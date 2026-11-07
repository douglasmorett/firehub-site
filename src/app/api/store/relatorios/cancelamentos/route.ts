/**
 * GET /api/store/relatorios/cancelamentos — "Cancelamentos e cortesias": o
 * que a loja tirou de venda (pedido inteiro, rodada, item, quantidade) e o
 * que deu de graça, com quem fez, quando, o motivo e o valor, e os alertas
 * anti-fraude. A conta está em lib/relatorios/cancelamentos.ts (testada em
 * scripts/teste-cancelamentos.ts).
 *
 * Filtros comuns (lib/relatorios/base.ts): tipo, canal e marca são os do
 * pedido; a faixa de horário também olha a hora do PEDIDO. O período olha a
 * hora em que o cancelamento/a cortesia ACONTECEU. formato=xlsx baixa a planilha.
 *
 * ── O que vai ao banco ──────────────────────────────────────────────────────
 *
 * 1. Os pedidos criados de CANCELAMENTOS_OLHAM_PARA_TRAS_DIAS antes do início
 *    até o fim do período, inclusive os cancelados (a rodada lançada ontem e
 *    cancelada hoje), com o rastro e os carimbos de cozinha.
 * 2. Só dos pedidos cancelados: os itens (para dizer o que saiu quando o
 *    rastro não tem `itensRetirados`).
 * 3. Das mesas desses pedidos: o nome da mesa e a primeira vez que a conta foi
 *    impressa (PrintRequest CONTA_DA_MESA) — o alerta "depois da conta".
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { ehCancelado, fmtDia, ROTULO_DO_TIPO } from "@/lib/relatorios/base";
import {
  CANCELAMENTOS_OLHAM_PARA_TRAS_DIAS, ROTULO_DO_ALERTA, cancelamentosDoPeriodo, type PedidoParaCancelamentos,
} from "@/lib/relatorios/cancelamentos";
import { rotuloDaMesa } from "@/lib/relatorios/descontos";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { montarPlanilha, respostaDePlanilha, type AbaDaPlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

const DIA_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const f = ctx.filtros;

  const pedidos = await pedidosDoRelatorio(ctx, {
    janela: { inicio: new Date(ctx.inicio.getTime() - CANCELAMENTOS_OLHAM_PARA_TRAS_DIAS * DIA_MS), fim: ctx.fim },
    incluirForaDaVenda: true,
    select: {
      dailyOrderNumber: true, customerName: true, cancelledBy: true, cancelReason: true, cancelledAt: true,
      editHistory: true, printedAt: true, kdsProductionAt: true, readyAt: true, dispatchedAt: true,
    },
  });

  // Os itens só de quem foi cancelado inteiro (o rastro dos outros já diz o que saiu).
  const cancelados = pedidos.filter((p) => ehCancelado(p.status)).map((p) => p.id);
  const itens = await emLotes(cancelados, 500, (lote) => prisma.customerOrderItem.findMany({
    where: { orderId: { in: lote } },
    select: { orderId: true, productName: true, quantity: true, price: true },
  }));
  const itensDe = new Map<string, { productName: string | null; quantity: number; price: number }[]>();
  for (const i of itens) itensDe.set(i.orderId, [...(itensDe.get(i.orderId) || []), i]);

  // As mesas: o nome e a primeira impressão da conta.
  const comRastroOuCancelado = pedidos.filter((p) => p.tableSessionId && (ehCancelado(p.status) || Array.isArray(p.editHistory)));
  const sessoes = [...new Set(comRastroOuCancelado.map((p) => p.tableSessionId as string))];
  const [mesas, impressoes] = await Promise.all([
    emLotes(sessoes, 500, (lote) => prisma.tableSession.findMany({
      where: { id: { in: lote }, franchiseeId: { in: ctx.lojaIds } },
      select: { id: true, table: { select: { number: true, label: true } } },
    })),
    emLotes(sessoes, 500, (lote) => prisma.printRequest.findMany({
      where: { franchiseeId: { in: ctx.lojaIds }, kind: "CONTA_DA_MESA", tableSessionId: { in: lote } },
      select: { tableSessionId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    })),
  ]);
  const nomeDaMesa = new Map(mesas.map((m) => [m.id, rotuloDaMesa({ mesa: m.table?.number ?? null, nome: m.table?.label })]));
  const contasImpressas = new Map<string, Date>();
  for (const i of impressoes) if (i.tableSessionId && !contasImpressas.has(i.tableSessionId)) contasImpressas.set(i.tableSessionId, i.createdAt);

  const prontos: PedidoParaCancelamentos[] = pedidos.map((p) => ({
    ...(p as any),
    items: itensDe.get(p.id) || undefined,
    mesa: p.tableSessionId ? nomeDaMesa.get(p.tableSessionId) || null : null,
  }));
  const resultado = cancelamentosDoPeriodo(prontos, { tz: ctx.tz, inicio: ctx.inicio, fim: ctx.fim, contasImpressas });
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, ...resultado });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const nomeDaMarca = new Map(cabecalho.marcas.map((m) => [m.chave, m.rotulo]));
  const filtrosEmTexto = [
    f.horaDe || f.horaAte ? `Horário do pedido ${f.horaDe || "00:00"}–${f.horaAte || "24:00"}` : "",
    f.tipos.length ? `Tipo: ${f.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    f.canais.length ? `Canal: ${f.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    f.marcas.length ? `Marca: ${f.marcas.map((m) => nomeDaMarca.get(m) || m).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const topo = (titulo: string, extra?: string): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(f.de)} a ${fmtDia(f.ate)} (o dia vira às 5h; vale a hora do cancelamento)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum", estilo: "suave" }] },
    { celulas: [{ v: extra || "Só o que a LOJA cancelou (pedido, rodada da mesa, item tirado, quantidade diminuída). O que o cliente, a plataforma ou o sistema cancelou está na aba \"Por fora\". \"Operador não registrado\": cancelamento sem o nome de quem fez no rastro (antigo).", estilo: "suave" }] },
    { celulas: [] },
  ];
  const cab = (...c: string[]): LinhaDaPlanilha => ({ celulas: c, estilo: "cabecalho" });
  const R = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "reaisNegrito" : "reais" });
  const Q = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "qtdNegrito" : "qtd" });
  const P = (v: number | null): Celula => (v == null ? "—" : { v: v / 100, estilo: "pct" });
  const N = (v: string): Celula => ({ v, estilo: "negrito" });
  const s = resultado.resumo;

  const resumo: LinhaDaPlanilha[] = [
    ...topo("Cancelamentos e cortesias"),
    cab("Resumo", "Quantidade", "Valor"),
    { celulas: [N("Cancelado pela loja"), Q(s.cancelamentos, true), R(s.valor, true)] },
    { celulas: ["  Pedidos / rodadas cancelados inteiros", Q(s.pedidos), R(s.valorPedidos)] },
    { celulas: ["  Itens tirados ou quantidade diminuída", Q(s.itens), R(s.valorItens)] },
    { celulas: ["Cancelado ÷ valor vendido", "", P(s.pctDoValorVendido)] },
    { celulas: ["Com alerta (depois da conta, de pronto ou da cozinha)", Q(s.comAlerta), R(s.valorComAlerta)] },
    ...resultado.alertas.map((a) => ({ celulas: [`  ${a.rotulo}`, Q(a.cancelamentos), R(a.valor)] })),
    { celulas: ["Sem operador registrado", Q(s.semOperador)] },
    { celulas: [N("Cortesias"), Q(s.cortesias, true), R(s.valorCortesias, true)] },
    { celulas: ["Cortesias ÷ valor vendido", "", P(s.pctCortesias)] },
    { celulas: ["Valor vendido no período (o mesmo do Vendas por período)", "", R(s.valorVendido)] },
    { celulas: ["Cancelados por fora (cliente, plataforma, sistema)", Q(s.foraDaLoja), R(s.valorForaDaLoja)] },
    ...(resultado.foraDaCurva.length ? [{ celulas: [`Fora da curva: ${resultado.foraDaCurva.join(", ")} (o dobro, ou mais, da média dos outros)`] }] : []),
  ];

  const operadores: LinhaDaPlanilha[] = [
    ...topo("Por operador", "O FireHub não grava quem LANÇOU cada venda: a comparação é entre os operadores. \"Fora da curva\": 3 ou mais cancelamentos e o dobro (em R$), ou mais, da média dos outros."),
    cab("Operador", "Cancelamentos", "Pedidos", "Itens", "Valor", "% do cancelado", "Com alerta", "Fora da curva", "Cortesias", "Valor das cortesias"),
    ...resultado.porOperador.map((o) => ({ celulas: [N(o.nome), Q(o.cancelamentos), Q(o.pedidos), Q(o.itens), R(o.valor), P(o.pct), Q(o.comAlerta), o.foraDaCurva ? "sim" : "", Q(o.cortesias), R(o.valorCortesias)] })),
    { celulas: [] },
    cab("Motivo", "Cancelamentos", "Valor", "% do cancelado"),
    ...resultado.porMotivo.map((m) => ({ celulas: [m.motivo, Q(m.cancelamentos), R(m.valor), P(m.pct)] })),
    { celulas: [] },
    cab("Produto", "Vezes", "Unidades", "Valor"),
    ...resultado.porProduto.map((p) => ({ celulas: [p.nome, Q(p.vezes), Q(p.quantidade), R(p.valor)] })),
  ];

  const lista: LinhaDaPlanilha[] = [
    ...topo("Cancelamentos", "Uma linha por cancelamento, do mais recente para o mais antigo."),
    cab("Data", "Hora", "Número", "Onde", "Canal", "O quê", "Itens", "Operador", "Motivo", "Valor", "Alertas"),
    ...resultado.lista.map((l) => ({
      celulas: [fmtDia(l.dia), l.hora, l.numero, l.onde, l.canalNome, l.tipo === "PEDIDO" ? "Pedido inteiro" : "Item", l.itens, l.quem, l.motivo || "", R(l.valor), l.alertas.map((a) => ROTULO_DO_ALERTA[a]).join("; ")],
    })),
    { celulas: [N("TOTAL"), "", Q(resultado.lista.length, true), "", "", "", "", "", "", R(s.valor, true), ""] },
  ];

  const cortesias: LinhaDaPlanilha[] = [
    ...topo("Cortesias", "Item dado de graça: fica a R$ 0,00 no pedido, sai da venda e entra no custo (o estoque não volta). Valor = o que o item teria custado."),
    cab("Data", "Hora", "Número", "Onde", "Cliente", "Itens", "Quem deu", "Motivo", "Valor"),
    ...resultado.cortesias.map((c) => ({ celulas: [fmtDia(c.dia), c.hora, c.numero, c.onde, c.cliente, c.itens, c.quem, c.motivo || "", R(c.valor)] })),
    { celulas: [N("TOTAL"), "", Q(resultado.cortesias.length, true), "", "", "", "", "", R(s.valorCortesias, true)] },
  ];

  const porFora: LinhaDaPlanilha[] = [
    ...topo("Cancelados por fora", "Não é a mão do caixa: o cliente cancelou no site, a plataforma cancelou, o Pix venceu, o robô encerrou."),
    cab("Quem cancelou", "Pedidos", "Valor"),
    ...resultado.porFora.map((x) => ({ celulas: [x.quem, Q(x.pedidos), R(x.valor)] })),
  ];

  const abas: AbaDaPlanilha[] = [
    { nome: "Resumo", linhas: resumo, larguras: [62, 14, 14], congelarLinhas: 5 },
    { nome: "Por operador", linhas: operadores, larguras: [32, 14, 10, 10, 14, 14, 12, 13, 11, 18], congelarLinhas: 6 },
    { nome: "Cancelamentos", linhas: lista, larguras: [12, 7, 9, 14, 12, 14, 48, 26, 40, 12, 36], congelarLinhas: 6 },
    { nome: "Cortesias", linhas: cortesias, larguras: [12, 7, 9, 14, 22, 44, 26, 32, 12], congelarLinhas: 6 },
    { nome: "Por fora", linhas: porFora, larguras: [44, 12, 14], congelarLinhas: 6 },
  ];
  return respostaDePlanilha(montarPlanilha(abas), `cancelamentos-e-cortesias_${f.de}_a_${f.ate}.xlsx`);
}
