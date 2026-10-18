/**
 * "Este celular tem o app e está com ele aberto" — para a tela Meu aplicativo
 * da loja no painel (instalações, ativos agora) e para a promoção chegar só a
 * quem aceitou.
 *
 * O app avisa o servidor (POST /api/app-da-loja/abertura) ao abrir, ao voltar
 * para a frente e de 4 em 4 minutos enquanto está na tela. Vai junto:
 * - um id SORTEADO na primeira abertura e guardado no SecureStore — não é o
 *   telefone, não é o id do aparelho, e some quando o app é desinstalado;
 * - o token de aviso, SÓ se o cliente já deixou avisar (aqui não se pede
 *   permissão nenhuma);
 * - a resposta da pergunta "Quer receber promoções?" (null = não respondeu).
 *
 * Nunca lança e nunca trava a tela: sem internet, o aviso só não chega.
 */
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { tokenDoAparelho } from "./avisos";
import { idDaInstalacao } from "./instalacao";
import { marca, urlDoSite } from "./marca";

/** De quanto em quanto tempo avisa que segue aberto. O painel conta "ativo agora" até 5 min. */
export const BATIDA_MS = 4 * 60 * 1000;

const CHAVE_DAS_PROMOCOES = "loja.promocoes";

export type RespostaDasPromocoes = "sim" | "nao" | null;

export async function respostaDasPromocoes(): Promise<RespostaDasPromocoes> {
  try {
    const v = await SecureStore.getItemAsync(CHAVE_DAS_PROMOCOES);
    return v === "sim" || v === "nao" ? v : null;
  } catch {
    return null;
  }
}

export async function guardarRespostaDasPromocoes(r: "sim" | "nao"): Promise<void> {
  try {
    await SecureStore.setItemAsync(CHAVE_DAS_PROMOCOES, r);
  } catch {
    /* sem onde guardar: a pergunta volta na próxima abertura */
  }
}

const CHAVE_DO_REPERGUNTA = "loja.promocoes.reperguntado";

/** Quem disse "agora não" é perguntado de novo UMA vez, depois do primeiro pedido pelo app. */
export async function podeReperguntar(): Promise<boolean> {
  try {
    if ((await respostaDasPromocoes()) !== "nao") return false;
    return (await SecureStore.getItemAsync(CHAVE_DO_REPERGUNTA)) !== "sim";
  } catch {
    return false;
  }
}

export async function marcarReperguntado(): Promise<void> {
  try {
    await SecureStore.setItemAsync(CHAVE_DO_REPERGUNTA, "sim");
  } catch {
    /* sem onde guardar: no pior caso pergunta mais uma vez */
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
    const [instalacaoId, pushToken, promocoes] = await Promise.all([idDaInstalacao(), tokenDoAparelho(false), respostaDasPromocoes()]);
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
        promocoes: promocoes === null ? null : promocoes === "sim",
        batida,
      }),
    });
  } catch {
    /* sem internet: fica para a próxima */
  }
}
