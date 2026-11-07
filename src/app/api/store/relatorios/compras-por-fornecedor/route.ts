/**
 * GET /api/store/relatorios/compras-por-fornecedor — as compras lançadas no
 * período, por fornecedor e por insumo, com o preço médio e o alerta do
 * insumo que subiu de preço (lib/relatorios/compras-por-fornecedor.ts).
 *
 * O período é o dia em que a mercadoria entrou (StockInvoice.dia), o mesmo do
 * CMV. Para achar a compra ANTERIOR de cada insumo, a leitura volta
 * DIAS_DE_HISTORICO antes do início. formato=xlsx: a planilha.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { comprasPorFornecedor, type EntradaDeCompra } from "@/lib/relatorios/compras-por-fornecedor";
import { fmtDia, naLoja, somarDias } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";
const DIAS_DE_HISTORICO = 180;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const { de, ate } = ctx.filtros;
  const deHistorico = somarDias(de, -DIAS_DE_HISTORICO);
  const janela = janelaDoPeriodo(deHistorico, ate, ctx.tz);

  // A compra antiga não tem `dia`: vale o dia em que foi lançada.
  const notas = await prisma.stockInvoice.findMany({
    where: {
      franchiseeId: { in: ctx.lojaIds }, canceladaEm: null,
      OR: [{ dia: { gte: deHistorico, lte: ate } }, { dia: null, createdAt: { gte: janela.inicio, lt: janela.fim } }],
    },
    select: { id: true, dia: true, createdAt: true, supplier: true },
  });
  const notaPorId = new Map(notas.map((n) => [n.id, { dia: n.dia || naLoja(n.createdAt, ctx.tz).dia, fornecedor: n.supplier }]));
  const movimentos = await emLotes(notas.map((n) => n.id), 500, (lote) => prisma.stockTransaction.findMany({
    where: { stockInvoiceId: { in: lote }, type: "INPUT", unitCost: { not: null } },
    select: { stockInvoiceId: true, stockItemId: true, quantity: true, unitCost: true, createdAt: true, stockItem: { select: { name: true, unit: true } } },
  }));
  const entradas: EntradaDeCompra[] = movimentos.map((t) => {
    const n = notaPorId.get(t.stockInvoiceId as string)!;
    return {
      compraId: t.stockInvoiceId as string, dia: n.dia, em: t.createdAt.getTime(), fornecedor: n.fornecedor,
      stockItemId: t.stockItemId, nome: t.stockItem.name, unidade: t.stockItem.unit, quantidade: Number(t.quantity) || 0, custoUnitario: Number(t.unitCost),
    };
  });
  const resultado = comprasPorFornecedor(entradas, de, ate);
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (req.nextUrl.searchParams.get("formato") !== "xlsx") return NextResponse.json({ ...cabecalho, ...resultado });

  const topo: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Compras por fornecedor — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Compras com entrada de ${fmtDia(de)} a ${fmtDia(ate)} (dia em que a mercadoria entrou). Compra desfeita não entra. Valor = o que entrou no estoque.`, estilo: "suave" }] },
    { celulas: [] },
  ];
  const buffer = montarPlanilha([
    {
      nome: "Por fornecedor",
      congelarLinhas: topo.length + 1,
      larguras: [32, 10, 10, 16, 11, 14],
      linhas: [
        ...topo,
        { celulas: ["Fornecedor", "Compras", "Insumos", "Total", "% do total", "Última compra"], estilo: "cabecalho" },
        ...resultado.fornecedores.map((f) => ({ celulas: [f.fornecedor, { v: f.compras, estilo: "qtd" as const }, { v: f.insumos, estilo: "qtd" as const }, { v: f.total, estilo: "reais" as const }, { v: f.pct / 100, estilo: "pct" as const }, fmtDia(f.ultima)] })),
        { celulas: [{ v: "TOTAL", estilo: "negrito" }, { v: resultado.totais.compras, estilo: "qtdNegrito" }, { v: resultado.totais.insumos, estilo: "qtdNegrito" }, { v: resultado.totais.total, estilo: "reaisNegrito" }] },
      ],
    },
    {
      nome: "Por insumo",
      congelarLinhas: topo.length + 1,
      larguras: [32, 8, 10, 14, 14, 14, 14, 14, 12, 30],
      linhas: [
        ...topo,
        { celulas: ["Insumo", "Unid.", "Compras", "Quantidade", "Total", "Preço médio", "Último preço", "Preço anterior", "Variação", "Fornecedores"], estilo: "cabecalho" },
        ...resultado.insumos.map((i) => ({
          celulas: [i.nome, i.unidade, { v: i.compras, estilo: "qtd" as const }, { v: i.quantidade, estilo: "qtd" as const }, { v: i.valor, estilo: "reais" as const },
            { v: i.precoMedio, estilo: "qtd" as const }, { v: i.ultimoPreco, estilo: "qtd" as const }, { v: i.precoAnterior, estilo: "qtd" as const },
            { v: i.variacaoPct == null ? null : i.variacaoPct / 100, estilo: i.subiu ? "pctNegrito" as const : "pct" as const }, i.fornecedores.join(", ")],
        })),
      ],
    },
  ]);
  return respostaDePlanilha(buffer, `compras-por-fornecedor_${de}_a_${ate}.xlsx`);
}
