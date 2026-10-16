/**
 * GET /api/store/relatorios/reposicoes — "Reposições (faltou item e troca)":
 * quantas reposições, quanto isso representa nas vendas e quanto custou
 * refazer e entregar de novo. A conta está em lib/relatorios/reposicoes.ts
 * (testada em scripts/teste-relatorio-de-reposicoes.ts).
 *
 * Filtros comuns (lib/relatorios/base.ts). formato=xlsx baixa a planilha.
 *
 * ── O que vai ao banco ──────────────────────────────────────────────────────
 *
 * 1. As reposições do período (`reposicao` preenchida, não canceladas), pela
 *    data e hora DELAS, com os itens e o produto de cada um.
 * 2. Os pedidos originais delas — para o número, a taxa da corrida das
 *    reposições antigas (sem `entregaGratis`) e os FILTROS: tipo, canal e
 *    marca são os do pedido original (a reposição nasce "presencial"; com o
 *    filtro "iFood", entra a reposição de pedido do iFood).
 * 3. As vendas do mesmo recorte (pedidosDoRelatorio), sem as reposições — a
 *    base do "% das vendas" e do "% do faturamento".
 * 4. Só das lojas com reposição: o cardápio e o estoque para o custo
 *    (prepararCustoDosItens, a régua do DRE), os motoboys marcados (acerto) e
 *    a regra de repasse da loja.
 * 5. O mesmo 1–3 do período anterior, para o "comparado com antes".
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, filtrarPedidos, janelaDoPeriodo, pedidosDoRelatorio,
  COLUNAS_DOS_FILTROS, type ContextoDoRelatorio, type PedidoBase,
} from "@/lib/relatorios/servidor";
import { STATUS_FORA_DA_VENDA, diasNoPeriodo, fmtDia, periodoAnterior, ROTULO_DO_TIPO, type TipoDeVenda } from "@/lib/relatorios/base";
import { anteriorAteEsteHorario } from "@/lib/relatorios/regua-da-venda";
import {
  montarReposicoes, relatorioDeReposicoes, vendasSemReposicoes,
  type PedidoDeReposicao, type PedidoOriginal, type ReposicaoMontada, type VendasDoPeriodo,
} from "@/lib/relatorios/reposicoes";
import { lerReposicao } from "@/lib/reposicao";
import { prepararCustoDosItens, type CustoDosItens } from "@/lib/financeiro/cmv-do-financeiro";
import { lerAcerto } from "@/lib/ganho-do-entregador";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { montarPlanilha, respostaDePlanilha, type AbaDaPlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

type Janela = { inicio: Date; fim: Date };

/** As reposições da janela, já filtradas pelos atributos do pedido original. */
async function buscarReposicoes(ctx: ContextoDoRelatorio, janela: Janela): Promise<{ reposicoes: PedidoDeReposicao[]; originais: Map<string, PedidoOriginal> }> {
  const brutas = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: { in: ctx.lojaIds },
      createdAt: { gte: janela.inicio, lt: janela.fim },
      status: { notIn: [...STATUS_FORA_DA_VENDA] },
      reposicao: { not: Prisma.DbNull },
    },
    select: {
      ...COLUNAS_DOS_FILTROS,
      dailyOrderNumber: true, customerName: true, customerAddress: true, reposicao: true,
      motoboyId: true, motoboyFee: true, deliveryFee: true, deliveryDistance: true, entregaGratis: true,
      items: {
        select: {
          menuProductId: true, productName: true, quantity: true, notes: true, comboSelections: true,
          menuProduct: { select: { name: true, price: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const validas = brutas.filter((p) => lerReposicao(p.reposicao));
  const idsDosOriginais = [...new Set(validas.map((p) => lerReposicao(p.reposicao)!.pedidoId))];
  const lidos = await emLotes(idsDosOriginais, 500, (lote) => prisma.customerOrder.findMany({
    where: { id: { in: lote }, franchiseeId: { in: ctx.lojaIds } },
    select: { ...COLUNAS_DOS_FILTROS, dailyOrderNumber: true, deliveryFee: true, entregaGratis: true },
  }));
  const originais = new Map(lidos.map((o) => [o.id, o]));

  // Os filtros (tipo, canal, marca) olham o pedido ORIGINAL; o horário, a reposição.
  const paraFiltrar = validas.map((p) => {
    const o = originais.get(lerReposicao(p.reposicao)!.pedidoId);
    return { ...(o || p), id: p.id, createdAt: p.createdAt } as PedidoBase;
  });
  const passaram = new Set(filtrarPedidos(paraFiltrar, ctx).map((p) => p.id));
  return {
    reposicoes: validas.filter((p) => passaram.has(p.id)) as unknown as PedidoDeReposicao[],
    originais: originais as unknown as Map<string, PedidoOriginal>,
  };
}

async function vendasDaJanela(ctx: ContextoDoRelatorio, janela: Janela): Promise<VendasDoPeriodo> {
  const pedidos = await pedidosDoRelatorio(ctx, {
    janela,
    select: { parentOrderId: true, reposicao: true, items: { select: { quantity: true, price: true } } },
  });
  return vendasSemReposicoes(pedidos as any);
}

/** O que a montagem precisa além dos pedidos: custo (por loja), motoboys e regra de repasse. Só das lojas com reposição. */
async function prepararMontagem(ctx: ContextoDoRelatorio, todas: PedidoDeReposicao[]) {
  const lojas = [...new Set(todas.map((p) => p.franchiseeId))];
  const idsDosMotoboys = [...new Set(todas.map((p) => p.motoboyId).filter(Boolean) as string[])];
  const [custos, motoboys, donos] = await Promise.all([
    Promise.all(lojas.map(async (id) => [id, await prepararCustoDosItens(id, ctx.tz)] as const)),
    idsDosMotoboys.length
      ? prisma.motoboy.findMany({
          where: { id: { in: idsDosMotoboys }, franchiseeId: { in: ctx.lojaIds } },
          select: { id: true, name: true, paymentType: true, dailyRate: true, perDeliveryRate: true, perKmRate: true, faixasDeKm: true },
        })
      : Promise.resolve([]),
    lojas.length
      ? prisma.user.findMany({ where: { id: { in: lojas } }, select: { id: true, deliveryConfig: true, deliveryZones: true } })
      : Promise.resolve([]),
  ]);
  const custoDe = new Map<string, CustoDosItens>(custos);
  const daLoja = new Map(donos.map((d) => [d.id, { regra: lerRegraDeRepasse(d.deliveryConfig), zonas: d.deliveryZones as unknown }]));
  return {
    tz: ctx.tz,
    custoDoItem: (lojaId: string, item: Parameters<CustoDosItens["custoDoItem"]>[0], dia: string) => {
      const c = custoDe.get(lojaId);
      return c ? c.custoDoItem(item, dia) : { nome: item.nome || "Item", valor: 0, custo: null, fonte: null, faltas: [{ motivo: "SEM_FICHA" as const, nome: item.nome || "Item" }] };
    },
    motoboys: new Map(motoboys.map((m) => [m.id, { nome: m.name, acerto: lerAcerto(m as any) }])),
    regraDaLoja: (lojaId: string) => daLoja.get(lojaId) || null,
  };
}

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const f = ctx.filtros;

  const ant = periodoAnterior(f.de, f.ate);
  const { janela: janelaAnterior, ateEsteHorario } = anteriorAteEsteHorario(janelaDoPeriodo(ant.de, ant.ate, ctx.tz), {
    ate: f.ate, hoje: ctx.hoje, recuo: diasNoPeriodo(f.de, f.ate),
  });

  const [atual, anterior, vendas, vendasAntes] = await Promise.all([
    buscarReposicoes(ctx, { inicio: ctx.inicio, fim: ctx.fim }),
    buscarReposicoes(ctx, janelaAnterior),
    vendasDaJanela(ctx, { inicio: ctx.inicio, fim: ctx.fim }),
    vendasDaJanela(ctx, janelaAnterior),
  ]);

  const base = await prepararMontagem(ctx, [...atual.reposicoes, ...anterior.reposicoes]);
  const montar = (b: { reposicoes: PedidoDeReposicao[]; originais: Map<string, PedidoOriginal> }): ReposicaoMontada[] =>
    montarReposicoes(b.reposicoes, { ...base, originais: b.originais });
  const resultado = relatorioDeReposicoes(montar(atual), vendas);
  const antes = relatorioDeReposicoes(montar(anterior), vendasAntes);
  const comparacao = {
    periodo: ant,
    ateEsteHorario,
    reposicoes: antes.resumo.reposicoes,
    custoTotal: antes.resumo.custoTotal,
    custoRefazer: antes.resumo.custoRefazer,
    custoEntrega: antes.resumo.custoEntrega,
    pctDasVendas: antes.resumo.pctDasVendas,
  };
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (sp.get("formato") !== "xlsx") {
    return NextResponse.json({ ...cabecalho, ...resultado, anterior: comparacao });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const nomeDaMarca = new Map(cabecalho.marcas.map((m) => [m.chave, m.rotulo]));
  const filtrosEmTexto = [
    f.horaDe || f.horaAte ? `Horário ${f.horaDe || "00:00"}–${f.horaAte || "24:00"}` : "",
    f.tipos.length ? `Tipo: ${f.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    f.canais.length ? `Canal: ${f.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    f.marcas.length ? `Marca: ${f.marcas.map((m) => nomeDaMarca.get(m) || m).join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  const topo = (titulo: string, extra?: string): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(f.de)} a ${fmtDia(f.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto} (tipo, canal e marca do pedido original)` : "Filtros: nenhum", estilo: "suave" }] },
    { celulas: [{ v: extra || "Reposição cancelada não entra. Custo de refazer pela ficha técnica (ou o custo do produto); item sem custo cadastrado fica fora da soma. Entrega: o que o acerto paga ao motoboy pela corrida.", estilo: "suave" }] },
    { celulas: [] },
  ];
  const cab = (...c: string[]): LinhaDaPlanilha => ({ celulas: c, estilo: "cabecalho" });
  const R = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "reaisNegrito" : "reais" });
  const RouTraco = (v: number | null): Celula => (v == null ? "sem custo cadastrado" : R(v));
  const Q = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "qtdNegrito" : "qtd" });
  const P = (v: number | null): Celula => (v == null ? "—" : { v: v / 100, estilo: "pct" });
  const N = (v: string): Celula => ({ v, estilo: "negrito" });
  const s = resultado.resumo;
  const tipoEmTexto = (t: string) => ROTULO_DO_TIPO[t as TipoDeVenda] || t;

  const resumo: LinhaDaPlanilha[] = [
    ...topo("Reposições (faltou item e troca)"),
    cab("Resumo", "Valor"),
    { celulas: [N("Reposições"), Q(s.reposicoes, true)] },
    ...resultado.porMotivo.map((m) => ({ celulas: [`  ${m.rotulo}`, Q(m.reposicoes)] })),
    { celulas: ["Pedidos que precisaram de reposição", Q(s.pedidosAfetados)] },
    { celulas: ["Vendas no período (sem as reposições)", Q(s.vendas)] },
    { celulas: ["% das vendas que precisaram de reposição", P(s.pctDasVendas)] },
    { celulas: [] },
    { celulas: [N("Custo de refazer (insumo)"), R(s.custoRefazer, true)] },
    { celulas: ["Unidades refeitas", Q(s.itens)] },
    { celulas: ["Unidades sem custo cadastrado (fora da soma)", Q(s.itensSemCusto)] },
    { celulas: ["Valor de venda do que foi dado de novo (preço do cardápio)", R(s.valorDeVenda)] },
    { celulas: [N("Custo de entrega (motoboy)"), R(s.custoEntrega, true)] },
    { celulas: ["Corridas de reposição", Q(s.entregas)] },
    { celulas: [`Das corridas, estimadas pela taxa do pedido original (antes de 15/10/2026)`, Q(s.entregasEstimadas)] },
    { celulas: [N("Custo total (refazer + entrega)"), R(s.custoTotal, true)] },
    { celulas: ["Custo médio por reposição", R(s.custoMedio)] },
    { celulas: ["Valor vendido no período", R(s.valorVendido)] },
    { celulas: ["Custo total ÷ valor vendido", P(s.pctDoFaturamento)] },
    { celulas: [`Período anterior (${fmtDia(ant.de)} a ${fmtDia(ant.ate)}${ateEsteHorario ? ", até este mesmo horário" : ""}): reposições`, Q(comparacao.reposicoes)] },
    { celulas: ["Período anterior: custo total", R(comparacao.custoTotal)] },
    { celulas: [] },
    cab("Motivo", "Reposições", "Unidades", "Custo de refazer", "Sem custo (un.)", "Entrega", "Custo total", "Valor de venda"),
    ...resultado.porMotivo.map((m) => ({ celulas: [m.rotulo, Q(m.reposicoes), Q(m.itens), R(m.custoRefazer), Q(m.itensSemCusto), R(m.custoEntrega), R(m.custoTotal), R(m.valorDeVenda)] })),
    { celulas: [N("TOTAL"), Q(s.reposicoes, true), Q(s.itens, true), R(s.custoRefazer, true), Q(s.itensSemCusto, true), R(s.custoEntrega, true), R(s.custoTotal, true), R(s.valorDeVenda, true)] },
  ];

  const produtos: LinhaDaPlanilha[] = [
    ...topo("Itens que mais dão problema", "Cada produto refeito: em quantas reposições apareceu, quantas unidades (faltou × troca) e o custo das unidades com custo cadastrado."),
    cab("Produto", "Reposições", "Unidades", "Faltou", "Troca", "Custo de refazer", "Sem custo (un.)", "Por que sem custo", "Valor de venda"),
    ...resultado.porProduto.map((p) => ({
      celulas: [p.nome, Q(p.vezes), Q(p.quantidade), Q(p.faltou), Q(p.troca), RouTraco(p.custo), Q(p.quantidadeSemCusto), p.semCustoPorque || "", R(p.valorDeVenda)],
    })),
  ];

  const lista: LinhaDaPlanilha[] = [
    ...topo("Reposições", "Uma linha por reposição, das mais recentes para as mais antigas. Entrega marcada \"estimada\": a reposição é anterior a 15/10/2026 e a taxa saiu do pedido original."),
    cab("Data", "Hora", "Reposição", "Pedido original", "Cliente", "Motivo", "Tipo", "Itens", "Custo de refazer", "Sem custo (un.)", "Entrega", "Entrega estimada?", "De onde saiu a entrega", "Custo total", "Motoboy"),
    ...resultado.lista.map((l) => ({
      celulas: [fmtDia(l.dia), l.hora, `#${l.numero}`, `#${l.original}`, l.cliente, l.rotulo, tipoEmTexto(l.tipo), l.itens,
        RouTraco(l.custoRefazer), Q(l.itensSemCusto), R(l.custoEntrega), l.entregaEstimada ? "sim" : "", l.entregaDetalhe, R(l.custoTotal), l.motoboy || ""],
    })),
    { celulas: [N("TOTAL"), "", Q(resultado.lista.length, true), "", "", "", "", "", R(s.custoRefazer, true), Q(s.itensSemCusto, true), R(s.custoEntrega, true), "", "", R(s.custoTotal, true), ""] },
  ];

  const semCusto: LinhaDaPlanilha[] = [
    ...topo("Sem custo cadastrado", "Cadastre a ficha técnica (ou o custo no produto) destes itens para o custo de refazer ficar completo."),
    cab("Item", "Unidades", "O que falta"),
    ...resultado.semCusto.map((x) => ({ celulas: [x.nome, Q(x.quantidade), x.porque] })),
  ];

  const abas: AbaDaPlanilha[] = [
    { nome: "Resumo", linhas: resumo, larguras: [62, 14, 12, 16, 14, 12, 14, 14], congelarLinhas: 5 },
    { nome: "Itens", linhas: produtos, larguras: [36, 12, 10, 9, 9, 16, 14, 44, 14], congelarLinhas: 6 },
    { nome: "Reposições", linhas: lista, larguras: [12, 7, 11, 14, 24, 20, 10, 48, 16, 14, 12, 16, 44, 13, 18], congelarLinhas: 6 },
    { nome: "Sem custo", linhas: semCusto, larguras: [40, 12, 60], congelarLinhas: 6 },
  ];
  return respostaDePlanilha(montarPlanilha(abas), `reposicoes_${f.de}_a_${f.ate}.xlsx`);
}
