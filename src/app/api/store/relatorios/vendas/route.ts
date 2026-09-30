/**
 * GET /api/store/relatorios/vendas — o "Vendas por período" da Saipos: o
 * resumo do período no topo e a lista de todos os pedidos, com detalhe.
 *
 * Filtros comuns (lib/relatorios/base.ts) mais:
 *   status=vendas|canceladas   a LISTA: não canceladas / só canceladas (padrão: todas)
 *   busca=texto                a LISTA: número do pedido, número no app, nome ou telefone
 *   pagina=N                   a LISTA: página de 50 (padrão 1)
 *   formato=xlsx               a planilha (Resumo + Pedidos, todas as linhas, sem página)
 *
 * O resumo NÃO muda com status, busca e página: é sempre o período nos
 * filtros comuns — vendas, canceladas e não concluídas, cada uma no seu lugar.
 * Status e busca escolhem só o que aparece na lista.
 *
 * A conta está em lib/relatorios/vendas.ts (testada em scripts/teste-vendas.ts),
 * inclusive por que o rascunho do robô e o totem sem pagamento não são
 * "cancelados" e como a mesa entra.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, janelaDoPeriodo, pedidosDoRelatorio,
  type ContextoDoRelatorio,
} from "@/lib/relatorios/servidor";
import { mesasFechadasDoPeriodo } from "@/lib/relatorios/mesas-do-periodo";
import { diasNoPeriodo, fmtDia, periodoAnterior, ROTULO_DO_TIPO } from "@/lib/relatorios/base";
import { anteriorAteEsteHorario } from "@/lib/relatorios/regua-da-venda";
import {
  finalDoTelefone, itensDoDetalhe, quemCancelou, lerFiltroDeStatus, linhaDoPedido, paginar, pedidosDaLista, precisaDoDetalheDoDesconto,
  resumoDeVendas, somaDasLinhas, nomeDoCanal, POR_PAGINA, ROTULO_DO_FILTRO_DE_STATUS,
  type LinhaDePedido, type PedidoParaVendas, type ResumoDeVendas, type SessaoDoPedido,
} from "@/lib/relatorios/vendas";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

/**
 * O que a conta e a lista leem do pedido, por cima das colunas dos filtros. Os
 * itens: só preço e quantidade. `parentOrderId`: o acréscimo não é venda nova
 * (lib/relatorios/regua-da-venda.ts).
 */
const COLUNAS_DA_VENDA = {
  deliveryFee: true, discountTotal: true, discountMerchant: true, discountIfood: true, parentOrderId: true,
  openDeliveryReference: true, dailyOrderNumber: true, customerName: true, customerPhone: true,
  paymentMethod: true, paymentMethods: true,
  items: { select: { quantity: true, price: true } },
} as const;

/**
 * O período anterior só alimenta a comparação dos cartões (vendas, total,
 * ticket, cancelados, descontos, entrega): sem itens, sem cliente — metade do
 * tráfego do banco para um número de rodapé.
 */
const COLUNAS_DO_ANTERIOR = { deliveryFee: true, discountTotal: true, discountMerchant: true, discountIfood: true, parentOrderId: true } as const;

/**
 * Quem pagou o desconto do 99Food antigo está em `discountDetails.promocoes`
 * (lib/relatorios/vendas.ts, descontoDoPedido). A coluna NÃO vem na consulta
 * do período: só os pedidos com desconto e sem as colunas de dono precisam
 * dela (123 em produção, todos do 99 anteriores a 18/09/2026). Uma segunda
 * consulta, só desses ids.
 */
async function comDetalheDoDesconto(ctx: ContextoDoRelatorio, pedidos: PedidoParaVendas[]): Promise<PedidoParaVendas[]> {
  const ids = pedidos.filter(precisaDoDetalheDoDesconto).map((p) => p.id);
  if (!ids.length) return pedidos;
  const detalhes = await emLotes(ids, 500, (lote) => prisma.customerOrder.findMany({
    where: { id: { in: lote }, franchiseeId: { in: ctx.lojaIds } },
    select: { id: true, discountDetails: true },
  }));
  const porId = new Map(detalhes.map((d) => [d.id, d.discountDetails]));
  return pedidos.map((p) => (porId.has(p.id) ? { ...p, discountDetails: porId.get(p.id) } : p));
}

/** As sessões dos pedidos de mesa da lista — o pagamento da mesa mora nelas. */
async function sessoesDosPedidos(ctx: ContextoDoRelatorio, pedidos: PedidoParaVendas[]): Promise<Map<string, SessaoDoPedido>> {
  const ids = [...new Set(pedidos.map((p) => p.tableSessionId).filter((x): x is string => Boolean(x)))];
  if (!ids.length) return new Map();
  const sessoes = await prisma.tableSession.findMany({
    where: { id: { in: ids }, franchiseeId: { in: ctx.lojaIds } },
    select: { id: true, status: true, paymentMethods: true, table: { select: { number: true, label: true } } },
  });
  return new Map(sessoes.map((s) => [s.id, {
    id: s.id, status: s.status, paymentMethods: s.paymentMethods,
    mesa: s.table ? (s.table.label?.trim() || `Mesa ${s.table.number}`) : null,
  }]));
}

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;

  const status = lerFiltroDeStatus(sp.get("status"));
  const busca = (sp.get("busca") || "").trim().slice(0, 80);
  const planilha = sp.get("formato") === "xlsx";

  // O anterior é cortado no mesmo horário de agora quando o período chega até
  // hoje — a mesma régua do Faturamento por dia (regua-da-venda.ts,
  // anteriorAteEsteHorario). Sem o corte, o "Hoje" do meio-dia saía "↓ 100%".
  const ant = periodoAnterior(ctx.filtros.de, ctx.filtros.ate);
  const { janela: janelaAnterior, ateEsteHorario } = anteriorAteEsteHorario(janelaDoPeriodo(ant.de, ant.ate, ctx.tz), {
    ate: ctx.filtros.ate, hoje: ctx.hoje, recuo: diasNoPeriodo(ctx.filtros.de, ctx.filtros.ate),
  });

  // Com `incluirForaDaVenda`: o resumo conta os cancelados e os não
  // concluídos — cada um na sua situação (lib/relatorios/vendas.ts).
  const [pedidos, pedidosAnteriores, mesas, mesasAnteriores] = await Promise.all([
    (pedidosDoRelatorio(ctx, { select: COLUNAS_DA_VENDA, incluirForaDaVenda: true }) as Promise<PedidoParaVendas[]>).then((l) => comDetalheDoDesconto(ctx, l)),
    (pedidosDoRelatorio(ctx, { select: COLUNAS_DO_ANTERIOR, incluirForaDaVenda: true, janela: janelaAnterior }) as Promise<PedidoParaVendas[]>).then((l) => comDetalheDoDesconto(ctx, l)),
    mesasFechadasDoPeriodo(ctx),
    mesasFechadasDoPeriodo(ctx, janelaAnterior),
  ]);

  const resumo = resumoDeVendas(pedidos, mesas);
  const r0 = resumoDeVendas(pedidosAnteriores, mesasAnteriores);
  const anterior = {
    de: ant.de, ate: ant.ate,
    /** O anterior foi cortado no mesmo horário de agora (o período chega até hoje). */
    ateEsteHorario,
    atendimentos: r0.atendimentos, pedidos: r0.pedidos, totalPedidos: r0.totalPedidos, ticketMedio: r0.ticketMedio,
    // Os descontos dos pedidos MAIS o dado no fechamento da mesa, este pelo dia
    // em que a mesa FECHOU (regra 4 da régua). É o MESMO total do relatório
    // Cupons e descontos desde que ele passou para a régua, em 24/09/2026
    // (antes ele pendurava o desconto da mesa no dia dos lançamentos: Pastel da
    // Paulista, 13/09/2026, R$ 286,49 aqui × R$ 161,09 lá). O
    // scripts/conferir-relatorios-batem.mjs confere, coluna "Desconto (anterior)".
    cancelados: r0.cancelados, descontos: descontosDoPeriodo(r0), taxaEntrega: r0.taxaEntrega.valor,
    servico: r0.servico.taxa + r0.servico.gorjeta,
  };

  const daLista = pedidosDaLista(pedidos, status, busca);
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (!planilha) {
    const pagina = paginar(daLista, Number(sp.get("pagina")) || 1);
    const ids = pagina.itens.map((p) => p.id);
    const [sessoes, detalhes] = await Promise.all([
      sessoesDosPedidos(ctx, pagina.itens),
      ids.length
        ? prisma.customerOrder.findMany({
            where: { id: { in: ids }, franchiseeId: { in: ctx.lojaIds } },
            select: {
              id: true, customerAddress: true, cancelReason: true, cancelledBy: true,
              items: { select: { quantity: true, price: true, productName: true, comboSelections: true, notes: true, menuProduct: { select: { name: true } } } },
            },
          })
        : Promise.resolve([]),
    ]);
    const detalheDe = new Map(detalhes.map((d) => [d.id, d]));
    const linhas = pagina.itens.map((p) => {
      const d = detalheDe.get(p.id);
      return {
        ...linhaDoPedido(p, ctx.tz, p.tableSessionId ? sessoes.get(p.tableSessionId) : null),
        detalhe: {
          itens: itensDoDetalhe(d?.items || []),
          endereco: d?.customerAddress?.trim() || null,
          motivoCancelamento: d?.cancelReason?.trim() || null,
          canceladoPor: quemCancelou(d?.cancelledBy),
        },
      };
    });
    return NextResponse.json({
      ...cabecalho,
      resumo,
      anterior,
      lista: {
        status, busca, pagina: pagina.pagina, paginas: pagina.paginas, porPagina: POR_PAGINA, total: pagina.total,
        // O rodapé é de TODAS as linhas do filtro, não só da página.
        soma: somaDasLinhas(daLista.map((p) => linhaDoPedido(p, ctx.tz))),
        linhas,
      },
    });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const sessoes = await sessoesDosPedidos(ctx, daLista);
  const linhas = daLista.map((p) => linhaDoPedido(p, ctx.tz, p.tableSessionId ? sessoes.get(p.tableSessionId) : null));
  const comSemDono = linhas.some((l) => l.descontoSemDono > 0);
  const buffer = montarPlanilha([
    { nome: "Resumo", larguras: [44, 16, 16, 16, 16, 12], linhas: abaResumo(ctx, cabecalho, resumo, anterior, status, busca) },
    { nome: "Pedidos", congelarLinhas: 6, larguras: larguraDosPedidos(comSemDono), linhas: abaPedidos(ctx, cabecalho, linhas, status, busca, comSemDono) },
  ]);
  return respostaDePlanilha(buffer, `vendas_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}

// ── AS ABAS ─────────────────────────────────────────────────────────────────

type Cabecalho = ReturnType<typeof cabecalhoDoRelatorio>;

/** Todo o desconto do período: o dos pedidos e o dado ao fechar a mesa. */
function descontosDoPeriodo(r: ResumoDeVendas): number {
  return Math.round((r.descontos.total + r.servico.descontoNaMesa) * 100) / 100;
}
type Anterior = { de: string; ate: string; ateEsteHorario: boolean; atendimentos: number; pedidos: number; totalPedidos: number; ticketMedio: number; cancelados: { pedidos: number; valor: number }; descontos: number; taxaEntrega: number; servico: number };

function filtrosEmTexto(ctx: ContextoDoRelatorio, cabecalho: Cabecalho): string {
  const f = ctx.filtros;
  const nomeDaMarca = new Map(cabecalho.marcas.map((m) => [m.chave, m.rotulo]));
  return [
    f.horaDe || f.horaAte ? `Horário ${f.horaDe || "00:00"}–${f.horaAte || "24:00"}` : "",
    f.tipos.length ? `Tipo: ${f.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    f.canais.length ? `Canal: ${f.canais.map((c) => nomeDoCanal(c, false)).join(", ")}` : "",
    f.marcas.length ? `Marca: ${f.marcas.map((m) => nomeDaMarca.get(m) || m).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
}

function topo(titulo: string, ctx: ContextoDoRelatorio, cabecalho: Cabecalho, extra: string[]): LinhaDaPlanilha[] {
  const filtros = filtrosEmTexto(ctx, cabecalho);
  return [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [{ v: filtros ? `Filtros: ${filtros}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    ...extra.map((t) => ({ celulas: [{ v: t, estilo: "suave" as const }] })),
  ];
}

/** O percentual 0–100 da conta como fração do Excel (0,12 = 12%), sem o ruído do float. */
const fracao = (pct: number) => Math.round(pct * 1000) / 100000;

/** Variação em fração (0,12 = 12%); vazio quando não há o que comparar. */
const variacao = (atual: number, antes: number) => (antes ? (atual - antes) / Math.abs(antes) : null);

function abaResumo(ctx: ContextoDoRelatorio, cabecalho: Cabecalho, r: ResumoDeVendas, a: Anterior, status: string, busca: string): LinhaDaPlanilha[] {
  const comparar = (rotulo: string, atual: number, antes: number, estilo: "qtd" | "reais"): LinhaDaPlanilha => ({
    celulas: [rotulo, { v: atual, estilo }, { v: antes, estilo }, { v: variacao(atual, antes), estilo: "pct" }],
  });
  const conta = (rotulo: string, valor: number, negrito = false): LinhaDaPlanilha => ({
    celulas: [{ v: rotulo, estilo: negrito ? "negrito" : "texto" }, { v: valor, estilo: negrito ? "reaisNegrito" : "reais" }],
  });
  return [
    ...topo("Vendas por período", ctx, cabecalho, [`Comparado com ${fmtDia(a.de)} a ${fmtDia(a.ate)}${a.ateEsteHorario ? " até este mesmo horário (hoje ainda está vendendo)" : ""} (mesmo número de dias, mesmos filtros)`]),
    { celulas: [] },
    { celulas: ["", "Este período", "Período anterior", "Variação"], estilo: "cabecalho" },
    comparar("Vendas (a mesa conta uma vez)", r.atendimentos, a.atendimentos, "qtd"),
    comparar("Lançamentos (pedidos, sem cancelados)", r.pedidos, a.pedidos, "qtd"),
    comparar("Valor vendido (total dos pedidos)", r.totalPedidos, a.totalPedidos, "reais"),
    comparar("Ticket médio (valor ÷ vendas)", r.ticketMedio, a.ticketMedio, "reais"),
    comparar("Pedidos cancelados", r.cancelados.pedidos, a.cancelados.pedidos, "qtd"),
    comparar("Valor cancelado", r.cancelados.valor, a.cancelados.valor, "reais"),
    comparar("Descontos (pedidos e fechamento da mesa)", descontosDoPeriodo(r), a.descontos, "reais"),
    comparar("Taxas de entrega", r.taxaEntrega.valor, a.taxaEntrega, "reais"),
    comparar("Taxa de serviço e gorjeta (mesas)", r.servico.taxa + r.servico.gorjeta, a.servico, "reais"),
    { celulas: [] },
    { celulas: ["A conta do período", "Valor"], estilo: "cabecalho" },
    conta(`Total dos itens (${r.quantidadeDeItens.toLocaleString("pt-BR")} itens)`, r.totalItens),
    conta(`+ Taxas de entrega (${r.taxaEntrega.pedidos} pedidos)`, r.taxaEntrega.valor),
    conta(`+ Outras taxas e ajustes (${r.outrasTaxas.pedidos} pedidos)`, r.outrasTaxas.valor),
    conta("− Descontos da loja", -r.descontos.loja),
    conta("− Descontos da plataforma (iFood, 99Food…)", -r.descontos.plataforma),
    ...(r.descontos.naoIdentificado > 0 ? [conta("− Descontos sem dono identificado (o pedido não diz quem pagou)", -r.descontos.naoIdentificado)] : []),
    conta("= Total dos pedidos (valor vendido)", r.totalPedidos, true),
    conta(`+ Taxa de serviço (${r.servico.mesas} mesas fechadas)`, r.servico.taxa),
    conta("+ Gorjeta", r.servico.gorjeta),
    ...(r.servico.descontoNaMesa > 0 ? [conta(`− Desconto no fechamento da mesa (${r.servico.mesasComDesconto} ${r.servico.mesasComDesconto === 1 ? "mesa" : "mesas"}; não sai do valor vendido)`, -r.servico.descontoNaMesa)] : []),
    conta("= Total com serviço e gorjeta", r.totalComServico, true),
    { celulas: [] },
    // Vendas = atendimentos (a mesa conta uma vez); o ticket é valor ÷ vendas.
    // Os lançamentos ficam na coluna do lado, para quem confere a aba Pedidos.
    { celulas: ["Tipo de venda", "Vendas", "Lançamentos", "Valor", "Ticket médio", "%"], estilo: "cabecalho" },
    ...r.porTipo.map((t) => ({ celulas: [t.rotulo, { v: t.vendas, estilo: "qtd" as const }, { v: t.pedidos, estilo: "qtd" as const }, { v: t.valor, estilo: "reais" as const }, { v: t.ticketMedio, estilo: "reais" as const }, { v: fracao(t.pct), estilo: "pct" as const }] })),
    { celulas: [{ v: "Total", estilo: "negrito" }, { v: r.atendimentos, estilo: "qtdNegrito" }, { v: r.pedidos, estilo: "qtdNegrito" }, { v: r.totalPedidos, estilo: "reaisNegrito" }, { v: r.ticketMedio, estilo: "reaisNegrito" }, { v: r.pedidos ? 1 : 0, estilo: "pctNegrito" }] },
    ...(r.mesas > 0 ? [{ celulas: [{ v: `Mesa: ${r.mesas} ${r.mesas === 1 ? "conta" : "contas"} = ${r.mesas} ${r.mesas === 1 ? "venda" : "vendas"}; cada rodada lançada é um lançamento, e a conta é uma venda só, no primeiro lançamento.`, estilo: "suave" as const }] }] : []),
    { celulas: [] },
    { celulas: ["Canal", "Vendas", "Lançamentos", "Valor", "Ticket médio", "%"], estilo: "cabecalho" },
    ...r.porCanal.map((c) => ({ celulas: [nomeDoCanal(c.canal, false), { v: c.vendas, estilo: "qtd" as const }, { v: c.pedidos, estilo: "qtd" as const }, { v: c.valor, estilo: "reais" as const }, { v: c.ticketMedio, estilo: "reais" as const }, { v: fracao(c.pct), estilo: "pct" as const }] })),
    { celulas: [] },
    { celulas: [{ v: "Cancelados não entram no total. Rascunho do robô e pedido do totem que não foi pago não são venda nem cancelamento" + (r.naoConcluidos.pedidos ? ` (${r.naoConcluidos.pedidos} no período, fora de todas as contas).` : "."), estilo: "suave" }] },
    ...(r.valoresImpossiveis ? [{ celulas: [{ v: `${r.valoresImpossiveis} ${r.valoresImpossiveis === 1 ? "pedido com valor impossível (R$ 1 milhão ou mais) ficou" : "pedidos com valor impossível (R$ 1 milhão ou mais) ficaram"} fora de todas as somas — está na aba Pedidos, marcado. Confira o cadastro.`, estilo: "suave" as const }] }] : []),
    { celulas: [{ v: "Total dos itens = o total do relatório Itens vendidos no mesmo filtro. Outras taxas e ajustes: a taxa de serviço que o app cobra do cliente (iFood, 99Food — o valor muda de pedido para pedido) e diferenças que o pedido não detalha, como item tirado de pedido pago online.", estilo: "suave" }] },
    { celulas: [{ v: "Desconto da plataforma sai do total que o cliente paga, mas é a plataforma que banca — ela repassa esse valor à loja. Quem pagou o desconto de cada PEDIDO é a mesma conta do relatório Cupons e descontos, e o desconto no fechamento da mesa entra, nos dois, no dia em que a mesa fechou: o total de desconto (dos pedidos mais o da mesa) é o mesmo nos dois.", estilo: "suave" }] },
    ...(r.servico.descontoNaMesa > 0 ? [{ celulas: [{ v: "Desconto no fechamento da mesa: não fica gravado; sai de consumo lançado − (pago − taxa de serviço − gorjeta), nas mesas fechadas desde 13/09/2026 (nas contas antigas, a taxa de serviço negativa). Fica à parte: NÃO sai do valor vendido, que é a soma dos pedidos lançados. É um piso: troco deixado na mesa esconde parte dele.", estilo: "suave" as const }] }] : []),
    { celulas: [{ v: `Aba Pedidos: ${ROTULO_DO_FILTRO_DE_STATUS[status as keyof typeof ROTULO_DO_FILTRO_DE_STATUS] || "Todas"}${busca ? `, busca “${busca}”` : ""}.`, estilo: "suave" }] },
  ];
}

/** As larguras da aba Pedidos; a coluna "Desconto sem dono" só existe quando alguma linha tem. */
function larguraDosPedidos(comSemDono: boolean): number[] {
  return [11, 7, 12, 8, 10, 28, 11, 14, 10, 36, 18, 7, 13, 12, 12, 12, 12, ...(comSemDono ? [12] : []), 13];
}

function abaPedidos(ctx: ContextoDoRelatorio, cabecalho: Cabecalho, linhas: LinhaDePedido[], status: string, busca: string, comSemDono: boolean): LinhaDaPlanilha[] {
  const s = somaDasLinhas(linhas);
  const rotuloStatus = ROTULO_DO_FILTRO_DE_STATUS[status as keyof typeof ROTULO_DO_FILTRO_DE_STATUS] || "Todas";
  const vazias = (n: number) => Array.from({ length: n }, () => "");
  // Depois do rótulo do total: 11 colunas de texto (Hora … Itens) e as de dinheiro antes do Total.
  const antesDoTotal = 11 + (comSemDono ? 6 : 5);
  return [
    ...topo("Pedidos", ctx, cabecalho, [`Status: ${rotuloStatus}${busca ? ` · Busca: “${busca}”` : ""} · ${linhas.length} pedidos · telefone só com o final (o completo fica na tela da loja)`]),
    { celulas: [] },
    {
      celulas: ["Data", "Hora", "Expediente", "Número", "Nº no app", "Cliente", "Telefone", "Canal", "Tipo", "Pagamento", "Status", "Itens",
        "Total dos itens", "Taxa de entrega", "Outras taxas", "Desconto loja", "Desconto plataforma", ...(comSemDono ? ["Desconto sem dono"] : []), "Total"],
      estilo: "cabecalho",
    },
    ...linhas.map((l): LinhaDaPlanilha => ({
      celulas: [
        l.data, l.hora, fmtDia(l.diaOperacional), l.numero, l.noApp || "", l.cliente, finalDoTelefone(l.telefone), nomeDoCanal(l.canal, false),
        l.mesa ? `${l.tipoRotulo} (${l.mesa})` : l.tipoRotulo, l.pagamento,
        // O valor gravado fica (é o que está no banco), mas a linha diz que não entra no total.
        l.valorImpossivel ? `${l.statusRotulo} — VALOR IMPOSSÍVEL, fora do total` : l.statusRotulo,
        { v: l.itens, estilo: "qtd" }, { v: l.totalItens, estilo: "reais" }, { v: l.taxaEntrega, estilo: "reais" }, { v: l.outrasTaxas, estilo: "reais" },
        { v: l.descontoLoja, estilo: "reais" }, { v: l.descontoPlataforma, estilo: "reais" }, ...(comSemDono ? [{ v: l.descontoSemDono, estilo: "reais" as const }] : []),
        { v: l.total, estilo: "reais" },
      ],
    })),
    { celulas: [] },
    // Só canceladas: o rodapé é o valor cancelado — "0 vendas, R$ 0" em cima de
    // uma lista de cancelados parece planilha quebrada.
    status === "canceladas" ? {
      celulas: [{ v: `TOTAL cancelado (${s.cancelados} pedidos, fora das vendas)`, estilo: "negrito" },
        ...vazias(antesDoTotal), { v: s.valorCancelado, estilo: "reaisNegrito" }],
    } : {
      celulas: [{ v: `TOTAL das vendas (${s.pedidos} pedidos${s.cancelados ? `; ${s.cancelados} cancelados fora da soma` : ""})`, estilo: "negrito" },
        ...vazias(11),
        { v: s.totalItens, estilo: "reaisNegrito" }, { v: s.taxaEntrega, estilo: "reaisNegrito" }, { v: s.outrasTaxas, estilo: "reaisNegrito" },
        { v: s.descontoLoja, estilo: "reaisNegrito" }, { v: s.descontoPlataforma, estilo: "reaisNegrito" }, ...(comSemDono ? [{ v: s.descontoSemDono, estilo: "reaisNegrito" as const }] : []),
        { v: s.total, estilo: "reaisNegrito" }],
    },
    ...(s.valoresImpossiveis ? [{ celulas: [{ v: `${s.valoresImpossiveis} ${s.valoresImpossiveis === 1 ? "linha marcada" : "linhas marcadas"} VALOR IMPOSSÍVEL (R$ 1 milhão ou mais) fora do total — confira o cadastro.`, estilo: "suave" as const }] }] : []),
    { celulas: [{ v: "Em cada venda: Total dos itens + Taxa de entrega + Outras taxas − Descontos = Total. Expediente = o dia de caixa (a venda da 1h da manhã é do dia anterior).", estilo: "suave" }] },
  ];
}
