import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// Throttle iFood polling — max once every 10s across all requests
let lastIfoodPoll = 0;

async function pollIfoodEvents() {
  const now = Date.now();
  if (now - lastIfoodPoll < 10_000) return; // Skip if polled less than 10s ago
  lastIfoodPoll = now;

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");
    const merchantId = process.env.IFOOD_MERCHANT_UUID;
    if (!merchantId) return;

    const token = await getIfoodToken();

    // Poll events from iFood
    const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const events = await res.json();
    if (!events || events.length === 0) return;

    // Find franchisee for this merchant
    let franchisee = await prisma.user.findFirst({
      where: { ifoodMerchantId: merchantId } as any,
    });
    if (!franchisee) {
      franchisee = await prisma.user.findFirst({ where: { role: "FRANCHISEE" } as any });
    }

    // Process each event
    for (const event of events) {
      try {
        const { code, orderId } = event;
        if (!orderId) continue;

        if (code === "PLC" || event.fullCode === "PLACED") {
          // Check idempotency
          const exists = await prisma.customerOrder.findFirst({
            where: { ifoodOrderId: orderId } as any,
          });
          if (exists) continue;

          // Fetch order details
          const orderRes = await fetch(
            `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!orderRes.ok) continue;
          const orderData = await orderRes.json();

          if (!franchisee) continue;

          // Extract items
          const items = (orderData.items ?? []).map((i: any) => ({
            price: i.unitPrice ?? i.price ?? 0,
            quantity: i.quantity ?? 1,
            menuProduct: {
              connectOrCreate: {
                where: { id: `ifood-${i.id}` } as any,
                create: {
                  id: `ifood-${i.id}`,
                  franchiseeId: franchisee.id,
                  name: i.name ?? "Item iFood",
                  description: "",
                  price: i.unitPrice ?? i.price ?? 0,
                  category: "iFood",
                  active: true,
                } as any,
              } as any,
            },
          }));

          // Extract total
          const total = typeof orderData.total === "object"
            ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
            : (orderData.totalPrice ?? orderData.total ?? 0);

          // Extract payments
          const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
          const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];
          const cashPayment = paymentList.find((p: any) => p.method === "CASH");
          const payMethodName = paymentList[0]?.method ?? "iFood Online";

          const customerNote = orderData.delivery?.observations ?? null;
          const notesArr = [
            `Pedido iFood #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
            customerNote ? `💬 ${customerNote}` : null,
          ].filter(Boolean).join(" | ");

          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchisee.id,
              ifoodOrderId: orderId,
              ifoodReference: orderData.displayId ?? undefined,
              source: "IFOOD",
              customerName: orderData.customer?.name ?? "Cliente iFood",
              customerPhone: orderData.customer?.phone?.number ?? orderData.customer?.phone ?? "",
              customerAddress: orderData.delivery?.deliveryAddress?.formattedAddress ?? "",
              deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
              paymentMethod: cashPayment ? "Dinheiro" : payMethodName,
              totalAmount: total,
              status: "NOVO",
              notes: notesArr,
              items: { create: items },
            },
          });
          console.log(`[iFood Poll] ✅ Pedido ${orderId} criado`);

          // Auto-confirm to iFood
          await fetch(
            `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`,
            { method: "POST", headers: { Authorization: `Bearer ${token}` } }
          );
        }

        // Handle cancellations
        if (code === "CAN" || event.fullCode === "CANCELLED") {
          await (prisma.customerOrder as any).updateMany({
            where: { ifoodOrderId: orderId } as any,
            data: { status: "CANCELADO", cancelledBy: "IFOOD" },
          });
        }
      } catch (err) {
        console.error("[iFood Poll] Erro:", err);
      }
    }

    // Acknowledge events
    const eventIds = events.map((e: any) => e.id);
    if (eventIds.length > 0) {
      await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(eventIds.map((id: string) => ({ id }))),
      });
    }
  } catch (err) {
    console.error("[iFood Poll] Erro geral:", err);
  }
}

// GET: Fast polling endpoint - returns orders + auto-polls iFood
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true }
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Poll iFood events in background (throttled to every 10s)
  pollIfoodEvents().catch(() => {});

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id },
    include: { items: { include: { menuProduct: { select: { id: true, name: true, cost: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return NextResponse.json(orders);
}
