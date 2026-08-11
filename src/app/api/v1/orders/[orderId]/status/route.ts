import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/prisma";
import { dispatchOutboundWebhook } from "@/lib/webhook-dispatcher";
import { sendOrderNotification } from "@/lib/order-notifications";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["NOVO", "ACEITO", "PREPARANDO", "EM_PREPARO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO", "CANCELED"];

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

  // Notificar cliente via WhatsApp se o status for SAIU_ENTREGA ou ENTREGUE
  if (["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"].includes(targetStatus)) {
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
