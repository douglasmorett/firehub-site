import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { trackSaleForBilling } from "@/lib/billing";

// Status que contam como venda confirmada para fins de faturamento
const BILLING_TRIGGER_STATUSES = ["ACEITO", "ENTREGUE", "PRONTO", "SAIU_PARA_ENTREGA"];

// GET: Public status check (no auth required)
export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("id");
  if (!orderId) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      deliveryType: true,
      paymentMethod: true,
      createdAt: true,
      updatedAt: true,
      items: {
        select: {
          quantity: true,
          price: true,
          menuProduct: { select: { name: true } }
        }
      }
    }
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const role = (session.user as any)?.role;
  const body = await req.json();
  const { orderId, status, scheduledDatetime, cancelReason } = body;

  if (!orderId || !status) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: { franchisee: true }
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  // Security: only admin or the franchisee owner can update
  if (role !== "ADMIN" && order.franchisee.email !== session.user?.email) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const updateData: any = { status };
  // Allow updating scheduledDatetime (e.g. when anticipating a scheduled order)
  if (scheduledDatetime !== undefined) {
    updateData.scheduledDatetime = scheduledDatetime ? new Date(scheduledDatetime) : null;
  }

  // ── Special handling for CANCELADO ──
  if (status === "CANCELADO") {
    // 1. Remove motoboy so delivery fee doesn't count for them
    updateData.motoboyId = null;
    updateData.cancelledBy = "LOJA";
    if (cancelReason) updateData.cancelReason = cancelReason;

    // 2. Cancel on iFood if it's an iFood order
    if (order.ifoodOrderId) {
      try {
        const { getIfoodToken } = await import("@/lib/ifood-api");
        const token = await getIfoodToken();

        // Try requestCancellation first (merchant-initiated)
        const cancelRes = await fetch(
          `https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}/requestCancellation`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              reason: "CANCELLED_BY_RESTAURANT",
              cancellationCode: "501",
            }),
          }
        );

        if (!cancelRes.ok) {
          // Fallback: try direct cancel endpoint
          const fallbackRes = await fetch(
            `https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}/cancel`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                reason: "Cancelado pela loja",
                cancelCodeId: "501",
              }),
            }
          );
          console.log(`[iFood Cancel] Fallback cancel ${order.ifoodOrderId}: ${fallbackRes.status}`);
        } else {
          console.log(`[iFood Cancel] ✅ Pedido ${order.ifoodOrderId} cancelado no iFood`);
        }
      } catch (err: any) {
        console.error(`[iFood Cancel] Erro ao cancelar ${order.ifoodOrderId}:`, err?.message);
        // Don't block local cancellation even if iFood fails
      }
    }
  }

  await prisma.customerOrder.update({
    where: { id: orderId },
    data: updateData
  });

  // Atualiza faturamento do ciclo mensal se pedido foi confirmado
  if (BILLING_TRIGGER_STATUSES.includes(status)) {
    trackSaleForBilling(order.franchiseeId).catch(err =>
      console.error("[Billing] Erro ao atualizar ciclo:", err)
    );
  }

  return NextResponse.json({ success: true });
}
