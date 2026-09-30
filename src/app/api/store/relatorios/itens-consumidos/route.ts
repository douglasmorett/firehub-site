/**
 * GET /api/store/relatorios/itens-consumidos — o "Itens consumidos" da Saipos:
 * quanto de cada insumo saiu pelas vendas (ficha técnica) e o CMV teórico.
 *
 * Filtros comuns (lib/relatorios/base.ts): período, horário, tipo de venda,
 * canal, marca e lojas. Categoria e produto não se aplicam — a baixa do
 * estoque é gravada por (pedido, insumo), sem dizer de qual item saiu.
 *   formato=xlsx   baixa a planilha em vez do JSON
 *
 * Tudo vale pelo PEDIDO que gerou a baixa: o período (o dia operacional do
 * pedido, o mesmo do faturamento), o tipo, o canal, a marca e o horário. O
 * consumo de cada pedido vendido (pedidosDoRelatorio) é o líquido de todas as
 * baixas e devoluções dele, lidas até DIAS_DE_FOLGA depois do fim do período
 * — a edição e o reaceite chegam depois do pedido. As regras de conta — o que
 * entra, o que não entra e a mesa — estão em lib/relatorios/itens-consumidos.ts
 * (testada em scripts/teste-itens-consumidos.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  COLUNAS_DOS_FILTROS, cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, filtrarPedidos, pedidosDoRelatorio,
  type PedidoBase,
} from "@/lib/relatorios/servidor";
import {
  DIAS_DE_FOLGA, itensConsumidos, montarFichas, separarMovimentos, situacaoDoPedido, type SituacaoDoPedido,
} from "@/lib/relatorios/itens-consumidos";
import { canalDoRelatorio, fmtDia, ROTULO_DO_TIPO } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

/** O cadastro que diz se o item vendido baixa estoque — o que `deductStockForOrder` consulta. */
async function fichasDasLojas(lojaIds: string[]) {
  const [ativos, comFicha, opcoes, comGrupos] = await Promise.all([
    prisma.menuProduct.findMany({
      where: { franchiseeId: { in: lojaIds }, active: true },
      select: { id: true, name: true, franchiseeId: true, category: true, active: true },
    }),
    prisma.productRecipe.findMany({
      where: { menuProduct: { franchiseeId: { in: lojaIds } } },
      select: { menuProductId: true },
      distinct: ["menuProductId"],
    }),
    // Só as opções de combo cujo produto tem ficha: as outras não baixam nada.
    prisma.comboGroupItem.findMany({
      where: { comboGroup: { menuProduct: { franchiseeId: { in: lojaIds } } }, menuProduct: { recipeItems: { some: {} } } },
      select: { id: true, menuProductId: true, comboGroup: { select: { menuProductId: true } }, menuProduct: { select: { name: true } } },
    }),
    // Quem tem grupo de opção: o conselho para ele é "ficha nas opções".
    prisma.comboGroup.findMany({
      where: { menuProduct: { franchiseeId: { in: lojaIds } } },
      select: { menuProductId: true },
      distinct: ["menuProductId"],
    }),
  ]);
  return montarFichas(
    ativos,
    comFicha.map((r) => r.menuProductId),
    opcoes.map((o) => ({ id: o.id, menuProductId: o.menuProductId, produtoDoComboId: o.comboGroup.menuProductId, nomeDaOpcao: o.menuProduct?.name ?? null })),
    comGrupos.map((g) => g.menuProductId),
  );
}

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  // A baixa nunca vem antes do pedido, então a leitura começa no início do
  // período; e vai até a folga depois do fim, para a correção que chega depois.
  const fimDaLeitura = new Date(ctx.fim.getTime() + DIAS_DE_FOLGA * 86_400_000);
  const [vendas, insumos, lidos, fichas] = await Promise.all([
    pedidosDoRelatorio(ctx, {
      select: {
        items: {
          select: {
            quantity: true, price: true, productName: true, menuProductId: true, comboSelections: true,
            menuProduct: { select: { id: true, name: true, category: true, active: true } },
          },
        },
      },
    }),
    // Os insumos pela LOJA do insumo: StockTransaction.franchiseeId é nulo nas
    // movimentações antigas (a coluna nasceu depois).
    prisma.stockItem.findMany({
      where: { franchiseeId: { in: ctx.lojaIds } },
      select: { id: true, name: true, unit: true, unitCost: true, active: true },
    }),
    // Só baixas de venda e devoluções por cancelamento — entrada de nota,
    // perda e ajuste manual não são consumo de venda.
    prisma.stockTransaction.findMany({
      where: {
        stockItem: { franchiseeId: { in: ctx.lojaIds } },
        createdAt: { gte: ctx.inicio, lt: fimDaLeitura },
        OR: [{ type: "SALE" }, { type: "INPUT", notes: { contains: "cancel id:" } }],
      },
      select: { stockItemId: true, type: true, quantity: true, notes: true, sourceRef: true, createdAt: true },
    }),
    fichasDasLojas(ctx.lojaIds),
  ]);

  // ── O pedido de cada baixa ──
  // As dos pedidos vendidos no período (`pedidosDoRelatorio`, já filtrados)
  // contam. As outras feitas dentro do período — de pedido cancelado, fora do
  // filtro, feito antes do período — são buscadas pelo id e passam pela MESMA
  // régua, só para o rodapé dizer por que ficaram de fora.
  const { movimentos, pedidosParaClassificar } = separarMovimentos(lidos, new Set(vendas.map((p) => p.id)), ctx.fim);
  const situacaoDe = new Map<string, SituacaoDoPedido>();
  if (pedidosParaClassificar.length) {
    const deFora = await emLotes(pedidosParaClassificar, 500, (lote) => prisma.customerOrder.findMany({
      where: { id: { in: lote }, franchiseeId: { in: ctx.lojaIds } },
      select: COLUNAS_DOS_FILTROS,
    })) as unknown as PedidoBase[];
    const passam = new Set(filtrarPedidos(deFora, ctx).map((p) => p.id));
    for (const p of deFora) {
      const t = new Date(p.createdAt).getTime();
      const noPeriodo = t >= ctx.inicio.getTime() && t < ctx.fim.getTime();
      situacaoDe.set(p.id, situacaoDoPedido(p, passam.has(p.id), noPeriodo));
    }
  }

  const resultado = itensConsumidos({
    movimentos,
    insumos: insumos.map((i) => ({ id: i.id, nome: i.name, unidade: i.unit, custoUnitario: i.unitCost, ativo: i.active })),
    situacaoDe,
    vendas: vendas.map((p) => ({
      id: p.id, franchiseeId: p.franchiseeId, createdAt: p.createdAt, totalAmount: p.totalAmount,
      canal: canalDoRelatorio(p), items: p.items || [],
    })),
    fichas,
    tz: ctx.tz,
    periodo: { de: ctx.filtros.de, ate: ctx.filtros.ate },
  });
  const cabecalho = cabecalhoDoRelatorio(ctx);
  const temFicha = fichas.produtosComFicha.size > 0;

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, insumosCadastrados: insumos.length, temFicha, ...resultado });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const nomeDaMarca = new Map(cabecalho.marcas.map((m) => [m.chave, m.rotulo]));
  const filtrosEmTexto = [
    ctx.filtros.horaDe || ctx.filtros.horaAte ? `Horário ${ctx.filtros.horaDe || "00:00"}–${ctx.filtros.horaAte || "24:00"}` : "",
    ctx.filtros.tipos.length ? `Tipo: ${ctx.filtros.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    ctx.filtros.canais.length ? `Canal: ${ctx.filtros.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    ctx.filtros.marcas.length ? `Marca: ${ctx.filtros.marcas.map((m) => nomeDaMarca.get(m) || m).join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  const topo = (titulo: string, extra: string[] = []): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h; vale o dia do pedido, como no faturamento)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros (pelo pedido que gerou a baixa): ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    ...extra.map((t) => ({ celulas: [{ v: t, estilo: "suave" as const }] })),
    { celulas: [] },
  ];

  const cabecalhoInsumos = ["Insumo", "Unidade", "Qtde consumida", "Custo unitário (R$)", "Custo total", "% do custo", "Pedidos"];
  const topoInsumos = topo("Itens consumidos", ["Custo unitário = o custo ATUAL do insumo no estoque (o do último recebimento), não o do dia da venda."]);
  const linhasDosInsumos: LinhaDaPlanilha[] = resultado.insumos.map((i) => ({
    celulas: [
      i.ativo ? i.nome : `${i.nome} (inativo)`,
      i.unidade,
      { v: i.quantidade, estilo: "qtd" },
      // Custo por grama é R$ 0,0450: no formato de R$ com 2 casas viraria
      // "R$ 0,05". Vai como número geral, com as casas que tem.
      { v: i.custoUnitario, estilo: "qtd" },
      i.custo === null ? { v: "sem custo", estilo: "suave" } : { v: i.custo, estilo: "reais" },
      { v: i.custo === null ? null : i.pct / 100, estilo: "pct" },
      { v: i.pedidos, estilo: "qtd" },
    ],
  }));
  const pctOuVazio = (n: number | null, estilo: "pct" | "pctNegrito" = "pctNegrito") => (n === null ? { v: "—", estilo: "suave" as const } : { v: n / 100, estilo });
  const totais = resultado.vendas;
  const resumo: LinhaDaPlanilha[] = [
    { celulas: [] },
    { celulas: [{ v: "Faturamento do período (total das vendas)", estilo: "negrito" }, "", "", "", { v: totais.faturamento, estilo: "reaisNegrito" }, "", { v: totais.pedidos, estilo: "qtd" }] },
    { celulas: ["Total dos itens vendidos (sem taxa de entrega e desconto)", "", "", "", { v: totais.totalDosItens, estilo: "reais" }] },
    { celulas: ["Itens vendidos que BAIXARAM estoque (a base do CMV das vendas com baixa)", "", "", "", { v: totais.valorComBaixa, estilo: "reais" }, pctOuVazio(totais.coberturaPct, "pct")] },
    { celulas: ["Itens com ficha técnica hoje, vendidos sem baixa (ficha cadastrada depois da venda)", "", "", "", { v: totais.valorComFichaSemBaixa, estilo: "reais" }] },
    { celulas: ["Itens sem ficha técnica (aba \"Sem ficha técnica\")", "", "", "", { v: resultado.semFicha.valor, estilo: "reais" }] },
    { celulas: [{ v: "CMV sobre o faturamento", estilo: "negrito" }, "", "", "", "", pctOuVazio(resultado.cmv.sobreFaturamento)] },
    { celulas: ["CMV sobre o total dos itens", "", "", "", "", pctOuVazio(resultado.cmv.sobreItens)] },
    { celulas: [{ v: "CMV das vendas que baixaram estoque", estilo: "negrito" }, "", "", "", "", pctOuVazio(resultado.cmv.sobreItensComBaixa)] },
    { celulas: [] },
    { celulas: [{ v: "Consumo = baixas automáticas do estoque pela ficha técnica, menos as devoluções, no dia do pedido. Pedido cancelado não entra. Perda, entrada de nota e ajuste manual não entram.", estilo: "suave" }] },
    { celulas: [{ v: "Item vendido sem ficha técnica não gera consumo: o CMV sobre o faturamento fica menor que o real. Veja a aba \"Sem ficha técnica\".", estilo: "suave" }] },
    { celulas: [{ v: "Mesa: tirar item de um lançamento pelo painel de mesas não devolve o insumo (só cancelar o lançamento inteiro devolve) — o consumo da mesa editada fica maior que o vendido.", estilo: "suave" }] },
    ...(totais.pedidosComFichaSemBaixa
      ? [{ celulas: [{ v: `${totais.pedidosComFichaSemBaixa} pedido(s) com item de ficha técnica não tiveram baixa (ficha cadastrada depois da venda, pedido ainda não aceito, ou baixa que falhou). Ficam fora do CMV das vendas com baixa.`, estilo: "suave" as const }] }]
      : []),
    ...(totais.pedidosComBaixaSemFichaHoje
      ? [{ celulas: [{ v: `${totais.pedidosComBaixaSemFichaHoje} pedido(s) baixaram estoque sem nenhum item com ficha técnica hoje (ficha apagada ou trocada depois da venda): o pedido inteiro entra na base do CMV das vendas com baixa.`, estilo: "suave" as const }] }]
      : []),
  ];

  const ROTULO_ORIGEM = { cardapio: "Cardápio", integracao: "Integração (iFood, 99…)", removido: "Produto removido" } as const;
  const linhasSemFicha: LinhaDaPlanilha[] = resultado.semFicha.produtos.map((p) => ({
    celulas: [
      p.nome,
      ROTULO_ORIGEM[p.origem],
      p.canais.map((c) => nomeDoCanal.get(c) || c).join(", "),
      { v: p.quantidade, estilo: "qtd" },
      { v: p.valor, estilo: "reais" },
      p.oQueFazer,
    ],
  }));

  const buffer = montarPlanilha([
    {
      nome: "Insumos",
      congelarLinhas: topoInsumos.length + 1,
      larguras: [40, 10, 16, 20, 16, 11, 10],
      linhas: [
        ...topoInsumos,
        { celulas: cabecalhoInsumos, estilo: "cabecalho" },
        ...(linhasDosInsumos.length ? linhasDosInsumos : [{ celulas: [{ v: "Nenhum insumo saiu pelas vendas neste período.", estilo: "suave" as const }] }]),
        { celulas: [{ v: "TOTAL", estilo: "negrito" }, "", "", "", { v: resultado.total.custo, estilo: "reaisNegrito" }, { v: resultado.total.custo > 0 ? 1 : null, estilo: "pctNegrito" }, { v: resultado.total.pedidosComBaixa, estilo: "qtdNegrito" }] },
        ...resumo,
      ],
    },
    {
      nome: "Sem ficha técnica",
      congelarLinhas: 6,
      larguras: [40, 24, 26, 12, 14, 70],
      linhas: [
        ...topo("Vendidos sem ficha técnica", ["Estes itens não tiraram nada do estoque. Ordem: os mais vendidos primeiro."]),
        { celulas: ["Produto", "Origem", "Canais", "Quantidade", "Valor", "O que fazer"], estilo: "cabecalho" },
        ...linhasSemFicha,
        { celulas: [{ v: "TOTAL", estilo: "negrito" }, "", "", { v: resultado.semFicha.quantidade, estilo: "qtdNegrito" }, { v: resultado.semFicha.valor, estilo: "reaisNegrito" }] },
      ],
    },
    {
      nome: "Por dia",
      congelarLinhas: 5,
      larguras: [14, 18, 18, 10],
      linhas: [
        ...topo("Consumo por dia"),
        { celulas: ["Dia", "Custo dos insumos", "Faturamento", "CMV %"], estilo: "cabecalho" },
        ...resultado.porDia.map((d) => ({
          celulas: [fmtDia(d.dia), { v: d.custo, estilo: "reais" as const }, { v: d.faturamento, estilo: "reais" as const }, pctOuVazio(d.cmvPct, "pct")],
        })),
      ],
    },
  ]);
  return respostaDePlanilha(buffer, `itens-consumidos_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
