/**
 * lib/jotaja-instavel-regras.ts — as regras puras de "JotaJá fora do ar", sem
 * banco (teste: scripts/teste-jotaja-instavel.ts). O resto, com as tabelas e
 * os avisos, está em lib/jotaja-instavel.ts.
 */

export const CANAL = "JotaJá";
/** Rodadas seguidas do cron com a fila falhando antes de avisar. */
export const FALHAS_PARA_AVISAR = 2;
/** Ação pendente mais velha que isto é descartada: o pedido já acabou. */
export const VALIDADE_DA_ACAO_MS = 3 * 3600_000;
export const TENTATIVAS_DA_ACAO = 90;

export function hora(ms: number, fuso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

export function deveAvisarQueda(falhas: number, avisadoEmMs: number | null | undefined): boolean {
  return falhas >= FALHAS_PARA_AVISAR && !avisadoEmMs;
}

export function textoDaQueda(loja: string, desdeMs: number, erro: string, fuso: string): string {
  return (
    `⚠️ *${CANAL} fora do ar* — ${loja}\n\n` +
    `Desde ${hora(desdeMs, fuso)} a API do ${CANAL} não responde (${erro}). ` +
    `Pedido feito no ${CANAL} agora pode NÃO entrar no FireHub: confira o portal do ${CANAL} ` +
    `e atenda por lá o que não aparecer aqui.\n\nAviso de novo quando voltar.`
  );
}

export function textoDaVolta(loja: string, desdeMs: number, agoraMs: number, fuso: string): string {
  return (
    `✅ *${CANAL} voltou* — ${loja}\n\n` +
    `A API do ${CANAL} ficou instável das ${hora(desdeMs, fuso)} às ${hora(agoraMs, fuso)}. ` +
    `Pedido feito no ${CANAL} nesse período pode ter ficado só no portal deles: confira lá se falta algum aqui.`
  );
}

/**
 * Chama o JotaJá com até 3 tentativas: erro de rede ou 5xx deles costuma
 * passar em segundos, e a rodada do cron é a cada minuto. 4xx não repete.
 * A última resposta 5xx é devolvida (quem chama trata o `!ok`); exceção na
 * última tentativa sobe.
 */
export async function comNovaTentativa(
  chamar: () => Promise<Response>,
  tentativas = 3,
  esperaMs = 1500,
): Promise<Response> {
  let ultimoErro: unknown = new Error("sem resposta");
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await chamar();
      if (r.status < 500 || i === tentativas) return r;
    } catch (e) {
      ultimoErro = e;
      if (i === tentativas) throw e;
    }
    await new Promise((f) => setTimeout(f, esperaMs));
  }
  throw ultimoErro;
}

export type AcaoPendente = {
  id: number;
  orderId: string;
  path: string;
  rotulo: string;
  tentativas: number;
  criadoEmMs: number;
};

/** As ações na ordem em que aconteceram (confirmar antes de despachar) e as que já venceram. */
export function separarAcoes<T extends { tentativas: number; criadoEmMs: number }>(
  linhas: T[],
  agoraMs: number,
): { reenviar: T[]; descartar: T[] } {
  const reenviar: T[] = [];
  const descartar: T[] = [];
  for (const l of [...linhas].sort((a, b) => a.criadoEmMs - b.criadoEmMs)) {
    if (agoraMs - l.criadoEmMs > VALIDADE_DA_ACAO_MS || l.tentativas >= TENTATIVAS_DA_ACAO) descartar.push(l);
    else reenviar.push(l);
  }
  return { reenviar, descartar };
}
