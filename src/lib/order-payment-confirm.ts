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

  const franchisee = order.franchisee;
  const initialStatus = franchisee?.autoAcceptOrders ? "ACEITO" : "NOVO";

  // Gera número do pedido apenas agora, se o pedido estiver sem número (abandonou no AGUARDANDO_PAGAMENTO)
  let finalDailyNumber = order.dailyOrderNumber;
  if (!finalDailyNumber && order.franchiseeId) {
    const { generateDailyOrderNumber } = await import("@/lib/order-number");
    finalDailyNumber = await generateDailyOrderNumber(order.franchiseeId);
  }

  // Atualização atômica do pedido: marca como pago, define status ativo, gera senha e coloca no KDS em produção
  const updatedOrder = await prisma.customerOrder.update({
    where: { id: orderId },
    data: {
      paymentPaidAt: new Date(),
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
      paymentMethod: `${order.paymentMethod || "ONLINE"} (Pago Online MP)`,
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

  // Notificação WhatsApp de pagamento confirmado
  try {
    const { sendOrderNotification } = await import("@/lib/order-notifications");
    sendOrderNotification(orderId, "CREATED").catch(() => {});
  } catch (errWp) {
    console.warn("[ConfirmPayment] WhatsApp notification error:", errWp);
  }

  return updatedOrder;
}
