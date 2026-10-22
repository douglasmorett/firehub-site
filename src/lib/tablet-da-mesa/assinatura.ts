/**
 * A ASSINATURA DO TABLET NA MESA — R$ 29,90 por tablet ativo no mês, numa
 * linha própria do boleto da mensalidade.
 *
 * Douglas, 22/10/2026: módulo novo, "a gente pode cobrar tipo 29,90 por
 * tablet ativo na mesa". O liga/desliga é o dos outros módulos pagos
 * (lib/modulo-pago.ts, mesmo desenho do Multimarcas):
 * - a PRIMEIRA ativação ganha 7 dias grátis; desligar e religar não dá outro;
 * - desligar no teste: na hora, sem cobrança; depois do teste: fica liberado
 *   até a virada do mês e desliga sozinho.
 *
 * O que muda é o valor: em vez de um preço fixo, conta os tablets que
 * FUNCIONARAM (TabletDaMesaUso) dentro do tempo cobrável do mês — ligado e
 * fora do teste. Tablet usado em qualquer dia = o mês inteiro, uma vez só.
 * O preço fica gravado no trecho, para um reajuste não mudar o combinado.
 *
 * Loja isenta (parceiro, conta da casa) tem o módulo liberado sem pagar, como
 * no Bill e no Multimarcas.
 */
import { prisma } from "@/lib/prisma";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "@/lib/modulo-pago";
import { garantirEstruturaDoTablet } from "./estrutura";
import { DIAS_DE_TESTE_DO_TABLET, PRECO_POR_TABLET } from "./preco";
import { VERSAO_DO_TERMO_DO_TABLET } from "./termo";

export { PRECO_POR_TABLET, DIAS_DE_TESTE_DO_TABLET };
const DIA_MS = 24 * 60 * 60 * 1000;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
/** Um trecho ligado. `ate` nulo = ligado agora. `valor` = o preço por tablet. */
export type TrechoDoTablet = { de: string; ate: string | null; valor: number; aceite?: AceiteDoTermo };
/** Um dia de uso de um tablet. */
export type UsoDoTablet = { tabletId: string; em: Date | string };

export type EstadoDoTablet = {
  ativo: boolean;
  testeAte: string | null;
  emTeste: boolean;
  jaTestou: boolean;
  isento: boolean;
  /** Preço por tablet: o do trecho ligado; desligado, o de quem ativar hoje. */
  preco: number;
  desligaEm: string | null;
  fimDoMes: string | null;
  /** Tablets que já entraram no boleto deste mês, e quanto dá. */
  tabletsCobradosEsteMes: number;
  valorEsteMes: number;
};

type Linha = { ativo: boolean; testeAte: Date | null; trechos: unknown };

async function lerLinha(lojaId: string): Promise<Linha | null> {
  const linhas = await prisma.$queryRawUnsafe<Linha[]>(
    `SELECT "ativo", "testeAte", "trechos" FROM "TabletDaMesaAssinatura" WHERE "franchiseeId" = $1`,
    lojaId,
  );
  return linhas[0] ?? null;
}

function lerTrechos(bruto: unknown): TrechoDoTablet[] {
  const lista = typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return []; } })() : bruto;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t: any) => t && typeof t.de === "string")
    .map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || PRECO_POR_TABLET }));
}

/**
 * Quanto o módulo custa no mês [inicio, fim). Puro, para o teste.
 * Cada tablet com uso dentro de um trecho ligado, depois do teste, entra uma
 * vez, pelo preço do trecho em que foi usado (dois trechos: vale o maior).
 */
export function valorDoTabletNoMes(
  trechos: TrechoDoTablet[],
  testeAte: Date | string | null | undefined,
  usos: UsoDoTablet[],
  inicio: Date,
  fim: Date,
  agora: Date = new Date(),
): { tablets: number; valor: number } {
  const fimDoTeste = testeAte ? new Date(testeAte).getTime() : 0;
  const ini = Math.max(inicio.getTime(), fimDoTeste);
  const fimMs = fim.getTime();
  if (ini >= fimMs) return { tablets: 0, valor: 0 };
  const precoPorTablet = new Map<string, number>();
  for (const u of usos) {
    const t = new Date(u.em).getTime();
    if (t < ini || t >= fimMs) continue;
    for (const tr of trechos) {
      const de = new Date(tr.de).getTime();
      const ate = tr.ate ? new Date(tr.ate).getTime() : Math.max(agora.getTime(), t + 1);
      if (t >= de && t < ate) precoPorTablet.set(u.tabletId, Math.max(precoPorTablet.get(u.tabletId) ?? 0, tr.valor));
    }
  }
  const valor = [...precoPorTablet.values()].reduce((s, v) => s + v, 0);
  return { tablets: precoPorTablet.size, valor: Math.round(valor * 100) / 100 };
}

/** A loja não paga: mesma regra (e mesmos campos) da mensalidade. */
export async function tabletIsento(lojaId: string): Promise<boolean> {
  try {
    const { lojaIsenta } = await import("@/lib/billing");
    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { email: true, planPercent: true, isFranqueadoHakim: true },
    });
    return lojaIsenta(loja as any);
  } catch {
    return false;
  }
}

async function mesCorrente(lojaId: string) {
  // Dinâmico: billing.ts importa este arquivo (também dinâmico) no fechamento.
  const { intervaloDoMes, getCurrentYearMonth } = await import("@/lib/billing");
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeTimezone: true } });
  const tz = loja?.storeTimezone || "America/Sao_Paulo";
  return intervaloDoMes(getCurrentYearMonth(0, tz), tz);
}

async function usosNoIntervalo(lojaId: string, inicio: Date, fim: Date): Promise<UsoDoTablet[]> {
  return prisma.$queryRawUnsafe<UsoDoTablet[]>(
    `SELECT "tabletId", "em" FROM "TabletDaMesaUso" WHERE "lojaId" = $1 AND "em" >= ($2::timestamptz AT TIME ZONE 'UTC') AND "em" < ($3::timestamptz AT TIME ZONE 'UTC')`,
    lojaId, inicio.toISOString(), fim.toISOString(),
  );
}

export async function estadoDoTablet(lojaId: string, agora: Date = new Date()): Promise<EstadoDoTablet> {
  const isento = await tabletIsento(lojaId);
  let fimDoMes: string | null = null;
  let mes: { monthStart: Date; monthEnd: Date } | null = null;
  try { mes = await mesCorrente(lojaId); fimDoMes = mes.monthEnd.toISOString(); } catch {}
  const vazio: EstadoDoTablet = { ativo: isento, testeAte: null, emTeste: false, jaTestou: false, isento, preco: PRECO_POR_TABLET, desligaEm: null, fimDoMes, tabletsCobradosEsteMes: 0, valorEsteMes: 0 };
  if (!(await garantirEstruturaDoTablet())) return vazio;
  const a = await lerLinha(lojaId);
  if (!a) return vazio;
  const trechos = lerTrechos(a.trechos);
  const ligado = ligadoAgora(trechos, agora);
  let cobrado = { tablets: 0, valor: 0 };
  if (!isento && mes) {
    try { cobrado = valorDoTabletNoMes(trechos, a.testeAte, await usosNoIntervalo(lojaId, mes.monthStart, mes.monthEnd), mes.monthStart, mes.monthEnd, agora); } catch {}
  }
  const aberto = trechos.find((t) => !t.ate || new Date(t.ate).getTime() > agora.getTime());
  return {
    ativo: ligado || isento,
    testeAte: a.testeAte ? new Date(a.testeAte).toISOString() : null,
    emTeste: Boolean(!isento && ligado && a.testeAte && new Date(a.testeAte).getTime() > agora.getTime()),
    jaTestou: Boolean(a.testeAte),
    isento,
    preco: ligado && aberto ? aberto.valor : PRECO_POR_TABLET,
    desligaEm: isento ? null : desligamentoMarcado(trechos, agora),
    fimDoMes,
    tabletsCobradosEsteMes: cobrado.tablets,
    valorEsteMes: cobrado.valor,
  };
}

/** Para o tablet e para o pareamento: ligado (ou loja isenta). Nunca lança. */
export async function tabletEstaLigado(lojaId: string): Promise<boolean> {
  try {
    if (await garantirEstruturaDoTablet()) {
      const a = await lerLinha(lojaId);
      if (a && ligadoAgora(lerTrechos(a.trechos))) return true;
    }
    return await tabletIsento(lojaId);
  } catch {
    return false;
  }
}

export class TermoNaoAceitoError extends Error {}

/** Liga (abre um trecho, com o aceite do termo) ou desliga — a regra do Multimarcas. */
export async function ligarOuDesligarTablet(
  lojaId: string,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDoTablet> {
  if (await tabletIsento(lojaId)) return estadoDoTablet(lojaId, agora);
  if (!(await garantirEstruturaDoTablet())) throw new Error("O Tablet na mesa ainda não está disponível. Tente de novo em alguns minutos.");
  const atual = await lerLinha(lojaId);
  const trechos = lerTrechos(atual?.trechos);
  const iso = agora.toISOString();
  const ligado = ligadoAgora(trechos, agora);
  const salvar = (ativo: boolean) => prisma.$executeRawUnsafe(
    `UPDATE "TabletDaMesaAssinatura" SET "ativo" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW() WHERE "franchiseeId" = $1`,
    lojaId, ativo, JSON.stringify(trechos),
  );

  if (ligar) {
    if (ligado) {
      const marcado = trechos.find((t) => t.ate && new Date(t.ate).getTime() > agora.getTime() && new Date(t.de).getTime() <= agora.getTime());
      if (marcado) { marcado.ate = null; await salvar(true); }
      return estadoDoTablet(lojaId, agora);
    }
    if (!aceite || aceite.versao !== VERSAO_DO_TERMO_DO_TABLET) {
      throw new TermoNaoAceitoError("Para ativar o Tablet na mesa é preciso aceitar o termo de contratação.");
    }
    trechos.push({ de: iso, ate: null, valor: PRECO_POR_TABLET, aceite: { ...aceite, em: iso } });
    const testeAte = atual?.testeAte ?? new Date(agora.getTime() + DIAS_DE_TESTE_DO_TABLET * DIA_MS);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "TabletDaMesaAssinatura" ("franchiseeId", "ativo", "testeAte", "trechos", "atualizadoEm")
       VALUES ($1, true, ($2::timestamptz AT TIME ZONE 'UTC'), $3::jsonb, NOW())
       ON CONFLICT ("franchiseeId") DO UPDATE SET "ativo" = true, "testeAte" = ($2::timestamptz AT TIME ZONE 'UTC'), "trechos" = $3::jsonb, "atualizadoEm" = NOW()`,
      lojaId, new Date(testeAte).toISOString(), JSON.stringify(trechos),
    );
  } else {
    if (!ligado) return estadoDoTablet(lojaId, agora);
    const { monthEnd } = await mesCorrente(lojaId);
    const { naHora, ate } = quandoDesliga(atual?.testeAte, monthEnd, agora);
    for (const t of trechos) if (!t.ate || new Date(t.ate).getTime() > agora.getTime()) t.ate = ate.toISOString();
    await salvar(!naHora);
  }
  return estadoDoTablet(lojaId, agora);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDoTabletNoMes(lojaId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDoTablet())) return 0;
    if (await tabletIsento(lojaId)) return 0;
    const a = await lerLinha(lojaId);
    if (!a) return 0;
    return valorDoTabletNoMes(lerTrechos(a.trechos), a.testeAte, await usosNoIntervalo(lojaId, inicio, fim), inicio, fim).valor;
  } catch (err: any) {
    console.error("[Tablet na mesa] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
