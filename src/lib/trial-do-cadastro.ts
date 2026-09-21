/**
 * QUANTOS DIAS DE TESTE O LINK DÁ.
 *
 * ── Por que isto é uma função, e não um número em cada arquivo ────────────
 *
 * O prazo aparece em DOIS lugares que precisam concordar até o último dia:
 *
 *   • a TELA de cadastro, que escreve "X dias grátis" três vezes;
 *   • a ROTA de cadastro, que grava `trialEndsAt` na conta.
 *
 * Eles já divergiram uma vez: a tela consultava /api/check-ref e anunciava 30
 * dias para link de embaixador depois que a rota tinha voltado a gravar 15 —
 * o lojista descobria na metade do prazo. O comentário que restou daquele
 * conserto dizia "os dois lados mudam juntos, sempre", e a única forma de
 * garantir isso é os dois lados lerem a MESMA função.
 *
 * ── Os 30 dias do FireHub Conect ─────────────────────────────────────────
 *
 * O QR do slide da palestra (21/09/2026) leva para /cadastro?ref=conect e a
 * tela atrás do palestrante promete "30 dias Grátis". Sem esta lista, o
 * `refCode` só servia para achar embaixador ou parceiro — "conect" não é
 * nenhum dos dois, caía fora, e a conta nascia com os 15 de sempre.
 *
 * LISTA EXPLÍCITA, e não "tem ref, então 30": link de embaixador continua com
 * o prazo de todo mundo (decisão comercial de 26/08/2026), e um código novo só
 * ganha prazo maior quando alguém o puser aqui de propósito.
 */

/** O prazo de todo mundo. */
export const TRIAL_PADRAO_DIAS = 15;

/** Códigos de campanha que dão o prazo dobrado. Tudo minúsculo. */
export const CODIGOS_DE_TRIAL_ESTENDIDO: Record<string, number> = {
  conect: 30,
  firehubconect: 30,
};

/**
 * Os dias de teste que este `?ref=` concede.
 *
 * Código desconhecido, vazio ou ausente cai no prazo padrão — nunca em zero,
 * que deixaria a conta nascer sem teste nenhum.
 */
export function diasDeTesteDoLink(refCode: string | null | undefined): number {
  const code = String(refCode || "").toLowerCase().trim();
  return CODIGOS_DE_TRIAL_ESTENDIDO[code] ?? TRIAL_PADRAO_DIAS;
}
