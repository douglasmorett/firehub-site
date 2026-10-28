/**
 * GET /api/store/relatorios/plataformas — Plataformas e repasses: cada canal
 * (iFood, 99Food, Keeta, site, app da loja…) por forma de pagamento, com a
 * comissão cadastrada e o repasse estimado. A conta mora em
 * lib/relatorios/plataformas.ts.
 *
 * Filtros comuns (lib/relatorios/base.ts): período, horário, tipo, canal,
 * marca e loja.
 *   formato=xlsx   baixa a planilha (canal × forma e o repasse por semana)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { precisaDoDetalheDoCupom } from "@/lib/relatorios/formas-de-pagamento";
import { precisaDoDetalheDoDesconto } from "@/lib/relatorios/vendas";
import { COLUNAS_DO_PEDIDO, plataformasERepasses, type PedidoDaPlataforma } from "@/lib/relatorios/plataformas";
import { lerComissoesDosApps } from "@/lib/financeiro/dre";
import { pedidosDoApp } from "@/lib/app-da-loja/instalacoes";
import { fmtDia } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type AbaDaPlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;

  const [pedidos, dono, idsDoApp] = await Promise.all([
    pedidosDoRelatorio(ctx, { select: COLUNAS_DO_PEDIDO }),
    prisma.user.findUnique({ where: { id: ctx.donoId }, select: { financialGoals: true } }),
    // Sem a tabela do app, o pedido do app fica no "Site próprio" — não derruba a tela.
    pedidosDoApp(ctx.lojaIds, ctx.inicio).catch(() => [] as string[]),
  ]);

  // Observação e detalhe do desconto (campos pesados) só de quem precisa — a
  // mesma economia do Formas de pagamento e do Financeiro.
  const precisam = pedidos.filter((p) => precisaDoDetalheDoCupom(p as any) || precisaDoDetalheDoDesconto(p as any)).map((p) => p.id);
  const detalhes = await emLotes(precisam, 500, (lote) => prisma.customerOrder.findMany({
    where: { id: { in: lote } }, select: { id: true, notes: true, discountDetails: true },
  }));
  const doDetalhe = new Map(detalhes.map((d) => [d.id, d]));
  const completos = pedidos.map((p) => {
    const d = doDetalhe.get(p.id);
    return (d ? { ...p, notes: d.notes, discountDetails: d.discountDetails } : p) as PedidoDaPlataforma;
  });

  const resultado = plataformasERepasses(completos, {
    de: ctx.filtros.de, ate: ctx.filtros.ate, tz: ctx.tz,
    comissoes: lerComissoesDosApps(dono?.financialGoals), idsDoApp: new Set(idsDoApp),
  });
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (req.nextUrl.searchParams.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, ...resultado });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const topo = (titulo: string, colunas: string[]): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h) · repasse estimado pela comissão cadastrada`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: colunas, estilo: "cabecalho" },
  ];

  const resumo: LinhaDaPlanilha[] = [...topo("Plataformas e repasses", [
    "Canal", "Vendas", "Valor vendido", "Pago no app/site", "Pago na entrega", "Cupom do app", "Cupom da loja",
    "Comissão %", "Comissão", "Entrega do app", "Taxa de serviço do app", "Repasse / cai na conta",
  ])];
  for (const c of resultado.canais) {
    resumo.push({ celulas: [
      { v: c.nome, estilo: "negrito" }, { v: c.vendas, estilo: "qtd" }, { v: c.valor, estilo: "reais" },
      { v: c.online, estilo: "reais" }, { v: c.naEntrega, estilo: "reais" }, { v: c.cupomDoApp, estilo: "reais" }, { v: c.cupomDaLoja, estilo: "reais" },
      c.marketplace ? (c.comissaoPct == null ? "não cadastrada" : { v: c.comissaoPct / 100, estilo: "pct" }) : "—",
      { v: c.comissao, estilo: "reais" }, { v: c.freteDoApp, estilo: "reais" }, { v: c.taxaDoApp, estilo: "reais" },
      c.repasse == null ? "cadastre a comissão" : { v: c.repasse, estilo: "reaisNegrito" },
    ] });
    for (const f of c.formas.filter((x) => x.total > 0)) {
      resumo.push({ nivel: 1, celulas: [
        { v: `    ${f.rotulo}`, estilo: "suave" }, { v: f.pagamentos, estilo: "qtd" }, { v: f.total, estilo: "reais" },
        { v: f.online, estilo: "reais" }, { v: f.naEntrega, estilo: "reais" },
      ] });
    }
  }
  const t = resultado.total;
  resumo.push({ celulas: [
    { v: "TOTAL", estilo: "negrito" }, { v: t.vendas, estilo: "qtdNegrito" }, { v: t.valor, estilo: "reaisNegrito" },
    { v: t.online, estilo: "reaisNegrito" }, { v: t.naEntrega, estilo: "reaisNegrito" }, { v: t.cupomDoApp, estilo: "reaisNegrito" }, { v: t.cupomDaLoja, estilo: "reaisNegrito" },
    "", { v: t.comissao, estilo: "reaisNegrito" }, { v: t.freteDoApp, estilo: "reaisNegrito" }, { v: t.taxaDoApp, estilo: "reaisNegrito" }, "",
  ] });

  const semanas: LinhaDaPlanilha[] = [...topo("Repasse dos apps por semana (segunda a domingo)", ["Semana", "App", "Vendas", "Valor vendido", "Repasse estimado"])];
  for (const s of resultado.semanas) {
    for (const l of s.porCanal) {
      semanas.push({ celulas: [
        `${fmtDia(s.de)} a ${fmtDia(s.ate)}`, l.nome, { v: l.vendas, estilo: "qtd" }, { v: l.valor, estilo: "reais" },
        l.repasse == null ? "cadastre a comissão" : { v: l.repasse, estilo: "reais" },
      ] });
    }
  }

  const abas: AbaDaPlanilha[] = [
    { nome: "Por plataforma", congelarLinhas: 4, larguras: [26, 9, 15, 15, 15, 13, 13, 11, 13, 13, 14, 18], linhas: resumo },
    { nome: "Repasse por semana", congelarLinhas: 4, larguras: [26, 18, 9, 15, 17], linhas: semanas },
  ];
  return respostaDePlanilha(montarPlanilha(abas), `plataformas_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
