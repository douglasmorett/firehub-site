/**
 * GET /api/store/relatorios/formas-de-pagamento — o "Vendas por forma de
 * pagamento" da Saipos, com a régua do fechamento de caixa.
 *
 * Filtros comuns (lib/relatorios/base.ts): período, horário, tipo de venda,
 * canal, marca e loja. Categoria e produto não se aplicam: pagamento é do
 * pedido, não do item.
 *   formato=xlsx   baixa a planilha (resumo por forma, forma × dia e os
 *                  textos que cada forma juntou) em vez do JSON
 *
 * Duas fontes, como no caixa: os PEDIDOS do período (pela régua de
 * lib/relatorios/servidor.ts) e as CONTAS DE MESA fechadas no período (pelo
 * `closedAt`), que é onde a forma do pedido de mesa está gravada. A conta está
 * em lib/relatorios/formas-de-pagamento.ts (testada em
 * scripts/teste-formas-de-pagamento.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { mesasFechadasDoPeriodo } from "@/lib/relatorios/mesas-do-periodo";
import {
  COLUNAS_DO_PEDIDO, formasDePagamento, precisaDoDetalheDoCupom, FORMAS, type MesaParaFormas, type PedidoParaFormas, type SituacaoDaMesa,
} from "@/lib/relatorios/formas-de-pagamento";
import { DIAS_CURTOS, fmtDia, fmtReais, ROTULO_DO_TIPO, STATUS_FORA_DA_VENDA } from "@/lib/relatorios/base";
import { montarPlanilha, respostaDePlanilha, type AbaDaPlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  // Cancelados e intenções vêm junto (incluirForaDaVenda) só para serem
  // CONTADOS à parte ("12 cancelados, R$ 580 — não entram"); a conta pura
  // aplica a régua de venda e nunca os soma. As colunas (COLUNAS_DO_PEDIDO)
  // trazem os itens: sem eles a trava do valor impossível só olhava o total.
  const [pedidos, mesasDoFiltro] = await Promise.all([
    pedidosDoRelatorio(ctx, { incluirForaDaVenda: true, select: COLUNAS_DO_PEDIDO }),
    // A conta de mesa passa pelos MESMOS filtros do pedido (tipo Mesa, canal
    // Mesa, a loja, a faixa de horário pelo fechamento) — a busca comum de
    // lib/relatorios/mesas-do-periodo.ts, a mesma do Vendas por período e do
    // Faturamento por dia, já com os pedidos de cada conta (de qualquer dia,
    // para a ponte saber o consumo) e as baixas.
    mesasFechadasDoPeriodo(ctx, undefined, { comPagamentos: true }),
  ]);
  const idsDasMesas = new Set(mesasDoFiltro.map((s) => s.id));

  // A situação das contas dos pedidos de mesa do recorte que NÃO fecharam no
  // recorte — para a ponte dizer se a mesa está aberta, fechou depois ou fechou
  // fora da faixa de horário (antes, tudo era "ainda aberta"). E, dos pedidos
  // de marketplace sem cupom nos campos numéricos, as observações e o detalhe
  // do desconto (os campos pesados, só de quem precisa).
  const candidatosAoCupom = pedidos.filter((p) => precisaDoDetalheDoCupom(p as any)).map((p) => p.id);
  const contasSemFechamentoNoRecorte = [...new Set(pedidos
    .filter((p) => p.tableSessionId && !idsDasMesas.has(p.tableSessionId) && !STATUS_FORA_DA_VENDA.includes(p.status))
    .map((p) => p.tableSessionId as string))];
  const [detalhesDoCupom, situacaoDasContas] = await Promise.all([
    emLotes(candidatosAoCupom, 500, (lote) => prisma.customerOrder.findMany({
      where: { id: { in: lote } },
      select: { id: true, notes: true, discountDetails: true },
    })),
    emLotes(contasSemFechamentoNoRecorte, 500, (lote) => prisma.tableSession.findMany({
      where: { id: { in: lote } },
      select: { id: true, status: true, closedAt: true },
    })),
  ]);
  const situacaoDasMesas: SituacaoDaMesa[] = situacaoDasContas.map((s) => ({ id: s.id, status: s.status, fechadaEm: s.closedAt }));

  const doCupom = new Map(detalhesDoCupom.map((d) => [d.id, d]));
  const pedidosDaConta: PedidoParaFormas[] = pedidos.map((p) => {
    const d = doCupom.get(p.id);
    return (d ? { ...p, notes: d.notes, discountDetails: d.discountDetails } : p) as PedidoParaFormas;
  });
  const mesas: MesaParaFormas[] = mesasDoFiltro.map((s) => ({
    id: s.id, fechadaEm: s.fechadaEm, totalPago: s.pago ?? null, taxaDeServico: s.serviceFee ?? null, gorjeta: s.waiterTip ?? null,
    pagamentos: s.pagamentos, pedidos: s.pedidos.map((o) => ({ id: o.id, totalAmount: o.totalAmount, status: o.status, discountTotal: o.discountTotal })),
  }));

  const resultado = formasDePagamento(pedidosDaConta, mesas, { de: ctx.filtros.de, ate: ctx.filtros.ate, tz: ctx.tz }, situacaoDasMesas);
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, ...resultado });
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

  const topo = (titulo: string, colunas: string[]): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h; mesa conta no dia em que a conta fechou)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto} · vendas canceladas não entram` : "Filtros: nenhum (todas as vendas) · vendas canceladas não entram", estilo: "suave" }] },
    { celulas: [] },
    { celulas: colunas, estilo: "cabecalho" },
  ];

  const total = resultado.total.valor;
  const fracao = (v: number) => (total > 0 ? v / total : 0);

  // Aba 1 — o resumo: grupo → forma → canal (as linhas agrupadas do Excel).
  const resumo: LinhaDaPlanilha[] = [...topo("Vendas por forma de pagamento", ["Forma de pagamento", "Nível", "Pagamentos", "Contas pagas", "Valor", "% do total", "Média por conta"])];
  // "Contas pagas" é pedido ou conta de mesa distinto (o dividido em duas
  // formas é uma conta no grupo e no total), e a média é valor ÷ contas — a
  // coluna ao lado. NÃO são "vendas" nem "ticket médio": essas palavras são da
  // régua única (regua-da-venda.ts) e ficam na linha "Total das vendas", com o
  // mesmo número dos outros relatórios (lib/relatorios/formas-de-pagamento.ts,
  // LinhaDaForma, explica por que os dois números diferem).
  for (const g of resultado.grupos) {
    resumo.push({ nivel: 0, celulas: [
      { v: g.rotulo, estilo: "negrito" }, "Grupo", { v: g.pagamentos, estilo: "qtdNegrito" }, { v: g.contas, estilo: "qtdNegrito" },
      { v: g.valor, estilo: "reaisNegrito" }, { v: fracao(g.valor), estilo: "pctNegrito" }, { v: g.mediaPorConta, estilo: "reaisNegrito" },
    ] });
    for (const f of resultado.formas.filter((x) => x.grupo === g.chave)) {
      resumo.push({ nivel: 1, celulas: [
        `    ${f.rotulo}`, "Forma", { v: f.pagamentos, estilo: "qtd" }, { v: f.contas, estilo: "qtd" },
        { v: f.valor, estilo: "reais" }, { v: fracao(f.valor), estilo: "pct" }, { v: f.mediaPorConta, estilo: "reais" },
      ] });
      for (const c of f.porCanal) {
        resumo.push({ nivel: 2, celulas: [
          { v: `        ${c.rotulo}`, estilo: "suave" }, "Canal", { v: c.pagamentos, estilo: "qtd" }, "",
          { v: c.valor, estilo: "reais" }, { v: fracao(c.valor), estilo: "pct" }, "",
        ] });
      }
    }
  }
  resumo.push({ celulas: [
    { v: "TOTAL DOS PAGAMENTOS", estilo: "negrito" }, "", { v: resultado.total.pagamentos, estilo: "qtdNegrito" }, { v: resultado.total.contas, estilo: "qtdNegrito" },
    { v: total, estilo: "reaisNegrito" }, { v: total > 0 ? 1 : 0, estilo: "pctNegrito" }, { v: resultado.total.mediaPorConta, estilo: "reaisNegrito" },
  ] });
  resumo.push({ celulas: [] });
  // O total das vendas é o da régua única: vendas = atendimentos (a mesa uma
  // vez), o mesmo número do Vendas por período e do Faturamento por dia.
  const vv = resultado.vendas;
  resumo.push({ celulas: [
    { v: `Total das vendas: ${fmtReais(vv.valor)} (${vv.atendimentos} vendas${vv.pedidos !== vv.atendimentos ? `; ${vv.pedidos} lançamentos — a mesa conta uma vez` : ""}; ticket médio ${fmtReais(vv.ticketMedio)})`, estilo: "negrito" }, "", "",
    // Só o valor vai numa coluna da tabela: vendas e ticket ficam no texto, porque
    // as colunas do lado são "Contas pagas" e "Média por conta" — outro número.
    "", { v: vv.valor, estilo: "reaisNegrito" },
  ] });
  if (resultado.diferenca.linhas.length) {
    resumo.push({ celulas: [
      { v: "Diferença (pagamentos − vendas)", estilo: "negrito" }, "", "", "", { v: resultado.diferenca.valor, estilo: "reaisNegrito" },
    ] });
    resumo.push({ celulas: ["Por que os totais diferem", "Explicação", "", "Qtd.", "Valor"], estilo: "cabecalho" });
    for (const l of resultado.diferenca.linhas) {
      resumo.push({ nivel: 1, celulas: [`    ${l.rotulo}`, { v: l.explicacao, estilo: "suave" }, "", { v: l.quantidade, estilo: "qtd" }, { v: l.valor, estilo: "reais" }] });
    }
  } else {
    resumo.push({ celulas: [{ v: "O total dos pagamentos é igual ao total das vendas.", estilo: "suave" }] });
  }
  resumo.push({ celulas: [] });
  if (resultado.cupomDaPlataforma.valor > 0) {
    resumo.push({ celulas: [
      { v: "Cupom pago pelas plataformas (não é pagamento do cliente; a plataforma paga à loja junto com o repasse)", estilo: "negrito" }, "", "",
      { v: resultado.cupomDaPlataforma.pedidos, estilo: "qtd" }, { v: resultado.cupomDaPlataforma.valor, estilo: "reaisNegrito" },
    ] });
    for (const c of resultado.cupomDaPlataforma.porCanal) {
      resumo.push({ nivel: 1, celulas: [`    ${c.rotulo}`, "", "", { v: c.pagamentos, estilo: "qtd" }, { v: c.valor, estilo: "reais" }] });
    }
  }
  const fora = resultado.foraDaVenda;
  if (fora.cancelados.pedidos) {
    resumo.push({ celulas: [{ v: "Cancelados (não entram)", estilo: "suave" }, "", "", { v: fora.cancelados.pedidos, estilo: "qtd" }, { v: fora.cancelados.valor, estilo: "reais" }] });
  }
  if (fora.aguardandoPagamento.pedidos) {
    resumo.push({ celulas: [{ v: "Aguardando pagamento (não entram)", estilo: "suave" }, "", "", { v: fora.aguardandoPagamento.pedidos, estilo: "qtd" }, { v: fora.aguardandoPagamento.valor, estilo: "reais" }] });
  }
  if (fora.valoresImpossiveis) {
    resumo.push({ celulas: [{ v: `Valor impossível (R$ 1 milhão ou mais — erro de cadastro; fora de toda soma)`, estilo: "suave" }, "", "", { v: fora.valoresImpossiveis, estilo: "qtd" }] });
  }
  const troco = resultado.mesas.troco;
  if (troco.valor > 0) {
    resumo.push({ celulas: [{ v: "Troco devolvido nas mesas (contas; já fora do Dinheiro)", estilo: "suave" }, "", "", { v: troco.contas, estilo: "qtd" }, { v: troco.valor, estilo: "reais" }] });
  }
  resumo.push({ celulas: [] });
  resumo.push({ celulas: [{ v: "Mesa: a forma real está na conta da mesa (baixas do fechamento, com taxa de serviço e gorjeta), contada no dia em que a conta fechou. O pedido de mesa entra no total das vendas, nunca como pagamento.", estilo: "suave" }] });
  resumo.push({ celulas: [{ v: "A baixa da mesa grava o que o cliente entregou; o que passou da conta voltou como troco e sai do Dinheiro daquela conta.", estilo: "suave" }] });
  resumo.push({ celulas: [{ v: "Pagamento dividido conta em cada forma pelo valor dela. A leitura das formas é a do fechamento de caixa.", estilo: "suave" }] });
  resumo.push({ celulas: [{ v: "Contas pagas: pedidos e contas de mesa com pagamento na forma (a mesa no dia em que fechou; a cortesia de R$ 0 não tem pagamento). Não é o número de vendas nem o ticket médio — esses estão em \"Total das vendas\", iguais aos do Vendas por período e do Faturamento por dia.", estilo: "suave" }] });

  // Aba 2 — forma × dia.
  const colunasDasFormas = FORMAS.map((f) => f.rotulo);
  const porDia: LinhaDaPlanilha[] = [...topo("Formas de pagamento por dia", ["Dia", "Semana", ...colunasDasFormas, "Total"])];
  resultado.dias.forEach((dia, i) => {
    const semana = DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()];
    porDia.push({ celulas: [
      fmtDia(dia), semana,
      ...resultado.formas.map((f) => ({ v: f.porDia[i], estilo: "reais" as const })),
      { v: resultado.total.porDia[i], estilo: "reaisNegrito" },
    ] });
  });
  porDia.push({ celulas: [
    { v: "TOTAL", estilo: "negrito" }, "",
    ...resultado.formas.map((f) => ({ v: f.valor, estilo: "reaisNegrito" as const })),
    { v: total, estilo: "reaisNegrito" },
  ] });

  // Aba 3 — como veio escrito: o que cada forma juntou. É a prova de que
  // "Cartão Elo Credito (Cobrar na Entrega)" e "Cartão Crédito" estão na
  // mesma linha — e o que caiu em "não identificado" para alguém corrigir.
  const textos: LinhaDaPlanilha[] = [...topo("Como cada forma veio escrita", ["Forma", "Texto gravado", "Pagamentos", "Valor"])];
  for (const f of resultado.formas) {
    for (const t of f.textos) {
      textos.push({ celulas: [f.rotulo, t.rotulo, { v: t.pagamentos, estilo: "qtd" }, { v: t.valor, estilo: "reais" }] });
    }
    // Quem soma as baixas cruas da mesa acha mais dinheiro que esta aba: a
    // diferença é o troco, e ele fica escrito aqui.
    if (f.chave === "DINHEIRO" && troco.valor > 0) {
      textos.push({ celulas: [
        { v: f.rotulo, estilo: "suave" }, { v: `Troco devolvido nas mesas (já descontado das linhas acima; ${troco.contas} conta${troco.contas === 1 ? "" : "s"})`, estilo: "suave" },
        "", { v: troco.valor, estilo: "reais" },
      ] });
    }
  }

  const abas: AbaDaPlanilha[] = [
    { nome: "Resumo", congelarLinhas: 5, larguras: [46, 34, 12, 10, 16, 11, 14], linhas: resumo },
    { nome: "Forma × dia", congelarLinhas: 5, larguras: [12, 8, ...colunasDasFormas.map(() => 15), 16], linhas: porDia },
    { nome: "Como veio escrito", congelarLinhas: 5, larguras: [28, 52, 12, 16], linhas: textos },
  ];
  return respostaDePlanilha(montarPlanilha(abas), `formas-de-pagamento_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
