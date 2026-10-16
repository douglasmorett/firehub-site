/**
 * src/lib/loja-bloqueada.ts — "ESTA LOJA ESTÁ BLOQUEADA POR MENSALIDADE AGORA?"
 *
 * Até 16/10/2026 o bloqueio existia só na TELA do painel (app/store/layout.tsx
 * cobria tudo com "Sua conta está bloqueada"). O servidor seguia trabalhando
 * para a loja: o iFood continuava sendo puxado e importado, o robô de IA do
 * WhatsApp respondia (e gastava modelo), o cardápio público e o totem fechavam
 * pedido. A NATAL LANCHES, com setembro em aberto e travada desde 11/10,
 * recebia pedido do iFood todo dia — e o painel aberto por baixo da tela de
 * bloqueio continuava puxando eventos a cada 5 s. Dono: "a loja bloqueada
 * continua gastando dinheiro do FireHub".
 *
 * A regra é UMA, a da tela, e mora aqui:
 *   - a conta é de loja (FRANCHISEE ou STAFF; o ADMIN nunca trava);
 *   - não é loja especial (Hakim — `isFranqueadoHakim` ou contatohakim@ — nem
 *     viniciusmenezes.ofc@);
 *   - não é o computador da loja em contingência (`FIREHUB_LOCAL=1`);
 *   - existe ciclo CLOSED com `amountPending` > 0 (o mais recente) e já passou
 *     o bloqueio dele (`bloqueioDoCiclo`: fim do dia 10 do mês seguinte, ou o
 *     prazo dado à mão em lib/prazo-da-mensalidade.ts).
 * Mensalidade perdoada (FORGIVEN), isenta ou paga (PAID / amountPending 0) não
 * casa com a consulta e não trava.
 *
 * O layout usa as funções puras (`ehLojaEspecial`, `cicloBloqueia`) sem cache —
 * a tela precisa da fatura fresca para "Já paguei — conferir de novo". Os
 * canais que recebem pedido usam `lojaBloqueadaPorMensalidade`, com cache de
 * 60 s por loja: uma consulta por loja por minuto, não uma por pedido ou por
 * mensagem. Pagou, o ciclo vira PAID e em até 1 minuto a loja volta a receber
 * sozinha.
 *
 * Erro ao ler o banco = NÃO bloqueia (igual ao layout): travar venda de loja em
 * dia por causa de um tropeço nosso é pior do que deixar passar um pedido.
 */
import { bloqueioDoCiclo } from "./prazo-da-mensalidade";

/** E-mails que nunca travam (mesma lista do layout). */
const EMAIL_HAKIM = "contatohakim@gmail.com";
const EMAILS_ESPECIAIS = new Set([EMAIL_HAKIM, "viniciusmenezes.ofc@gmail.com"]);

/** Mensagem para quem está do lado de fora (cliente, totem, mesa). Nunca fala de dívida. */
export const MENSAGEM_LOJA_INDISPONIVEL =
  "Loja temporariamente indisponível. Não é possível fazer pedidos no momento.";

/** Mensagem para o próprio lojista (rotas do painel). */
export const MENSAGEM_CONTA_BLOQUEADA =
  "Conta bloqueada por mensalidade em aberto. Pague a fatura para voltar a receber pedidos.";

export function limparEmail(email?: string | null): string {
  return (email || "").toLowerCase().replace(/\s+/g, "");
}

/**
 * Loja que nunca trava por mensalidade. `donoDaLoja` é a conta dona do ciclo
 * (o dono do funcionário, ou a própria loja); `conta` é quem está logado / a
 * conta do pedido. Exatamente o `isSpecialStore` do layout.
 */
export function ehLojaEspecial(
  donoDaLoja: { email?: string | null; isFranqueadoHakim?: boolean | null } | null | undefined,
  conta?: { email?: string | null; isFranqueadoHakim?: boolean | null } | null,
): boolean {
  const email = limparEmail(donoDaLoja?.email || conta?.email);
  if (donoDaLoja?.isFranqueadoHakim === true || conta?.isFranqueadoHakim === true) return true;
  return EMAILS_ESPECIAIS.has(email);
}

/** O ciclo em aberto já passou do dia do bloqueio? */
export function cicloBloqueia(
  ciclo: { yearMonth: string; closedAt?: Date | string | null; amountPending: number; status?: string | null } | null | undefined,
  emailDaLoja: string | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!ciclo) return false;
  if (ciclo.status && ciclo.status !== "CLOSED") return false;
  if (!(ciclo.amountPending > 0)) return false;
  return agora >= bloqueioDoCiclo(ciclo, limparEmail(emailDaLoja));
}

export type ContaParaBloqueio = {
  role?: string | null;
  email?: string | null;
  isFranqueadoHakim?: boolean | null;
};

/**
 * A decisão inteira, pura (é o que scripts/teste-loja-bloqueada.ts prova).
 * `conta` = a conta da loja do pedido; `dono` = a dona dela (ownerId), ou a
 * própria conta quando não há dono.
 */
export function decidirBloqueio(opts: {
  conta: ContaParaBloqueio | null | undefined;
  dono?: ContaParaBloqueio | null;
  ciclo: Parameters<typeof cicloBloqueia>[0];
  agora?: Date;
  modoLocal?: boolean;
}): boolean {
  const { conta } = opts;
  const dono = opts.dono || conta;
  if (!conta) return false;
  if (opts.modoLocal) return false;
  if (conta.role !== "FRANCHISEE" && conta.role !== "STAFF") return false;
  if (ehLojaEspecial(dono, conta)) return false;
  return cicloBloqueia(opts.ciclo, dono?.email || conta.email, opts.agora || new Date());
}

/**
 * Tira da lista as lojas bloqueadas — para os crons de marketplace, que nem
 * chegam a puxar a fila delas. `log` recebe uma linha por loja deixada de fora.
 */
export async function semLojasBloqueadas<T extends { id: string; storeName?: string | null; email?: string | null }>(
  lojas: T[],
  log?: string[],
): Promise<T[]> {
  const ficam: T[] = [];
  for (const loja of lojas) {
    if (await lojaBloqueadaPorMensalidade(loja.id)) {
      log?.push(`[bloqueio] ${loja.storeName || loja.email || loja.id}: bloqueada por mensalidade — fila não puxada`);
      continue;
    }
    ficam.push(loja);
  }
  return ficam;
}

// ── Cache curto, por loja ───────────────────────────────────────────────────
const TTL_MS = 60_000;
const cache = new Map<string, { bloqueada: boolean; ate: number }>();

/** Só para testes / depois de dar baixa à mão: esquece o que sabia da loja. */
export function esquecerBloqueio(lojaId?: string) {
  if (lojaId) cache.delete(lojaId);
  else cache.clear();
}

/**
 * A loja (franchiseeId do pedido — a conta da loja, não do funcionário) está
 * bloqueada por mensalidade agora? Cache de 60 s; erro de banco = não.
 */
export async function lojaBloqueadaPorMensalidade(lojaId: string | null | undefined): Promise<boolean> {
  if (!lojaId) return false;
  if (process.env.FIREHUB_LOCAL === "1") return false;

  const agora = Date.now();
  const guardado = cache.get(lojaId);
  if (guardado && guardado.ate > agora) return guardado.bloqueada;

  let bloqueada = false;
  try {
    const { prisma } = await import("./prisma");
    const campos = { id: true, role: true, email: true, isFranqueadoHakim: true, ownerId: true } as const;
    const conta = await prisma.user.findUnique({ where: { id: lojaId }, select: campos });
    if (conta) {
      const dono = conta.ownerId
        ? (await prisma.user.findUnique({ where: { id: conta.ownerId }, select: campos })) || conta
        : conta;
      const ciclo = await prisma.franchiseeBillingCycle.findFirst({
        where: { franchiseeId: dono.id, status: "CLOSED", amountPending: { gt: 0 } },
        orderBy: { closedAt: "desc" },
        select: { yearMonth: true, closedAt: true, amountPending: true, status: true },
      });
      bloqueada = decidirBloqueio({ conta, dono, ciclo, agora: new Date(agora) });
    }
  } catch (e: any) {
    console.error(`[loja-bloqueada] Erro ao conferir ${lojaId}: ${e?.message}`);
    bloqueada = false;
  }

  // Sem crescer para sempre: a lista de lojas é pequena, mas a faxina é barata.
  if (cache.size > 5000) cache.clear();
  cache.set(lojaId, { bloqueada, ate: agora + TTL_MS });
  return bloqueada;
}
