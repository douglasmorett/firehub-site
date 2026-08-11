import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/ifood-drain
 * 
 * Rota de EMERGÊNCIA para drenar todos os eventos pendentes do iFood,
 * importar pedidos cancelados para o banco de dados e limpar a fila.
 * 
 * Isso é necessário quando o sistema ficou fora do ar e pedidos se acumularam
 * no iFood sem serem confirmados/processados.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const log: string[] = [];
  const startTime = Date.now();

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");

    // Find franchisee
    const franchisee = await prisma.user.findFirst({
      where: { email: { contains: "hakim", mode: "insensitive" } },
      select: { id: true, storeName: true, ifoodMerchantId: true },
    });
    if (!franchisee?.ifoodMerchantId) {
      return NextResponse.json({ error: "Franchisee or ifoodMerchantId not found" }, { status: 404 });
    }
    const merchantId = franchisee.ifoodMerchantId;
    log.push(`👤 Franchisee: ${franchisee.storeName} (${franchisee.id})`);

    // Get token
    let token: string;
    try {
      token = await getIfoodToken();
      log.push("✅ Token obtido");
    } catch (err: any) {
      log.push(`❌ Token falhou: ${err.message}`);
      return NextResponse.json({ ok: false, log }, { status: 500 });
    }

    // Drain ALL events in a loop
    let totalDrained = 0;
    let totalCreated = 0;
    let totalCancelled = 0;
    let round = 0;

    while (round < 30) {
      round++;
      log.push(`\n--- Rodada ${round} ---`);

      const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        log.push(`❌ Polling falhou: ${res.status}`);
        break;
      }

      const text = await res.text();
      const events = text ? JSON.parse(text) : [];
      log.push(`📥 ${events.length} evento(s)`);

      if (!events || events.length === 0) {
        log.push("✅ Fila VAZIA!");
        break;
      }

      // Process each event
      for (const event of events) {
        try {
          const { code, orderId } = event;
          if (!orderId) continue;

          const isPlaced = code === "PLC" || event.fullCode === "PLACED";
          const isCancelled = code === "CAN" || event.fullCode === "CANCELLED";
          const isConfirmed = code === "CFM" || event.fullCode === "CONFIRMED";

          // Check if order already exists
          const existing = await prisma.customerOrder.findFirst({
            where: { ifoodOrderId: orderId },
          });

          if (isPlaced && !existing) {
            // Fetch order details from iFood
            let orderData: any = null;
            try {
              const detailRes = await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (detailRes.ok) {
                orderData = await detailRes.json();
              }
            } catch {}

            if (orderData) {
              const items = (orderData.items || []).map((item: any) => ({
                name: item.name || "Item",
                quantity: item.quantity || 1,
                unitPrice: (item.unitPrice || item.price || 0) / 100,
                totalPrice: (item.totalPrice || item.price || 0) / 100,
                externalCode: item.externalCode || item.id || "",
                observations: item.observations || "",
              }));

              const totalAmount = (orderData.total?.orderAmount || orderData.totalPrice || 0) / 100;
              const deliveryFee = (orderData.total?.deliveryFee || orderData.deliveryFee || 0) / 100;

              const customer = orderData.customer || {};
              const deliveryAddress = orderData.delivery?.deliveryAddress || {};
              const addressStr = [
                deliveryAddress.streetName,
                deliveryAddress.streetNumber,
                deliveryAddress.complement,
                deliveryAddress.neighborhood,
                deliveryAddress.city,
              ].filter(Boolean).join(", ");

              await prisma.customerOrder.create({
                data: {
                  franchiseeId: franchisee.id,
                  ifoodOrderId: orderId,
                  ifoodReference: orderData.displayId || orderData.shortReference || "",
                  customerName: customer.name || "Cliente iFood",
                  customerPhone: customer.phone?.number || "",
                  customerAddress: addressStr || "",
                  deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "ENTREGA",
                  paymentMethod: orderData.payments?.[0]?.name || "iFood Online",
                  totalAmount,
                  deliveryFee,
                  source: "IFOOD",
                  status: "CANCELADO", // Already cancelled
                  cancelledBy: "IFOOD_AUTO",
                  cancelReason: "Pedido não confirmado a tempo (sistema fora do ar)",
                  notes: "Importado retroativamente - pedido cancelado por timeout",
                  kdsProductionAt: new Date(),
                  createdAt: orderData.createdAt ? new Date(orderData.createdAt) : undefined,
                  items: { create: items },
                },
              });
              totalCreated++;
              log.push(`  📦 IMPORTADO: ${orderId} (R$ ${totalAmount.toFixed(2)}) → CANCELADO`);
            }
          } else if (isCancelled && existing && existing.status !== "CANCELADO") {
            // Update existing order to cancelled
            await prisma.customerOrder.updateMany({
              where: { ifoodOrderId: orderId },
              data: {
                status: "CANCELADO",
                cancelledBy: "IFOOD_AUTO",
                cancelReason: "Cancelado automaticamente pelo iFood - não confirmado a tempo",
              },
            });
            totalCancelled++;
            log.push(`  ❌ CANCELADO no DB: ${orderId}`);
          } else if (isCancelled && !existing) {
            // Order was cancelled but we never had it - try to fetch and import as cancelled
            let orderData: any = null;
            try {
              const detailRes = await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (detailRes.ok) {
                orderData = await detailRes.json();
              }
            } catch {}

            if (orderData) {
              const totalAmount = (orderData.total?.orderAmount || orderData.totalPrice || 0) / 100;
              const customer = orderData.customer || {};

              await prisma.customerOrder.create({
                data: {
                  franchiseeId: franchisee.id,
                  ifoodOrderId: orderId,
                  ifoodReference: orderData.displayId || orderData.shortReference || "",
                  customerName: customer.name || "Cliente iFood",
                  customerPhone: customer.phone?.number || "",
                  customerAddress: "",
                  deliveryType: "ENTREGA",
                  paymentMethod: orderData.payments?.[0]?.name || "iFood Online",
                  totalAmount,
                  deliveryFee: 0,
                  source: "IFOOD",
                  status: "CANCELADO",
                  cancelledBy: "IFOOD_AUTO",
                  cancelReason: "Pedido não confirmado a tempo (sistema fora do ar)",
                  notes: "Importado retroativamente - pedido cancelado por timeout",
                  kdsProductionAt: new Date(),
                  createdAt: orderData.createdAt ? new Date(orderData.createdAt) : undefined,
                  items: {
                    create: (orderData.items || []).map((item: any) => ({
                      name: item.name || "Item",
                      quantity: item.quantity || 1,
                      unitPrice: (item.unitPrice || item.price || 0) / 100,
                      totalPrice: (item.totalPrice || item.price || 0) / 100,
                      externalCode: item.externalCode || item.id || "",
                      observations: item.observations || "",
                    })),
                  },
                },
              });
              totalCreated++;
              log.push(`  📦 IMPORTADO (cancelado): ${orderId} (R$ ${totalAmount.toFixed(2)})`);
            }
          }
        } catch (err: any) {
          log.push(`  ⚠️ Erro processando evento: ${err.message}`);
        }
      }

      // Acknowledge ALL events
      const ackPayload = events
        .filter((e: any) => e.id)
        .map((e: any) => ({
          id: e.id,
          orderId: e.orderId || "",
          eventType: e.fullCode || e.code || "",
        }));

      if (ackPayload.length > 0) {
        await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(ackPayload),
        });
        totalDrained += ackPayload.length;
        log.push(`✅ ${ackPayload.length} eventos acknowledged`);
      }

      // Check elapsed time — stop before Vercel timeout
      if (Date.now() - startTime > 50000) {
        log.push("⏱️ Tempo limite atingido, parando...");
        break;
      }
    }

    // Try to check/clear interruptions
    log.push("\n--- Verificando interrupções da loja ---");
    try {
      const intRes = await fetch(
        `https://merchant-api.ifood.com.br/merchant/v1.0/merchants/${merchantId}/interruptions`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (intRes.ok) {
        const interruptions = await intRes.json();
        log.push(`🏪 ${Array.isArray(interruptions) ? interruptions.length : 0} interrupção(ões)`);
        if (Array.isArray(interruptions)) {
          for (const intr of interruptions) {
            if (intr.id) {
              const delRes = await fetch(
                `https://merchant-api.ifood.com.br/merchant/v1.0/merchants/${merchantId}/interruptions/${intr.id}`,
                { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
              );
              log.push(`  🗑️ Interrupção ${intr.id} removida: ${delRes.status}`);
            }
          }
        }
      }
    } catch (err: any) {
      log.push(`⚠️ Erro interrupções: ${err.message}`);
    }

    return NextResponse.json({
      ok: true,
      summary: {
        eventsDrained: totalDrained,
        ordersImported: totalCreated,
        ordersCancelled: totalCancelled,
        rounds: round,
        durationMs: Date.now() - startTime,
      },
      log,
    });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
