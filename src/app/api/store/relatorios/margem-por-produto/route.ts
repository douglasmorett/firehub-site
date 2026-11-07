/**
 * GET /api/store/relatorios/margem-por-produto — margem e markup de cada
 * produto vendido no período e a engenharia de cardápio (estrela, vaca
 * leiteira, quebra-cabeça, abacaxi). Conta em lib/relatorios/margem-por-
 * produto.ts.
 *
 * Filtros comuns (lib/relatorios/base.ts): período, horário, tipo de venda,
 * canal, marca e lojas. formato=xlsx baixa a planilha.
 *
 * O custo de cada item é o da ficha técnica × o custo do insumo NO DIA da
 * venda (lib/financeiro/cmv-do-financeiro.ts, `prepararCustoDosItens`, o
 * mesmo do DRE), ou o custo digitado no produto. Sem nada disso: sem custo.
 */
import { NextRequest, NextResponse } from "next/server";
import { cabecalhoDoRelatorio, contextoDoRelatorio, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { prepararCustoDosItens, type CustoDosItens } from "@/lib/financeiro/cmv-do-financeiro";
import type { FaltaDoItem } from "@/lib/financeiro/custo-pela-ficha";
import { margemPorProduto, QUADRANTES, type ItemComCusto } from "@/lib/relatorios/margem-por-produto";
import { nomeDoProduto } from "@/lib/relatorios/itens-vendidos";
import { chaveDoNome } from "@/lib/categoria-do-item";
import { fmtDia, naLoja } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

const textoDaFalta = (f: FaltaDoItem) =>
  f.motivo === "SEM_FICHA" ? "sem ficha técnica"
  : f.motivo === "INSUMO_SEM_CUSTO" ? `${f.nome} sem custo`
  : f.motivo === "NOME_NAO_CASA" ? "não há produto com este nome no cardápio"
  : `opção ${f.nome} sem ficha`;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  const [pedidos, custos] = await Promise.all([
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
    Promise.all(ctx.lojaIds.map(async (id) => [id, await prepararCustoDosItens(id, ctx.tz)] as const)),
  ]);
  const custoDe = new Map<string, CustoDosItens>(custos);

  const itens: ItemComCusto[] = [];
  for (const p of pedidos) {
    const c = custoDe.get(p.franchiseeId);
    const dia = naLoja(p.createdAt, ctx.tz).dia;
    for (const it of (p.items || []) as any[]) {
      const q = Number(it.quantity) || 0;
      if (!(q > 0)) continue;
      const nome = nomeDoProduto(it);
      const custo = c ? c.custoDoItem({ produtoId: it.menuProductId, nome: it.productName, quantidade: q, preco: Number(it.price) || 0, escolhas: it.comboSelections }, dia) : null;
      itens.push({
        chave: chaveDoNome(nome) || nome.toLowerCase(), nome, quantidade: q, valor: (Number(it.price) || 0) * q,
        custo: custo?.custo ?? null, faltas: (custo?.faltas || [{ motivo: "SEM_FICHA", nome }]).map(textoDaFalta),
      });
    }
  }
  const resultado = margemPorProduto(itens);
  const cabecalho = cabecalhoDoRelatorio(ctx);
  const usaFicha = custos.some(([, c]) => c.usaFicha);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, usaFicha, ...resultado, quadrantes: QUADRANTES });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const topo: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Margem por produto — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h) · custo = ficha técnica × custo do insumo no dia da venda`, estilo: "suave" }] },
    { celulas: [{ v: "Produto sem ficha técnica nem custo cadastrado aparece como \"sem custo\": sem custo não há lucro para mostrar.", estilo: "suave" }] },
    { celulas: [] },
  ];
  const buffer = montarPlanilha([{
    nome: "Margem por produto",
    congelarLinhas: topo.length + 1,
    larguras: [38, 10, 14, 14, 14, 14, 14, 11, 10, 11, 18, 40],
    linhas: [
      ...topo,
      { celulas: ["Produto", "Qtde", "Valor vendido", "Preço médio", "Custo unit.", "Margem unit.", "Margem total", "Margem %", "Markup", "% do fatur.", "Classificação", "Observação"], estilo: "cabecalho" },
      ...resultado.produtos.map((p): LinhaDaPlanilha => ({
        celulas: [
          p.nome, { v: p.quantidade, estilo: "qtd" }, { v: p.valor, estilo: "reais" }, { v: p.precoMedio, estilo: "reais" },
          p.custoUnitario == null ? { v: "sem custo", estilo: "suave" } : { v: p.custoUnitario, estilo: "reais" },
          { v: p.margemUnitaria, estilo: "reais" }, { v: p.margemTotal, estilo: "reaisNegrito" },
          { v: p.margemPct == null ? null : p.margemPct / 100, estilo: "pct" }, { v: p.markup, estilo: "qtd" },
          { v: p.pctDoFaturamento / 100, estilo: "pct" },
          p.quadrante ? `${QUADRANTES[p.quadrante].emoji} ${QUADRANTES[p.quadrante].rotulo}` : "",
          p.custoTotal == null ? p.faltas.join("; ") : p.quantidadeComCusto < p.quantidade ? `margem de ${p.quantidadeComCusto} de ${p.quantidade} vendidos (o resto sem custo: ${p.faltas.join("; ")})` : "",
        ],
      })),
      { celulas: [{ v: "TOTAL", estilo: "negrito" }, { v: resultado.totais.quantidade, estilo: "qtdNegrito" }, { v: resultado.totais.valor, estilo: "reaisNegrito" }, "", "", "", { v: resultado.totais.margem, estilo: "reaisNegrito" }, { v: resultado.totais.margemPct == null ? null : resultado.totais.margemPct / 100, estilo: "pctNegrito" }] },
      { celulas: [] },
      ...(Object.keys(QUADRANTES) as (keyof typeof QUADRANTES)[]).map((k) => ({ celulas: [{ v: `${QUADRANTES[k].emoji} ${QUADRANTES[k].rotulo}: ${QUADRANTES[k].oQueE} ${QUADRANTES[k].oQueFazer}`, estilo: "suave" as const }] })),
    ],
  }]);
  return respostaDePlanilha(buffer, `margem-por-produto_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
