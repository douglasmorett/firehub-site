/**
 * /api/store/relatorios/ranking-de-entregadores — o ranking da equipe de
 * entrega (lib/relatorios/ranking-de-entregadores.ts), para o relatório e para
 * a aba Ranking da tela Motoboys.
 *
 *   GET  ?de&ate (os filtros dos relatórios) ou ?atalho=hoje|7d|30d|mes
 *        tela=motoboys   a permissão é a da tela Motoboys (funcionário com
 *                        "Motoboys" e sem "Relatórios" vê a aba)
 *        formato=xlsx    a planilha
 *   PUT  { rankingNoApp: boolean } — mostrar ou não o ranking no app dos
 *        entregadores (User.appMotoboyConfig.rankingNoApp; padrão desligado).
 *
 * Volta também o ranking do período anterior de mesmo tamanho, só posição e
 * score de cada um: é o "subiu 2" / "caiu 1" da tela.
 */
import { NextRequest, NextResponse } from "next/server";
import { cabecalhoDoRelatorio, contextoDoRelatorio, janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { periodoAnterior, periodoDoAtalho, type AtalhoDePeriodo } from "@/lib/relatorios/base";
import { lerRankingDeEntregadores } from "@/lib/relatorios/ranking-de-entregadores-banco";
import { PESOS } from "@/lib/relatorios/ranking-de-entregadores";
import { lerAppMotoboyConfig } from "@/lib/app-motoboy-config";
import { prisma } from "@/lib/prisma";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

const ATALHOS_ACEITOS: AtalhoDePeriodo[] = ["hoje", "ontem", "7d", "15d", "30d", "mes", "mesAnterior"];
const telaDo = (req: NextRequest) => (req.nextUrl.searchParams.get("tela") === "motoboys" ? "/store/motoboys" : "/store/relatorios");

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req, telaDo(req));
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  // A aba da tela Motoboys não tem a barra de filtros: escolhe por atalho, e o
  // "hoje" é o da loja (o celular do gerente pode estar em outro fuso).
  const atalho = sp.get("atalho") as AtalhoDePeriodo | null;
  const periodo = atalho && ATALHOS_ACEITOS.includes(atalho)
    ? periodoDoAtalho(atalho, ctx.hoje)
    : { de: ctx.filtros.de, ate: ctx.filtros.ate };
  const anterior = periodoAnterior(periodo.de, periodo.ate);

  const [ranking, rankingAnterior, lojas] = await Promise.all([
    lerRankingDeEntregadores(ctx.lojaIds, janelaDoPeriodo(periodo.de, periodo.ate, ctx.tz), ctx.tz),
    lerRankingDeEntregadores(ctx.lojaIds, janelaDoPeriodo(anterior.de, anterior.ate, ctx.tz), ctx.tz),
    prisma.user.findMany({ where: { id: { in: ctx.lojaIds } }, select: { appMotoboyConfig: true } }),
  ]);
  const antes: Record<string, { posicao: number | null; score: number | null }> = {};
  for (const l of rankingAnterior.linhas) antes[l.motoboyId] = { posicao: l.posicao, score: l.score };
  // Várias lojas: ligado só se estiver ligado em todas (a tela diz o que vale).
  const rankingNoApp = lojas.length > 0 && lojas.every((l) => lerAppMotoboyConfig(l.appMotoboyConfig).rankingNoApp);

  if (sp.get("formato") === "xlsx") {
    const n = (v: number | null) => (v == null ? null : v);
    const linhas: LinhaDaPlanilha[] = [
      { celulas: [{ v: "Ranking de entregadores", estilo: "titulo" }] },
      { celulas: [`${periodo.de} a ${periodo.ate}`] },
      { celulas: [] },
      {
        estilo: "cabecalho",
        celulas: ["Posição", "Entregador", "Score", "Entregas", "Cancelados com ele", "Conclusão %", "Entrega mediana (min)", "Entrega média (min)",
          "No prazo %", "Atrasadas", "Atraso médio (min)", "Coleta mediana (min)", "Volta mediana (min)", "Viagens", "Pedidos por viagem",
          "Km", "Dias", "Entregas por dia", "Avaliação"],
      },
      ...ranking.linhas.map((l) => ({
        celulas: [l.posicao ?? "—", l.nome, n(l.score), l.entregas, l.canceladas, n(l.conclusaoPct), n(l.entregaMedianaMin), n(l.entregaMediaMin),
          n(l.noPrazoPct), l.atrasadas, n(l.atrasoMedioMin), n(l.coletaMedianaMin), n(l.voltaMedianaMin), l.viagens, n(l.pedidosPorViagem),
          n(l.km), l.dias, n(l.entregasPorDia), n(l.avaliacao)],
      })),
      { celulas: [] },
      { celulas: [{ v: `Score: conclusão ${PESOS.conclusao} · no prazo ${PESOS.prazo} · entrega ${PESOS.entrega} · volta ${PESOS.volta} · coleta ${PESOS.coleta}. Tempo contra a mediana da equipe.`, estilo: "suave" }] },
    ];
    return respostaDePlanilha(montarPlanilha([{ nome: "Ranking", linhas, larguras: [9, 28, 8, 10, 12, 12, 12, 12, 11, 10, 12, 12, 12, 9, 12, 8, 7, 12, 10] }]),
      `ranking-de-entregadores-${periodo.de}-a-${periodo.ate}.xlsx`);
  }

  return NextResponse.json({
    ...cabecalhoDoRelatorio(ctx),
    periodo,
    periodoAnterior: anterior,
    ...ranking,
    antes,
    rankingNoApp,
    pesos: PESOS,
  });
}

export async function PUT(req: NextRequest) {
  const r = await contextoDoRelatorio(req, "/store/motoboys");
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const corpo = await req.json().catch(() => null);
  if (typeof corpo?.rankingNoApp !== "boolean") return NextResponse.json({ error: "Diga se o ranking aparece no app (rankingNoApp)." }, { status: 400 });

  // Só a chave do ranking muda; o resto do que a loja escolheu para o app fica.
  const lojas = await prisma.user.findMany({ where: { id: { in: ctx.lojaIds } }, select: { id: true, appMotoboyConfig: true } });
  await prisma.$transaction(lojas.map((l) => prisma.user.update({
    where: { id: l.id },
    data: { appMotoboyConfig: { ...lerAppMotoboyConfig(l.appMotoboyConfig), rankingNoApp: corpo.rankingNoApp } },
  })));
  return NextResponse.json({ success: true, rankingNoApp: corpo.rankingNoApp });
}
