/**
 * "Este celular tem o app e está com ele aberto" — para a tela Meu aplicativo
 * da loja no painel (instalações, ativos agora) e para a promoção chegar a
 * quem aceitou o termo e permitiu a notificação no celular.
 *
 * O app avisa o servidor (POST /api/app-da-loja/abertura) ao abrir, ao voltar
 * para a frente e de 4 em 4 minutos enquanto está na tela. Vai junto:
 * - um id SORTEADO na primeira abertura e guardado no SecureStore — não é o
 *   telefone, não é o id do aparelho, e some quando o app é desinstalado;
 * - o token de aviso, SÓ se o cliente já deixou avisar (aqui não se pede
 *   permissão nenhuma);
 * - se recebe promoção (termo aceito) e a versão do termo aceita.
 *
 * Nunca lança e nunca trava a tela: sem internet, o aviso só não chega.
 */
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { tokenDoAparelho } from "./avisos";
import { idDaInstalacao } from "./instalacao";
import { marca, urlDoSite } from "./marca";
import { VERSAO_DO_TERMO, termoAceito } from "./termo";

/** De quanto em quanto tempo avisa que segue aberto. O painel conta "ativo agora" até 5 min. */
export const BATIDA_MS = 4 * 60 * 1000;

/**
 * UMA permissão só (Douglas, 18/10/2026: "todo mundo que tem o app tem que
 * receber notificação" e "nada de botão de tirar notificação"). Quem aceitou o
 * termo (lib/termo.ts) e permitiu a notificação no celular recebe pedido E
 * promoção. Sair = desligar as notificações nos ajustes do celular (a linha
 * "Notificações" da aba Loja abre os ajustes — Apple 4.5.4).
 *
 * A única exceção é quem tocou "Agora não" na tela ANTIGA de promoções (antes
 * do termo): foi uma escolha explícita e continua valendo — esse celular
 * recebe só os avisos do pedido.
 */
const CHAVE_ANTIGA = "loja.promocoes";

export async function recusouPromocaoNaTelaAntiga(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(CHAVE_ANTIGA)) === "nao";
  } catch {
    return false;
  }
}

const CHAVE_DO_REPERGUNTA = "loja.notificacao.reperguntado";

/** Quem não permitiu a notificação é lembrado UMA vez, depois do primeiro pedido pelo app. */
export async function jaReperguntou(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(CHAVE_DO_REPERGUNTA)) === "sim";
  } catch {
    return true;
  }
}

export async function marcarReperguntado(): Promise<void> {
  try {
    await SecureStore.setItemAsync(CHAVE_DO_REPERGUNTA, "sim");
  } catch {
    /* sem onde guardar: no pior caso lembra mais uma vez */
  }
}

/** O cliente tocou numa notificação de promoção: conta como "aberta" no painel da loja. */
export async function avisarToque(envioId: unknown): Promise<void> {
  if (typeof envioId !== "string" || !envioId) return;
  try {
    await fetch(urlDoSite("/api/app-da-loja/notificacao-aberta"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ envioId, instalacaoId: await idDaInstalacao() }),
    });
  } catch {
    /* sem internet: o toque só não é contado */
  }
}

/** Avisa o servidor. `batida` = segue aberto (não conta como abertura nova). */
export async function avisarAbertura(batida = false): Promise<void> {
  try {
    const [instalacaoId, pushToken, recusou, termo] = await Promise.all([idDaInstalacao(), tokenDoAparelho(false), recusouPromocaoNaTelaAntiga(), termoAceito()]);
    // Promoção só depois do termo atual aceito; antes disso o servidor não muda nada.
    const comTermo = termo === VERSAO_DO_TERMO;
    await fetch(urlDoSite("/api/app-da-loja/abertura"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instalacaoId,
        pagina: marca.paginaInicial,
        pushToken,
        plataforma: Platform.OS,
        versaoDoApp: Constants.expoConfig?.version ?? null,
        app: marca.bundleId,
        promocoes: comTermo ? !recusou : null,
        termoVersao: termo,
        batida,
      }),
    });
  } catch {
    /* sem internet: fica para a próxima */
  }
}
