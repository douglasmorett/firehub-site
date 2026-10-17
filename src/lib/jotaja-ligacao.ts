/**
 * lib/jotaja-ligacao.ts — ligar/desligar o JotaJá numa loja (tela Integrações ›
 * JotaJá, rota /api/store/integracoes/jotaja). Fora da rota para o teste
 * (scripts/e2e-jotaja-por-loja-pglite.ts) chamar sem sessão.
 *
 * Integração é POR LOJA (lib/jotaja-loja.ts):
 * - credencial recusada, de outro restaurante, de vários, ou que já é de outra
 *   loja do FireHub → 400 e NADA é gravado (a credencial boa continua);
 * - JotaJá fora do ar / lento → 503 e nada muda, nem o "ligado";
 * - ao LIGAR (1ª vez, ou estava desligada) grava a hora da ligação e dá baixa
 *   nos pedidos de antes, que ficam no portal do JotaJá. Loja que já estava
 *   ligada (salvar de novo, trocar a credencial) não perde nada da fila.
 */
import { prisma } from "./prisma";
import { CredencialJotajaRecusada, darBaixaNaFila, filaDaCredencial, marcarLigacao } from "./jotaja-api";
import { conferirFilaNaLigacao, eventosDaLargada } from "./jotaja-loja";

const SELECAO = { id: true, email: true, jotajaClientId: true, jotajaMerchantId: true, jotajaConnected: true } as const;

export type RespostaDaLigacao = { status: number; corpo: Record<string, any> };

export async function ligarJotajaNaLoja(
  lojaId: string,
  entrada: { clientId?: string | null; clientSecret?: string | null; merchantId?: string | null; connected?: boolean },
): Promise<RespostaDaLigacao> {
  // ⚠️ Campo vazio NUNCA apaga credencial.
  // O formulário chegava em branco (o GET não devolve mais o secret) e o POST
  // gravava `null` nos três campos com jotajaConnected: true. O cron exige
  // clientId E secret não-nulos, então a loja saía da lista de polling para
  // sempre — com o painel continuando verde. Vazio agora significa "mantém".
  const atual = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { jotajaClientId: true, jotajaClientSecret: true, jotajaMerchantId: true, jotajaConnected: true },
  });

  const novoClientId = entrada.clientId?.trim() || atual?.jotajaClientId || null;
  const novoSecret = entrada.clientSecret?.trim() || atual?.jotajaClientSecret || null;
  const novoMerchant = entrada.merchantId?.trim() || atual?.jotajaMerchantId || null;

  // Desligar não precisa falar com o JotaJá nem mexe na credencial.
  if (entrada.connected === false) {
    const desligada = await prisma.user.update({ where: { id: lojaId }, data: { jotajaConnected: false }, select: SELECAO });
    return {
      status: 200,
      corpo: { ok: true, message: "Integração JotaJá desligada — nenhum pedido do JotaJá entra até ligar de novo.", autenticou: false, user: desligada },
    };
  }

  if (!novoClientId || !novoSecret) {
    return {
      status: 400,
      corpo: { error: "Informe o Client ID e o Client Secret do JotaJá — sem os dois a loja não entra no polling de pedidos." },
    };
  }

  const recusa = (erro: string, status = 400): RespostaDaLigacao => ({
    status,
    corpo: { error: `Não liguei: ${erro}. Nada foi alterado.` },
  });

  const outraComACredencial = await prisma.user.findFirst({
    where: { jotajaClientId: novoClientId, id: { not: lojaId }, ownerId: null, NOT: { email: { startsWith: "deleted_" } } },
    select: { storeName: true },
  });
  if (outraComACredencial) {
    return recusa(`essa credencial do JotaJá já está em outra loja do FireHub (${outraComACredencial.storeName || "outra conta"}) — cada loja usa a sua`);
  }

  const mesmaCredencial = novoClientId === atual?.jotajaClientId && novoSecret === atual?.jotajaClientSecret;
  let fila: any[];
  try {
    // Ler a fila já autentica — e mostra de que restaurante é a credencial.
    fila = await filaDaCredencial(novoClientId, novoSecret);
  } catch (e: any) {
    if (e instanceof CredencialJotajaRecusada) {
      // Prova de credencial ruim. Se era a que estava ligada, desliga (o cron
      // pararia de receber de qualquer jeito); credencial nova recusada não
      // substitui a que estava lá.
      if (mesmaCredencial && atual?.jotajaConnected) {
        await prisma.user.update({ where: { id: lojaId }, data: { jotajaConnected: false } });
        return {
          status: 400,
          corpo: { error: `${e.message}. A integração foi DESLIGADA — confira o Client ID e o Secret com o JotaJá.` },
        };
      }
      return recusa(`${e.message} — confira o Client ID e o Secret com o JotaJá`);
    }
    return recusa(`não consegui falar com o JotaJá agora (${e?.message || "erro de rede"}); tente de novo em alguns minutos`, 503);
  }

  // Salvar de novo o que já está ligado (mesma credencial, mesmo restaurante)
  // não trava a loja por causa de um evento estranho na fila — aquele pedido já
  // é recusado e avisado pelo poll —, só avisa. Ligar, religar ou trocar de
  // credencial passa pela conferência inteira.
  const conferida = conferirFilaNaLigacao(fila, novoMerchant);
  const jaLigadaAssim =
    mesmaCredencial && !!atual?.jotajaConnected && !!atual?.jotajaMerchantId && novoMerchant === atual.jotajaMerchantId;
  if (conferida.erro && !jaLigadaAssim) return recusa(conferida.erro);
  const aviso = conferida.erro ? ` ⚠️ Atenção: ${conferida.erro} — fale com o JotaJá.` : "";
  const merchant = jaLigadaAssim ? atual!.jotajaMerchantId : conferida.merchant;
  if (merchant) {
    const outra = await prisma.user.findFirst({
      where: { jotajaMerchantId: merchant, id: { not: lojaId }, ownerId: null, NOT: { email: { startsWith: "deleted_" } } },
      select: { storeName: true },
    });
    if (outra) return recusa(`o restaurante ${merchant} do JotaJá já está em outra loja do FireHub (${outra.storeName || "outra conta"})`);
  }

  // LIGANDO AGORA: os pedidos entram a partir deste instante. Os CREATED de
  // antes saem da fila já; o resto da fila segue o caminho normal, que aplica
  // a mesma regra (lib/jotaja-loja.ts › pedidoDeAntesDaLigacao).
  let foraDaLargada = 0;
  if (!atual?.jotajaConnected) {
    const ligadoEmMs = Date.now();
    await marcarLigacao(lojaId, novoClientId, ligadoEmMs);
    const deAntes = eventosDaLargada(fila, ligadoEmMs);
    if (deAntes.length > 0) {
      try {
        foraDaLargada = await darBaixaNaFila(novoClientId, novoSecret, deAntes);
      } catch (e: any) {
        // Não impede de ligar: o caminho normal ignora os mesmos pedidos.
        console.warn(`[JotaJá] baixa da largada falhou (${e?.message}) — o poll ignora os pedidos de antes da ligação`);
      }
    }
  }

  const ligada = await prisma.user.update({
    where: { id: lojaId },
    data: { jotajaClientId: novoClientId, jotajaClientSecret: novoSecret, jotajaMerchantId: merchant, jotajaConnected: true },
    select: SELECAO,
  });

  return {
    status: 200,
    corpo: {
      ok: true,
      message:
        `Integração JotaJá ligada — credencial aceita${merchant ? ` (restaurante ${merchant} no JotaJá)` : ""}.` +
        (foraDaLargada > 0 ? ` ${foraDaLargada} pedido(s) de antes de ligar ficaram no portal do JotaJá; os novos entram a partir de agora.` : "") +
        aviso,
      autenticou: true,
      foraDaLargada,
      user: ligada,
    },
  };
}
