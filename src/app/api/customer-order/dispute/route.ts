import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const { orderId, action, denyReason } = body; // action: 'accept' | 'deny'

  if (!orderId || !action) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const order: any = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: { franchisee: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const role = (session.user as any)?.role;
  if (role !== "ADMIN" && order.franchisee.email !== session.user?.email) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Sync with iFood using Handshake API
  if (order.ifoodOrderId && order.cancelDispute?.disputeId) {
    try {
      const { getIfoodToken } = await import("@/lib/ifood-api");
      const token = await getIfoodToken();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const disputeId = order.cancelDispute.disputeId;

      // iFood Handshake Dispute API
      const handshakeUrl = `https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}/handshake/dispute/${disputeId}`;

      if (action === "accept") {
        // Accept cancellation via handshake
        const r = await fetch(handshakeUrl, {
          method: "PUT", headers,
          body: JSON.stringify({ resolution: "ACCEPTED" }),
        });
        console.log(`[iFood Dispute] ACCEPT handshake ${order.ifoodOrderId} dispute=${disputeId}: ${r.status} ${await r.text().catch(() => "")}`);

        // Fallback: try acceptCancellation if handshake fails
        if (!r.ok) {
          const r2 = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}/acceptCancellation`, { method: "POST", headers });
          console.log(`[iFood Dispute] ACCEPT fallback ${order.ifoodOrderId}: ${r2.status}`);
        }
      } else if (action === "deny") {
        // Deny cancellation via handshake
        const r = await fetch(handshakeUrl, {
          method: "PUT", headers,
          body: JSON.stringify({ resolution: "REJECTED", reason: denyReason || "Pedido já em andamento" }),
        });
        console.log(`[iFood Dispute] DENY handshake ${order.ifoodOrderId} dispute=${disputeId}: ${r.status} ${await r.text().catch(() => "")}`);

        // Fallback
        if (!r.ok) {
          const r2 = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}/denyCancellation`, {
            method: "POST", headers,
            body: JSON.stringify({ reason: denyReason || "Pedido já em andamento" }),
          });
          console.log(`[iFood Dispute] DENY fallback ${order.ifoodOrderId}: ${r2.status}`);
        }
      }
    } catch (err: any) {
      console.error(`[iFood Dispute] Erro:`, err?.message);
    }
  }

  // Update local database
  const dispute = order.cancelDispute || {};
  if (action === "accept") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        status: "CANCELADO",
        cancelledBy: "CUSTOMER",
        motoboyId: null,
        cancelDispute: { ...dispute, pending: false, resolved: "accepted", resolvedAt: new Date().toISOString() },
      } as any,
    });
  } else {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, resolved: "denied", resolvedAt: new Date().toISOString(), denyReason },
      } as any,
    });
  }

  return NextResponse.json({ success: true, action });
}
