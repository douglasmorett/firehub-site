/**
 * GET /api/store/relatorios/contas-a-receber — o "Receitas" do SWFast: o que
 * cada venda JÁ FEITA ainda vai pôr na conta, por dia, forma e app — bruto,
 * taxa %, taxa e líquido. A conta mora em lib/relatorios/recebiveis.ts
 * (testada em scripts/teste-contas-a-receber.ts).
 *
 *   de, ate        o período em que o dinheiro CAI (a tela manda o mês)
 *   formato=xlsx   baixa a planilha
 *
 * Busca as vendas desde (início − maior prazo): o crédito vendido em outubro
 * cai em novembro. Venda que ainda não aconteceu não entra aqui (está no
 * Fluxo de caixa, como "vendas previstas").
 *
 * Só para quem tem "Financeiro" (lib/permissao-da-tela.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { cabecalhoDoRelatorio, contextoDoRelatorio } from "@/lib/relatorios/servidor";
import { DIAS_CURTOS, diasNoPeriodo, fmtDia, somarDias } from "@/lib/relatorios/base";
import { configuracaoDosRecebiveis, maiorPrazo, prazosParaTela, recebiveisDasVendasDoPeriodo } from "@/lib/relatorios/recebiveis-servidor";
import { contasAReceber } from "@/lib/relatorios/recebiveis";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

const MAX_DIAS = 186;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req, "/store/relatorios/contas-a-receber");
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const { de, ate } = ctx.filtros;
  if (diasNoPeriodo(de, ate) > MAX_DIAS) {
    return NextResponse.json({ error: `Período maior que ${MAX_DIAS} dias. Escolha um intervalo menor.` }, { status: 400 });
  }

  const cfg = await configuracaoDosRecebiveis(ctx.donoId);
  const vendasAte = ate < ctx.hoje ? ate : ctx.hoje;
  const recebidos = await recebiveisDasVendasDoPeriodo(ctx, somarDias(de, -maiorPrazo(cfg.prazos)), vendasAte, cfg);
  const resultado = contasAReceber(recebidos.recebiveis, { de, ate, hoje: ctx.hoje });
  const appsComVenda = new Set(recebidos.recebiveis.filter((x) => x.tipo === "APP").map((x) => x.chave));
  const cabecalho = cabecalhoDoRelatorio(ctx);

  const corpo = {
    ...cabecalho,
    ...resultado,
    prazos: prazosParaTela(cfg, appsComVenda),
    algumPrazoPadrao: resultado.linhas.some((x) => x.prazoPadrao),
    fora: recebidos.fora,
    semComissao: recebidos.semComissao,
    semTaxa: recebidos.semTaxa,
  };
  if (req.nextUrl.searchParams.get("formato") !== "xlsx") return NextResponse.json(corpo);

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const R = (v: number, negrito = false) => ({ v, estilo: negrito ? ("reaisNegrito" as const) : ("reais" as const) });
  const P = (v: number | null) => (v == null ? "não cadastrada" : { v: v / 100, estilo: "pct" as const });
  const topo = (titulo: string, colunas: string[]): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Cai na conta de ${fmtDia(de)} a ${fmtDia(ate)} · estimado pelo prazo e pela taxa cadastrados (app: repasse pela comissão)`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: colunas, estilo: "cabecalho" },
  ];
  const porForma: LinhaDaPlanilha[] = [...topo("Contas a receber", ["Forma / app", "Prazo", "Vendas/pagamentos", "Bruto", "Taxa %", "Taxa", "Líquido"])];
  for (const f of resultado.porForma) {
    porForma.push({ celulas: [{ v: f.rotulo, estilo: "negrito" }, `D+${f.prazo}${f.prazoPadrao ? " (padrão)" : ""}`, { v: f.quantidade, estilo: "qtd" }, R(f.bruto), P(f.taxaPct), R(f.taxa), R(f.liquido, true)] });
  }
  porForma.push({ celulas: [{ v: "TOTAL", estilo: "negrito" }, "", "", R(resultado.total.bruto, true), "", R(resultado.total.taxa, true), R(resultado.total.liquido, true)] });

  const porDia: LinhaDaPlanilha[] = [...topo("Contas a receber por dia", ["Cai em", "Venda de", "Forma / app", "Bruto", "Taxa %", "Taxa", "Líquido"])];
  for (const l of resultado.linhas) {
    porDia.push({ celulas: [`${DIAS_CURTOS[new Date(`${l.dia}T12:00:00Z`).getUTCDay()]} ${fmtDia(l.dia)}`, fmtDia(l.diaDaVenda), l.rotulo, R(l.bruto), P(l.taxaPct), R(l.taxa), R(l.liquido, true)] });
  }

  const buffer = montarPlanilha([
    { nome: "Por forma", congelarLinhas: 4, larguras: [34, 14, 12, 15, 10, 13, 15], linhas: porForma },
    { nome: "Por dia", congelarLinhas: 4, larguras: [16, 12, 34, 15, 10, 13, 15], linhas: porDia },
  ]);
  return respostaDePlanilha(buffer, `contas-a-receber_${de}_a_${ate}.xlsx`);
}
