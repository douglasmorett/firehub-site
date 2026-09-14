import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/prisma";
import { dispatchOutboundWebhook } from "@/lib/webhook-dispatcher";
import { sendOrderNotification } from "@/lib/order-notifications";

export const dynamic = "force-dynamic";

// PRONTO faltava nesta lista: quem integra pela API pública (PDV, KDS de
// terceiro) levava 400 ao marcar o pedido como pronto e era obrigado a pular
// direto para "saiu para entrega" — que dispara o dispatch no parceiro e
// registra a saída de um pedido que ainda está no balcão.
const VALID_STATUSES = ["NOVO", "ACEITO", "PREPARANDO", "EM_PREPARO", "PRONTO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO", "CANCELED"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado.", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const { orderId } = await params;
  const body = await req.json();
  const { status, cancelReason } = body;

  if (!status || !VALID_STATUSES.includes(status.toUpperCase())) {
    return NextResponse.json(
      { error: `Status inválido. Statuses aceitos: ${VALID_STATUSES.join(", ")}`, code: "INVALID_STATUS" },
      { status: 400 }
    );
  }

  const targetStatus = status.toUpperCase();

  const existingOrder = await prisma.customerOrder.findFirst({
    where: { id: orderId, franchiseeId: auth.franchiseeId },
  });

  if (!existingOrder) {
    return NextResponse.json({ error: "Pedido não encontrado ou não pertence a esta loja." }, { status: 404 });
  }

  const updatedOrder = await prisma.customerOrder.update({
    where: { id: orderId },
    data: {
      status: targetStatus,
      cancelledBy: targetStatus === "CANCELADO" || targetStatus === "CANCELED" ? "API_PARCEIRA" : undefined,
      notes: cancelReason ? `${existingOrder.notes || ""}\n[Motivo Cancelamento API]: ${cancelReason}`.trim() : undefined,
    },
  });

  // Notificar cliente via WhatsApp. PRONTO nao e um evento de notificacao: ele
  // vira o aviso de retirada, que so faz sentido em pedido que o cliente vem
  // buscar. Em pedido de entrega o cliente nao tem o que fazer com um "pronto":
  // o aviso dele e o SAIU_ENTREGA, logo abaixo.
  if (targetStatus === "PRONTO") {
    if (existingOrder.deliveryType !== "DELIVERY") {
      sendOrderNotification(updatedOrder.id, "PRONTO_RETIRADA").catch(() => {});
    }
  } else if (["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"].includes(targetStatus)) {
    sendOrderNotification(updatedOrder.id, targetStatus as any).catch(() => {});
  }

  // Disparar Webhook de Saída
  const eventName = ["CANCELADO", "CANCELED"].includes(targetStatus) ? "order.canceled" : "order.status_updated";
  dispatchOutboundWebhook(auth.franchiseeId, eventName, {
    orderId: updatedOrder.id,
    externalReference: updatedOrder.openDeliveryReference,
    status: updatedOrder.status,
    cancelReason: cancelReason || null,
    updatedAt: updatedOrder.updatedAt,
  });

  return NextResponse.json({
    success: true,
    order: {
      id: updatedOrder.id,
      status: updatedOrder.status,
      updatedAt: updatedOrder.updatedAt,
    },
  });
}
