import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/cron/ifood-poll
 * Vercel Cron Job — runs every minute to poll iFood events.
 * Ensures orders are never missed, even when no dashboard is open.
 * 
 * Protected by CRON_SECRET to prevent unauthorized access.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30; // Allow up to 30s for processing

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron jobs)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  
  // In production, verify the secret. Allow in dev mode.
  if (process.env.NODE_ENV !== "development") {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startTime = Date.now();
  const log: string[] = [];

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");
    const merchantId = process.env.IFOOD_MERCHANT_UUID;
    
    if (!merchantId) {
      log.push("❌ IFOOD_MERCHANT_UUID não configurado");
      return NextResponse.json({ ok: false, log });
    }

    // Get token
    let token: string;
    try {
      token = await getIfoodToken();
      log.push("✅ Token obtido");
    } catch (err: any) {
      log.push(`❌ Token falhou: ${err.message}`);
      return NextResponse.json({ ok: false, log });
    }

    // Poll events from iFood
    const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log.push(`❌ events:polling falhou: ${res.status} ${res.statusText} — ${errBody.slice(0, 200)}`);
      return NextResponse.json({ ok: false, log });
    }

    const eventsText = await res.text();
    const events = eventsText ? JSON.parse(eventsText) : [];
    log.push(`📥 ${events.length} evento(s) recebido(s)`);

    if (!events || events.length === 0) {
      return NextResponse.json({ ok: true, events: 0, log, durationMs: Date.now() - startTime });
    }

    // Process events
    const processedEventIds: { id: string; orderId: string; eventType: string }[] = [];
    let created = 0;
    let updated = 0;

    for (const event of events) {
      try {
        const { code, orderId, merchantId } = event;
        if (!orderId) continue;

        const isPlaced = code === "PLC" || event.fullCode === "PLACED";
        const isConfirmed = code === "CFM" || event.fullCode === "CONFIRMED";
        const isPreparation = code === "PRP" || event.fullCode === "IN_PREPARATION" || event.fullCode === "PREPARATION_STARTED";
        const isReadyPickup = code === "RTP" || event.fullCode === "READY_TO_PICKUP";
        const isDispatched = code === "DSP" || event.fullCode === "DISPATCHED";
        const isConcluded = code === "CON" || event.fullCode === "CONCLUDED";
        const isCancelled = code === "CAN" || event.fullCode === "CANCELLED";
        const isCancellationRequest = code === "HSD" || code === "CRR" || event.fullCode === "HANDSHAKE_DISPUTE" || event.fullCode === "CANCELLATION_REQUESTED";

        log.push(`  📋 Evento: code=${code}, fullCode=${event.fullCode}, orderId=${orderId}`);

        // Handle cancellation REQUEST (negotiation)
        if (isCancellationRequest) {
          const meta = event.metadata || {};
          if (meta.action === "CANCELLATION" || code === "CRR") {
            const disputeData = {
              pending: true,
              disputeId: meta.disputeId || "",
              reason: meta.message || meta.cancelCodeDescription || "Cliente solicitou cancelamento",
              handshakeType: meta.handshakeType || "",
              expiresAt: meta.expiresAt || "",
              requestedAt: meta.createdAt || new Date().toISOString(),
            };
            await (prisma.customerOrder as any).updateMany({
              where: { ifoodOrderId: orderId } as any,
              data: { cancelDispute: disputeData },
            });
            log.push(`  ⚠️ Negociação: ${orderId} — disputeId=${meta.disputeId}, motivo="${meta.message}"`);
            if (event.id) {
              processedEventIds.push({
                id: event.id,
                orderId: event.orderId || "",
                eventType: event.fullCode || event.code || "",
              });
            }
            continue;
          }
        }

        if (isCancelled) {
          const existingOrder: any = await prisma.customerOrder.findFirst({
            where: { ifoodOrderId: orderId } as any,
            select: { cancelledBy: true } as any,
          });
          const cancelData: any = { status: "CANCELADO" };
          if (!existingOrder?.cancelledBy || existingOrder.cancelledBy !== "LOJA") {
            cancelData.cancelledBy = "IFOOD";
          }
          await (prisma.customerOrder as any).updateMany({
            where: { ifoodOrderId: orderId } as any,
            data: cancelData,
          });
          log.push(`  🚫 Cancelado: ${orderId}`);
          if (event.id) {
            processedEventIds.push({
              id: event.id,
              orderId: event.orderId || "",
              eventType: event.fullCode || event.code || "",
            });
          }
          continue;
        }

        // Check if order exists
        const exists = await prisma.customerOrder.findFirst({
          where: { ifoodOrderId: orderId } as any,
        });

        if (!exists) {
          // Fetch order details
          const orderRes = await fetch(
            `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          if (!orderRes.ok) {
            log.push(`  ⚠️ Detalhes do pedido ${orderId} falhou: ${orderRes.status}`);
            continue;
          }

          const orderData = await orderRes.json();

          const eventMerchantId = merchantId || orderData.merchant?.id;
          const eventFranchisee = await prisma.user.findFirst({
            where: { ifoodMerchantId: eventMerchantId } as any,
          });
          if (!eventFranchisee) {
            log.push(`  ❌ Nenhum franqueado encontrado para merchantId: ${eventMerchantId} no pedido ${orderId}`);
            continue;
          }

          // Extract items
          const items = (orderData.items ?? []).map((i: any) => ({
            price: i.unitPrice ?? i.price ?? 0,
            quantity: i.quantity ?? 1,
            menuProduct: {
              connectOrCreate: {
                where: { id: `ifood-${i.id}` } as any,
                create: {
                  id: `ifood-${i.id}`,
                  franchiseeId: eventFranchisee.id,
                  name: i.name ?? "Item iFood",
                  description: "",
                  price: i.unitPrice ?? i.price ?? 0,
                  category: "iFood",
                  active: true,
                } as any,
              } as any,
            },
          }));

          const total = typeof orderData.total === "object"
            ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
            : (orderData.totalPrice ?? orderData.total ?? 0);

          const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
          const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

          const deliveryFeeValue = orderData.total?.deliveryFee
            ?? orderData.delivery?.deliveryFee
            ?? orderData.deliveryFee
            ?? 0;

          const rawScheduled = orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime
            ? orderData.scheduledDatetime
            : orderData.schedule?.scheduledDatetimeEnd
              ?? orderData.schedule?.scheduledDatetimeStart
              ?? (orderData.orderTiming === "SCHEDULED" && orderData.preparationStartDateTime
                ? orderData.preparationStartDateTime : null);

          const scheduledDatetime = rawScheduled ? new Date(rawScheduled) : null;

          if (orderData.orderTiming === "SCHEDULED" || orderData.schedule) {
            log.push(`  📅 Scheduling: orderTiming=${orderData.orderTiming}, scheduledDatetime=${orderData.scheduledDatetime}, schedule=${JSON.stringify(orderData.schedule)}, resolved=${scheduledDatetime?.toISOString()}`);
          }

          const deliveryDeadline = !scheduledDatetime && orderData.delivery?.deliveryDateTime
            ? new Date(orderData.delivery.deliveryDateTime)
            : null;

          const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

          const cashPayment = paymentList.find((p: any) =>
            p.method === "CASH" || p.name?.toLowerCase().includes("dinheir")
          );
          const changeAmount = cashPayment?.changeFor ?? cashPayment?.cash?.changeFor ?? null;
          const payMethodName = paymentList[0]?.method ?? "iFood Online";
          const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? null;

          // Descontos
          const benefits = orderData.benefits ?? [];
          let discountIfood = 0, discountMerchant = 0, discountTotal = 0;
          const discountDetails: any[] = [];

          for (const benefit of benefits) {
            const value = benefit.value ?? 0;
            discountTotal += value;
            const sponsorships = Array.isArray(benefit.sponsorshipValues)
              ? benefit.sponsorshipValues
              : benefit.sponsorshipValues ? [benefit.sponsorshipValues] : [];
            let bIfood = 0, bMerchant = 0;
            for (const sp of sponsorships) {
              const spName = (sp.name ?? sp.sponsorship ?? "").toUpperCase();
              const spValue = sp.value ?? 0;
              if (spName === "IFOOD" || spName === "PARTNER" || spName === "EXTERNAL") bIfood += spValue;
              else if (spName === "MERCHANT") bMerchant += spValue;
              else bIfood += spValue;
            }
            if (sponsorships.length === 0 && value > 0) {
              if ((benefit.sponsorship ?? "").toUpperCase() === "MERCHANT") bMerchant += value;
              else bIfood += value;
            }
            discountIfood += bIfood;
            discountMerchant += bMerchant;
            discountDetails.push({ target: benefit.target ?? "CART", value, ifood: bIfood, merchant: bMerchant, description: benefit.campaign?.name ?? benefit.description ?? null });
          }

          const notesArr = [
            `Pedido iFood #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
            scheduledDatetime ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString("pt-BR")}` : null,
            discountTotal > 0 ? `🏷️ Desconto R$${discountTotal.toFixed(2)} (iFood: R$${discountIfood.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : null,
            customerNote ? `💬 ${customerNote}` : null,
          ].filter(Boolean).join(" | ");

          let initialStatus = "NOVO";
          if (isConfirmed) initialStatus = "ACEITO";
          else if (isPreparation) initialStatus = "PREPARANDO";
          else if (isReadyPickup) initialStatus = "PREPARANDO";
          else if (isDispatched) initialStatus = "SAIU_ENTREGA";
          else if (isConcluded) initialStatus = "ENTREGUE";

          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: eventFranchisee.id,
              ifoodOrderId: orderId,
              ifoodReference: orderData.displayId ?? undefined,
              scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
              changeAmount,
              customerCpfCnpj,
              discountTotal: discountTotal > 0 ? discountTotal : null,
              discountIfood: discountIfood > 0 ? discountIfood : null,
              discountMerchant: discountMerchant > 0 ? discountMerchant : null,
              discountDetails: discountDetails.length > 0 ? discountDetails : undefined,
              source: "IFOOD",
              customerName: orderData.customer?.name ?? "Cliente iFood",
              customerPhone: (() => {
                const phone = orderData.customer?.phone;
                const number = phone?.number ?? (typeof phone === 'string' ? phone : '');
                const localizer = phone?.localizer;
                return localizer ? `${number} ID: ${localizer}` : number;
              })(),
              customerAddress: orderData.delivery?.deliveryAddress?.formattedAddress ?? "",
              deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
              paymentMethod: cashPayment ? "Dinheiro" : payMethodName,
              totalAmount: total,
              deliveryFee: deliveryFeeValue,
              status: initialStatus,
              notes: notesArr,
              createdAt: orderData.createdAt ? new Date(orderData.createdAt) : undefined,
              items: { create: items },
            },
          });

          log.push(`  ✅ Pedido CRIADO: ${orderId} (status: ${initialStatus})`);
          created++;

          // Auto-confirm
          if (isPlaced) {
            await fetch(
              `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`,
              { method: "POST", headers: { Authorization: `Bearer ${token}` } }
            );
            log.push(`  ✅ Auto-confirmado: ${orderId}`);
          }
        } else {
          // Update existing order status
          let newStatus: string | null = null;
          if (isConfirmed) newStatus = "ACEITO";
          else if (isPreparation) newStatus = "PREPARANDO";
          else if (isReadyPickup) newStatus = "PREPARANDO";
          else if (isDispatched) newStatus = "SAIU_ENTREGA";
          else if (isConcluded) newStatus = "ENTREGUE";

          if (newStatus) {
            const updateData: any = { status: newStatus };
            if (isConcluded) {
              updateData.ifoodDriverStatus = "CONCLUDED";
            }
            await (prisma.customerOrder as any).updateMany({
              where: { ifoodOrderId: orderId } as any,
              data: updateData,
            });
            log.push(`  🔄 Status atualizado: ${orderId} → ${newStatus}`);
            updated++;
          }
        }

        if (event.id) {
          processedEventIds.push({
            id: event.id,
            orderId: event.orderId || "",
            eventType: event.fullCode || event.code || "",
          });
        }
      } catch (err: any) {
        log.push(`  ❌ Erro: ${err.message}`);
      }
    }

    // Acknowledge processed events
    if (processedEventIds.length > 0) {
      await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(processedEventIds),
      });
      log.push(`✅ ${processedEventIds.length} eventos acknowledged`);
    }

    return NextResponse.json({
      ok: true,
      events: events.length,
      created,
      updated,
      acknowledged: processedEventIds.length,
      durationMs: Date.now() - startTime,
      log,
    });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    console.error("[iFood Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
