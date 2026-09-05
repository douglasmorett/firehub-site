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

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true }
  });
  if (!currentUser) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const targetFranchiseeId = currentUser.ownerId || currentUser.id;
  const role = (session.user as any)?.role;

  if (role !== "ADMIN" && order.franchiseeId !== targetFranchiseeId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Sync with iFood using Disputes API
  let ifoodResult = "no_ifood";
  if (order.ifoodOrderId) {
    try {
      // Com a credencial do DONO do pedido: o token central só alcança a
      // Hakim, e nas outras lojas a disputa era respondida com um 403 que
      // ninguém via — o cliente ficava sem resposta no iFood.
      const { chamarPeloPedido } = await import("@/lib/ifood-pedido");
      const disputeId = order.cancelDispute?.disputeId;
      const base = "/order/v1.0";
      const post = (path: string, corpo: unknown = {}) =>
        chamarPeloPedido(order, path, { method: "POST", body: JSON.stringify(corpo) }, "iFood Dispute");

      if (action === "update_delivery_time") {
        const { additionalMinutes = 10, reason = "OUT_FOR_DELIVERY" } = body;
        if (disputeId) {
          const r = await post(`${base}/disputes/${disputeId}/accept`, { additionalMinutes, reason });
          ifoodResult = `disputes_accept_time:${r.status}`;
        } else {
          const r = await post(`${base}/orders/${order.ifoodOrderId}/updateEta`, { additionalMinutes });
          ifoodResult = `updateEta:${r.status}`;
        }
      } else if (action === "deny_delivery") {
        if (disputeId) {
          const r = await post(`${base}/disputes/${disputeId}/reject`, { reason: "CANNOT_DELIVER" });
          ifoodResult = `disputes_reject_time:${r.status}`;
        }
      } else if (action === "accept") {
        // Try Disputes API first (correct endpoint)
        if (disputeId) {
          const r = await post(`${base}/disputes/${disputeId}/accept`, { reason: "CUSTOMER_SATISFACTION" });
          ifoodResult = `disputes_accept:${r.status}`;

          if (!r.ok) {
            const r2 = await post(`${base}/orders/${order.ifoodOrderId}/acceptCancellation`);
            ifoodResult += `,fallback:${r2.status}`;
          }
        } else {
          const r = await post(`${base}/orders/${order.ifoodOrderId}/acceptCancellation`);
          ifoodResult = `acceptCancellation:${r.status}`;
        }
      } else if (action === "deny") {
        const reason = denyReason || "Pedido já em andamento";
        if (disputeId) {
          const r = await post(`${base}/disputes/${disputeId}/reject`, { reason });
          ifoodResult = `disputes_reject:${r.status}`;

          if (!r.ok) {
            const r2 = await post(`${base}/orders/${order.ifoodOrderId}/denyCancellation`, { reason });
            ifoodResult += `,fallback:${r2.status}`;
          }
        } else {
          const r = await post(`${base}/orders/${order.ifoodOrderId}/denyCancellation`, { reason });
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
        cancelDispute: { ...dispute, pending: false, resolved: "accepted", resolvedAt: new Date().toISOString(), ifoodResult },
      } as any,
    });
  } else if (action === "update_delivery_time") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, resolved: "accepted_time_update", resolvedAt: new Date().toISOString(), ifoodResult },
      } as any,
    });
  } else if (action === "deny_delivery") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, resolved: "denied_delivery", resolvedAt: new Date().toISOString(), ifoodResult },
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
