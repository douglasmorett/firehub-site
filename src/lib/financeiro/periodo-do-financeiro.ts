/**
 * O lado do SERVIDOR do DRE: busca o período (dia operacional da loja, a
 * janela dos Relatórios) e devolve os pedidos enxutos e os números que só o
 * servidor sabe — o acerto dos entregadores, as mesas fechadas e os ciclos da
 * mensalidade. A conta em si é de lib/financeiro/dre.ts (pura).
 *
 * ── O que mudou em relação à página antiga ─────────────────────────────────
 *
 * A página mandava 365 dias de pedidos com TODAS as ~90 colunas (e os itens)
 * para o navegador filtrar pelo relógio dele. Agora vai só a janela pedida,
 * só as colunas que o DRE e o Extrato usam, e o período é o da loja.
 */
import { prisma } from "@/lib/prisma";
import { janelaDoPeriodo, type ContextoDoRelatorio } from "@/lib/relatorios/servidor";
import { mesasFechadasDoPeriodo } from "@/lib/relatorios/mesas-do-periodo";
import { canalDoRelatorio, tipoDeVenda } from "@/lib/relatorios/base";
import { servicoDasMesas, temValorImpossivel } from "@/lib/relatorios/regua-da-venda";
import { cupomDaPlataforma, formaDoTexto, precisaDoDetalheDoCupom } from "@/lib/relatorios/formas-de-pagamento";
import { partesDaEntrega } from "@/lib/resumo-do-entregador";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { infoDaEntrega } from "@/lib/entrega-parceira";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { montarRelatorioDosEntregadores } from "@/lib/relatorio-do-entregador";
import {
  getCurrentCycleView, getCurrentYearMonth, inicioDaCobranca, intervaloDoMes, lojasExtrasDeMarketplace, type VisaoDoCiclo,
} from "@/lib/billing";
import {
  mesesDoPeriodo,
  type CicloNoPeriodo, type DadosDoPeriodo, type PedidoDoFinanceiro, type ResumoDosEntregadores,
} from "@/lib/financeiro/dre";

const MARKETPLACES = new Set<string>(canaisConhecidos().filter((c) => c.ehMarketplace).map((c) => c.chave));
const c2 = (n: number) => Math.round(n * 100) / 100;

/** As colunas do pedido que o DRE e o Extrato leem. Nunca `include` sem select. */
const COLUNAS = {
  id: true, createdAt: true, status: true, totalAmount: true, deliveryFee: true,
  discountTotal: true, discountIfood: true, discountMerchant: true,
  deliveryType: true, source: true, tableSessionId: true, parentOrderId: true, totemLicenseId: true,
  ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true, openDeliveryReference: true,
  dailyOrderNumber: true, motoboyId: true,
  // Forma de pagamento pela régua do caixa (partesDaEntrega / formaDoPedido).
  paymentMethod: true, paymentMethods: true, paymentPaidAt: true, gatewayProvider: true, gatewayPaymentId: true,
  pagarmeOrderId: true, pagarmeMethod: true, changeAmount: true, taxaOnline: true,
  // Quem entregou (lib/entrega-parceira.ts): a taxa da corrida do app fica com o app.
  deliveryBy: true, ifoodDriverName: true, ifoodDriverStatus: true,
  items: { select: { quantity: true, price: true, menuProduct: { select: { cost: true } } } },
} as const;

/** O número que o lojista vê no pedido — o do dia, o do iFood, o do parceiro. */
function numeroDoPedido(o: { id: string; dailyOrderNumber: number | null; ifoodReference: string | null; openDeliveryReference: string | null }): string {
  if (o.dailyOrderNumber != null) return String(o.dailyOrderNumber);
  if (o.ifoodReference) return String(o.ifoodReference);
  if (o.openDeliveryReference) return String(o.openDeliveryReference);
  return o.id.slice(-4).toUpperCase();
}

const SEM_ENTREGADORES: ResumoDosEntregadores = {
  porEntrega: 0, diarias: 0, total: 0, corridas: 0, corridasCanceladas: 0, diasDeDiaria: 0, semDistancia: 0, pelaTaxaDoCliente: 0, erro: null,
};

/**
 * O que a loja pagou aos entregadores no período, pela MESMA função do
 * Motoboys → Relatório (lib/relatorio-do-entregador.ts): ganho de cada corrida
 * (acerto do entregador, faixa, regra da loja) + diária × dias trabalhados.
 * `motoboyFee`, que o DRE antigo somava, não é gravado em quase nenhuma
 * entrega (Hakim, setembro/2026: 0 de 1.540) — por isso o custo saía ~R$ 0.
 */
async function entregadoresDoPeriodo(lojaId: string, inicio: Date, fim: Date, tz: string): Promise<ResumoDosEntregadores> {
  try {
    const rel = await montarRelatorioDosEntregadores({ lojaId, fromDate: inicio, toDate: new Date(fim.getTime() - 1), tz });
    let porEntrega = 0, diarias = 0, corridas = 0, canceladas = 0, dias = 0, semDistancia = 0, pelaTaxa = 0;
    for (const r of rel.report) {
      porEntrega += Number(r.stats.feeTotal) || 0;
      diarias += Number(r.stats.dailyTotal) || 0;
      corridas += Number(r.stats.totalDeliveries) || 0;
      canceladas += Number(r.stats.canceladasCount) || 0;
      if ((Number(r.motoboy.dailyRate) || 0) > 0) dias += Number(r.stats.uniqueDays) || 0;
      semDistancia += Number(r.motoboy.entregasSemDistancia) || 0;
      pelaTaxa += r.orders.filter((o) => o.origemDoGanho === "TAXA_DO_CLIENTE").length;
    }
    return {
      porEntrega: c2(porEntrega), diarias: c2(diarias), total: c2(porEntrega + diarias),
      corridas, corridasCanceladas: canceladas, diasDeDiaria: dias, semDistancia, pelaTaxaDoCliente: pelaTaxa, erro: null,
    };
  } catch (err: any) {
    console.error("[Financeiro] Erro ao apurar o custo dos entregadores:", err);
    return { ...SEM_ENTREGADORES, erro: String(err?.message || err) };
  }
}

/**
 * O que cada mês do período custou (ou vai custar) de FireHub, pelo CICLO de
 * cobrança — nunca por uma conta própria. A linha antiga do DRE fazia 2% do
 * período, sem mês nem teste: Divinos em teste descontava R$ 204,90; Pastel
 * 01–30/09 R$ 400 com R$ 107,46 devidos; Ragnar setembro R$ 400 com boleto de
 * R$ 500; "7 dias" levava o mínimo mensal inteiro.
 *
 *   • mês fechado: o valor do boleto (sem a multa de atraso) + o que o
 *     abatimento de pagamento online já tinha quitado;
 *   • mês corrente: a previsão da aba Mensalidade (getCurrentCycleView);
 *   • mês anterior ainda não fechado: a mensalidade recalculada do ciclo +
 *     taxas + lojas extras (a conta do fechamento).
 */
async function ciclosDoPeriodo(
  lojaId: string, de: string, ate: string, tz: string, isenta: boolean, visao?: VisaoDoCiclo | null,
): Promise<CicloNoPeriodo[]> {
  const meses = mesesDoPeriodo(de, ate).map((m) => m.mes);
  const zero = { mensalidade: 0, lojasExtras: 0, outrosServicos: 0, custo: 0 };
  if (isenta) return meses.map((mes) => ({ mes, ...zero, situacao: "isento" as const }));

  const atual = getCurrentYearMonth(0, tz);
  const [ciclos, loja] = await Promise.all([
    prisma.franchiseeBillingCycle.findMany({
      where: { franchiseeId: lojaId, yearMonth: { in: meses } },
      select: {
        yearMonth: true, status: true, amountDue: true, amountPending: true, amountOffset: true,
        metaAdsFee: true, totemFee: true, asaasPaymentId: true, paidValue: true,
      },
    }),
    prisma.user.findUnique({ where: { id: lojaId }, select: { trialEndsAt: true, ifoodConnected: true, food99Connected: true } }),
  ]);
  const doMes = new Map(ciclos.map((c) => [c.yearMonth, c]));

  const saida: CicloNoPeriodo[] = [];
  for (const mes of meses) {
    if (mes === atual) {
      const v = visao ?? await getCurrentCycleView(lojaId);
      const mensalidade = v.mensalidadePrevista ?? 0;
      const lojasExtras = v.taxas?.lojasExtras ?? 0;
      const outros = (v.taxas?.trafegoPago ?? 0) + (v.taxas?.totem ?? 0);
      const custo = c2(mensalidade + lojasExtras + outros);
      saida.push({
        mes, mensalidade, lojasExtras, outrosServicos: c2(outros), custo,
        situacao: v.isExempt ? "isento" : v.emTeste && custo === 0 ? "teste" : "previsto",
      });
      continue;
    }
    const c = doMes.get(mes);
    if (!c || mes > atual || c.status === "FORGIVEN") { saida.push({ mes, ...zero, situacao: "sem-cobranca" }); continue; }

    const outros = c2((c.metaAdsFee || 0) + (c.totemFee || 0));
    const { monthStart, monthEnd } = intervaloDoMes(mes, tz);
    const testeNoMesInteiro = inicioDaCobranca(monthStart, monthEnd, loja?.trialEndsAt) === null;
    const devido = c.amountDue || 0;

    if (c.status === "CLOSED") {
      // O boleto emitido (ainda não pago) + a parte da mensalidade que o
      // abatimento de pagamento online já tinha quitado.
      const custo = c2(c.amountPending + Math.min(c.amountOffset || 0, devido));
      const mensalidade = Math.min(devido, custo);
      saida.push({
        mes, mensalidade, lojasExtras: c2(Math.max(0, custo - mensalidade - outros)),
        outrosServicos: Math.min(outros, c2(custo - mensalidade)), custo,
        situacao: custo === 0 ? "sem-cobranca" : "fechado",
      });
      continue;
    }
    if (c.status === "PAID") {
      // PAID sem boleto: o fechamento não achou nada a cobrar (grava devido 0)
      // ou alguém deu baixa à mão — vale o devido gravado.
      //
      // PAID com boleto: o Asaas grava o valor PAGO, que leva multa e juros
      // quando o pagamento atrasou (Ragnar, setembro/2026: boleto R$ 500,00,
      // pago R$ 510,83 em 10/10). O custo do MÊS é o do boleto — mensalidade +
      // lojas extras + tráfego + totem —, com as lojas extras pela contagem de
      // hoje e nunca acima do que foi pago. A multa não é mensalidade.
      let custo = c2(devido + outros);
      if (c.asaasPaymentId) {
        const extras = testeNoMesInteiro ? 0 : (await lojasExtrasDeMarketplace(lojaId, loja)).total;
        custo = c2(Math.min(devido + extras + outros, c.paidValue ?? Number.POSITIVE_INFINITY));
      }
      const mensalidade = Math.min(devido, custo);
      saida.push({
        mes, mensalidade, lojasExtras: c2(Math.max(0, custo - mensalidade - outros)),
        outrosServicos: Math.min(outros, c2(custo - mensalidade)), custo,
        situacao: custo === 0 ? "sem-cobranca" : "pago",
      });
      continue;
    }

    // Mês que já acabou e o fechamento ainda não rodou: a conta do fechamento.
    const extras = testeNoMesInteiro ? 0 : (await lojasExtrasDeMarketplace(lojaId, loja)).total;
    const mensalidade = devido;
    saida.push({
      mes, mensalidade, lojasExtras: extras, outrosServicos: outros, custo: c2(mensalidade + extras + outros),
      situacao: "previsto",
    });
  }
  return saida;
}

export async function dadosDoPeriodoDoFinanceiro(opts: {
  lojaId: string;
  tz: string;
  hoje: string;
  de: string;
  ate: string;
  isenta: boolean;
  /** A visão do ciclo já buscada pela página (evita refazer a conta). */
  visaoDoCiclo?: VisaoDoCiclo | null;
}): Promise<DadosDoPeriodo> {
  const { lojaId, tz, hoje, de, ate, isenta } = opts;
  const { inicio, fim } = janelaDoPeriodo(de, ate, tz);

  const brutos = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: lojaId,
      createdAt: { gte: inicio, lt: fim },
      // Rascunho do robô e totem que não pagou não são venda nem cancelamento.
      status: { notIn: ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] },
    },
    select: COLUNAS,
    orderBy: { createdAt: "asc" },
  });

  // O cupom que o app bancou às vezes só está na observação ou no detalhe do
  // desconto (99Food antigo). Só esses pedidos buscam os campos pesados — a
  // mesma economia do relatório Formas de pagamento.
  const precisam = brutos.filter((o) => precisaDoDetalheDoCupom(o as any)).map((o) => o.id);
  const detalhes = new Map<string, { notes: string | null; discountDetails: unknown }>();
  for (let i = 0; i < precisam.length; i += 500) {
    const lote = await prisma.customerOrder.findMany({
      where: { id: { in: precisam.slice(i, i + 500) }, franchiseeId: lojaId },
      select: { id: true, notes: true, discountDetails: true },
    });
    for (const d of lote) detalhes.set(d.id, { notes: d.notes, discountDetails: d.discountDetails });
  }

  const pedidos: PedidoDoFinanceiro[] = brutos.map((o) => {
    let cItens = 0, cComCusto = 0, cCusto = 0;
    for (const i of o.items) {
      const q = Number(i.quantity) || 0;
      if (q <= 0) continue;
      const v = Math.round((Number(i.price) || 0) * q * 100);
      cItens += v;
      const custo = Number(i.menuProduct?.cost) || 0;
      if (custo > 0) { cComCusto += v; cCusto += Math.round(custo * q * 100); }
    }
    const canal = canalDoRelatorio(o as any);
    const tipo = tipoDeVenda(o as any);
    const marketplace = MARKETPLACES.has(canal);
    const pago = Boolean(o.paymentPaidAt);
    const extra = detalhes.get(o.id);
    return {
      id: o.id,
      numero: numeroDoPedido(o),
      criadoEm: o.createdAt.toISOString(),
      status: o.status,
      totalAmount: Number(o.totalAmount) || 0,
      deliveryFee: Number(o.deliveryFee) || 0,
      tipo,
      canal,
      marketplace,
      entregaDoApp: tipo === "DELIVERY" && infoDaEntrega(o).parceira,
      temEntregador: Boolean(o.motoboyId),
      tableSessionId: o.tableSessionId,
      parentOrderId: o.parentOrderId,
      itens: cItens / 100,
      itensComCusto: cComCusto / 100,
      custo: cCusto / 100,
      impossivel: temValorImpossivel(o),
      pagamentos: o.tableSessionId ? [] : partesDaEntrega(o).map((p) => ({ forma: p.caixa, valor: p.valor })),
      taxaOnline: pago ? Number((o.taxaOnline as any)?.valor) || 0 : 0,
      cupomDoApp: marketplace ? cupomDaPlataforma({ ...o, notes: extra?.notes ?? null, discountDetails: extra?.discountDetails ?? null } as any) : 0,
      paymentMethod: o.paymentMethod || "",
      pagarmeMethod: o.pagarmeMethod,
      paymentPaidAt: o.paymentPaidAt ? o.paymentPaidAt.toISOString() : null,
    };
  });

  // As mesas FECHADAS no período (pelo fechamento) — desconto no fechamento,
  // serviço e as baixas. Mesma busca dos Relatórios, sem filtro nenhum.
  const ctxDasMesas: ContextoDoRelatorio = {
    usuarioId: lojaId, papel: "FRANCHISEE", donoId: lojaId,
    lojasDaConta: [{ id: lojaId, nome: "" }], lojaAtiva: lojaId, tz, hoje, lojasDeOrigem: [],
    filtros: { de, ate, horaDe: "", horaAte: "", tipos: [], canais: [], marcas: [], lojas: [], categorias: [], produtos: [] },
    lojaIds: [lojaId], inicio, fim,
  };
  let erroDasMesas: string | null = null;
  const [mesasFechadas, entregadores, ciclos] = await Promise.all([
    mesasFechadasDoPeriodo(ctxDasMesas, { inicio, fim }, { comPagamentos: true }).catch((err) => {
      // Sem as mesas, o desconto no fechamento e as baixas ficam de fora: o
      // DRE avisa (pendência) em vez de mostrar zero como se fosse verdade.
      console.error("[Financeiro] Erro ao buscar as mesas fechadas:", err);
      erroDasMesas = String(err?.message || err);
      return [];
    }),
    entregadoresDoPeriodo(lojaId, inicio, fim, tz),
    ciclosDoPeriodo(lojaId, de, ate, tz, isenta, opts.visaoDoCiclo),
  ]);
  const servico = servicoDasMesas(mesasFechadas);

  // As baixas das mesas, sem o TROCO: a baixa grava a nota que o cliente
  // entregou (R$ 50 numa conta de R$ 13,90). O que passou de consumo + serviço
  // + gorjeta sai do dinheiro daquela conta — a regra do relatório Formas de
  // pagamento (lib/relatorios/formas-de-pagamento.ts, "O TROCO").
  const pagamentosDasMesas = mesasFechadas.flatMap((m) => {
    const partes = lerPagamentos(m.pagamentos).map((p) => ({ forma: formaDoTexto(p.method), centavos: Math.round(p.amount * 100) }));
    const consumo = (m.pedidos || [])
      .filter((o) => !["CANCELADO", "CANCELLED", "CANCELED", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"].includes(String(o.status || "").toUpperCase()))
      .reduce((s, o) => s + Math.round((Number(o.totalAmount) || 0) * 100), 0);
    const devido = consumo + Math.round(Math.max(0, Number(m.serviceFee) || 0) * 100) + Math.round(Math.max(0, Number(m.waiterTip) || 0) * 100);
    let troco = Math.max(0, partes.reduce((s, p) => s + p.centavos, 0) - devido);
    for (const p of [...partes].filter((x) => x.forma === "DINHEIRO").sort((a, b) => b.centavos - a.centavos)) {
      if (troco <= 0) break;
      const tira = Math.min(troco, p.centavos);
      p.centavos -= tira;
      troco -= tira;
    }
    return partes.filter((p) => p.centavos > 0).map((p) => ({ forma: p.forma, valor: p.centavos / 100 }));
  });

  return {
    de, ate, hoje, tz,
    pedidos,
    entregadores,
    mesas: {
      fechadas: servico.mesas,
      descontoNoFechamento: servico.descontoNaMesa,
      mesasComDesconto: servico.mesasComDesconto,
      taxaDeServico: servico.taxa,
      gorjeta: servico.gorjeta,
      pagamentos: pagamentosDasMesas,
      erro: erroDasMesas,
    },
    ciclos,
    isenta,
  };
}
