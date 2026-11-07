/**
 * GET /api/store/relatorios/fluxo-de-caixa — dia a dia: saldo anterior,
 * entradas e saídas realizadas, a receber, vendas previstas, a pagar e o
 * saldo previsto. A conta mora em lib/relatorios/fluxo-de-caixa.ts (testada
 * em scripts/teste-fluxo-de-caixa.ts); o a receber em lib/relatorios/recebiveis.ts.
 *
 *   de, ate        o período (o padrão da tela: hoje e os próximos 29 dias)
 *   previsao=0     sem as vendas previstas (padrão: com)
 *   agrupar=semana|mes   só para a planilha (a tela agrupa sozinha)
 *   formato=xlsx   baixa a planilha
 *
 * O que se busca: as vendas desde (início − maior prazo), para o crédito de
 * um mês atrás que cai no período; as das últimas 4 semanas, para a previsão;
 * as contas a pagar (pendentes, e as pagas desde o início da conta), as
 * recorrentes ativas e as despesas lançadas da janela.
 *
 * Só para quem tem "Financeiro" (lib/permissao-da-tela.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio } from "@/lib/relatorios/servidor";
import { DIAS_CURTOS, diasNoPeriodo, fmtDia, somarDias } from "@/lib/relatorios/base";
import { garantirEstruturaDeDespesas } from "@/lib/garantir-colunas";
import { dataDaLoja } from "@/lib/fuso";
import { configuracaoDosRecebiveis, maiorPrazo, prazosParaTela, recebiveisDasVendasDoPeriodo } from "@/lib/relatorios/recebiveis-servidor";
import {
  DIAS_DA_BASE, agruparFluxo, fluxoDeCaixa, lerSaldoInformado, vendasPrevistas,
  type ContaParaFluxo, type DespesaParaFluxo, type RecorrenteParaFluxo,
} from "@/lib/relatorios/fluxo-de-caixa";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

/** Mais que isso é planejamento de ano, não fluxo de caixa — e o saldo previsto lá não quer dizer nada. */
const MAX_DIAS_DO_FLUXO = 186;
/** Saldo informado há mais tempo que isso não ancora mais nada: a tela pede um novo. */
const SALDO_VALE_POR = 90;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req, "/store/relatorios/fluxo-de-caixa");
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const { de, ate } = ctx.filtros;
  if (diasNoPeriodo(de, ate) > MAX_DIAS_DO_FLUXO) {
    return NextResponse.json({ error: `Período maior que ${MAX_DIAS_DO_FLUXO} dias. Escolha um intervalo menor.` }, { status: 400 });
  }
  const comPrevisao = sp.get("previsao") !== "0";
  const hoje = ctx.hoje;

  const cfg = await configuracaoDosRecebiveis(ctx.donoId);
  const informado = lerSaldoInformado(cfg.financialGoals);
  const saldoAntigo = Boolean(informado && informado.dia < somarDias(de, -SALDO_VALE_POR));
  const saldo = informado && !saldoAntigo ? informado : null;

  // A conta corre desde o dia do saldo (se for antes do período) até o fim.
  const ancora = saldo && saldo.dia < de ? saldo.dia : de;
  const fimDaConta = saldo && saldo.dia > ate ? saldo.dia : ate;
  const vendasDe = [somarDias(ancora, -maiorPrazo(cfg.prazos)), ...(comPrevisao ? [somarDias(hoje, -DIAS_DA_BASE)] : [])].sort()[0];
  const vendasAte = fimDaConta < hoje ? fimDaConta : hoje;

  const [recebidos, contasDoBanco, recorrentesDoBanco, despesasDoBanco] = await Promise.all([
    recebiveisDasVendasDoPeriodo(ctx, vendasDe, vendasAte, cfg),
    prisma.payable.findMany({
      where: {
        franchiseeId: { in: ctx.lojaIds },
        // As pendentes (inclusive as vencidas) e as pagas desde um pouco antes do início da conta.
        OR: [{ status: { not: "PAID" } }, { paidDate: { gte: new Date(`${somarDias(ancora, -1)}T00:00:00Z`) } }],
      },
      select: { id: true, supplierName: true, value: true, status: true, dueDate: true, paidDate: true, recurringPayableId: true },
    }),
    prisma.recurringPayable.findMany({
      where: { franchiseeId: { in: ctx.lojaIds }, active: true },
      select: { id: true, supplierName: true, value: true, dueDateDay: true, active: true },
    }),
    (async () => {
      if (!(await garantirEstruturaDeDespesas())) return [];
      return prisma.despesaLancada.findMany({
        where: { franchiseeId: { in: ctx.lojaIds }, dia: { gte: ancora, lte: fimDaConta } },
        select: { id: true, dia: true, categoria: true, descricao: true, valor: true },
      });
    })().catch(() => []),
  ]);

  // O vencimento é DATA (gravada ao meio-dia), o "pago em" é o instante do clique, no fuso da loja — a régua da aba Contas a pagar.
  const contas: ContaParaFluxo[] = contasDoBanco.map((c) => ({
    id: c.id, fornecedor: c.supplierName, valor: Number(c.value) || 0, vencimento: c.dueDate.toISOString().slice(0, 10),
    pago: c.status === "PAID", pagoEm: c.paidDate ? dataDaLoja(ctx.tz, c.paidDate) : null, recorrenteId: c.recurringPayableId,
  }));
  const recorrentes: RecorrenteParaFluxo[] = recorrentesDoBanco.map((x) => ({ id: x.id, fornecedor: x.supplierName, valor: Number(x.value) || 0, diaDoVencimento: x.dueDateDay, ativa: x.active }));
  const despesas: DespesaParaFluxo[] = despesasDoBanco.map((x) => ({ id: x.id, dia: x.dia, categoria: x.categoria, descricao: x.descricao, valor: Number(x.valor) || 0 }));

  const previstas = comPrevisao ? vendasPrevistas(recebidos.recebiveis, { hoje, ate: fimDaConta }) : [];
  const resultado = fluxoDeCaixa({ de, ate, hoje, recebiveis: recebidos.recebiveis, previstas, contas, recorrentes, despesas, saldo });
  const appsComVenda = new Set(recebidos.recebiveis.filter((x) => x.tipo === "APP").map((x) => x.chave));
  const cabecalho = cabecalhoDoRelatorio(ctx);

  const corpo = {
    ...cabecalho,
    ...resultado,
    comPrevisao,
    saldoAntigo: saldoAntigo ? informado : null,
    prazos: prazosParaTela(cfg, appsComVenda),
    algumPrazoPadrao: recebidos.recebiveis.some((x) => x.prazoPadrao),
    fora: recebidos.fora,
    semComissao: recebidos.semComissao,
    semTaxa: recebidos.semTaxa,
  };
  if (sp.get("formato") !== "xlsx") return NextResponse.json(corpo);

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const R = (v: number, negrito = false) => ({ v, estilo: negrito ? ("reaisNegrito" as const) : ("reais" as const) });
  const agrupar = sp.get("agrupar") === "semana" || sp.get("agrupar") === "mes" ? (sp.get("agrupar") as "semana" | "mes") : null;
  const COLUNAS = ["Data", "Saldo anterior", "Entradas realizadas", "Saídas realizadas", "A receber", ...(comPrevisao ? ["Vendas previstas"] : []), "A pagar", "Saldo previsto"];
  const linhas: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Fluxo de caixa — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(de)} a ${fmtDia(ate)} · hoje ${fmtDia(hoje)}${saldo ? ` · saldo informado em ${fmtDia(saldo.dia)}: R$ ${saldo.valor.toFixed(2).replace(".", ",")}` : " · sem saldo informado: a linha começa em R$ 0 e mostra só a variação"}`, estilo: "suave" }] },
    { celulas: [{ v: "A receber é ESTIMADO: cada venda cai no prazo da forma (crédito, débito, Pix, app) menos a taxa cadastrada. Vendas previstas repetem o ritmo das últimas 4 semanas.", estilo: "suave" }] },
    { celulas: [] },
    { celulas: COLUNAS, estilo: "cabecalho" },
  ];
  const linhaDe = (rotulo: string, x: { saldoAnterior: number; entradasRealizadas: number; saidasRealizadas: number; aReceber: number; vendasPrevistas: number; aPagar: number; saldo: number }): LinhaDaPlanilha => ({
    celulas: [rotulo, R(x.saldoAnterior), R(x.entradasRealizadas), R(x.saidasRealizadas), R(x.aReceber), ...(comPrevisao ? [R(x.vendasPrevistas)] : []), R(x.aPagar), R(x.saldo, true)],
  });
  if (agrupar) for (const g of agruparFluxo(resultado.dias, agrupar)) linhas.push(linhaDe(g.rotulo, g));
  else for (const d of resultado.dias) linhas.push(linhaDe(`${DIAS_CURTOS[d.diaSemana]} ${fmtDia(d.dia)}${d.quando === "hoje" ? " (hoje)" : ""}`, d));
  linhas.push({
    celulas: [{ v: "TOTAL", estilo: "negrito" }, R(resultado.saldoInicial, true), R(resultado.total.entradasRealizadas, true), R(resultado.total.saidasRealizadas, true), R(resultado.total.aReceber, true),
      ...(comPrevisao ? [R(resultado.total.vendasPrevistas, true)] : []), R(resultado.total.aPagar, true), R(resultado.saldoFinal, true)],
  });
  if (resultado.negativo) {
    linhas.push({ celulas: [] }, { celulas: [{ v: `⚠ O saldo previsto fica negativo em ${fmtDia(resultado.negativo.dia)}: R$ ${resultado.negativo.saldo.toFixed(2).replace(".", ",")}`, estilo: "negrito" }] });
  }

  // A 2ª aba: cada movimento, para o contador conferir.
  const movs: LinhaDaPlanilha[] = [
    { celulas: [{ v: "Movimentos do fluxo de caixa", estilo: "titulo" }] },
    { celulas: [] },
    { celulas: ["Data", "Tipo", "Situação", "Descrição", "Valor"], estilo: "cabecalho" },
  ];
  for (const d of resultado.dias) {
    for (const m of d.movimentos) {
      movs.push({ celulas: [fmtDia(d.dia), m.tipo === "ENTRADA" ? "Entrada" : "Saída", m.previsto ? (m.vencidaEm ? `Vencida em ${fmtDia(m.vencidaEm)}` : "Previsto") : "Realizado", m.descricao, R(m.tipo === "ENTRADA" ? m.valor : -m.valor)] });
    }
  }

  const buffer = montarPlanilha([
    { nome: "Fluxo de caixa", congelarLinhas: 5, larguras: [18, 15, 15, 15, 15, ...(comPrevisao ? [15] : []), 15, 16], linhas },
    { nome: "Movimentos", congelarLinhas: 3, larguras: [12, 9, 20, 44, 14], linhas: movs },
  ]);
  return respostaDePlanilha(buffer, `fluxo-de-caixa_${de}_a_${ate}.xlsx`);
}
