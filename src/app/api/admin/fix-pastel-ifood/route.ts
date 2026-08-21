import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getIfoodToken, getIfoodItemUnitPrice } from "@/lib/ifood-api";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { parseOrderPaymentInfo } from "@/lib/payment-parser";

const PASTEL_EMAIL = "pasteldapaulistamacae21@gmail.com";
const PASTEL_MERCHANT_ID = "6a5fb96d-68bd-46af-ada4-456a9a160787";

export async function GET() {
  const log: string[] = [];

  try {
    // 1. Atribuir merchantId
    const user = await prisma.user.findUnique({
      where: { email: PASTEL_EMAIL },
      select: { id: true, ifoodMerchantId: true, ifoodConnected: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    log.push(`Usuário: ${user.id}, merchantId atual: ${user.ifoodMerchantId}, connected: ${user.ifoodConnected}`);

    await prisma.user.update({
      where: { email: PASTEL_EMAIL },
      data: { ifoodMerchantId: PASTEL_MERCHANT_ID, ifoodConnected: true },
    });
    log.push(`✅ merchantId ${PASTEL_MERCHANT_ID} salvo`);

    try {
      await prisma.ifoodIntegration.upsert({
        where: { userId_merchantId: { userId: user.id, merchantId: PASTEL_MERCHANT_ID } },
        create: { userId: user.id, label: "Pastel da Paulista - Macaé", merchantId: PASTEL_MERCHANT_ID, connected: true, active: true },
        update: { connected: true, active: true },
      });
      log.push(`✅ IfoodIntegration record criado`);
    } catch (e: any) {
      log.push(`⚠️ IfoodIntegration: ${e.message}`);
    }

    // 2. Puxar eventos
    const token = await getIfoodToken();
    let importedCount = 0;
    let totalEvents = 0;

    for (let round = 0; round < 10; round++) {
      const evRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!evRes.ok) { log.push(`❌ polling HTTP ${evRes.status}`); break; }

      const evText = await evRes.text();
      const events = evText ? JSON.parse(evText) : [];
      if (events.length === 0) { log.push(`ℹ️ Fila vazia rodada ${round}`); break; }

      totalEvents += events.length;
      log.push(`📥 Rodada ${round}: ${events.length} evento(s)`);

      const myEvents = events.filter((e: any) =>
        e.merchantId === PASTEL_MERCHANT_ID && e.orderId &&
        (e.fullCode?.includes("PLC") || e.fullCode?.includes("CFM") || e.code === "PLACED" || e.code === "CONFIRMED")
      );

      for (const event of myEvents) {
        const exists = await prisma.customerOrder.findFirst({ where: { ifoodOrderId: event.orderId } as any });
        if (exists) { log.push(`⏭️ ${event.orderId} já existe`); continue; }

        try {
          const orderRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${event.orderId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!orderRes.ok) { log.push(`❌ Order ${event.orderId}: ${orderRes.status}`); continue; }
          const orderData = await orderRes.json();

          const items = (orderData.items || []).map((i: any) => ({
            price: getIfoodItemUnitPrice(i),
            quantity: i.quantity ?? 1,
            comboSelections: (i.options || i.subItems || []).length > 0
              ? JSON.stringify((i.options || i.subItems || []).map((s: any) => ({ name: s.name || "", quantity: s.quantity || 1, price: s.price || s.unitPrice || 0 })))
              : null,
            menuProduct: {
              connectOrCreate: {
                where: { id: `ifood-${i.id || i.externalCode || "item"}` } as any,
                create: { id: `ifood-${i.id || i.externalCode || "item"}`, franchiseeId: user.id, name: i.name || "Item iFood", description: "", price: getIfoodItemUnitPrice(i), category: "iFood", active: false } as any,
              } as any,
            },
          }));

          const total = typeof orderData.total === "object" ? (orderData.total?.orderAmount ?? 0) : (orderData.totalPrice ?? 0);
          const deliveryFee = orderData.total?.deliveryFee ?? orderData.deliveryFee ?? 0;
          const parsedPay = parseOrderPaymentInfo(orderData, "IFOOD");
          const customer = orderData.customer || {};
          const addr = orderData.delivery?.deliveryAddress;
          const addressStr = addr ? [addr.formattedAddress || `${addr.streetName || ""}, ${addr.streetNumber || ""}`, addr.complement, addr.neighborhood, addr.city].filter(Boolean).join(" - ") : "";

          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: user.id,
              dailyOrderNumber: await generateDailyOrderNumber(user.id),
              ifoodOrderId: event.orderId,
              ifoodReference: orderData.displayId ?? undefined,
              source: "IFOOD",
              customerName: customer.name ?? "Cliente iFood",
              customerPhone: customer.phone?.number ?? "",
              customerAddress: addressStr,
              deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
              paymentMethod: parsedPay.paymentMethod,
              totalAmount: total,
              deliveryFee,
              status: "NOVO",
              createdAt: orderData.createdAt ? new Date(orderData.createdAt) : new Date(),
              items: { create: items },
            },
          });
          importedCount++;
          log.push(`📦 Pedido ${event.orderId} (${orderData.displayId}) importado! ${customer.name}`);
        } catch (orderErr: any) {
          log.push(`⚠️ Erro ${event.orderId}: ${orderErr.message}`);
        }
      }

      // Ack todos eventos
      const ackPayload = events.filter((e: any) => e.id).map((e: any) => ({ id: e.id }));
      if (ackPayload.length > 0) {
        await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(ackPayload),
        });
        log.push(`✅ ${ackPayload.length} eventos acked`);
      }
    }

    return NextResponse.json({ ok: true, merchantId: PASTEL_MERCHANT_ID, totalEvents, importedOrders: importedCount, log });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, log }, { status: 500 });
  }
}
