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

  // Sync with iFood
  if (order.ifoodOrderId) {
    try {
      const { getIfoodToken } = await import("@/lib/ifood-api");
      const token = await getIfoodToken();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const baseUrl = `https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}`;

      if (action === "accept") {
        const r = await fetch(`${baseUrl}/acceptCancellation`, { method: "POST", headers });
        console.log(`[iFood Dispute] acceptCancellation ${order.ifoodOrderId}: ${r.status}`);
      } else if (action === "deny") {
        const r = await fetch(`${baseUrl}/denyCancellation`, {
          method: "POST", headers,
          body: JSON.stringify({ reason: denyReason || "Pedido já em andamento" }),
        });
        console.log(`[iFood Dispute] denyCancellation ${order.ifoodOrderId}: ${r.status}`);
      }
    } catch (err: any) {
      console.error(`[iFood Dispute] Erro:`, err?.message);
    }
  }

  // Update local database
  if (action === "accept") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        status: "CANCELADO",
        cancelledBy: "CUSTOMER",
        motoboyId: null,
        cancelDispute: { pending: false, resolved: "accepted", resolvedAt: new Date().toISOString() },
      } as any,
    });
  } else {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { pending: false, resolved: "denied", resolvedAt: new Date().toISOString(), denyReason },
      } as any,
    });
  }

  return NextResponse.json({ success: true, action });
}
