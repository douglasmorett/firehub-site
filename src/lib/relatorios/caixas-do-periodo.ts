/**
 * Os caixas FECHADOS do período (pelo dia operacional da abertura), com quem
 * abriu — a busca comum do Diferenças de caixa e do Sangrias e suprimentos.
 *
 * Quem abriu (`CashSession.abertoPor`) é lido por SQL, como em
 * lib/quem-abriu-o-caixa.ts: a coluna nasceu em garantir-colunas.ts e o
 * cliente do Prisma das worktrees não é regenerado a cada branch. Se a leitura
 * falhar, o operador cai em quem fechou — o relatório abre do mesmo jeito.
 */
import { prisma } from "@/lib/prisma";
import { lerQuemAbriu } from "@/lib/resumo-do-caixa-aberto";
import type { ContextoDoRelatorio } from "@/lib/relatorios/servidor";
import type { CaixaParaDiferencas } from "@/lib/relatorios/diferencas-de-caixa";

export async function caixasDoPeriodo(ctx: ContextoDoRelatorio, janela: { inicio: Date; fim: Date } = { inicio: ctx.inicio, fim: ctx.fim }): Promise<CaixaParaDiferencas[]> {
  const caixas = await prisma.cashSession.findMany({
    where: { franchiseeId: { in: ctx.lojaIds }, status: "CLOSED", openedAt: { gte: janela.inicio, lt: janela.fim } },
    select: {
      id: true, franchiseeId: true, openedAt: true, closedAt: true, closedBy: true, openingAmount: true,
      expectedCash: true, expectedDebit: true, expectedCredit: true, expectedPix: true, expectedVoucher: true, expectedTotal: true,
      closingCash: true, closingDebit: true, closingCredit: true, closingPix: true, closingVoucher: true, difference: true,
    },
    orderBy: { openedAt: "desc" },
  });
  const nomes = new Map<string, string>();
  if (caixas.length) {
    try {
      const ids = caixas.map((c) => c.id);
      const linhas = await prisma.$queryRaw<{ id: string; abertoPor: unknown }[]>`
        SELECT "id", "abertoPor" FROM "CashSession" WHERE "id" = ANY(${ids})
      `;
      for (const l of linhas) {
        const q = lerQuemAbriu(l.abertoPor);
        if (q?.nome) nomes.set(l.id, q.nome);
      }
    } catch (e: any) {
      console.warn("[Relatórios] Quem abriu o caixa não carregado:", e?.message);
    }
  }
  return caixas.map((c) => ({ ...c, abertoPorNome: nomes.get(c.id) ?? null }));
}
