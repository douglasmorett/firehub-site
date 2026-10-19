/**
 * INDIQUE E GANHE ENTRE LOJISTAS — a parte que fala com o banco. A regra mora
 * em lib/indique-e-ganhe.ts.
 *
 * ── A TABELA "IndicacaoLojista" ─────────────────────────────────────────────
 *
 * Uma linha por loja INDICADA (`indicadaId` único): quem indicou (a loja
 * principal da conta), o crédito de R$ 100 quando a indicada paga a primeira
 * mensalidade, quanto dele já foi usado e em qual ciclo (`usos`).
 *
 * Fora do schema.prisma de propósito, como CashbackAjuste
 * (lib/cashback-no-banco.ts): o acesso é por SQL cru, o boot cria a tabela
 * (instrumentation.ts) e as funções daqui chamam `garantirTabelaDeIndicacoes`
 * antes de ler. Se a tabela faltar, a leitura devolve "nenhuma indicação" e a
 * mensalidade sai como sempre saiu — nunca um 500 no fechamento, no webhook
 * do Asaas ou no cadastro.
 *
 * Nada aqui grava em `User` (nem `referredById`, nem `ambassadorId`, nem
 * `asaasWalletId`): o programa é só desconto, nunca split.
 */
import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { executarDDL } from "./ddl-do-boot";
import {
  abaterCreditos,
  cicloGeraCredito,
  codigoDaIndicacao,
  contaDaLoja,
  indicadosAtivosPagantes,
  isentaPorIndicacoes,
  motivoDaRecusa,
  previsaoDoAbatimento,
  saldoTotal,
  situacaoDaIndicacao,
  VALOR_DO_CREDITO,
  type CreditoDaIndicacao,
  type LojaNaIndicacao,
  type SituacaoDaIndicacao,
  type UsoDoCredito,
} from "./indique-e-ganhe";
import type { CicloNasRegras } from "./parceiro/regras";

let tabelaOk = false;

/** A tabela existe? Uma vez por processo — e só marca DEPOIS de conseguir. */
export async function garantirTabelaDeIndicacoes(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await executarDDL("indique-e-ganhe", [
      `CREATE TABLE IF NOT EXISTS "IndicacaoLojista" (
      "id" TEXT NOT NULL,
      "indicadoraId" TEXT NOT NULL,
      "indicadaId" TEXT NOT NULL,
      "codigoUsado" TEXT,
      "recusadaMotivo" TEXT,
      "creditoValor" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "creditoGeradoEm" TIMESTAMP(3),
      "cicloPagoId" TEXT,
      "creditoUsado" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "usos" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "IndicacaoLojista_pkey" PRIMARY KEY ("id")
    )`,
      // A trava do "um por loja indicada": duas indicações para a mesma loja
      // não existem, e o crédito mora na linha dela.
      `CREATE UNIQUE INDEX IF NOT EXISTS "IndicacaoLojista_indicadaId_key" ON "IndicacaoLojista"("indicadaId")`,
      `CREATE INDEX IF NOT EXISTS "IndicacaoLojista_indicadoraId_idx" ON "IndicacaoLojista"("indicadoraId")`,
    ]);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Indique e Ganhe] 🛑 Tabela IndicacaoLojista falhou: ${err?.message}`);
    return false;
  }
}

type LinhaDaIndicacao = CreditoDaIndicacao & {
  indicadoraId: string;
  indicadaId: string;
  recusadaMotivo: string | null;
  cicloPagoId: string | null;
  createdAt: Date;
};

const usosDe = (bruto: unknown): UsoDoCredito[] => (Array.isArray(bruto) ? (bruto as UsoDoCredito[]) : []);

async function indicacoesDaConta(indicadoraId: string): Promise<LinhaDaIndicacao[]> {
  if (!(await garantirTabelaDeIndicacoes())) return [];
  try {
    const linhas = await prisma.$queryRaw<LinhaDaIndicacao[]>`
      SELECT "id", "indicadoraId", "indicadaId", "recusadaMotivo", "creditoValor", "creditoGeradoEm",
             "cicloPagoId", "creditoUsado", "usos", "createdAt"
      FROM "IndicacaoLojista"
      WHERE "indicadoraId" = ${indicadoraId}
      ORDER BY "createdAt" ASC`;
    return linhas.map((l) => ({ ...l, usos: usosDe(l.usos) }));
  } catch (err: any) {
    console.error(`[Indique e Ganhe] leitura falhou: ${err?.message}`);
    return [];
  }
}

const CAMPOS_DA_LOJA = {
  id: true, role: true, accountGroupId: true, ownerId: true, cpfCnpj: true, onboardingData: true,
} as const;

function lojaNaIndicacao(u: { id: string; role: string; accountGroupId: string | null; ownerId: string | null; cpfCnpj: string | null; onboardingData: unknown }): LojaNaIndicacao {
  const od = (u.onboardingData && typeof u.onboardingData === "object" ? u.onboardingData : {}) as Record<string, unknown>;
  return {
    id: u.id, role: u.role, accountGroupId: u.accountGroupId, ownerId: u.ownerId, cpfCnpj: u.cpfCnpj,
    cpfDoResponsavel: typeof od.cpfDoResponsavel === "string" ? od.cpfDoResponsavel : null,
  };
}

// ── O cadastro ──────────────────────────────────────────────────────────────

/** A loja dona do código (slug, id ou slug antigo), já resolvida para a principal da conta. */
async function indicadoraDoCodigo(codigo: string) {
  let loja = await prisma.user.findFirst({ where: { OR: [{ slug: codigo }, { id: codigo }] }, select: CAMPOS_DA_LOJA });
  if (!loja) {
    try {
      loja = await prisma.user.findFirst({ where: { slugsAntigos: { array_contains: codigo } }, select: CAMPOS_DA_LOJA });
    } catch {
      loja = null; // coluna ausente num container velho: sem slug antigo, como antes
    }
  }
  if (!loja) return null;
  const conta = contaDaLoja(loja);
  if (conta === loja.id) return loja;
  return (await prisma.user.findUnique({ where: { id: conta }, select: CAMPOS_DA_LOJA })) ?? loja;
}

/**
 * Grava quem indicou a loja que acabou de nascer (api/register). Nunca lança:
 * o cadastro vale mais do que a indicação. Indicação que não vale (a própria
 * conta, o mesmo CPF/CNPJ) fica gravada com o motivo, para o admin ver por
 * que não gerou crédito — e a loja que indicou vê "não vale" na lista dela.
 */
export async function registrarIndicacaoNoCadastro(indicadaId: string, codigoBruto: unknown): Promise<void> {
  const codigo = codigoDaIndicacao(codigoBruto);
  if (!codigo) return;
  try {
    if (!(await garantirTabelaDeIndicacoes())) return;
    const [indicadora, indicada] = await Promise.all([
      indicadoraDoCodigo(codigo),
      prisma.user.findUnique({ where: { id: indicadaId }, select: CAMPOS_DA_LOJA }),
    ]);
    if (!indicadora || !indicada) return;
    const motivo = motivoDaRecusa(lojaNaIndicacao(indicadora), lojaNaIndicacao(indicada));
    await prisma.$executeRaw`
      INSERT INTO "IndicacaoLojista" ("id", "indicadoraId", "indicadaId", "codigoUsado", "recusadaMotivo")
      VALUES (${randomUUID()}, ${indicadora.id}, ${indicada.id}, ${codigo}, ${motivo})
      ON CONFLICT ("indicadaId") DO NOTHING`;
  } catch (err: any) {
    console.error(`[Indique e Ganhe] não gravou a indicação da loja ${indicadaId}: ${err?.message}`);
  }
}

// ── O gatilho (lib/pagamento-da-mensalidade.ts) ─────────────────────────────

/**
 * A loja pagou uma mensalidade: se foi indicada e ainda não gerou crédito,
 * gera os R$ 100 para quem indicou. Idempotente pelo próprio UPDATE
 * (`creditoGeradoEm IS NULL`): webhook repetido, a conferência de meia em
 * meia hora e o segundo mês pago não geram nada. Nunca lança.
 *
 * A elegibilidade é conferida DE NOVO aqui: entre o cadastro e o pagamento a
 * loja indicada pode ter sido movida para a conta de quem indicou.
 */
export async function creditarIndicacaoPelaMensalidadePaga(cicloId: string): Promise<boolean> {
  try {
    if (!(await garantirTabelaDeIndicacoes())) return false;
    const ciclo = await prisma.franchiseeBillingCycle.findUnique({
      where: { id: cicloId },
      select: { id: true, franchiseeId: true, status: true, paidAt: true, amountDue: true },
    });
    if (!ciclo || !cicloGeraCredito(ciclo)) return false;

    const [ind] = await prisma.$queryRaw<{ id: string; indicadoraId: string; creditoGeradoEm: Date | null; recusadaMotivo: string | null }[]>`
      SELECT "id", "indicadoraId", "creditoGeradoEm", "recusadaMotivo" FROM "IndicacaoLojista" WHERE "indicadaId" = ${ciclo.franchiseeId}`;
    if (!ind || ind.creditoGeradoEm || ind.recusadaMotivo) return false;

    const [indicadora, indicada] = await Promise.all([
      prisma.user.findUnique({ where: { id: ind.indicadoraId }, select: CAMPOS_DA_LOJA }),
      prisma.user.findUnique({ where: { id: ciclo.franchiseeId }, select: CAMPOS_DA_LOJA }),
    ]);
    const motivo = indicadora && indicada ? motivoDaRecusa(lojaNaIndicacao(indicadora), lojaNaIndicacao(indicada)) : "INDICADORA_INVALIDA";
    if (motivo) {
      await prisma.$executeRaw`
        UPDATE "IndicacaoLojista" SET "recusadaMotivo" = ${motivo} WHERE "id" = ${ind.id} AND "creditoGeradoEm" IS NULL`;
      console.warn(`[Indique e Ganhe] Loja ${ciclo.franchiseeId} pagou, mas a indicação não vale (${motivo}).`);
      return false;
    }

    const gravou = await prisma.$executeRaw`
      UPDATE "IndicacaoLojista"
      SET "creditoValor" = ${VALOR_DO_CREDITO}, "creditoGeradoEm" = NOW(), "cicloPagoId" = ${ciclo.id}
      WHERE "id" = ${ind.id} AND "creditoGeradoEm" IS NULL AND "recusadaMotivo" IS NULL`;
    if (Number(gravou) > 0) {
      console.log(`[Indique e Ganhe] Crédito de R$ ${VALOR_DO_CREDITO} para a loja ${ind.indicadoraId} (indicou ${ciclo.franchiseeId}, ciclo ${ciclo.id}).`);
      return true;
    }
    return false;
  } catch (err: any) {
    console.error(`[Indique e Ganhe] crédito do ciclo ${cicloId} falhou: ${err?.message}`);
    return false;
  }
}

// ── A isenção ───────────────────────────────────────────────────────────────

const CAMPOS_DO_CICLO = {
  yearMonth: true, status: true, amountDue: true, amountPending: true, asaasPaymentId: true, asaasBoletoUrl: true,
  dueDate: true, closedAt: true, paidAt: true, paidValue: true, paidNetValue: true, asaasStatus: true, notes: true,
} as const;

/** Quantos indicados da conta estão ativos e pagantes agora (lib/indique-e-ganhe.ts, `indicadaAtivaPagante`). */
async function contarAtivosPagantes(indicadas: string[], agora: Date): Promise<number> {
  if (indicadas.length === 0) return 0;
  const [lojas, ciclos] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: indicadas } }, select: { id: true, role: true, trialEndsAt: true } }),
    prisma.franchiseeBillingCycle.findMany({
      where: { franchiseeId: { in: indicadas }, status: { not: "OPEN" } },
      select: { franchiseeId: true, ...CAMPOS_DO_CICLO },
    }),
  ]);
  const porLoja = new Map<string, CicloNasRegras[]>();
  for (const { franchiseeId, ...c } of ciclos) {
    const lista = porLoja.get(franchiseeId) || [];
    lista.push(c);
    porLoja.set(franchiseeId, lista);
  }
  return indicadosAtivosPagantes(lojas.map((l) => ({ ...l, ciclos: porLoja.get(l.id) || [] })), agora);
}

export type IndiqueEGanheDaLoja = {
  /** A loja é a principal da conta — só ela tem crédito e isenção. */
  principal: boolean;
  ativosPagantes: number;
  isenta: boolean;
  saldo: number;
};

/** O resumo do programa para uma loja — o que a previsão do painel e o fechamento leem. */
export async function indiqueEGanheDaLoja(loja: { id: string; accountGroupId: string | null }, agora = new Date()): Promise<IndiqueEGanheDaLoja> {
  const nada: IndiqueEGanheDaLoja = { principal: false, ativosPagantes: 0, isenta: false, saldo: 0 };
  if (contaDaLoja(loja) !== loja.id) return nada;
  const linhas = await indicacoesDaConta(loja.id);
  if (linhas.length === 0) return { ...nada, principal: true };
  try {
    const validas = linhas.filter((l) => !l.recusadaMotivo);
    const ativosPagantes = await contarAtivosPagantes(validas.map((l) => l.indicadaId), agora);
    return { principal: true, ativosPagantes, isenta: isentaPorIndicacoes(ativosPagantes), saldo: saldoTotal(validas) };
  } catch (err: any) {
    console.error(`[Indique e Ganhe] resumo da loja ${loja.id} falhou: ${err?.message}`);
    return { ...nada, principal: true };
  }
}

/** A previsão do painel (getCurrentCycleView): o que abateria hoje, sem gravar. */
export async function previsaoDoIndiqueEGanhe(loja: { id: string; accountGroupId: string | null }, mensalidade: number) {
  const r = await indiqueEGanheDaLoja(loja);
  if (r.isenta) return { ...r, abate: 0 };
  const linhas = await indicacoesDaConta(loja.id);
  return { ...r, abate: previsaoDoAbatimento(linhas.filter((l) => !l.recusadaMotivo), mensalidade) };
}

// ── A aplicação (lib/billing.ts, closeBillingCycle) ─────────────────────────

/**
 * Abate os créditos na mensalidade do ciclo que está fechando e grava o uso.
 * Numa transação com a linha travada (`FOR UPDATE`): dois fechamentos do
 * mesmo mês ao mesmo tempo não usam o mesmo crédito duas vezes. Devolve o
 * valor abatido; qualquer falha devolve 0 e a mensalidade sai cheia — cobrar
 * R$ 100 a mais e acertar à mão é melhor que não emitir o boleto.
 */
export async function aplicarCreditosNoCiclo(
  lojaId: string,
  ciclo: { id: string; yearMonth: string },
  mensalidade: number,
  agora = new Date(),
): Promise<number> {
  if (mensalidade <= 0) return 0;
  try {
    if (!(await garantirTabelaDeIndicacoes())) return 0;
    return await prisma.$transaction(async (tx) => {
      const linhas = await tx.$queryRaw<LinhaDaIndicacao[]>`
        SELECT "id", "creditoValor", "creditoGeradoEm", "creditoUsado", "usos"
        FROM "IndicacaoLojista"
        WHERE "indicadoraId" = ${lojaId} AND "recusadaMotivo" IS NULL AND "creditoValor" > 0
        FOR UPDATE`;
      const creditos = linhas.map((l) => ({ ...l, usos: usosDe(l.usos) }));
      const { abatido, alteracoes } = abaterCreditos(creditos, ciclo, mensalidade, agora);
      for (const a of alteracoes) {
        await tx.$executeRaw`
          UPDATE "IndicacaoLojista" SET "creditoUsado" = ${a.creditoUsado}, "usos" = ${JSON.stringify(a.usos)}::jsonb
          WHERE "id" = ${a.id}`;
      }
      return abatido;
    });
  } catch (err: any) {
    console.error(`[Indique e Ganhe] abatimento no ciclo ${ciclo.id} falhou: ${err?.message}`);
    return 0;
  }
}

// ── A tela do lojista e o admin ─────────────────────────────────────────────

export type IndicacaoNaTela = {
  loja: string;
  cadastradaEm: string;
  situacao: SituacaoDaIndicacao;
  motivo: string | null;
};

export async function indicacoesParaATela(lojaPrincipalId: string, agora = new Date()): Promise<IndicacaoNaTela[]> {
  const linhas = await indicacoesDaConta(lojaPrincipalId);
  if (linhas.length === 0) return [];
  const lojas = await prisma.user.findMany({
    where: { id: { in: linhas.map((l) => l.indicadaId) } },
    select: { id: true, role: true, trialEndsAt: true, storeName: true, name: true },
  });
  const porId = new Map(lojas.map((l) => [l.id, l]));
  return linhas
    .map((l) => {
      const loja = porId.get(l.indicadaId) || null;
      return {
        loja: loja?.storeName || loja?.name || "Loja removida",
        cadastradaEm: new Date(l.createdAt).toISOString(),
        situacao: situacaoDaIndicacao(l, loja, agora),
        motivo: l.recusadaMotivo,
      };
    })
    .reverse();
}

/** Quem indicou cada loja (aba Lojistas do admin). Vazio se a tabela faltar. */
export async function indicadorasDasLojas(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!(await garantirTabelaDeIndicacoes())) return mapa;
  try {
    const linhas = await prisma.$queryRaw<{ indicadaId: string; indicadoraId: string }[]>`
      SELECT "indicadaId", "indicadoraId" FROM "IndicacaoLojista"`;
    linhas.forEach((l) => mapa.set(l.indicadaId, l.indicadoraId));
  } catch {}
  return mapa;
}
