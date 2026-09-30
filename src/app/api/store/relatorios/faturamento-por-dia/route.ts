/**
 * GET /api/store/relatorios/faturamento-por-dia — uma linha por dia
 * operacional, com total, média, melhor e pior dia, a comparação com o período
 * anterior e a meta do mês.
 *
 * Filtros comuns (lib/relatorios/base.ts) mais:
 *   dias=0,5,6     só estes dias da semana (0 = domingo). Vazio = todos.
 *   formato=xlsx   baixa a planilha em vez do JSON
 *
 * A conta está em lib/relatorios/faturamento-por-dia.ts (testada em
 * scripts/teste-faturamento-por-dia.ts), com a régua única de
 * lib/relatorios/regua-da-venda.ts: valor pelo pedido, a mesa é uma venda no
 * primeiro lançamento, serviço, gorjeta e desconto no fechamento à parte.
 *
 * O que se busca, e só isso: os pedidos da janela com as colunas dos filtros,
 * a taxa de entrega, o desconto e (preço × quantidade) dos itens; as mesas
 * FECHADAS na janela (lib/relatorios/mesas-do-periodo.ts); e, para o período
 * anterior, só os pedidos sem os itens — ali só o valor e as vendas são
 * comparados.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  cabecalhoDoRelatorio, contextoDoRelatorio, emLotes, janelaDoPeriodo, pedidosDoRelatorio,
  type ContextoDoRelatorio,
} from "@/lib/relatorios/servidor";
import { mesasFechadasDoPeriodo } from "@/lib/relatorios/mesas-do-periodo";
import { NOMES_DOS_DIAS, DIAS_CURTOS, ROTULO_DO_TIPO, fmtDia, fmtReais, naLoja, somarDias } from "@/lib/relatorios/base";
import { anteriorAteEsteHorario, entraNaVenda } from "@/lib/relatorios/regua-da-venda";
import {
  compararPeriodos, consumoDasMesasAbertas, faturamentoPorDia, lerDiasDaSemana, lerMetaDeFaturamento, limiteDaMeta, periodoDeComparacao, progressoDaMeta,
  type DiaDoFaturamento, type PedidoParaFaturamento, type ProgressoDaMeta, type SomaDosDias,
} from "@/lib/relatorios/faturamento-por-dia";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

type Janela = { inicio: Date; fim: Date };

const ITENS = { items: { select: { quantity: true, price: true } } } as const;

/** Pedidos da janela (com os cancelados, que têm coluna própria). */
async function pedidosDaJanela(ctx: ContextoDoRelatorio, janela: Janela, comItens: boolean): Promise<PedidoParaFaturamento[]> {
  const pedidos = await pedidosDoRelatorio(ctx, {
    janela,
    incluirForaDaVenda: comItens, // o período anterior só compara venda: nem busca cancelado
    select: { deliveryFee: true, discountTotal: true, discountMerchant: true, discountIfood: true, parentOrderId: true, ...(comItens ? ITENS : {}) },
  });
  return pedidos as unknown as PedidoParaFaturamento[];
}

/** A meta das lojas do relatório: a soma, quando TODAS têm meta. */
async function metaDasLojas(lojaIds: string[]): Promise<number | null> {
  const lojas = await prisma.user.findMany({ where: { id: { in: lojaIds } }, select: { financialGoals: true } });
  const metas = lojas.map((l) => lerMetaDeFaturamento(l.financialGoals));
  if (!metas.length || metas.some((m) => m === null)) return null;
  return metas.reduce((s: number, m) => s + (m as number), 0);
}

/**
 * O dia operacional do 1º pedido das lojas (qualquer status, qualquer canal):
 * antes dele a loja não estava no FireHub, e o dia não entra na média.
 */
async function primeiroDiaDasLojas(ctx: ContextoDoRelatorio): Promise<string | null> {
  const primeiro = await prisma.customerOrder.findFirst({
    where: { franchiseeId: { in: ctx.lojaIds } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return primeiro ? naLoja(primeiro.createdAt, ctx.tz).dia : null;
}

/**
 * Quanto do valor do período está em mesas AINDA ABERTAS. Pela régua o
 * lançado é vendido e já está no valor — mas a conta não fechou: o pagamento,
 * a taxa de serviço e a gorjeta só entram quando fechar. Antes da régua o
 * aviso dizia o contrário ("entra no dia em que a conta fechar"); agora diz
 * que já entrou, para ninguém procurar esse dinheiro duas vezes.
 *
 * A soma é a do MESMO recorte do valor, com o filtro de dias da semana
 * (`consumoDasMesasAbertas`): a janela buscada tem todos os dias, e o aviso
 * somava a quarta numa tabela de "só as sextas".
 */
async function mesasAbertasNoPeriodo(ctx: ContextoDoRelatorio, pedidos: PedidoParaFaturamento[], diasDaSemana: number[]): Promise<{ quantidade: number; consumo: number } | null> {
  const ids = [...new Set(pedidos.filter((p) => p.tableSessionId && entraNaVenda(p)).map((p) => p.tableSessionId as string))];
  if (!ids.length) return null;
  const abertas = (await emLotes(ids, 500, (lote) => prisma.tableSession.findMany({
    where: { id: { in: lote }, franchiseeId: { in: ctx.lojaIds }, status: { in: ["OPEN", "CLOSING"] } },
    select: { id: true },
  }))).map((s) => s.id);
  if (!abertas.length) return null;
  return consumoDasMesasAbertas({ de: ctx.filtros.de, ate: ctx.filtros.ate, tz: ctx.tz, diasDaSemana, pedidos, abertas });
}

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const sp = req.nextUrl.searchParams;
  const f = ctx.filtros;
  const diasDaSemana = lerDiasDaSemana(sp.get("dias"));

  // O período de comparação: os n dias antes, ou — com filtro de dia da
  // semana — semanas inteiras antes, para comparar o mesmo número de sextas.
  const ant = periodoDeComparacao(f.de, f.ate, diasDaSemana);
  const janela = { inicio: ctx.inicio, fim: ctx.fim };

  // ── O período anterior, visto como se hoje fosse `recuo` dias atrás ──
  // Quando o período chega até hoje, hoje ainda está vendendo. Comparar o
  // "Hoje" das 12h com o ontem inteiro dava "↓ 100%" todo meio-dia (medido na
  // NIK em 24/09/2026: R$ 0 contra R$ 6.475,28). Então o anterior é cortado no
  // MESMO instante, `recuo` dias antes — pela régua de regua-da-venda.ts, a
  // mesma do Vendas por período —, e o dia equivalente a hoje fica "aberto" lá
  // também: fora da média e do pior dia, como aqui.
  const hojeDoAnterior = somarDias(ctx.hoje, -ant.recuo);
  const { janela: janelaAnterior, ateEsteHorario } = anteriorAteEsteHorario(janelaDoPeriodo(ant.de, ant.ate, ctx.tz), { ate: f.ate, hoje: ctx.hoje, recuo: ant.recuo });

  // A meta compara o faturamento INTEIRO da loja com a meta do mês: com filtro
  // de tipo, canal, marca, horário ou dia da semana ligado, a comparação seria
  // "só o iFood contra a meta da loja toda" — esconder é mais honesto.
  const filtroQueCorta = Boolean(f.tipos.length || f.canais.length || f.marcas.length || f.horaDe || f.horaAte || diasDaSemana.length);

  const [pedidos, mesas, pedidosAnt, meta, primeiroDia] = await Promise.all([
    pedidosDaJanela(ctx, janela, true),
    mesasFechadasDoPeriodo(ctx, janela),
    pedidosDaJanela(ctx, janelaAnterior, false),
    metaDasLojas(ctx.lojaIds),
    primeiroDiaDasLojas(ctx),
  ]);
  const abertas = await mesasAbertasNoPeriodo(ctx, pedidos, diasDaSemana);

  const resultado = faturamentoPorDia({ de: f.de, ate: f.ate, tz: ctx.tz, hoje: ctx.hoje, primeiroDia, diasDaSemana, pedidos, mesas });
  const anterior = faturamentoPorDia({
    de: ant.de, ate: ant.ate, tz: ctx.tz, hoje: ateEsteHorario ? hojeDoAnterior : ctx.hoje, primeiroDia, diasDaSemana, pedidos: pedidosAnt,
  });
  const comparacao = compararPeriodos(resultado, anterior, ant);

  // ── A meta do mês ──
  // O acumulado é do dia 1 do mês até o fim do período (ou hoje). Se o período
  // começa depois do dia 1, busca-se o pedaço que falta — só o valor.
  let progresso: ProgressoDaMeta | null = null;
  let semMeta: "sem-meta" | "filtro" | "periodo" | null = null;
  if (meta === null) semMeta = "sem-meta";
  else if (filtroQueCorta) semMeta = "filtro";
  else if (!limiteDaMeta(f.ate, ctx.hoje)) semMeta = "periodo";
  else {
    const primeiro = `${f.ate.slice(0, 7)}-01`;
    let diasDoMes: Array<{ dia: string; valor: number }> = resultado.dias.filter((d) => d.dia >= primeiro);
    if (f.de > primeiro) {
      const janelaDoInicio = janelaDoPeriodo(primeiro, somarDias(f.de, -1), ctx.tz);
      const pIni = await pedidosDaJanela(ctx, janelaDoInicio, false);
      const inicioDoMes = faturamentoPorDia({ de: primeiro, ate: somarDias(f.de, -1), tz: ctx.tz, hoje: ctx.hoje, pedidos: pIni });
      diasDoMes = [...inicioDoMes.dias, ...diasDoMes];
    }
    progresso = progressoDaMeta({ meta, ate: f.ate, hoje: ctx.hoje, dias: diasDoMes });
  }

  const cabecalho = cabecalhoDoRelatorio(ctx);
  const corpo = {
    ...cabecalho,
    ...resultado,
    anterior: {
      de: ant.de, ate: ant.ate, total: anterior.total, media: anterior.media, melhorDia: anterior.melhorDia,
      /** O anterior foi cortado no mesmo horário de agora (o período chega até hoje). */
      ateEsteHorario,
      /** Com filtro de dia da semana: quantas semanas inteiras o anterior recua. */
      semanas: ant.semanas,
    },
    comparacao,
    meta: progresso,
    semMeta,
    mesasAbertas: abertas,
  };

  if (sp.get("formato") !== "xlsx") return NextResponse.json(corpo);

  // ── A PLANILHA ──────────────────────────────────────────────────────────
  const nomeDoCanal = new Map(canaisConhecidos().map((c) => [c.chave as string, c.nome]));
  const filtrosEmTexto = [
    f.horaDe || f.horaAte ? `Horário ${f.horaDe || "00:00"}–${f.horaAte || "24:00"}` : "",
    f.tipos.length ? `Tipo: ${f.tipos.map((t) => ROTULO_DO_TIPO[t]).join(", ")}` : "",
    f.canais.length ? `Canal: ${f.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}` : "",
    f.marcas.length ? `Marcas: ${f.marcas.map((m) => cabecalho.marcas.find((x) => x.chave === m)?.rotulo || m).join(", ")}` : "",
    diasDaSemana.length ? `Dias da semana: ${diasDaSemana.map((d) => NOMES_DOS_DIAS[d]).join(", ")}` : "",
  ].filter(Boolean).join(" · ");

  const R = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "reaisNegrito" : "reais" });
  const Q = (v: number | null | undefined, negrito = false): Celula => ({ v: v ?? null, estilo: negrito ? "qtdNegrito" : "qtd" });
  const P = (v: number | null | undefined): Celula => ({ v: v ?? null, estilo: "pct" });

  // A coluna do desconto na mesa só existe quando o período tem: é à parte,
  // informativa, e fica DEPOIS dos cancelados — longe da conta que fecha.
  const comDescontoNaMesa = resultado.total.descontoNaMesa > 0;
  const COLUNAS = [
    "Data", "Dia", "Vendas", "Lançamentos", "Valor das vendas", "Acumulado", "Ticket médio", "Total dos itens", "Taxa de entrega", "Outros", "Descontos",
    "Cancelados", "Valor cancelado", ...(comDescontoNaMesa ? ["Desconto na mesa (à parte)"] : []),
  ];
  const linhaDoDia = (d: DiaDoFaturamento): LinhaDaPlanilha => {
    const futuro = d.estado === "futuro";
    const marca = resultado.melhorDia?.dia === d.dia ? " — melhor dia" : resultado.piorDia?.dia === d.dia ? " — pior dia" : "";
    const estado = d.estado === "hoje" ? " (hoje, ainda aberto)" : d.estado === "antes" ? " (antes do 1º pedido)" : "";
    return {
      celulas: [
        fmtDia(d.dia),
        `${NOMES_DOS_DIAS[d.diaSemana]}${estado}${marca}`,
        futuro ? null : Q(d.vendas), futuro ? null : Q(d.lancamentos), futuro ? null : R(d.valor), R(d.acumulado), R(d.ticketMedio),
        futuro ? null : R(d.itens), futuro ? null : R(d.entrega), futuro ? null : R(d.outros), futuro ? null : R(d.descontos),
        futuro ? null : Q(d.canceladosQtd), futuro ? null : R(d.canceladosValor),
        ...(comDescontoNaMesa ? [futuro ? null : R(d.descontoNaMesa)] : []),
      ],
    };
  };
  const linhaDaSoma = (rotulo: string, s: SomaDosDias, qtdComFracao = false): LinhaDaPlanilha => {
    const q = (n: number) => (qtdComFracao ? Math.round(n * 10) / 10 : n);
    return {
      celulas: [
        { v: rotulo, estilo: "negrito" }, "",
        Q(q(s.vendas), true), Q(q(s.lancamentos), true), R(s.valor, true), null, R(s.ticketMedio, true),
        R(s.itens, true), R(s.entrega, true), R(s.outros, true), R(s.descontos, true),
        Q(q(s.canceladosQtd), true), R(s.canceladosValor, true),
        ...(comDescontoNaMesa ? [R(s.descontoNaMesa, true)] : []),
      ],
    };
  };
  const rotuloDaMedia = resultado.media.base === "fechados" && resultado.dias.some((d) => d.estado === "hoje")
    ? `MÉDIA POR DIA (${resultado.media.dias} dias fechados, sem hoje)`
    : `MÉDIA POR DIA (${resultado.media.dias} dia${resultado.media.dias === 1 ? "" : "s"})`;
  const destaqueEmTexto = (d: { dia: string; diaSemana: number; valor: number; vendas: number } | null) =>
    d ? `${DIAS_CURTOS[d.diaSemana]} ${fmtDia(d.dia)} — ${fmtReais(d.valor)} (${d.vendas} venda${d.vendas === 1 ? "" : "s"})` : "—";
  const mf = resultado.mesasFechadas;

  const linhas: Array<LinhaDaPlanilha | Celula[]> = [
    { celulas: [{ v: `Faturamento por dia — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(f.de)} a ${fmtDia(f.ate)} (o dia vira às 5h)`, estilo: "suave" }] },
    { celulas: [{ v: filtrosEmTexto ? `Filtros: ${filtrosEmTexto}` : "Filtros: nenhum (todas as vendas)", estilo: "suave" }] },
    { celulas: [{ v: "Itens + Taxa de entrega − Descontos + Outros = Valor das vendas. Outros = o que o app cobrou além dos itens e da entrega (a taxa de serviço do iFood). Vendas: a mesa conta uma vez, no dia do primeiro lançamento; Lançamentos: cada pedido.", estilo: "suave" }] },
    { celulas: [] },
    { celulas: COLUNAS, estilo: "cabecalho" },
    ...resultado.dias.map(linhaDoDia),
    linhaDaSoma("TOTAL", resultado.total),
    linhaDaSoma(rotuloDaMedia, resultado.media, true),
    { celulas: [] },
    {
      celulas: [{
        v: `Comparação com o período anterior (${fmtDia(ant.de)} a ${fmtDia(ant.ate)}${ant.semanas ? `, ${ant.semanas} semana${ant.semanas === 1 ? "" : "s"} antes: o mesmo número de cada dia da semana` : ""}${ateEsteHorario ? ", até este mesmo horário" : ""})`,
        estilo: "negrito",
      }],
    },
    { celulas: ["", "", "", "", "Este período", "Período anterior", "Variação"], estilo: "cabecalho" },
    // O rótulo fica na coluna A e "transborda" pelas vazias do lado; os números
    // começam na E, que é larga o bastante para R$ com milhar.
    { celulas: ["Valor das vendas", "", "", "", R(comparacao.total.atual), R(comparacao.total.anterior), P(comparacao.total.variacao)] },
    { celulas: ["Vendas", "", "", "", Q(comparacao.vendas.atual), Q(comparacao.vendas.anterior), P(comparacao.vendas.variacao)] },
    { celulas: ["Média por dia", "", "", "", R(comparacao.media.atual), R(comparacao.media.anterior), P(comparacao.media.variacao)] },
    { celulas: ["Ticket médio", "", "", "", R(comparacao.ticketMedio.atual), R(comparacao.ticketMedio.anterior), P(comparacao.ticketMedio.variacao)] },
    { celulas: ["Melhor dia", "", "", "", R(comparacao.melhorDia.atual?.valor), R(comparacao.melhorDia.anterior?.valor), P(comparacao.melhorDia.variacao)] },
    { celulas: [] },
    { celulas: ["Melhor dia", "", "", "", destaqueEmTexto(resultado.melhorDia)] },
    { celulas: ["Pior dia (entre os fechados com venda)", "", "", "", resultado.piorDia ? destaqueEmTexto(resultado.piorDia) : "— (precisa de outro dia fechado com venda, abaixo do melhor)"] },
    { celulas: ["Média nos dias com venda", "", "", "", R(resultado.mediaDiasComVenda)] },
  ];
  if (resultado.servicoDasMesas > 0) {
    linhas.push({ celulas: [`Taxa de serviço e gorjeta de ${mf.mesas} mesa${mf.mesas === 1 ? "" : "s"} fechada${mf.mesas === 1 ? "" : "s"} (do garçom, fora do valor)`, "", "", "", R(resultado.servicoDasMesas)] });
  }
  if (mf.descontoNaMesa > 0) {
    linhas.push({ celulas: [`Desconto no fechamento de ${mf.mesasComDesconto} mesa${mf.mesasComDesconto === 1 ? "" : "s"} (à parte: não sai do valor vendido; é um piso)`, "", "", "", R(mf.descontoNaMesa)] });
  }
  if (abertas) {
    linhas.push({ celulas: [`${abertas.quantidade} mesa${abertas.quantidade === 1 ? "" : "s"} ainda aberta${abertas.quantidade === 1 ? "" : "s"} (o lançado já está no valor; serviço e gorjeta entram quando fechar)`, "", "", "", R(abertas.consumo)] });
  }
  if (progresso) {
    linhas.push(
      { celulas: [] },
      { celulas: [{ v: `Meta de ${progresso.mes.slice(5, 7)}/${progresso.mes.slice(0, 4)} (até ${fmtDia(progresso.ateODia)})`, estilo: "negrito" }] },
      { celulas: ["Meta do mês", "", "", "", R(progresso.meta)] },
      { celulas: ["Acumulado", "", "", "", R(progresso.acumulado), P(progresso.pct)] },
      { celulas: ["Esperado pelos dias fechados", "", "", "", R(progresso.esperadoAteAgora)] },
      { celulas: ["Projeção no ritmo dos dias fechados", "", "", "", R(progresso.projecao)] },
      { celulas: ["Falta", "", "", "", R(progresso.faltam)] },
      { celulas: ["Por dia para bater", "", "", "", R(progresso.porDiaParaBater), progresso.diasRestantes ? `${progresso.diasRestantes} dia(s) restantes` : ""] },
    );
  }
  linhas.push(
    { celulas: [] },
    { celulas: [{ v: "Cancelados, pedido do totem esperando pagamento e rascunho do robô não são venda. O cancelado aparece na coluna própria, no dia do pedido.", estilo: "suave" }] },
    { celulas: [{ v: "Mesa: o valor é o lançado, no dia de cada lançamento (mesa aberta ou fechada); a conta é UMA venda, no dia do primeiro lançamento. Taxa de serviço, gorjeta e desconto no fechamento ficam à parte, pelo dia em que a mesa fechou. O troco não mexe no valor vendido.", estilo: "suave" }] },
  );

  const buffer = montarPlanilha([{
    nome: "Faturamento por dia",
    congelarLinhas: 6,
    larguras: [12, 34, 9, 12, 17, 15, 14, 15, 14, 11, 12, 11, 14, ...(comDescontoNaMesa ? [16] : [])],
    linhas,
  }]);
  return respostaDePlanilha(buffer, `faturamento-por-dia_${f.de}_a_${f.ate}.xlsx`);
}
