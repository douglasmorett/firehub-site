import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// Throttle iFood polling — max once every 5s for faster order detection
let lastIfoodPoll = 0;

// Throttle Jotajá polling — max once every 5s
let lastJotajaPoll = 0;

async function pollIfoodEvents(sessionUserId?: string) {
  const now = Date.now();
  if (now - lastIfoodPoll < 5_000) return; // Skip if polled less than 5s ago
  lastIfoodPoll = now;

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");
    let merchantId = process.env.IFOOD_MERCHANT_UUID;
    if (sessionUserId) {
      const u = await prisma.user.findUnique({ where: { id: sessionUserId }, select: { ifoodMerchantId: true } });
      if (u?.ifoodMerchantId) merchantId = u.ifoodMerchantId;
    }
    if (!merchantId) {
      const u = await prisma.user.findFirst({ where: { email: "contatohakim@gmail.com" }, select: { ifoodMerchantId: true } });
      merchantId = u?.ifoodMerchantId || "5bfb7d90-b184-4b95-a2bc-ae61db896cb0";
    }

    const token = await getIfoodToken();

    // Poll events from iFood
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (merchantId) headers["x-polling-merchants"] = merchantId;

    const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[iFood Poll] ❌ events:polling falhou: ${res.status} ${res.statusText} — ${errBody.slice(0, 200)}`);
      return;
    }

    // iFood events:polling can return 204 No Content or empty body
    const eventsText = await res.text();
    const events = eventsText ? JSON.parse(eventsText) : [];
    if (!events || events.length === 0) return;



    // Process each event
    const processedEventIds: { id: string; orderId: string; eventType: string }[] = [];
    for (const event of events) {
      try {
        const { code, orderId, merchantId } = event;
        if (!orderId) continue;

        // Log de debug para identificar códigos de eventos
        console.log(`[iFood Poll] Evento recebido: code=${code}, fullCode=${event.fullCode}, orderId=${orderId}`);

        // Códigos de eventos do iFood (abreviados e completos)
        const isPlaced = code === "PLC" || event.fullCode === "PLACED";
        const isConfirmed = code === "CFM" || event.fullCode === "CONFIRMED";
        const isPreparation = code === "PRP" || event.fullCode === "IN_PREPARATION" || event.fullCode === "PREPARATION_STARTED";
        const isReadyPickup = code === "RTP" || event.fullCode === "READY_TO_PICKUP";
        const isDispatched = code === "DSP" || event.fullCode === "DISPATCHED";
        const isConcluded = code === "CON" || event.fullCode === "CONCLUDED";
        const isCancelled = code === "CAN" || event.fullCode === "CANCELLED";
        const isDispute = code === "HSD" || code === "CRR" || code === "DDC" || event.fullCode === "HANDSHAKE_DISPUTE" || event.fullCode === "CANCELLATION_REQUESTED" || event.fullCode === "DUE_DATE_CHANGE_REQUESTED";

        // Handle cancellation or due date change REQUEST (negotiation) — don't cancel yet, let merchant decide
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
          console.log(`[iFood Poll] ⚠️ Negociação (${disputeData.type}): ${orderId} — disputeId=${meta.disputeId}, motivo="${meta.message}"`);
          if (event.id) {
            processedEventIds.push({
              id: event.id,
              orderId: event.orderId || "",
              eventType: event.fullCode || event.code || "",
            });
          }
          continue;
        }

        // === LOGISTICS EVENTS (Motoboy iFood) ===
        const isAssignDriver = code === "ASSIGN_DRIVER" || code === "ADR" || event.fullCode === "ASSIGN_DRIVER";
        const isGoingToOrigin = code === "GOING_TO_ORIGIN" || code === "GTO" || event.fullCode === "GOING_TO_ORIGIN";
        const isArrivedAtOrigin = code === "ARRIVED_AT_ORIGIN" || code === "AAO" || event.fullCode === "ARRIVED_AT_ORIGIN";
        const isCollectedEv = code === "COLLECTED" || code === "COL" || event.fullCode === "COLLECTED";
        const isArrivedAtDest = code === "ARRIVED_AT_DESTINATION" || code === "AAD" || event.fullCode === "ARRIVED_AT_DESTINATION";
        const isDriverSuccess = code === "REQUEST_DRIVER_SUCCESS" || code === "RDS" || event.fullCode === "REQUEST_DRIVER_SUCCESS";
        const isDriverFailed = code === "REQUEST_DRIVER_FAILED" || code === "RDF" || event.fullCode === "REQUEST_DRIVER_FAILED";
        const isDriverEvent = isAssignDriver || isGoingToOrigin || isArrivedAtOrigin || isCollectedEv || isArrivedAtDest || isDriverSuccess || isDriverFailed;

        if (isDriverEvent) {
          const meta = event.metadata || {};
          const driverUpdate: any = {};

          if (isAssignDriver || isDriverSuccess) {
            driverUpdate.ifoodDriverName = meta.driverName || meta.name || null;
            driverUpdate.ifoodDriverPhone = meta.driverPhone || null;
            driverUpdate.ifoodDriverVehicle = meta.vehicle || null;
            driverUpdate.ifoodDriverPhotoUrl = meta.driverPhotoUrl || null;
            driverUpdate.ifoodDriverStatus = "ASSIGNED";
            console.log(`[iFood Poll] 🛵 Motoboy atribuído: ${meta.driverName || "?"} para pedido ${orderId}`);
          } else if (isGoingToOrigin) {
            driverUpdate.ifoodDriverStatus = "GOING_TO_ORIGIN";
          } else if (isArrivedAtOrigin) {
            driverUpdate.ifoodDriverStatus = "ARRIVED_AT_ORIGIN";
          } else if (isCollectedEv) {
            driverUpdate.ifoodDriverStatus = "COLLECTED";
          } else if (isArrivedAtDest) {
            driverUpdate.ifoodDriverStatus = "ARRIVED_AT_DESTINATION";
          } else if (isDriverFailed) {
            driverUpdate.ifoodDriverStatus = "FAILED";
          }

          if (Object.keys(driverUpdate).length > 0) {
            await (prisma.customerOrder as any).updateMany({
              where: { ifoodOrderId: orderId } as any,
              data: driverUpdate,
            });
            console.log(`[iFood Poll] 🛵 Driver status: ${driverUpdate.ifoodDriverStatus} para ${orderId}`);
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

        // CATCH-ALL: qualquer evento com orderId (que não seja cancelamento) deve criar o pedido se não existir
        // Isso garante que NENHUM pedido é perdido, independente do código do evento
        if (!isCancelled) {
          // Check idempotency
          const exists = await prisma.customerOrder.findFirst({
            where: { ifoodOrderId: orderId } as any,
          });

          if (!exists) {
            // Pedido não existe — criar (independente do tipo de evento)
            const orderRes = await fetch(
              `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!orderRes.ok) {
              const errText = await orderRes.text().catch(() => "");
              console.error(`[iFood Poll] ❌ Falha ao buscar detalhes do pedido ${orderId}: ${orderRes.status} — ${errText.slice(0, 200)}`);
              continue;
            }
            const orderData = await orderRes.json();

            const eventMerchantId = merchantId || orderData.merchant?.id;
            const eventFranchisee = await prisma.user.findFirst({
              where: { email: "contatohakim@gmail.com" }
            }) || (sessionUserId
              ? await prisma.user.findUnique({ where: { id: sessionUserId } })
              : null) || await prisma.user.findFirst({
              where: { ifoodMerchantId: eventMerchantId } as any,
            });
            if (!eventFranchisee) {
              console.error(`[iFood Poll] ❌ Nenhum franqueado encontrado para merchantId: ${eventMerchantId} no pedido ${orderId}`);
              continue;
            }

            // Extract items
            const { getIfoodItemUnitPrice } = await import("@/lib/ifood-api");
            const rawIfoodItems = (
              (Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : null) ??
              (Array.isArray(orderData.orderItems) && orderData.orderItems.length > 0 ? orderData.orderItems : null) ??
              (Array.isArray(orderData.products) && orderData.products.length > 0 ? orderData.products : null) ??
              []
            );

            const items = rawIfoodItems.map((i: any, idx: number) => {
              const itemId = i.id || i.externalCode || i.code || `ifitem-${idx}-${Math.random().toString(36).slice(2)}`;
              const itemName = (i.name || i.productName || i.displayName || i.title || i.label || "Item iFood").trim();

              const subItemsList = i.options || i.subItems || i.garnishItems || i.items || [];
              const comboSels = Array.isArray(subItemsList) && subItemsList.length > 0
                ? JSON.stringify(subItemsList.map((s: any) => ({
                    name: s.name || s.label || s.productName || "",
                    quantity: s.quantity || 1,
                    price: s.price || s.unitPrice || s.addition || 0
                  })).filter((s: any) => s.name))
                : null;

              const itemUnitPrice = getIfoodItemUnitPrice(i);

              return {
                price: itemUnitPrice,
                quantity: i.quantity ?? 1,
                comboSelections: comboSels,
                menuProduct: {
                  connectOrCreate: {
                    where: { id: `ifood-${itemId}` } as any,
                    create: {
                      id: `ifood-${itemId}`,
                      franchiseeId: eventFranchisee.id,
                      name: itemName,
                      description: i.observations || i.notes || "",
                      price: itemUnitPrice,
                      category: i.category || "iFood",
                      active: true,
                    } as any,
                  } as any,
                },
              };
            });

            // Extract total
            const total = typeof orderData.total === "object"
              ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
              : (orderData.totalPrice ?? orderData.total ?? 0);

            // Extract payments
            const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
            const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

            // Extract delivery fee from iFood
            const deliveryFeeValue = orderData.total?.deliveryFee
              ?? orderData.delivery?.deliveryFee
              ?? orderData.deliveryFee
              ?? 0;

            // === Campos para homologação e sincronização de prazo iFood ===
            const isExplicitlyScheduled = orderData.orderTiming === "SCHEDULED" || Boolean(orderData.schedule);

            const rawScheduled = isExplicitlyScheduled
              ? (orderData.schedule?.scheduledDatetimeEnd
                ?? orderData.schedule?.scheduledDatetimeStart
                ?? orderData.scheduledDatetime
                ?? orderData.preparationStartDateTime)
              : null;

            const scheduledDatetime = rawScheduled ? new Date(rawScheduled) : null;

            const rawDeadline = orderData.delivery?.deliveryDateTime
              ?? orderData.delivery?.estimatedDeliveryWindow?.end
              ?? orderData.delivery?.estimatedDeliveryWindow?.start
              ?? orderData.takeout?.takeoutDateTime
              ?? orderData.takeout?.estimatedTakeoutWindow?.end;

            const deliveryDeadline = scheduledDatetime ?? (rawDeadline ? new Date(rawDeadline) : null);

            const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

            const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
            const parsedPay = parseOrderPaymentInfo(orderData, "IFOOD");
            const resolvedPaymentMethod = parsedPay.paymentMethod;
            const changeAmount = parsedPay.changeAmount;
            const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber
              ?? orderData.customer?.documentNumber
              ?? orderData.customer?.cpf
              ?? orderData.taxPayerIdentificationNumber
              ?? orderData.additionalInfo?.taxPayerIdentificationNumber
              ?? null;
            console.log(`[iFood Poll] CPF/CNPJ: ${customerCpfCnpj ?? "não informado"}. customer=${JSON.stringify(orderData.customer || {})}`);

            // === DISCRIMINAÇÃO DE DESCONTOS (benefits) ===
            const benefits = orderData.benefits ?? [];
            let discountIfood = 0;
            let discountMerchant = 0;
            let discountTotal = 0;
            const discountDetails: any[] = [];

            for (const benefit of benefits) {
              const value = benefit.value ?? 0;
              discountTotal += value;

              const sponsorships = Array.isArray(benefit.sponsorshipValues)
                ? benefit.sponsorshipValues
                : benefit.sponsorshipValues ? [benefit.sponsorshipValues] : [];

              let benefitIfood = 0;
              let benefitMerchant = 0;

              for (const sp of sponsorships) {
                const spName = (sp.name ?? sp.sponsorship ?? "").toUpperCase();
                const spValue = sp.value ?? 0;
                if (spName === "IFOOD" || spName === "PARTNER" || spName === "EXTERNAL") {
                  benefitIfood += spValue;
                } else if (spName === "MERCHANT") {
                  benefitMerchant += spValue;
                } else {
                  benefitIfood += spValue;
                }
              }

              if (sponsorships.length === 0 && value > 0) {
                const sponsor = (benefit.sponsorship ?? "").toUpperCase();
                if (sponsor === "MERCHANT") {
                  benefitMerchant += value;
                } else {
                  benefitIfood += value;
                }
              }

              discountIfood += benefitIfood;
              discountMerchant += benefitMerchant;

              discountDetails.push({
                target: benefit.target ?? "CART",
                value,
                ifood: benefitIfood,
                merchant: benefitMerchant,
                description: benefit.campaign?.name ?? benefit.description ?? null,
              });
            }

            const notesArr = [
              `Pedido iFood #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
              scheduledDatetime ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString("pt-BR")}` : null,
              discountTotal > 0 ? `🏷️ Desconto R$${discountTotal.toFixed(2)} (iFood: R$${discountIfood.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : null,
              customerNote ? `💬 ${customerNote}` : null,
            ].filter(Boolean).join(" | ");

            // Determinar status inicial baseado no evento recebido
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
                  const localizer = phone?.localizer || phone?.phoneLocalizer || orderData.customer?.phoneLocalizer || orderData.customer?.localizer;
                  return localizer ? `${number} (ID: ${localizer})` : number;
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
                paymentMethod: resolvedPaymentMethod,
                totalAmount: total,
                deliveryFee: deliveryFeeValue,
                status: initialStatus,
                notes: notesArr,
                createdAt: new Date(), // Entra no final da fila com o próximo número sequencial
                items: { create: items },
              },
            });
            console.log(`[iFood Poll] ✅ Pedido ${orderId} criado com sucesso! (evento: ${code}/${event.fullCode}, status: ${initialStatus}, franchisee: ${eventFranchisee.id})`);

            // Auto-confirm to iFood se ainda é PLACED
            if (isPlaced) {
              await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`,
                { method: "POST", headers: { Authorization: `Bearer ${token}` } }
              );
            }
          } else if (!isPlaced && exists) {
            // Pedido já existe — atualizar status automaticamente (Apenas avançar status, NUNCA retroceder)
            const FINAL_STATUSES = ["ENTREGUE", "ENCERRADO", "CANCELADO"];
            if (FINAL_STATUSES.includes((exists as any).status)) {
              // Mantém o status finalizado escolhido pelo lojista
            } else {
              const STATUS_RANK: Record<string, number> = {
                NOVO: 0, ACEITO: 1, PREPARANDO: 2, PRONTO: 3, SAIU_ENTREGA: 4, ENTREGUE: 5, ENCERRADO: 5, CANCELADO: 5
              };
              const currentRank = STATUS_RANK[(exists as any).status || "NOVO"] || 0;

              let newStatus: string | null = null;
              if (isConcluded) newStatus = "ENTREGUE";
              else if (isDispatched) newStatus = "SAIU_ENTREGA";
              else if (isPreparation || isReadyPickup) newStatus = "PREPARANDO";
              else if (isConfirmed) newStatus = "ACEITO";

              if (newStatus && (STATUS_RANK[newStatus] || 0) >= currentRank) {
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
                      console.log(`[iFood Poll] ⏱️ Prazo atualizado: ${orderId} → ${updatedDeadline}`);
                    }
                  }
                } catch (deadlineErr: any) {
                  console.warn(`[iFood Poll] ⚠️ Falha ao sincronizar prazo de ${orderId}: ${deadlineErr?.message}`);
                }

                await (prisma.customerOrder as any).updateMany({
                  where: { ifoodOrderId: orderId } as any,
                  data: updateData,
                });
                console.log(`[iFood Poll] 🔄 Status atualizado automaticamente: ${orderId} -> ${newStatus}`);
              }
            }
          }
        }

        // Handle cancellations
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
        }

        // Evento processado com sucesso
        if (event.id) {
          processedEventIds.push({
            id: event.id,
            orderId: event.orderId || "",
            eventType: event.fullCode || event.code || "",
          });
        }
      } catch (err: any) {
        console.error(`[iFood Poll] ❌ Erro processando evento ${event?.orderId}:`, err?.message ?? err);
        // NÃO adiciona ao processedIds — evento não foi processado, será reprocessado no próximo poll
      }
    }

    // Só reconhecer eventos que foram processados com sucesso
    if (processedEventIds.length > 0) {
      const ackPayload = processedEventIds.map(e => ({ id: e.id }));
      await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(ackPayload),
      });
      console.log(`[iFood Poll] ✅ ${processedEventIds.length}/${events.length} eventos acknowledged`);
    }
  } catch (err) {
    console.error("[iFood Poll] Erro geral:", err);
  }
}

async function pollJotajaEvents(sessionUserId?: string) {
  const now = Date.now();
  if (now - lastJotajaPoll < 5_000) return;

  lastJotajaPoll = now;

  try {
    const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");
    const { processJotajaEvent } = await import("@/lib/processJotajaEvent");

    const res = await jotajaFetch("/v1/events:polling", { method: "GET" }).catch(err => {
      console.warn("[Jotaja Poll] Erro de rede no polling:", err.message);
      return null;
    });
    if (!res || !res.ok) {
      if (res) {
        const errBody = await res.text().catch(() => "");
        console.error(`[Jotaja Poll] events:polling falhou: ${res.status} - ${errBody.slice(0, 200)}`);
      }
      return;
    }

    const eventsText = await res.text();
    const events = eventsText ? JSON.parse(eventsText) : [];
    if (!events || events.length === 0) return;

    const processedEvents: { id: string; orderId: string; eventType: string }[] = [];
    for (const event of events) {
      const result = await processJotajaEvent(event, jotajaFetch, jotajaMutate, sessionUserId);
      const eid = event.eventId || event.id;
      if (result.action !== "error" && eid) {
        processedEvents.push({
          id: eid,
          orderId: event.orderId || "",
          eventType: event.eventType || event.fullCode || event.code || "",
        });
      }
      if (result.action !== "error" && result.action !== "skipped") {
        console.log(`[Jotaja Poll] ${result.action} - ${result.orderId}${result.message ? ": " + result.message : ""}`);
      } else if (result.action === "error") {
        console.error(`[Jotaja Poll] ERRO ${result.orderId}: ${result.message}`);
      }
    }

    if (processedEvents.length > 0) {
      await jotajaMutate("/v1/events/acknowledgment", {
        method: "POST",
        body: JSON.stringify(processedEvents),
      });
      console.log(`[Jotaja Poll] ${processedEvents.length}/${events.length} eventos acknowledged`);
    }
  } catch (err) {
    console.error("[Jotaja Poll] Erro geral:", err);
  }
}

// GET: Fast polling endpoint - returns orders + auto-polls iFood & Jotaja
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true }
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  try {
    await Promise.allSettled([
      pollIfoodEvents(targetFranchiseeId),
      pollJotajaEvents(targetFranchiseeId),
    ]);
  } catch (err) {
    console.error("[Poll] Erro no polling:", err);
  }

  const validFranchiseeIds = Array.from(new Set([
    targetFranchiseeId,
    user.id,
    user.ownerId
  ].filter(Boolean))) as string[];

  const orders = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: { in: validFranchiseeIds },
      status: { notIn: ["AGUARDANDO_PAGAMENTO"] }
    },
    include: {
      items: { include: { menuProduct: { select: { id: true, name: true, cost: true, price: true, imageUrl: true, category: true, active: true } } } },
      motoboy: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  // Auto-repair zero-price items in existing orders
  for (const o of orders) {
    const zeroItems = (o.items || []).filter((it: any) => !it.price || it.price === 0);
    if (zeroItems.length > 0 && o.totalAmount > 0) {
      const otherItemsSum = (o.items || []).reduce((sum: number, it: any) => sum + (it.price || 0) * (it.quantity || 1), 0);
      const expectedSubtotal = o.totalAmount - (o.deliveryFee || 0) + (o.discountTotal || 0);
      const diff = expectedSubtotal - otherItemsSum;

      for (const zeroIt of zeroItems) {
        let repairedPrice = 0;
        if (zeroIt.comboSelections) {
          try {
            const parsed = typeof zeroIt.comboSelections === "string" ? JSON.parse(zeroIt.comboSelections) : zeroIt.comboSelections;
            if (Array.isArray(parsed) && parsed.length > 0) {
              const comboSum = parsed.reduce((acc: number, s: any) => acc + ((s.price || s.unitPrice || s.addition || 0) * (s.quantity || 1)), 0);
              if (comboSum > 0) repairedPrice = comboSum;
            }
          } catch {}
        }

        if (repairedPrice === 0 && zeroItems.length === 1 && diff > 0 && (zeroIt.quantity || 1) > 0) {
          repairedPrice = diff / (zeroIt.quantity || 1);
        }

        if (repairedPrice > 0) {
          zeroIt.price = repairedPrice;
          prisma.customerOrderItem.update({
            where: { id: zeroIt.id },
            data: { price: repairedPrice }
          }).catch(err => console.error("[AutoRepair Item Price]", err));
        }
      }
    }
  }

  // Buscar data de abertura do caixa ativo para calcular a sequência do dia/sessão
  const activeSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: targetFranchiseeId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { openedAt: true }
  });

  // Numeração PERMANENTE E IMUTÁVEL baseada na Sessão de Caixa Ativa / Turno Operacional
  const allRecentOrders = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: targetFranchiseeId,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true, createdAt: true, dailyOrderNumber: true } as any,
    orderBy: { createdAt: "asc" },
  });

  const { buildSessionOrderNumberMap } = await import("@/lib/order-sequence");
  const dailyNumMap = buildSessionOrderNumberMap(allRecentOrders, activeSession?.openedAt);

  const ordersWithDailyNum = orders.map((o: any) => ({
    ...o,
    dailyOrderNumber: dailyNumMap.get(o.id) || o.dailyOrderNumber || null,
  }));


  // 🤖 Executa verificação de inatividade de rascunhos IA (20 min pergunta / 30 min cancela)
  try {
    const { checkAndCleanupStaleAiDrafts } = await import("@/lib/chatbot-ai");
    checkAndCleanupStaleAiDrafts(targetFranchiseeId).catch(() => {});
  } catch {}

  return NextResponse.json(ordersWithDailyNum, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}
