import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * GET /api/cron/ifood-poll
 * Cron Job — runs every minute to poll iFood events.
 * Ensures orders are never missed, even when no dashboard is open.
 * 
 * Protected by CRON_SECRET (bypass para chamadas internas do cron-runner).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30; // Allow up to 30s for processing

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const log: string[] = [];

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");

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
        const isDispute = code === "HSD" || code === "CRR" || code === "DDC" || event.fullCode === "HANDSHAKE_DISPUTE" || event.fullCode === "CANCELLATION_REQUESTED" || event.fullCode === "DUE_DATE_CHANGE_REQUESTED";

        log.push(`  📋 Evento: code=${code}, fullCode=${event.fullCode}, orderId=${orderId}`);

        // Handle cancellation or due date change REQUEST (negotiation)
        if (isDispute) {
          const meta = event.metadata || {};
          const actionType = (meta.action || meta.handshakeType || meta.type || event.fullCode || "").toUpperCase();
          const rawReason = meta.message || meta.cancelCodeDescription || meta.subCodeDescription || meta.reason || meta.description || "";
          
          let disputeType = "CANCELLATION";
          if (actionType.includes("DUE_DATE") || actionType.includes("PREDICTION") || code === "DDC") {
            disputeType = "DUE_DATE_CHANGE";
          } else if (actionType.includes("RESEND") || actionType.includes("REPLACEMENT") || actionType.includes("REENVIO") || /reenvio|reenviar|repor|substituir/i.test(rawReason)) {
            disputeType = "RESEND_ITEMS";
          } else if (actionType.includes("REFUND") || /reembolso|reembolsar/i.test(rawReason)) {
            disputeType = "REFUND_ITEMS";
          }

          const finalReason = rawReason || (
            disputeType === "DUE_DATE_CHANGE" ? "O pedido está atrasado. Quero uma nova previsão de entrega." :
            disputeType === "RESEND_ITEMS" ? "Cliente prefere o reenvio de itens pra resolver o problema." :
            disputeType === "REFUND_ITEMS" ? "Cliente solicitou reembolso de item." :
            "Cliente solicitou cancelamento do pedido pelo iFood."
          );

          const disputeData = {
            pending: true,
            disputeId: meta.disputeId || "",
            type: disputeType,
            reason: finalReason,
            customerName: meta.customerName || "",
            handshakeType: meta.handshakeType || actionType,
            expiresAt: meta.expiresAt || "",
            requestedAt: meta.createdAt || new Date().toISOString(),
          };
          await (prisma.customerOrder as any).updateMany({
            where: { ifoodOrderId: orderId } as any,
            data: { cancelDispute: disputeData },
          });
          log.push(`  ⚠️ Negociação (${disputeData.type}): ${orderId} — disputeId=${meta.disputeId}, motivo="${meta.message}"`);
          if (event.id) {
            processedEventIds.push({
              id: event.id,
              orderId: event.orderId || "",
              eventType: event.fullCode || event.code || "",
            });
          }
          continue;
        }

        if (isCancelled) {
          const existingOrder: any = await prisma.customerOrder.findFirst({
            where: { ifoodOrderId: orderId } as any,
            select: { id: true, cancelledBy: true } as any,
          });

          if (existingOrder) {
            // Pedido já existe — apenas atualizar status para CANCELADO
            const cancelData: any = { status: "CANCELADO" };
            if (!existingOrder.cancelledBy || existingOrder.cancelledBy !== "LOJA") {
              cancelData.cancelledBy = "IFOOD";
            }
            await (prisma.customerOrder as any).updateMany({
              where: { ifoodOrderId: orderId } as any,
              data: cancelData,
            });
            log.push(`  🚫 Cancelado (existente): ${orderId}`);
          } else {
            // Pedido NÃO existe no nosso DB — importar como CANCELADO
            // Isso acontece quando o sistema estava fora do ar e o iFood cancelou por timeout
            try {
              const cancelOrderRes = await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (cancelOrderRes.ok) {
                const cancelOrderData = await cancelOrderRes.json();
                let cancelFranchisee = merchantId
                  ? await prisma.user.findFirst({ where: { ifoodMerchantId: merchantId } as any })
                  : null;

                if (cancelFranchisee) {
                  const { getIfoodItemUnitPrice } = await import("@/lib/ifood-api");
                  const cancelItems = (cancelOrderData.items ?? []).map((i: any) => {
                    const subItemsList = i.options || i.subItems || i.garnishItems || i.items || [];
                    const comboSels = Array.isArray(subItemsList) && subItemsList.length > 0
                      ? JSON.stringify(subItemsList.map((s: any) => ({
                          name: s.name || s.label || s.productName || "",
                          quantity: s.quantity || 1,
                          price: s.price || s.unitPrice || s.addition || 0,
                        })))
                      : null;
                    const itemUnitPrice = getIfoodItemUnitPrice(i);
                    return {
                      price: itemUnitPrice,
                      quantity: i.quantity ?? 1,
                      comboSelections: comboSels,
                      menuProduct: {
                        connectOrCreate: {
                          where: { id: `ifood-${i.id}` } as any,
                          create: {
                            id: `ifood-${i.id}`,
                            franchiseeId: cancelFranchisee.id,
                            name: i.name ?? "Item iFood",
                            description: "",
                            price: itemUnitPrice,
                            category: "iFood",
                            active: true,
                          } as any,
                        } as any,
                      },
                    };
                  });

                  const cancelTotal = typeof cancelOrderData.total === "object"
                    ? (cancelOrderData.total?.orderAmount ?? cancelOrderData.total?.subTotal ?? 0)
                    : (cancelOrderData.totalPrice ?? cancelOrderData.total ?? 0);

                  const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
                  const cancelParsedPay = parseOrderPaymentInfo(cancelOrderData, "IFOOD");

                  const cancelMeta = event.metadata || {};
                  const cancelReason = cancelMeta.cancelCodeDescription
                    || cancelMeta.message
                    || cancelMeta.reason
                    || "Pedido cancelado automaticamente pelo iFood (não confirmado a tempo)";

                  await (prisma.customerOrder as any).create({
                    data: {
                      franchiseeId: cancelFranchisee.id,
                      ifoodOrderId: orderId,
                      ifoodReference: cancelOrderData.displayId ?? undefined,
                      source: "IFOOD",
                      customerName: cancelOrderData.customer?.name ?? "Cliente iFood",
                      customerPhone: (() => {
                        const phone = cancelOrderData.customer?.phone;
                        const number = phone?.number ?? (typeof phone === 'string' ? phone : '');
                        const localizer = phone?.localizer;
                        return localizer ? `${number} ID: ${localizer}` : number;
                      })(),
                      customerAddress: (() => {
                        const addr = cancelOrderData.delivery?.deliveryAddress;
                        if (!addr) return "";
                        const parts: string[] = [];
                        if (addr.formattedAddress) parts.push(addr.formattedAddress);
                        else if (addr.streetName) parts.push(`${addr.streetName}${addr.streetNumber ? `, ${addr.streetNumber}` : ""}`);
                        if (addr.neighborhood) parts.push(addr.neighborhood);
                        if (addr.city) parts.push(addr.city);
                        return parts.join(" - ");
                      })(),
                      deliveryType: cancelOrderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
                      paymentMethod: cancelParsedPay.paymentMethod,
                      totalAmount: cancelTotal,
                      deliveryFee: cancelOrderData.total?.deliveryFee ?? cancelOrderData.delivery?.deliveryFee ?? 0,
                      status: "CANCELADO",
                      cancelledBy: "IFOOD",
                      cancelReason,
                      kdsStage: "PRODUCTION",
                      kdsProductionAt: new Date(),
                      notes: `Pedido iFood #${(cancelOrderData.displayId ?? orderId.slice(-6)).toUpperCase()} | ❌ Cancelado: ${cancelReason}`,
                      createdAt: cancelOrderData.createdAt ? new Date(cancelOrderData.createdAt) : undefined,
                      items: { create: cancelItems },
                    },
                  });
                  created++;
                  log.push(`  🚫📦 Cancelado + IMPORTADO: ${orderId} (R$ ${cancelTotal})`);
                } else {
                  log.push(`  ⚠️ Cancelado mas sem franqueado: ${orderId}`);
                }
              } else {
                log.push(`  ⚠️ Cancelado mas detalhes indisponíveis: ${orderId} (${cancelOrderRes.status})`);
              }
            } catch (cancelErr: any) {
              log.push(`  ⚠️ Erro ao importar cancelado ${orderId}: ${cancelErr.message}`);
            }
          }

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
          let eventFranchisee = eventMerchantId
            ? await prisma.user.findFirst({ where: { ifoodMerchantId: eventMerchantId, role: "FRANCHISEE" } as any })
            : null;

          if (!eventFranchisee) {
            log.push(`  ❌ Nenhum franqueado encontrado para merchantId: ${eventMerchantId} no pedido ${orderId}`);
            continue;
          }

          // Extract items
          const { getIfoodItemUnitPrice } = await import("@/lib/ifood-api");
          const items = (orderData.items ?? []).map((i: any) => {
            const subItemsList = i.options || i.subItems || i.garnishItems || i.items || [];
            const comboSels = Array.isArray(subItemsList) && subItemsList.length > 0
              ? JSON.stringify(subItemsList.map((s: any) => ({
                  name: s.name || s.label || s.productName || "",
                  quantity: s.quantity || 1,
                  price: s.price || s.unitPrice || s.addition || 0,
                })))
              : null;

            const itemUnitPrice = getIfoodItemUnitPrice(i);

            return {
              price: itemUnitPrice,
              quantity: i.quantity ?? 1,
              comboSelections: comboSels,
              menuProduct: {
                connectOrCreate: {
                  where: { id: `ifood-${i.id}` } as any,
                  create: {
                    id: `ifood-${i.id}`,
                    franchiseeId: eventFranchisee.id,
                    name: i.name ?? "Item iFood",
                    description: "",
                    price: itemUnitPrice,
                    category: "iFood",
                    active: false,
                  } as any,
                } as any,
              },
            };
          });

          const total = typeof orderData.total === "object"
            ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
            : (orderData.totalPrice ?? orderData.total ?? 0);

          const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
          const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

          const deliveryFeeValue = orderData.total?.deliveryFee
            ?? orderData.delivery?.deliveryFee
            ?? orderData.deliveryFee
            ?? 0;

          const isExplicitlyScheduled = orderData.orderTiming === "SCHEDULED" || Boolean(orderData.schedule);
          const rawScheduled = isExplicitlyScheduled
            ? (orderData.schedule?.scheduledDatetimeEnd
              ?? orderData.schedule?.scheduledDatetimeStart
              ?? orderData.scheduledDatetime
              ?? orderData.preparationStartDateTime)
            : null;

          const scheduledDatetime = rawScheduled ? new Date(rawScheduled) : null;

          if (isExplicitlyScheduled) {
            log.push(`  📅 Scheduling: orderTiming=${orderData.orderTiming}, scheduledDatetime=${orderData.scheduledDatetime}, schedule=${JSON.stringify(orderData.schedule)}, resolved=${scheduledDatetime?.toISOString()}`);
          }

          const rawDeadline = orderData.delivery?.deliveryDateTime
            ?? orderData.delivery?.estimatedDeliveryWindow?.end
            ?? orderData.delivery?.estimatedDeliveryWindow?.start
            ?? orderData.takeout?.takeoutDateTime
            ?? orderData.takeout?.estimatedTakeoutWindow?.end;

          const deliveryDeadline = scheduledDatetime ?? (rawDeadline ? new Date(rawDeadline) : null);

          const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

          const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
          const parsedPay = parseOrderPaymentInfo(orderData, "IFOOD");
          const payMethodName = parsedPay.paymentMethod;
          const changeAmount = parsedPay.changeAmount;
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

          const deliveredByRaw = (
            orderData.deliveredBy || orderData.deliveryBy ||
            orderData.delivery?.deliveredBy || orderData.delivery?.deliveryBy ||
            orderData.merchant?.deliveredBy || orderData.logistics?.deliveredBy ||
            ""
          ).toString().toUpperCase();

          const deliveryBy = (deliveredByRaw.includes("IFOOD") || deliveredByRaw.includes("LOGISTICS") || deliveredByRaw.includes("PARTNER")) ? "IFOOD" : "MERCHANT";

          const ifoodPickupCode = (
            orderData.delivery?.pickupCode ||
            orderData.pickupCode ||
            orderData.driver?.pickupCode ||
            orderData.logistics?.pickupCode ||
            event?.pickupCode ||
            event?.data?.pickupCode ||
            null
          )?.toString().trim() || null;

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
              ifoodPickupCode: ifoodPickupCode ?? undefined,
              scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
              changeAmount,
              customerCpfCnpj,
              deliveryBy,
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
              customerAddress: (() => {
                const addr = orderData.delivery?.deliveryAddress;
                if (!addr) return "";
                const formatted = addr.formattedAddress || "";
                const neighborhood = addr.neighborhood || "";
                const city = addr.city || "";
                const complement = addr.complement || addr.streetNameComplement || "";
                const reference = addr.reference || addr.streetNameReference || orderData.delivery?.observations || orderData.customer?.customerNote || "";
                const parts: string[] = [];
                if (formatted) {
                  parts.push(formatted);
                } else if (addr.streetName) {
                  parts.push(`${addr.streetName}${addr.streetNumber ? `, ${addr.streetNumber}` : ""}`);
                }
                if (complement && !parts.some(p => p.toLowerCase().includes(complement.toLowerCase()))) {
                  parts.push(`Comp: ${complement}`);
                }
                if (reference && !parts.some(p => p.toLowerCase().includes(reference.toLowerCase()))) {
                  parts.push(`Ref: ${reference}`);
                }
                if (neighborhood && (!parts[0] || !parts[0].toLowerCase().includes(neighborhood.toLowerCase()))) {
                  parts.push(neighborhood);
                }
                if (city) parts.push(city);
                return parts.join(" - ");
              })(),
              deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
              paymentMethod: payMethodName,
              totalAmount: total,
              deliveryFee: deliveryFeeValue,
              status: initialStatus,
              kdsStage: "PRODUCTION",
              kdsProductionAt: new Date(),
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
          if (isConcluded) newStatus = "ENTREGUE";
          else if (isDispatched) newStatus = "SAIU_ENTREGA";
          else if (isPreparation || isReadyPickup) newStatus = "PREPARANDO";
          else if (isConfirmed) newStatus = "ACEITO";

          if (newStatus) {
            const updateData: any = { status: newStatus };
            if (isConcluded) {
              updateData.ifoodDriverStatus = "CONCLUDED";
            }

            // === Sincronizar prazo de entrega do iFood ===
            try {
              const detailRes = await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (detailRes.ok) {
                const detailData = await detailRes.json();
                const updatedDeadline = detailData.delivery?.deliveryDateTime
                  ?? detailData.delivery?.estimatedDeliveryWindow?.end
                  ?? detailData.delivery?.estimatedDeliveryWindow?.start
                  ?? detailData.takeout?.takeoutDateTime
                  ?? detailData.takeout?.estimatedTakeoutWindow?.end;
                if (updatedDeadline) {
                  updateData.scheduledDatetime = new Date(updatedDeadline);
                  log.push(`  ⏱️ Prazo atualizado: ${orderId} → ${updatedDeadline}`);
                }
                const dByRaw = (
                  detailData.deliveredBy || detailData.deliveryBy ||
                  detailData.delivery?.deliveredBy || detailData.delivery?.deliveryBy ||
                  detailData.merchant?.deliveredBy || detailData.logistics?.deliveredBy ||
                  ""
                ).toString().toUpperCase();
                if (dByRaw.includes("IFOOD") || dByRaw.includes("LOGISTICS") || dByRaw.includes("PARTNER")) {
                  updateData.deliveryBy = "IFOOD";
                }
                const pCode = (
                  detailData.delivery?.pickupCode ||
                  detailData.pickupCode ||
                  detailData.driver?.pickupCode ||
                  detailData.logistics?.pickupCode
                )?.toString().trim();
                if (pCode) {
                  updateData.ifoodPickupCode = pCode;
                }
              }
            } catch (deadlineErr: any) {
              log.push(`  ⚠️ Falha ao sincronizar prazo de ${orderId}: ${deadlineErr?.message}`);
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
