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

  // ── Sync with iFood ──
  if (order.ifoodOrderId) {
    try {
      const { getIfoodToken } = await import("@/lib/ifood-api");
      const token = await getIfoodToken();
      const ifoodId = order.ifoodOrderId;
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const baseUrl = `https://merchant-api.ifood.com.br/order/v1.0/orders/${ifoodId}`;

      if (status === "ACEITO") {
        // Confirm order on iFood
        const r = await fetch(`${baseUrl}/confirm`, { method: "POST", headers });
        console.log(`[iFood Sync] confirm ${ifoodId}: ${r.status}`);
      }

      if (status === "PREPARANDO") {
        // Start preparation
        const r = await fetch(`${baseUrl}/startPreparation`, { method: "POST", headers });
        console.log(`[iFood Sync] startPreparation ${ifoodId}: ${r.status}`);
      }

      if (status === "SAIU_ENTREGA") {
        // Dispatch (delivery orders)
        const r = await fetch(`${baseUrl}/dispatch`, { method: "POST", headers });
        console.log(`[iFood Sync] dispatch ${ifoodId}: ${r.status}`);
      }

      if (status === "ENTREGUE") {
        const isPickup = order.deliveryType !== "DELIVERY";
        if (isPickup) {
          // For pickup: readyToPickup then conclude
          const r1 = await fetch(`${baseUrl}/readyToPickup`, { method: "POST", headers });
          console.log(`[iFood Sync] readyToPickup ${ifoodId}: ${r1.status}`);
        }
        // Conclude order (works for both delivery and pickup)
        const r2 = await fetch(`${baseUrl}/conclude`, { method: "POST", headers, body: JSON.stringify({}) });
        console.log(`[iFood Sync] conclude ${ifoodId}: ${r2.status}`);
      }

      if (status === "CANCELADO") {
        // Cancel on iFood
        updateData.motoboyId = null;
        updateData.cancelledBy = "LOJA";
        if (cancelReason) updateData.cancelReason = cancelReason;

        const cancelRes = await fetch(`${baseUrl}/requestCancellation`, {
          method: "POST", headers,
          body: JSON.stringify({ reason: cancelReason || "CANCELLED_BY_RESTAURANT", cancellationCode: "501" }),
        });

        if (!cancelRes.ok) {
          // Fallback: try deny (for NOVO orders) or direct cancel
          const fallbackUrl = order.status === "NOVO" ? `${baseUrl}/deny` : `${baseUrl}/cancel`;
          const fallbackRes = await fetch(fallbackUrl, {
            method: "POST", headers,
            body: JSON.stringify({ reason: cancelReason || "Cancelado pela loja", cancelCodeId: "501" }),
          });
          console.log(`[iFood Sync] cancel fallback ${ifoodId}: ${fallbackRes.status}`);
        } else {
          console.log(`[iFood Sync] ✅ cancel ${ifoodId}: ${cancelRes.status}`);
        }
      }
    } catch (err: any) {
      console.error(`[iFood Sync] Erro ${order.ifoodOrderId}:`, err?.message);
      // Don't block local update even if iFood sync fails
    }
  }

  // Handle non-iFood cancellations
  if (status === "CANCELADO" && !order.ifoodOrderId) {
    updateData.motoboyId = null;
    updateData.cancelledBy = "LOJA";
    if (cancelReason) updateData.cancelReason = cancelReason;
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

  // Realiza a baixa do estoque se o pedido for aceito ou entrar em preparo/entrega
  const STOCK_DEDUCT_STATUSES = ["ACEITO", "PREPARANDO", "PRONTO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE"];
  if (STOCK_DEDUCT_STATUSES.includes(status)) {
    const { deductStockForOrder } = await import("@/lib/stock");
    deductStockForOrder(orderId).catch(err =>
      console.error("[Stock] Erro ao deduzir estoque:", err)
    );
  }

  return NextResponse.json({ success: true });
}
