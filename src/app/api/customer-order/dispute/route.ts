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

  // Sync with iFood using Disputes API
  let ifoodResult = "no_ifood";
  if (order.ifoodOrderId) {
    try {
      const { getIfoodToken } = await import("@/lib/ifood-api");
      const token = await getIfoodToken();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const disputeId = order.cancelDispute?.disputeId;
      const baseUrl = "https://merchant-api.ifood.com.br/order/v1.0";

      if (action === "accept") {
        // Try Disputes API first (correct endpoint)
        if (disputeId) {
          const r = await fetch(`${baseUrl}/disputes/${disputeId}/accept`, {
            method: "POST", headers,
            body: JSON.stringify({ reason: "CUSTOMER_SATISFACTION" }),
          });
          const respText = await r.text().catch(() => "");
          console.log(`[iFood Dispute] ACCEPT disputes/${disputeId}/accept: ${r.status} ${respText}`);
          ifoodResult = `disputes_accept:${r.status}`;

          if (!r.ok) {
            // Fallback: try acceptCancellation
            const r2 = await fetch(`${baseUrl}/orders/${order.ifoodOrderId}/acceptCancellation`, { method: "POST", headers });
            console.log(`[iFood Dispute] ACCEPT fallback acceptCancellation: ${r2.status}`);
            ifoodResult += `,fallback:${r2.status}`;
          }
        } else {
          // No disputeId — use acceptCancellation directly
          const r = await fetch(`${baseUrl}/orders/${order.ifoodOrderId}/acceptCancellation`, { method: "POST", headers });
          console.log(`[iFood Dispute] ACCEPT acceptCancellation (no disputeId): ${r.status}`);
          ifoodResult = `acceptCancellation:${r.status}`;
        }
      } else if (action === "deny") {
        const reason = denyReason || "Pedido já em andamento";
        // Try Disputes API first
        if (disputeId) {
          const r = await fetch(`${baseUrl}/disputes/${disputeId}/reject`, {
            method: "POST", headers,
            body: JSON.stringify({ reason }),
          });
          const respText = await r.text().catch(() => "");
          console.log(`[iFood Dispute] DENY disputes/${disputeId}/reject: ${r.status} ${respText}`);
          ifoodResult = `disputes_reject:${r.status}`;

          if (!r.ok) {
            // Fallback: try denyCancellation
            const r2 = await fetch(`${baseUrl}/orders/${order.ifoodOrderId}/denyCancellation`, {
              method: "POST", headers,
              body: JSON.stringify({ reason }),
            });
            console.log(`[iFood Dispute] DENY fallback denyCancellation: ${r2.status}`);
            ifoodResult += `,fallback:${r2.status}`;
          }
        } else {
          const r = await fetch(`${baseUrl}/orders/${order.ifoodOrderId}/denyCancellation`, {
            method: "POST", headers,
            body: JSON.stringify({ reason }),
          });
          console.log(`[iFood Dispute] DENY denyCancellation (no disputeId): ${r.status}`);
          ifoodResult = `denyCancellation:${r.status}`;
        }
      }
    } catch (err: any) {
      console.error(`[iFood Dispute] Erro:`, err?.message);
      ifoodResult = `error:${err?.message}`;
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
        cancelDispute: { ...dispute, pending: false, resolved: "accepted", resolvedAt: new Date().toISOString(), ifoodResult },
      } as any,
    });
  } else {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, resolved: "denied", resolvedAt: new Date().toISOString(), denyReason, ifoodResult },
      } as any,
    });
  }

  return NextResponse.json({ success: true, action, ifoodResult });
}
