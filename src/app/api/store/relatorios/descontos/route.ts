/**
 * GET /api/store/relatorios/descontos — "Cupons e descontos": quanto de
 * desconto foi dado, quem pagou (loja, plataforma ou não identificado) e de
 * onde veio (cupom, campanha da plataforma, balcão, conta da mesa).
 *
 * Filtros comuns (lib/relatorios/base.ts) mais, só para a LISTA de pedidos
 * (não mexem nos totais):
 *   pagina=N            a página da lista (50 por página)
 *   origem=<chave>      só os pedidos desta origem (um cupom, uma campanha)
 *   quem=LOJA|PLATAFORMA|NAO_IDENTIFICADO
 *   ordem=maior         maior desconto primeiro (padrão: mais recentes)
 *   formato=xlsx        baixa a planilha (a lista inteira, sem paginar)
 *
 * A conta está em lib/relatorios/descontos.ts (testada em
 * scripts/teste-descontos.ts), inclusive a decisão sobre a MESA: o desconto
 * dado na conta não é gravado como desconto e sai da sessão (a taxa de serviço
 * negativa, ou consumo − pago sem taxa e gorjeta). Segue a régua única
 * (lib/relatorios/regua-da-venda.ts): entra no dia e na hora em que a mesa
 * FECHOU, e a base do percentual é o valor vendido — os dois iguais aos do
 * Vendas por período no mesmo filtro (scripts/conferir-relatorios-batem.mjs).
 *
 * ── O que vai ao banco ──────────────────────────────────────────────────────
 *
 * 1. Os pedidos do período com as colunas numéricas do desconto (todos: são a
 *    base do percentual).
 * 2. Só dos pedidos COM desconto: a observação (código do cupom, motivo do
 *    balcão) e o `discountDetails` (campanhas). O `discountDetails` do 99Food
 *    guarda o `precoCru` inteiro, em TODO pedido do 99, com ou sem desconto —
 *    trazer isso para os pedidos sem desconto seria peso à toa.
 * 3. As mesas FECHADAS no período (`mesasFechadasDoPeriodo`, com os filtros
 *    aplicados no fechamento), com todos os pedidos de cada uma; e o número da
 *    mesa só das que tiveram desconto (é só para o rótulo da lista).
 * 4. O cadastro de cupons das lojas.
 * 5. O mesmo 1–3 do período anterior, para o "comparado com antes" — cortado
 *    no mesmo horário de agora quando o período chega até hoje, como no Vendas
 *    por período (regua-da-venda.ts, `anteriorAteEsteHorario`).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, janelaDoPeriodo, pedidosDoRelatorio,
  type ContextoDoRelatorio,
} from "@/lib/relatorios/servidor";
import {
  ROTULO_DA_FATIA, cuponsDoCadastro, descontosDoPeriodo, paginar,
  type ContaDeMesa, type ConfigDosDescontos, type CupomCadastrado, type PedidoParaDescontos, type QuemBancou,
} from "@/lib/relatorios/descontos";
import { mesasFechadasDoPeriodo } from "@/lib/relatorios/mesas-do-periodo";
import { anteriorAteEsteHorario, descontoNoFechamento } from "@/lib/relatorios/regua-da-venda";
import { c2, diasNoPeriodo, fmtDia, periodoAnterior, ROTULO_DO_TIPO } from "@/lib/relatorios/base";
import { cuponsComCampanha } from "@/lib/campanha-converter";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { montarPlanilha, respostaDePlanilha, type AbaDaPlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

const QUEM_VALIDO: QuemBancou[] = ["LOJA", "PLATAFORMA", "NAO_IDENTIFICADO"];

/** Os pedidos e as mesas de uma janela, prontos para a conta. */
async function buscar(ctx: ContextoDoRelatorio, janela: { inicio: Date; fim: Date }): Promise<{ pedidos: PedidoParaDescontos[]; mesas: ContaDeMesa[] }> {
  const pedidos = await pedidosDoRelatorio(ctx, {
    janela,
    select: {
      dailyOrderNumber: true, openDeliveryReference: true,
      discountTotal: true, discountMerchant: true, discountIfood: true,
      cashbackEarned: true, cashbackUsed: true, entregaGratis: true,
    },
  });

  const comDesconto = pedidos
    .filter((p) => (p.discountTotal || 0) > 0 || (p.discountMerchant || 0) > 0 || (p.discountIfood || 0) > 0)
    .map((p) => p.id);
  const detalhes = await emLotes(comDesconto, 500, (lote) => prisma.customerOrder.findMany({
    where: { id: { in: lote } },
    select: { id: true, notes: true, discountDetails: true, trilhaPremio: true },
  }));
  const porId = new Map(detalhes.map((d) => [d.id, d]));
  const completos = pedidos.map((p) => ({ ...p, ...(porId.get(p.id) || {}) })) as PedidoParaDescontos[];

  // ── As mesas ──
  // A régua única (regua-da-venda.ts, regra 4): o desconto dado no fechamento
  // entra pelas mesas FECHADAS no período, com os filtros aplicados no
  // fechamento — a MESMA busca do Vendas por período e do Faturamento por dia.
  // Até 24/09/2026 a conta vinha pelos pedidos de mesa do período (fechada em
  // qualquer data) e o desconto ia para o dia dos lançamentos: o desconto da
  // Mesa 55 da Pastel da Paulista (lançada em 11/09/2026, fechada em 13/09)
  // saía no dia 11 aqui e no 13 nos outros relatórios.
  const fechadas = await mesasFechadasDoPeriodo(ctx, janela);
  // O número da mesa é só para o rótulo da linha ("Mesa 7"): busca-se o das
  // que têm desconto, não o das ~300 mesas da semana da Pastel.
  const comDescontoNaMesa = fechadas.filter((m) => descontoNoFechamento(m) > 0).map((m) => m.id);
  const rotulos = comDescontoNaMesa.length
    ? await emLotes(comDescontoNaMesa, 500, (lote) => prisma.tableSession.findMany({
        where: { id: { in: lote }, franchiseeId: { in: ctx.lojaIds } },
        select: { id: true, table: { select: { number: true, label: true } } },
      }))
    : [];
  const mesaDe = new Map(rotulos.map((s) => [s.id, s.table]));
  const mesas: ContaDeMesa[] = fechadas.map((m) => ({
    id: m.id, franchiseeId: m.franchiseeId, fechadaEm: m.fechadaEm,
    mesa: mesaDe.get(m.id)?.number ?? null, nome: mesaDe.get(m.id)?.label || null,
    pago: m.pago ?? null, taxaServico: m.serviceFee ?? null, gorjeta: m.waiterTip ?? null, pedidos: m.pedidos,
  }));
  return { pedidos: completos, mesas };
}

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const f = ctx.filtros;

  const quem = String(sp.get("quem") || "").toUpperCase() as QuemBancou;
  const lista: ConfigDosDescontos["lista"] = {
    origem: sp.get("origem") || "",
    quem: QUEM_VALIDO.includes(quem) ? quem : "",
    ordem: sp.get("ordem") === "maior" ? "maior" : "recentes",
  };
  const ant = periodoAnterior(f.de, f.ate);
  // O anterior cortado no mesmo horário de agora quando o período chega até
  // hoje — a régua do Vendas por período (regua-da-venda.ts,
  // anteriorAteEsteHorario). Sem o corte, o total de desconto do "Hoje" ao
  // meio-dia comparava com o ontem inteiro, e a variação daqui saía diferente
  // da do cartão de descontos de lá no mesmo filtro.
  const { janela: janelaAnterior, ateEsteHorario } = anteriorAteEsteHorario(janelaDoPeriodo(ant.de, ant.ate, ctx.tz), {
    ate: f.ate, hoje: ctx.hoje, recuo: diasNoPeriodo(f.de, f.ate),
  });

  // Só a lista (a tela troca de página, de filtro "quem bancou" ou de ordem):
  // sem o período anterior e sem o cadastro de cupons, que não mudam com isso.
  if (sp.get("parte") === "lista" && sp.get("formato") !== "xlsx") {
    const atual = await buscar(ctx, { inicio: ctx.inicio, fim: ctx.fim });
    const soLista = descontosDoPeriodo(atual.pedidos, atual.mesas, { tz: ctx.tz, de: f.de, ate: f.ate, hoje: ctx.hoje, cupons: [], mostrarCuponsSemUso: false, lista });
    return NextResponse.json({
      periodo: { de: f.de, ate: f.ate, horaDe: f.horaDe, horaAte: f.horaAte },
      lista: paginar(soLista.lista, Number(sp.get("pagina")) || 1, 50),
    });
  }

  const [atual, anterior, lojas] = await Promise.all([
    buscar(ctx, { inicio: ctx.inicio, fim: ctx.fim }),
    buscar(ctx, janelaAnterior),
    prisma.user.findMany({ where: { id: { in: ctx.lojaIds } }, select: { id: true, storeCoupons: true, storeLoyalty: true } }),
  ]);

  // O cadastro é o que o checkout aceita: os cupons da loja MAIS o da campanha
  // da comanda (lib/campanha-converter.ts) — o PRIMEIROPEDIDO de muita loja
  // vem de lá, não da tela de cupons.
  const cupons: CupomCadastrado[] = lojas.flatMap((l) => cuponsDoCadastro(l.id, cuponsComCampanha(l.storeCoupons, l.storeLoyalty)));
  // Cupom cadastrado e não usado só faz sentido na lista quando o filtro deixa
  // entrar pedido do site: com "só iFood" marcado, seria ruído.
  const siteNoFiltro = (f.canais.length === 0 || f.canais.includes("SITE"))
    && (f.tipos.length === 0 || f.tipos.includes("DELIVERY") || f.tipos.includes("RETIRADA"))
    && f.marcas.length === 0;

  const cfg: ConfigDosDescontos = { tz: ctx.tz, de: f.de, ate: f.ate, hoje: ctx.hoje, cupons, mostrarCuponsSemUso: siteNoFiltro, lista };
  const resultado = descontosDoPeriodo(atual.pedidos, atual.mesas, cfg);
  const antes = descontosDoPeriodo(anterior.pedidos, anterior.mesas, { ...cfg, de: ant.de, ate: ant.ate, mostrarCuponsSemUso: false, lista: {} });
  const comparacao = {
    periodo: ant,
    /** O anterior foi cortado no mesmo horário de agora (o período chega até hoje). */
    ateEsteHorario,
    desconto: antes.resumo.desconto,
    loja: antes.resumo.loja,
    plataforma: antes.resumo.plataforma,
    pctSobreVendas: antes.resumo.pctSobreVendas,
    pedidosComDesconto: antes.resumo.pedidosComDesconto,
    descontoMedio: antes.resumo.descontoMedio,
  };
  const cabecalho = cabecalhoDoRelatorio(ctx);

  if (sp.get("formato") !== "xlsx") {
    const { lista: linhas, ...resto } = resultado;
    return NextResponse.json({ ...cabecalho, ...resto, anterior: comparacao, lista: paginar(linhas, Number(sp.get("pagina")) || 1, 50) });
  }

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const nomeDaMarca = new Map(cabecalho.marcas.map((m) => [m.chave, m.rotulo]));
  const nomeDaOrigem = new Map(resultado.origens.map((o) => [o.chave, `${o.nome} (${o.canalNome})`]));
  const filtrosEmTexto = [
    f.horaDe || f.horaAte ? `Horário ${f.horaDe || "00:00"}–${f.horaAte || "24:00"}` : "",
    f.tipos.length ? `Tipo: ${f.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    f.canais.length ? `Canal: ${f.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    f.marcas.length ? `Marca: ${f.marcas.map((m) => nomeDaMarca.get(m) || m).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const filtroDaLista = [
    lista.origem ? `origem ${nomeDaOrigem.get(lista.origem) || lista.origem}` : "",
    lista.quem ? `quem bancou: ${lista.quem === "LOJA" ? "loja" : lista.quem === "PLATAFORMA" ? "plataforma" : "não identificado"}` : "",
  ].filter(Boolean).join(" · ");

  const topo = (titulo: string, extra?: string): LinhaDaPlanilha[] => [
    { celulas: [{ v: `${titulo} — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(f.de)} a ${fmtDia(f.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    { celulas: [{ v: extra || "Pedidos cancelados não entram. Mesa: o desconto dado ao fechar a conta, no dia e na hora em que ela fechou (não sai do valor vendido). % sobre o valor vendido, o mesmo do relatório Vendas por período — que já vem sem o desconto, inclusive o que a plataforma pagou; por isso sai maior que \"desconto ÷ preço cheio\".", estilo: "suave" }] },
    { celulas: [] },
  ];
  const cab = (...c: string[]): LinhaDaPlanilha => ({ celulas: c, estilo: "cabecalho" });
  const R = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "reaisNegrito" : "reais" });
  const Q = (v: number, negrito = false): Celula => ({ v, estilo: negrito ? "qtdNegrito" : "qtd" });
  const P = (v: number, negrito = false): Celula => ({ v: v / 100, estilo: negrito ? "pctNegrito" : "pct" });
  // Percentual sobre uma base que pode ser zero (o recorte em que só uma mesa
  // FECHOU, sem lançamento): "—", como na tela, e não um 0% ao lado de desconto.
  const PouTraco = (v: number, base: number, negrito = false): Celula => (base > 0 ? P(v, negrito) : "—");
  const N = (v: string): Celula => ({ v, estilo: "negrito" });
  const s = resultado.resumo;

  const resumo: LinhaDaPlanilha[] = [
    ...topo("Cupons e descontos"),
    cab("Resumo", "Valor", "", ""),
    { celulas: [N("Total de desconto"), R(s.desconto, true)] },
    { celulas: ["Do bolso da loja", R(s.loja)] },
    { celulas: ["Pago pelas plataformas", R(s.plataforma)] },
    { celulas: ["Não identificado", R(s.naoIdentificado)] },
    { celulas: ["% sobre o valor vendido", PouTraco(s.pctSobreVendas, s.vendas)] },
    { celulas: ["% da loja sobre o valor vendido", PouTraco(s.pctLojaSobreVendas, s.vendas)] },
    { celulas: [`Pedidos com desconto${s.mesasComDesconto ? ` (com ${s.mesasComDesconto} ${s.mesasComDesconto === 1 ? "conta" : "contas"} de mesa)` : ""}`, Q(s.pedidosComDesconto)] },
    { celulas: ["Pedidos no período (lançamentos)", Q(s.pedidos)] },
    // Só pedidos ÷ pedidos: a conta de mesa não é lançamento (lib/relatorios/descontos.ts, "A MESA").
    { celulas: [s.mesasComDesconto ? "% dos pedidos com desconto (sem as contas de mesa)" : "% dos pedidos com desconto", PouTraco(s.pctDosPedidos, s.pedidos)] },
    { celulas: [s.mesasComDesconto ? "Desconto médio por pedido ou conta de mesa com desconto" : "Desconto médio por pedido com desconto", R(s.descontoMedio)] },
    { celulas: ["Valor vendido (o mesmo do Vendas por período; já sem o desconto, inclusive o pago pela plataforma)", R(s.vendas)] },
    { celulas: [`Período anterior (${fmtDia(ant.de)} a ${fmtDia(ant.ate)}${ateEsteHorario ? ", até este mesmo horário" : ""}): total de desconto`, R(comparacao.desconto)] },
    { celulas: ["Período anterior: do bolso da loja", R(comparacao.loja)] },
    { celulas: [] },
    cab("Quem bancou", "Valor", "% do desconto", "Pedidos"),
    ...resultado.quemBancou.map((q) => ({ celulas: [q.rotulo, R(q.valor), P(q.pct), Q(q.pedidos)] })),
    { celulas: [] },
    cab("Onde o desconto caiu", "Valor", "% do desconto", ""),
    ...resultado.porAlvo.map((a) => ({ celulas: [a.rotulo, R(a.valor), P(a.pct)] })),
    { celulas: [] },
    cab("À parte (fora do total de desconto)", "Valor", "Pedidos", ""),
    { celulas: ["Cashback usado pelos clientes", R(resultado.cashback.usado), Q(resultado.cashback.pedidosQueUsaram)] },
    { celulas: ["Cashback gerado para os clientes", R(resultado.cashback.gerado), Q(resultado.cashback.pedidosQueGeraram)] },
    { celulas: ["Entrega grátis por regra da loja (valor mínimo, área)", R(resultado.entregaGratisForaDoDesconto.valor), Q(resultado.entregaGratisForaDoDesconto.pedidos)] },
  ];

  const porCanal: LinhaDaPlanilha[] = [
    ...topo("Descontos por canal"),
    cab("Canal", "Pedidos", "Com desconto", "Valor vendido", "Desconto", "% sobre o valor vendido", "Loja", "Plataforma", "Não identificado"),
    ...resultado.porCanal.map((c) => ({ celulas: [c.canalNome, Q(c.pedidos), Q(c.pedidosComDesconto), R(c.vendas), R(c.desconto), PouTraco(c.pctSobreVendas, c.vendas), R(c.loja), R(c.plataforma), R(c.naoIdentificado)] })),
    { celulas: [N("TOTAL"), Q(s.pedidos, true), Q(s.pedidosComDesconto, true), R(s.vendas, true), R(s.desconto, true), PouTraco(s.pctSobreVendas, s.vendas, true), R(s.loja, true), R(s.plataforma, true), R(s.naoIdentificado, true)] },
    { celulas: [] },
    cab("Dia", "Pedidos com desconto", "Desconto", "Loja", "Plataforma", "Não identificado"),
    ...resultado.porDia.map((d) => ({ celulas: [fmtDia(d.dia), Q(d.pedidos), R(d.desconto), R(d.loja), R(d.plataforma), R(d.naoIdentificado)] })),
  ];

  const cuponsAba: LinhaDaPlanilha[] = [
    ...topo("Cupons", "Cupom do site (cadastro da loja), da Wabiz, da Brendi e da Jotajá — \"(sem código)\" quando o app não mandou o código. Faturamento = o que os clientes pagaram nos pedidos com o cupom."),
    cab("Código", "Onde", "Usos", "Desconto", "Faturamento", "Ticket médio", "Desconto médio", "% do desconto", "Benefício", "Situação", "Regras"),
    ...resultado.cupons.map((c) => ({
      celulas: [
        N(c.codigo), c.canalNome, Q(c.usos), R(c.desconto), R(c.faturamento), R(c.ticketMedio), R(c.descontoMedio), P(c.pctDoDesconto),
        c.cadastro?.beneficio || (c.canal !== "SITE" ? `cadastrado na ${c.canalNome}` : ""), c.cadastro?.situacao || "", (c.cadastro?.regras || []).join("; "),
      ],
    })),
  ];

  const origensAba: LinhaDaPlanilha[] = [
    ...topo("Campanhas, cupons e motivos", "Cada desconto do pedido separado pela origem: campanha da plataforma, cupom, desconto manual (com o motivo), conta da mesa."),
    cab("Tipo", "Canal", "Nome", "Onde caiu", "Pedidos", "Valor", "Loja", "Plataforma", "Não identificado", "% do desconto"),
    ...resultado.origens.map((o) => ({
      celulas: [ROTULO_DA_FATIA[o.tipo], o.canalNome, o.nome, o.alvo, Q(o.usos), R(o.valor), R(o.loja), R(o.plataforma), R(o.naoIdentificado), P(o.pctDoDesconto)],
    })),
  ];

  const soma = (k: "desconto" | "loja" | "plataforma" | "naoIdentificado" | "total") => c2(resultado.lista.reduce((t, l) => t + l[k], 0));
  const pedidosAba: LinhaDaPlanilha[] = [
    ...topo("Pedidos com desconto", filtroDaLista ? `Lista filtrada: ${filtroDaLista}` : undefined),
    cab("Data", "Hora", "Número", "Referência", "Canal", "Tipo", "Cupom / campanha / motivo", "Quem bancou", "Desconto", "Loja", "Plataforma", "Não identificado", "Total pago"),
    ...resultado.lista.map((l) => ({
      celulas: [fmtDia(l.dia), l.hora, l.numero, l.referencia || "", l.canalNome, l.tipo, l.origem, l.quem, R(l.desconto), R(l.loja), R(l.plataforma), R(l.naoIdentificado), R(l.total)],
    })),
    {
      celulas: [N("TOTAL"), "", Q(resultado.lista.length, true), "", "", "", "", "",
        R(soma("desconto"), true), R(soma("loja"), true), R(soma("plataforma"), true), R(soma("naoIdentificado"), true), R(soma("total"), true)],
    },
  ];

  const abas: AbaDaPlanilha[] = [
    { nome: "Resumo", linhas: resumo, larguras: [52, 16, 14, 10], congelarLinhas: 5 },
    { nome: "Por canal e dia", linhas: porCanal, larguras: [18, 12, 14, 20, 14, 16, 14, 14, 16], congelarLinhas: 6 },
    { nome: "Cupons", linhas: cuponsAba, larguras: [20, 10, 8, 14, 14, 14, 15, 13, 22, 22, 40], congelarLinhas: 6 },
    { nome: "Campanhas e motivos", linhas: origensAba, larguras: [24, 12, 40, 16, 10, 14, 14, 14, 16, 13], congelarLinhas: 6 },
    { nome: "Pedidos", linhas: pedidosAba, larguras: [12, 7, 10, 18, 11, 10, 52, 22, 12, 12, 12, 15, 13], congelarLinhas: 6 },
  ];
  return respostaDePlanilha(montarPlanilha(abas), `cupons-e-descontos_${f.de}_a_${f.ate}.xlsx`);
}
