/**
 * /src/lib/relatorio-do-entregador.ts
 *
 * O relatório do entregador — UMA conta, para as duas telas que o mostram:
 * Motoboys → Relatório (o lojista, /api/motoboy-report) e o app do próprio
 * motoboy (/api/motoboys/relatorio). Antes cada lado contava do seu jeito e
 * não batia: a Frangoso via 9 entregas e o motoboy 10, pela entrega da 1h
 * (Lucas, 02/10/2026). Com o mesmo período (data E hora, de/até) e a mesma
 * função, os dois números são o mesmo número.
 *
 * ── O período ───────────────────────────────────────────────────────────────
 * `de`/`ate` aceitam HORA ("2026-09-01T18:00"): é o que fecha o turno de quem
 * entrou às 18h do dia 1 e saiu às 2h do dia 2. Sem hora, o DIA é o
 * expediente, das 5h às 5h do dia seguinte (lib/fuso.ts).
 *
 * ── Cancelado conta se o motoboy saiu com ele ───────────────────────────────
 * "Se ele puxou o pedido, vai ficar na conta" (o Douglas, 02/10/2026). Até
 * 11/10/2026 isso valia para TODO cancelado com motoboy atribuído, inclusive o
 * que nem saiu da loja — e o fechamento de caixa não contava nenhum: o mesmo
 * entregador, no mesmo turno, com dois números (77 cancelados com motoboy em
 * 60 dias; 57 tinham saído). Agora a regra é uma, nas duas telas
 * (lib/resumo-do-entregador.ts, `canceladoComCorrida`): cancelado DEPOIS de
 * sair (`dispatchedAt`) é corrida — entrega, dia e ganho —, marcado na lista;
 * cancelado antes de sair não é corrida e aparece à parte. Dinheiro a prestar
 * contas, nunca: ninguém pagou o pedido cancelado.
 *
 * ── Entrega do app não é do motoboy da loja ─────────────────────────────────
 * O pedido que o entregador do iFood/99 levou (`ehEntregaDaLoja`, a mesma
 * régua do fechamento de caixa) sai do acerto, mesmo com o motoboy marcado.
 *
 * ── Os ajustes à mão ────────────────────────────────────────────────────────
 * A diária de um dia mudada pela loja e as pendências ("faltou R$ 50,00")
 * entram AQUI, para chegar iguais à tela Motoboys, ao app do entregador e ao
 * relatório Acerto de entregadores (lib/ajustes-do-acerto-regras.ts).
 */
import { canalDoPedido, chaveDoCanal } from "@/lib/canal-do-pedido";
import { foiEntregueDepoisDeCancelado, podeMarcarEntregueDepoisDeCancelado } from "@/lib/entregue-depois-de-cancelado";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { ganhoDoPedido as calcularGanho, lerAcerto, type OrigemDoGanho } from "@/lib/ganho-do-entregador";
import { prisma } from "@/lib/prisma";
import { getStartOfDayUTC, getEndOfDayUTC, getStartOfMonthUTC, getInstantUTC } from "@/lib/timezone";
import { resumoDasEntregas, ehCancelado, partesDaEntrega, canceladoComCorrida, contaComoCorrida, ehEntregaDaLoja, composicaoDoGanho, diaDoExpediente, dinheiroDaParte, trocoLevadoDaParte } from "@/lib/resumo-do-entregador";
import { SELECT_TROCO_NO_PIX, trocoNoPixDoPedido } from "@/lib/troco-no-pix";
import { HORA_DE_VIRADA_DO_EXPEDIENTE } from "@/lib/fuso";
import { configDaLoja, descontoDoAcerto, lanchesDoPeriodo, type LancheDoHistorico } from "@/lib/lanche-da-equipe";
import { fiadoDosMotoboys } from "@/lib/fiado-do-motoboy";
import { ajustesDoPeriodo, type AjustesDoPeriodo } from "@/lib/ajustes-do-acerto";
import { acertosDoPeriodo, type AcertoPago } from "@/lib/acerto-pago";
import { diariasDoPeriodo, somaDasDiarias, totalDasPendencias, totaisDoAcertoDoMotoboy } from "@/lib/ajustes-do-acerto-regras";

const VIRADA_MS = HORA_DE_VIRADA_DO_EXPEDIENTE * 60 * 60 * 1000;

/** O período pedido, no fuso da loja. Sem `de`: começo do mês; sem `ate`: agora. */
export function periodoDoRelatorio(de: string | null | undefined, ate: string | null | undefined, tz: string) {
  const fromDate = de
    ? getInstantUTC(de, tz) ?? new Date(getStartOfDayUTC(de, tz).getTime() + VIRADA_MS)
    : new Date(getStartOfMonthUTC(new Date(), tz).getTime() + VIRADA_MS);
  const toDate = ate
    ? getInstantUTC(ate, tz) ?? new Date(getEndOfDayUTC(ate, tz).getTime() + VIRADA_MS)
    : new Date();
  return { fromDate, toDate };
}

export async function montarRelatorioDosEntregadores(opts: {
  lojaId: string;
  motoboyId?: string | null;
  fromDate: Date;
  toDate: Date;
  tz: string;
}) {
  const { lojaId, motoboyId, fromDate, toDate, tz } = opts;
  // Buscar motoboys do franqueado
  const motoboyFilter = motoboyId ? { id: motoboyId } : {};
  // ── O REPASSE POR FAIXA DE DISTÂNCIA ─────────────────────────────────────
  //
  // A loja pode pagar ao entregador um valor diferente do que cobra do
  // cliente (tela de Entrega, coluna "Motoboy"). Quando ela separa os dois, é
  // esse valor que vale no acerto — e ele é por FAIXA, então depende da
  // distância daquela entrega.
  const donoDaLoja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { deliveryZones: true, deliveryZoneType: true, deliveryConfig: true, city: true },
  }).catch(() => null);
  const regraDeRepasse = lerRegraDeRepasse(donoDaLoja?.deliveryConfig);

  const motoboys = await prisma.motoboy.findMany({
    where: { franchiseeId: lojaId, ...motoboyFilter },
    orderBy: { name: "asc" },
  });

  // Otimização N+1: Buscar todos os pedidos no período para todos os motoboys de uma só vez
  const motoboyIds = motoboys.map(mb => mb.id);
  const allOrders = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: lojaId,
      motoboyId: { in: motoboyIds },
      createdAt: { gte: fromDate, lte: toDate },
      deliveryType: "DELIVERY",
    },
    select: {
      id: true,
      createdAt: true,
      totalAmount: true,
      deliveryFee: true,
      // Entrega grátis: o valor cheio que o motoboy recebe (taxaDaCorrida).
      entregaGratis: true,
      motoboyFee: true,
      discountTotal: true,
      discountIfood: true,
      discountMerchant: true,
      source: true,
      deliveryDistance: true,
      customerName: true,
      customerPhone: true,
      customerAddress: true,
      status: true,
      motoboyId: true,
      paymentMethod: true,
      // A troca de pagamento pela linha da entrega (TrocaDePagamentoPainel)
      // precisa da divisão e da prova de pago online (podeTrocarPagamento).
      paymentMethods: true,
      gatewayPaymentId: true,
      // A régua do caixa (lib/resumo-do-entregador.ts, `partesDaEntrega`): o
      // Pix/cartão pago pelo site tem o texto igual ao da porta, e é o carimbo
      // do gateway que diz que foi online.
      paymentPaidAt: true,
      gatewayProvider: true,
      // O rastro das edições: a linha marca "editado" e o "Ver pedido" mostra.
      editHistory: true,
      changeAmount: true,
      items: true,
      notes: true,
      dailyOrderNumber: true,
      ifoodReference: true,
      openDeliveryReference: true,
      // O canal sai de lib/canal-do-pedido.ts e precisa destes: sem eles todo
      // pedido parece do site, e a regra do app nunca se aplicaria.
      ifoodOrderId: true,
      openDeliveryChannel: true,
      openDeliveryOrderId: true,
      tableSessionId: true,
      // A régua da corrida (saiu antes de cancelar?) e a de quem entregou (o
      // entregador do app tira o pedido do acerto) — as mesmas do caixa.
      dispatchedAt: true,
      cancelledAt: true,
      deliveryBy: true,
      ifoodDriverStatus: true,
      ifoodDriverName: true,
      // Troco feito pelo Pix (lib/troco-no-pix.ts): muda o dinheiro a entregar.
      ...SELECT_TROCO_NO_PIX,
      // A regra do "entregue mesmo depois de cancelado" (a reposição não é venda).
      reposicao: true,
      cancelReason: true,
      cancelledBy: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // O lanche dos motoboys (lib/lanche-da-equipe.ts): o que passou do
  // combinado do dia sai do acerto. Só nas lojas que têm a tela.
  const lanchesPorMotoboy = new Map<string, LancheDoHistorico[]>();
  if ((await configDaLoja(lojaId).catch(() => null))?.disponivel) {
    const lanches = await lanchesDoPeriodo({ lojaId, motoboyId, de: fromDate, ate: toDate }).catch(() => []);
    for (const l of lanches) lanchesPorMotoboy.set(l.motoboyId, [...(lanchesPorMotoboy.get(l.motoboyId) || []), l]);
  }

  // O que o motoboy pegou no fiado (lib/fiado-do-motoboy.ts) — aparece no
  // relatório, mas não sai do acerto: a baixa é na tela Fiado.
  const fiadoPorMotoboy = await fiadoDosMotoboys({ lojaId, motoboys, de: fromDate, ate: toDate });

  // A diária mudada num dia e as pendências (lib/ajustes-do-acerto.ts). Os
  // dois são por DIA do expediente: entram os dias que o período alcança — com
  // hora (18h do dia 1 às 2h do dia 2), é o dia 1. Sem a tabela, o acerto sai
  // sem ajustes, como era antes.
  const diaDe = diaDoExpediente(fromDate, tz);
  const diaAte = diaDoExpediente(toDate, tz);
  const ajustes: AjustesDoPeriodo = await ajustesDoPeriodo({ lojaId, motoboyIds, de: diaDe, ate: diaAte })
    .catch(() => ({ diarias: new Map(), pendencias: new Map() }));
  // Os acertos já pagos que alcançam algum dia do período (lib/acerto-pago.ts).
  const acertosPagos: Map<string, AcertoPago[]> = await acertosDoPeriodo({ lojaId, motoboyIds, de: diaDe, ate: diaAte })
    .catch(() => new Map());

  // Agrupar pedidos em memória por motoboyId
  const ordersByMotoboy: Record<string, typeof allOrders> = {};
  for (const o of allOrders) {
    if (o.motoboyId) {
      if (!ordersByMotoboy[o.motoboyId]) {
        ordersByMotoboy[o.motoboyId] = [];
      }
      ordersByMotoboy[o.motoboyId].push(o);
    }
  }

  // Mapear motoboys em memória sem chamadas adicionais ao banco
  const report = motoboys.map((mb) => {
    // O que o entregador do APP levou sai do acerto (ver o cabeçalho).
    const marcados = ordersByMotoboy[mb.id] || [];
    const doApp = marcados.filter((o) => !ehEntregaDaLoja(o));
    const orders = marcados.filter((o) => ehEntregaDaLoja(o));
    // Cancelado DEPOIS de sair conta (entrega, dia e ganho); antes, não.
    const cancelados = orders.filter((o) => canceladoComCorrida(o));
    const canceladosSemCorrida = orders.filter((o) => ehCancelado(o.status) && !canceladoComCorrida(o));

    // Só vale o que o TIPO escolhido usa — a regra mora em
    // lib/ganho-do-entregador.ts, junto com a conta que a usa.
    const acerto = lerAcerto(mb as any);
    const { tipo, dailyRate, perDeliveryRate, perKmRate } = acerto;

    // ── QUANTO ESTE PEDIDO RENDE PARA O MOTOBOY ──────────────────────────
    //
    // Uma função só, e o total é a SOMA dela pedido a pedido. Antes o total
    // era calculado aqui (entregas × valor) e a lista detalhada mostrava
    // `deliveryFee` — a taxa que o CLIENTE pagou ao marketplace. Os dois
    // números não tinham relação, e o lojista via "Taxa: R$ 6,94" numa
    // entrega que ele paga R$ 2,00 (reclamação do Lucas, 12/09/2026).
    //
    // Pior no 99Food: lá o `deliveryFee` é o que sobrou para o cliente pagar
    // DEPOIS do desconto que o 99 bancou. O pedido #266009 tinha taxa de
    // R$ 12,00 com R$ 11,00 abatidos pelo 99Food, e o relatório mostrava
    // "Taxa: R$ 1,00" — um valor que não existe em lugar nenhum do acerto
    // entre a loja e o entregador.
    // A conta é da lib (lib/ganho-do-entregador.ts): a mesma que o papel do
    // fechamento de caixa usa (lib/esperado-do-turno.ts), para os dois nunca
    // divergirem.
    const ganhoDoPedido = (o: { deliveryFee?: number | null; motoboyFee?: number | null; deliveryDistance?: number | null; source?: string | null; [k: string]: any }) =>
      calcularGanho({
        acerto,
        pedido: o,
        regraDaLoja: regraDeRepasse,
        zonas: donoDaLoja?.deliveryZones,
        cidadeDaLoja: donoDaLoja?.city,
        ehMarketplace: canalDoPedido(o).ehMarketplace,
      });

    // O ganho só existe na corrida: o cancelado antes de sair rende zero.
    const ganhos = orders.map((o) => {
      const g = ganhoDoPedido(o);
      return { pedido: o, origem: g.origem, valor: contaComoCorrida(o) ? g.valor : 0 };
    });
    const quantosDe = (origem: OrigemDoGanho) => ganhos.filter((g) => g.origem === origem && contaComoCorrida(g.pedido)).length;
    /**
     * Caiu mesmo na taxa do cliente — não é suposição pela configuração. No
     * "Diária + Taxa do Pedido" (DAILY_PLUS_FEE) a taxa do pedido É o combinado:
     * o aviso "não tem valor por entrega cadastrado" ali era falso.
     */
    const usandoTaxaDoCliente = tipo !== "DAILY_PLUS_FEE" && quantosDe("TAXA_DO_CLIENTE") > 0;
    /** Entregas que a escada/km não conseguiu precificar por falta de distância. */
    const entregasSemDistancia = quantosDe("SEM_DISTANCIA");

    // A soma (entregas, km, dias, dinheiro por forma, ganho) mora em
    // lib/resumo-do-entregador.ts — a mesma que a tela refaz quando o lojista
    // filtra o cartão do motoboy por integração.
    const resumo = resumoDasEntregas(ganhos.map((g) => ({ ...g.pedido, ganho: g.valor })), tz);

    // A diária só existe nos tipos que a oferecem — `dailyRate` já vem zerado
    // nos outros, então não há mais o que descontar aqui. Cada dia trabalhado
    // vale a do cadastro, a não ser o dia que a loja ajustou.
    const diarias = diariasDoPeriodo(resumo.diasTrabalhados, dailyRate, ajustes.diarias.get(mb.id));
    const dailyTotal = somaDasDiarias(diarias);
    const feeTotal = resumo.feeTotal;

    // O lanche acima do combinado é descontado do que a loja paga.
    const lanches = lanchesPorMotoboy.get(mb.id) || [];
    const lancheDescontado = descontoDoAcerto(lanches);
    // As pendências lançadas pela loja também — nos dois totais, como o lanche.
    const pendencias = ajustes.pendencias.get(mb.id) || [];
    const pendenciasDescontadas = totalDasPendencias(pendencias);
    const { totalWithDaily, totalFeeOnly } = totaisDoAcertoDoMotoboy({
      diarias: dailyTotal, entregas: feeTotal, lanche: lancheDescontado, pendencias: pendenciasDescontadas,
    });

    return {
      motoboy: {
        id: mb.id,
        name: mb.name,
        paymentType: mb.paymentType,
        dailyRate,
        perDeliveryRate,
        perKmRate,
        faixasDeKm: acerto.faixas,
        active: mb.active,
        // A tela precisa dizer ao lojista QUE CONTA foi feita — e avisar
        // quando caiu na taxa do cliente por falta de configuração.
        usandoTaxaDoCliente,
        // Entregas que a escada de km não pôde precificar porque o pedido veio
        // sem distância. Elas entram como R$ 0,00: a tela mostra a contagem
        // para o lojista conferir o endereço em vez de descobrir no bolso.
        entregasSemDistancia,
      },
      stats: {
        ...resumo,
        dailyTotal,
        feeTotal,
        totalWithDaily,
        totalFeeOnly,
        /** Lanche acima do combinado do dia, já tirado dos dois totais acima. */
        lancheDescontado,
        /** A diária de cada dia trabalhado (a do cadastro ou a ajustada pela loja). */
        diarias,
        /** Quantos dias tiveram a diária mudada pela loja. */
        diariasAjustadas: diarias.filter((d) => d.ajustada).length,
        /** Pendências lançadas pela loja no período, já tiradas dos dois totais. */
        pendenciasDescontadas,
      },
      /** As pendências do período: data, valor, motivo e quem lançou (o motoboy vê). */
      pendencias,
      /** O fiado dele no período e o saldo em aberto (não descontado do acerto). */
      fiado: fiadoPorMotoboy.get(mb.id) || null,
      /** Acertos já pagos que alcançam o período, e quais dias trabalhados deste período eles cobrem. */
      acertosPagos: acertosPagos.get(mb.id) || [],
      diasPagos: resumo.diasTrabalhados.filter((d: string) => (acertosPagos.get(mb.id) || []).some((a) => a.dias.includes(d))),
      /** Os lanches do período (o motoboy confere dia, itens e o que foi descontado). */
      lanches: lanches.filter((l) => !l.cancelado).map((l) => ({
        pedidoId: l.pedidoId, numero: l.numero, dia: l.dia, em: l.em, levar: l.levar,
        valor: l.valor, coberto: l.coberto, excedente: l.excedente, itens: l.itens,
      })),
      // As canceladas DEPOIS de sair (a corrida conta). O app do motoboy lê
      // este campo e diz "a corrida conta" — por isso só elas.
      cancelados: {
        qtd: cancelados.length,
        lista: cancelados.map((o) => ({
          id: o.id,
          createdAt: o.createdAt,
          dailyOrderNumber: o.dailyOrderNumber,
          ifoodReference: o.ifoodReference,
          openDeliveryReference: o.openDeliveryReference,
          customerName: o.customerName,
          totalAmount: o.totalAmount,
        })),
      },
      /** Canceladas antes de sair: não são corrida. */
      canceladosSemCorrida: {
        qtd: canceladosSemCorrida.length,
        lista: canceladosSemCorrida.map((o) => ({
          id: o.id, createdAt: o.createdAt, dailyOrderNumber: o.dailyOrderNumber, ifoodReference: o.ifoodReference,
          openDeliveryReference: o.openDeliveryReference, customerName: o.customerName, totalAmount: o.totalAmount,
        })),
      },
      /** Marcadas com ele, mas levadas pelo entregador do app: fora do acerto. */
      entregasDoApp: {
        qtd: doApp.length,
        lista: doApp.map((o) => ({ id: o.id, createdAt: o.createdAt, dailyOrderNumber: o.dailyOrderNumber, ifoodReference: o.ifoodReference, openDeliveryReference: o.openDeliveryReference, totalAmount: o.totalAmount })),
      },
      /** A composição do pagamento por ORIGEM do valor (a tela monta as linhas daqui). */
      composicao: composicaoDoGanho(ganhos.map((g) => ({ origemDoGanho: g.origem, ganhoDoMotoboy: g.valor, deliveryDistance: g.pedido.deliveryDistance, corrida: contaComoCorrida(g.pedido) }))),
      orders: orders.map(o => {
        // O dinheiro desta entrega pelas MESMAS partes que somam o quadrado
        // (a régua do caixa) — no pagamento dividido, só a parte em dinheiro.
        const emDinheiro = partesDaEntrega(o).filter((p) => p.caixa === "DINHEIRO");
        const changeFor = emDinheiro.find((p) => p.trocoPara)?.trocoPara ?? null;
        // Cancelado: a corrida conta, o dinheiro não — ninguém pagou o pedido.
        const cancelado = ehCancelado(o.status);
        // Com o troco feito pelo Pix: no Pix da loja ele entrega a nota inteira,
        // no dele só o pedido; troco levado, nenhum (`dinheiroDaParte`).
        const cashToDeliver = cancelado ? 0 : Math.round(emDinheiro.reduce((s, p) => s + dinheiroDaParte(p), 0) * 100) / 100;
        const changeGiven = cancelado ? 0 : Math.round(emDinheiro.reduce((s, p) => s + trocoLevadoDaParte(p), 0) * 100) / 100;

        return {
          id: o.id,
          createdAt: o.createdAt,
          date: o.createdAt,
          // O que ESTE pedido rende para o motoboy, pela mesma função que
          // soma o total. É o que faz a lista detalhada bater com o valor a
          // pagar — antes ela mostrava a taxa que o cliente pagou ao
          // marketplace, que não tem relação com o acerto da loja.
          ganhoDoMotoboy: contaComoCorrida(o) ? Math.round(ganhoDoPedido(o).valor * 100) / 100 : 0,
          // De onde saiu esse valor: a linha da lista pode dizer "faixa de
          // 4 km" ou "sem distância" em vez de deixar o lojista adivinhar.
          origemDoGanho: ganhoDoPedido(o).origem,
          totalAmount: o.totalAmount,
          changeAmount: o.changeAmount,
          changeFor,
          changeGiven,
          cashToDeliver,
          // A marca crua (a tela refaz `partesDaEntrega` com ela) e a linha
          // pronta "Troco feito pelo Pix: R$ X" (valor e quem fez o Pix).
          trocoNoPix: (o as any).trocoNoPix ?? null,
          trocoNoPixInfo: cancelado ? null : trocoNoPixDoPedido(o as any),
          deliveryFee: o.deliveryFee,
          motoboyFee: o.motoboyFee,
          // Para o "Ver Pedido" mostrar a conta fechando, com o desconto e a
          // taxa — que e o que o lojista confere com o entregador.
          discountTotal: o.discountTotal,
          discountIfood: (o as any).discountIfood,
          discountMerchant: (o as any).discountMerchant,
          source: o.source,
          // De onde veio — é por esta chave que o cartão do motoboy filtra
          // (só iFood, só 99, só site próprio...).
          canal: chaveDoCanal(o),
          deliveryDistance: o.deliveryDistance,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          customerAddress: o.customerAddress,
          paymentMethod: o.paymentMethod,
          paymentMethods: o.paymentMethods,
          gatewayPaymentId: o.gatewayPaymentId,
          // A tela refaz a soma (filtro de integração) e marca a caixa de cada
          // linha com `partesDaEntrega` — que lê estes três.
          paymentPaidAt: o.paymentPaidAt,
          gatewayProvider: o.gatewayProvider,
          openDeliveryChannel: o.openDeliveryChannel,
          tableSessionId: o.tableSessionId,
          deliveryType: "DELIVERY",
          /** Quantas vezes o pedido foi mexido depois de lançado (editHistory). */
          edicoes: Array.isArray(o.editHistory) ? o.editHistory.length : 0,
          /** O "Ver pedido" (janela na própria tela) lista o que foi mexido. */
          editHistory: o.editHistory,
          status: o.status,
          /** Sai do dinheiro — as telas marcam "CANCELADO". */
          cancelado,
          /**
           * O cancelado que o cliente recebeu e pagou pode voltar a ser
           * entregue pela Conferência (lib/entregue-depois-de-cancelado.ts):
           * só pedido da própria loja. Decidido aqui, com os campos do canal
           * que a linha não leva (ifoodOrderId, openDeliveryOrderId).
           */
          podeEntregueDepoisDeCancelado: cancelado && podeMarcarEntregueDepoisDeCancelado(o).pode,
          /** Já voltou: a linha diz que foi cancelado antes. */
          entregueDepoisDeCancelado: foiEntregueDepoisDeCancelado(o),
          /** É corrida (não cancelada, ou cancelada depois de sair): conta entrega, dia e ganho. */
          corrida: contaComoCorrida(o),
          dispatchedAt: o.dispatchedAt,
          cancelledAt: o.cancelledAt,
          notes: o.notes,
          items: o.items,
          dailyOrderNumber: o.dailyOrderNumber,
          ifoodReference: o.ifoodReference,
          openDeliveryReference: o.openDeliveryReference,
        };
      }),
    };
  });

  return {
    period: {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      fromFormatted: fromDate.toLocaleDateString("pt-BR", { timeZone: tz }),
      toFormatted: toDate.toLocaleDateString("pt-BR", { timeZone: tz }),
    },
    report,
  };
}
