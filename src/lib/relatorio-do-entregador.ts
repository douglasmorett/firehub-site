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
 * ── Cancelado com o motoboy conta ───────────────────────────────────────────
 * Pedido cancelado que estava com o entregador CONTA como entrega e soma o
 * ganho: ele saiu, e o costume é receber a corrida (o Douglas, 02/10/2026 —
 * "se ele puxou o pedido, vai ficar na conta"). O que muda é a informação:
 * vem marcado como cancelado na lista e contado em `cancelados`, para nenhum
 * dos dois lados estranhar o número. Dinheiro a prestar contas, não: ninguém
 * pagou o pedido cancelado.
 */
import { canalDoPedido, chaveDoCanal } from "@/lib/canal-do-pedido";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { ganhoDoPedido as calcularGanho, lerAcerto, type OrigemDoGanho } from "@/lib/ganho-do-entregador";
import { prisma } from "@/lib/prisma";
import { getStartOfDayUTC, getEndOfDayUTC, getStartOfMonthUTC, getInstantUTC } from "@/lib/timezone";
import { resumoDasEntregas, ehCancelado, partesDaEntrega } from "@/lib/resumo-do-entregador";
import { HORA_DE_VIRADA_DO_EXPEDIENTE } from "@/lib/fuso";

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
    select: { deliveryZones: true, deliveryZoneType: true, deliveryConfig: true },
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
    },
    orderBy: { createdAt: "asc" },
  });

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
    // Cancelado com o motoboy CONTA (entrega, dia e ganho) — ver o cabeçalho.
    // Só não entra no dinheiro a prestar contas, logo abaixo.
    const orders = ordersByMotoboy[mb.id] || [];
    const cancelados = orders.filter((o) => ehCancelado(o.status));

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
        ehMarketplace: canalDoPedido(o).ehMarketplace,
      });

    const ganhos = orders.map((o) => ({ pedido: o, ...ganhoDoPedido(o) }));
    const quantosDe = (origem: OrigemDoGanho) => ganhos.filter((g) => g.origem === origem).length;
    /** Caiu mesmo na taxa do cliente — não é suposição pela configuração. */
    const usandoTaxaDoCliente = quantosDe("TAXA_DO_CLIENTE") > 0;
    /** Entregas que a escada/km não conseguiu precificar por falta de distância. */
    const entregasSemDistancia = quantosDe("SEM_DISTANCIA");

    // A soma (entregas, km, dias, dinheiro por forma, ganho) mora em
    // lib/resumo-do-entregador.ts — a mesma que a tela refaz quando o lojista
    // filtra o cartão do motoboy por integração.
    const resumo = resumoDasEntregas(ganhos.map((g) => ({ ...g.pedido, ganho: g.valor })), tz);

    // A diária só existe nos tipos que a oferecem — `dailyRate` já vem zerado
    // nos outros, então não há mais o que descontar aqui.
    const dailyTotal = resumo.uniqueDays * dailyRate;
    const feeTotal = resumo.feeTotal;

    const totalWithDaily = dailyTotal + feeTotal;
    const totalFeeOnly = feeTotal;

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
      },
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
      orders: orders.map(o => {
        // O dinheiro desta entrega pelas MESMAS partes que somam o quadrado
        // (a régua do caixa) — no pagamento dividido, só a parte em dinheiro.
        const emDinheiro = partesDaEntrega(o).filter((p) => p.caixa === "DINHEIRO");
        const changeFor = emDinheiro.find((p) => p.trocoPara)?.trocoPara ?? null;
        // Cancelado: a corrida conta, o dinheiro não — ninguém pagou o pedido.
        const cancelado = ehCancelado(o.status);
        const cashToDeliver = cancelado ? 0 : Math.round(emDinheiro.reduce((s, p) => s + (p.trocoPara ?? p.valor), 0) * 100) / 100;
        const changeGiven = cancelado ? 0 : Math.round(emDinheiro.reduce((s, p) => s + (p.trocoPara ? p.trocoPara - p.valor : 0), 0) * 100) / 100;

        return {
          id: o.id,
          createdAt: o.createdAt,
          date: o.createdAt,
          // O que ESTE pedido rende para o motoboy, pela mesma função que
          // soma o total. É o que faz a lista detalhada bater com o valor a
          // pagar — antes ela mostrava a taxa que o cliente pagou ao
          // marketplace, que não tem relação com o acerto da loja.
          ganhoDoMotoboy: Math.round(ganhoDoPedido(o).valor * 100) / 100,
          // De onde saiu esse valor: a linha da lista pode dizer "faixa de
          // 4 km" ou "sem distância" em vez de deixar o lojista adivinhar.
          origemDoGanho: ganhoDoPedido(o).origem,
          totalAmount: o.totalAmount,
          changeAmount: o.changeAmount,
          changeFor,
          changeGiven,
          cashToDeliver,
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
          /** Conta na corrida, sai do dinheiro — as telas marcam "CANCELADO". */
          cancelado,
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
