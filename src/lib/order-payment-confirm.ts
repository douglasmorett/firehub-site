import { prisma } from "@/lib/prisma";
import { pushJobToPrintQueue } from "@/app/api/store/print-queue/route";

export async function confirmOrderPayment(orderId: string) {
  if (!orderId) return null;

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: {
      franchisee: { select: { id: true, storeName: true, autoAcceptOrders: true } },
      items: { include: { menuProduct: { select: { name: true } } } },
    },
  });

  if (!order) return null;

  // Se já está marcado como pago e ativo, ignora duplicata
  if (order.paymentPaidAt && order.status !== "AGUARDANDO_PAGAMENTO") {
    return order;
  }

  // Pagamento que chega DEPOIS do cancelamento não ressuscita o pedido: sem
  // esta guarda ele voltava para NOVO/ACEITO e ia para a cozinha — lanche
  // feito para um pedido que a loja (ou o cliente) já tinha desistido. Quem
  // recebeu o dinheiro decide o que fazer com ele (o Pix pelo site estorna
  // sozinho, lib/pix-online-pedido.ts).
  if (order.status === "CANCELADO") {
    console.warn(`[ConfirmPayment] Pedido ${orderId} está CANCELADO: pagamento não reabre o pedido.`);
    return order;
  }

  // Trava: só UM caminho confirma. O webhook do gateway, a tela do cliente
  // (consulta a cada 3 s) e o cron chegam juntos com frequência, e os dois
  // passavam pela guarda acima — cada um gerava um número (o segundo ficava
  // "queimado") e disparava o WhatsApp e a impressão em dobro.
  // O segundo OR recupera a confirmação que começou e não terminou (processo
  // caiu no meio): passados 2 minutos, outro caminho pode concluir.
  const carimbo = new Date();
  const trava = await prisma.customerOrder.updateMany({
    where: {
      id: orderId,
      status: { not: "CANCELADO" },
      OR: [
        { paymentPaidAt: null },
        { status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: { lt: new Date(carimbo.getTime() - 2 * 60_000) } },
      ],
    },
    data: { paymentPaidAt: carimbo },
  });
  if (trava.count === 0) {
    return prisma.customerOrder.findUnique({ where: { id: orderId } });
  }

  const franchisee = order.franchisee;
  const initialStatus = franchisee?.autoAcceptOrders ? "ACEITO" : "NOVO";

  // Gera número do pedido apenas agora, se o pedido estiver sem número (abandonou no AGUARDANDO_PAGAMENTO).
  // Pela hora em que o pedido NASCEU, não a do pagamento: o Pix feito às
  // 23h58 e pago às 00h01 ganhava o #1 do dia seguinte com a data do dia
  // anterior — dois #1 no painel quando o primeiro pedido de verdade chegava.
  let finalDailyNumber = order.dailyOrderNumber;
  if (!finalDailyNumber && order.franchiseeId) {
    const { generateDailyOrderNumber } = await import("@/lib/order-number");
    finalDailyNumber = await generateDailyOrderNumber(order.franchiseeId, order.createdAt);
  }

  // Atualização atômica do pedido: marca como pago, define status ativo, gera senha e coloca no KDS em produção
  const updatedOrder = await prisma.customerOrder.update({
    where: { id: orderId },
    data: {
      paymentPaidAt: carimbo,
      status: initialStatus,
      pagarmeStatus: "approved",
      kdsStage: "PRODUCTION",
      kdsProductionAt: new Date(),
      ...(finalDailyNumber ? { dailyOrderNumber: finalDailyNumber } : {})
    },
  });

  // Envia para a fila de impressão térmica automática da loja
  try {
    const formattedOrder = {
      id: order.id,
      dailyOrderNumber: order.id.slice(-4).toUpperCase(),
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      deliveryType: order.deliveryType || "DELIVERY",
      paymentMethod: `${order.paymentMethod || "ONLINE"} (Pago online)`,
      isPrepaid: true,
      items: (order.items || []).map((i: any) => ({
        name: i.menuProduct?.name || "Item",
        qty: i.quantity || 1,
        price: i.price || 0,
        comboSelections: i.comboSelections,
      })),
      totalAmount: order.totalAmount || 0,
      deliveryFee: order.deliveryFee || 0,
      notes: order.notes,
      createdAt: order.createdAt.toISOString(),
    };
    pushJobToPrintQueue(order.franchiseeId, formattedOrder, franchisee?.storeName || "FIREHUB", "80mm");
  } catch (errPrint) {
    console.error("[ConfirmPayment] Auto-print error:", errPrint);
  }

  // Abater taxa da fatura de faturamento (billing)
  try {
    const { trackSaleForBilling } = await import("@/lib/billing");
    await trackSaleForBilling(order.franchiseeId);
  } catch (errBill) {
    console.error("[ConfirmPayment] Billing error:", errBill);
  }

  // Baixa de estoque no pagamento, não na criação.
  //
  // O pedido do totem debitava insumo no instante em que o cliente tocava em
  // "confirmar", antes de qualquer cartão: quem desistia na tela de pagamento
  // levava embora o estoque de um lanche que nunca foi feito. Aqui a baixa
  // acontece uma vez só, quando o dinheiro entrou, e `deductStockForOrder` é
  // idempotente — pedido confirmado duas vezes não debita duas vezes.
  try {
    const { deductStockForOrder } = await import("@/lib/stock");
    deductStockForOrder(orderId).catch((e) =>
      console.error("[ConfirmPayment] Baixa de estoque:", e)
    );
  } catch (errEstoque) {
    console.error("[ConfirmPayment] Baixa de estoque:", errEstoque);
  }

  // ── PURCHASE PARA O META, PELO SERVIDOR ─────────────────────────────────
  //
  // Este é o ponto do pedido de pagamento ONLINE: a venda só existe quando o
  // dinheiro entra. Quem desiste na tela do cartão não pode virar conversão —
  // além de inflar o número, ensina o algoritmo a buscar mais gente que
  // abandona.
  //
  // O pedido de "pagar na entrega" NÃO chega aqui (ele nunca é confirmado, o
  // `paymentPaidAt` fica nulo para sempre): esse dispara na criação, em
  // api/customer-order/route.ts.
  //
  // Reenvio de webhook é inofensivo: o `event_id` é determinístico por pedido,
  // então o Meta reconhece o mesmo evento e conta uma venda só.
  try {
    const { dispararCompraNoMeta } = await import("@/lib/meta-purchase");
    dispararCompraNoMeta(orderId).catch((e) =>
      console.error("[ConfirmPayment] Meta CAPI:", e)
    );
    const { dispararCompraNoGoogle } = await import("@/lib/ga-purchase");
    dispararCompraNoGoogle(orderId).catch((e) =>
      console.error("[ConfirmPayment] GA4 MP:", e)
    );
  } catch (errMeta) {
    console.error("[ConfirmPayment] Meta CAPI:", errMeta);
  }

  // Contador de pedidos da loja (Pay as You Grow).
  prisma.user
    .update({ where: { id: order.franchiseeId }, data: { storeOrderCount: { increment: 1 } } })
    .catch((e) => console.error("[ConfirmPayment] Contador de pedidos:", e));

  // Notificação WhatsApp de pagamento confirmado
  try {
    const { sendOrderNotification } = await import("@/lib/order-notifications");
    sendOrderNotification(orderId, "CREATED").catch(() => {});
  } catch (errWp) {
    console.warn("[ConfirmPayment] WhatsApp notification error:", errWp);
  }

  return updatedOrder;
}
