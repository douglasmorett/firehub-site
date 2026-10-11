/**
 * O lado do SERVIDOR do CMV do DRE: busca o que as duas fontes precisam. A
 * conta é de lib/financeiro/dre.ts (pura).
 *
 *   • Fonte 1, CMV REAL (`cmvRealDoPeriodo`): as contagens fechadas e as
 *     compras entre elas, do mesmo jeito do painel de Dados sensíveis
 *     (lib/cmv/painel.ts): compra pelo DIA em que a mercadoria entrou
 *     (`StockInvoice.dia`), compra desfeita fora, só insumo que entra no CMV.
 *     A janela é `janelaCompletaDoPeriodo` (lib/cmv/cmv-real.ts): só entre
 *     contagens COMPLETAS, dentro do período.
 *   • Fonte 2/3, FICHA e CUSTO DO PRODUTO (`prepararCustoDosItens`): o
 *     cardápio inteiro da loja (fichas, combos, custo digitado) e o custo de
 *     cada insumo dia a dia (lib/cmv/custo-do-insumo.ts).
 */
import { prisma } from "@/lib/prisma";
import { somarDias } from "@/lib/relatorios/base";
import { cmvEntre, janelaCompletaDoPeriodo, type ContagemFechada, type DiaDoCmv } from "@/lib/cmv/cmv-real";
import { custosNoDia } from "@/lib/cmv/custo-do-insumo";
import { entradasComCusto, insumosParaCusto } from "@/lib/cmv/contagem-no-banco";
import {
  custoDoInsumoNoDia, custoDoItem, montarCatalogo,
  type CustoDoInsumo, type CustoDoItem, type ItemParaCusto, type ProdutoParaCusto,
} from "@/lib/financeiro/custo-pela-ficha";
import type { CmvRealDoPeriodo } from "@/lib/financeiro/dre";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** O CMV pela contagem no período, ou o que falta para ele existir. */
export async function cmvRealDoPeriodo(lojaId: string, de: string, ate: string): Promise<CmvRealDoPeriodo> {
  const fechadas = await prisma.contagemDeEstoque.findMany({
    where: { franchiseeId: lojaId, status: "FECHADA", dia: { lte: ate } },
    select: { id: true, dia: true, tipo: true, valorTotal: true },
    orderBy: { dia: "asc" },
  });
  const contagens: ContagemFechada[] = fechadas.map((c) => ({ id: c.id, dia: c.dia, tipo: c.tipo, valorTotal: Number(c.valorTotal) || 0 }));
  const ultimaCompleta = [...contagens].reverse().find((c) => c.tipo === "COMPLETA")?.dia ?? null;
  const janela = janelaCompletaDoPeriodo(contagens, de, ate);
  const base = { contagens: contagens.length, ultimaCompleta };
  if (!janela.abertura || !janela.fechamento) {
    return { ...base, abertura: janela.abertura?.dia ?? null, trecho: null, falta: janela.falta ?? "NENHUMA_CONTAGEM", semCustoNaContagem: [] };
  }
  const abertura = janela.abertura, fechamento = janela.fechamento;

  // Compras do trecho, pelo dia em que a mercadoria entrou (lib/cmv/painel.ts).
  const notas = await prisma.stockInvoice.findMany({
    where: { franchiseeId: lojaId, canceladaEm: null, dia: { gt: abertura.dia, lte: fechamento.dia } },
    select: { id: true, dia: true },
  });
  const diaDaNota = new Map(notas.map((n) => [n.id, n.dia as string]));
  const entradas = notas.length
    ? await prisma.stockTransaction.findMany({
        where: { stockInvoiceId: { in: notas.map((n) => n.id) }, type: "INPUT" },
        select: { stockInvoiceId: true, quantity: true, unitCost: true, stockItem: { select: { entraNoCmv: true } } },
      })
    : [];
  const comprasPorDia = new Map<string, number>();
  for (const t of entradas) {
    if (t.stockItem.entraNoCmv === false) continue;
    const dia = diaDaNota.get(t.stockInvoiceId as string)!;
    comprasPorDia.set(dia, (comprasPorDia.get(dia) || 0) + (Number(t.unitCost) || 0) * t.quantity);
  }
  const dias: DiaDoCmv[] = [];
  for (let d = somarDias(abertura.dia, 1), guarda = 0; d <= fechamento.dia && guarda < 800; d = somarDias(d, 1), guarda++) {
    dias.push({ dia: d, compras: r2(comprasPorDia.get(d) || 0), vendas: 0 });
  }

  // Item contado sem custo entra com R$ 0 no estoque (o painel avisa): aqui é pendência.
  const linhas = await prisma.contagemItem.findMany({
    where: { contagemId: { in: [abertura.id, fechamento.id] }, custoUnitario: null, quantidade: { gt: 0 } },
    select: { nome: true, stockItem: { select: { entraNoCmv: true } } },
  });
  const semCustoNaContagem = [...new Set(linhas.filter((l) => l.stockItem.entraNoCmv !== false).map((l) => l.nome))].sort();

  return { ...base, abertura: abertura.dia, trecho: cmvEntre(abertura, fechamento, dias), falta: null, semCustoNaContagem };
}

export type CustoDosItens = {
  custoDoItem: (item: ItemParaCusto, dia: string) => CustoDoItem;
  usaFicha: boolean;
  usaEstoque: boolean;
};

/** Carrega o cardápio e o estoque da loja uma vez; o custo de cada insumo é calculado uma vez por dia. */
export async function prepararCustoDosItens(lojaId: string, tz: string): Promise<CustoDosItens> {
  const [produtos, insumos, entradas] = await Promise.all([
    prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId },
      select: {
        id: true, name: true, active: true, cost: true, isCombo: true,
        recipeItems: { select: { stockItemId: true, quantityConsumed: true, stockItem: { select: { name: true } } } },
        comboGroups: { select: { id: true, items: { select: { id: true, menuProductId: true } } } },
      },
    }),
    insumosParaCusto(lojaId),
    entradasComCusto(lojaId, tz),
  ]);
  const catalogo = montarCatalogo(produtos.map((p): ProdutoParaCusto => ({
    id: p.id, nome: p.name || "", ativo: p.active !== false, custo: p.cost ?? null, combo: Boolean(p.isCombo),
    ficha: p.recipeItems.map((r) => ({ insumoId: r.stockItemId, nome: r.stockItem?.name || "insumo", quantidade: Number(r.quantityConsumed) || 0 })),
    grupos: p.comboGroups.map((g) => ({ id: g.id, opcoes: g.items.map((i) => ({ id: i.id, produtoId: i.menuProductId })) })),
  })));
  const porDia = new Map<string, CustoDoInsumo>();
  const doDia = (dia: string) => {
    let f = porDia.get(dia);
    if (!f) { f = custoDoInsumoNoDia(insumos, custosNoDia(insumos, entradas, dia)); porDia.set(dia, f); }
    return f;
  };
  return {
    custoDoItem: (item, dia) => custoDoItem(item, catalogo, doDia(dia)),
    usaFicha: catalogo.usaFicha,
    usaEstoque: insumos.length > 0,
  };
}
