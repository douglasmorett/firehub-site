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
    const merchantId = process.env.IFOOD_MERCHANT_UUID;
    if (!merchantId) return;

    const token = await getIfoodToken();

    // Poll events from iFood
    const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
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
        const isCancellationRequest = code === "HSD" || code === "CRR" || event.fullCode === "HANDSHAKE_DISPUTE" || event.fullCode === "CANCELLATION_REQUESTED";

        // Handle cancellation REQUEST (negotiation) — don't cancel yet, let merchant decide
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
            console.log(`[iFood Poll] ⚠️ Negociação: ${orderId} — disputeId=${meta.disputeId}, motivo="${meta.message}"`);
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
              where: { ifoodMerchantId: eventMerchantId } as any,
            });
            if (!eventFranchisee) {
              console.error(`[iFood Poll] ❌ Nenhum franqueado encontrado para merchantId: ${eventMerchantId} no pedido ${orderId}`);
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

            // === Campos para homologação iFood ===
            // iFood sends scheduling info in multiple possible fields
            const rawScheduled = orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime
              ? orderData.scheduledDatetime
              : orderData.schedule?.scheduledDatetimeEnd
                ?? orderData.schedule?.scheduledDatetimeStart
                ?? (orderData.orderTiming === "SCHEDULED" && orderData.preparationStartDateTime
                  ? orderData.preparationStartDateTime : null);

            const scheduledDatetime = rawScheduled ? new Date(rawScheduled) : null;

            // Log scheduling data for debugging
            if (orderData.orderTiming === "SCHEDULED" || orderData.schedule) {
              console.log(`[iFood Poll] Scheduling data: orderTiming=${orderData.orderTiming}, scheduledDatetime=${orderData.scheduledDatetime}, schedule=${JSON.stringify(orderData.schedule)}, preparationStart=${orderData.preparationStartDateTime}, resolved=${scheduledDatetime?.toISOString()}`);
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
            console.log(`[iFood Poll] ✅ Pedido ${orderId} criado com sucesso! (evento: ${code}/${event.fullCode}, status: ${initialStatus}, franchisee: ${eventFranchisee.id})`);

            // Auto-confirm to iFood se ainda é PLACED
            if (isPlaced) {
              await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`,
                { method: "POST", headers: { Authorization: `Bearer ${token}` } }
              );
            }
          } else if (!isPlaced) {
            // Pedido já existe — atualizar status
            const STATUS_EVENT_MAP: Record<string, string> = {};
            if (isConfirmed) STATUS_EVENT_MAP[code] = "ACEITO";
            if (isPreparation) STATUS_EVENT_MAP[code] = "PREPARANDO";
            if (isReadyPickup) STATUS_EVENT_MAP[code] = "PREPARANDO";
            if (isDispatched) STATUS_EVENT_MAP[code] = "SAIU_ENTREGA";
            if (isConcluded) STATUS_EVENT_MAP[code] = "ENTREGUE";

            const newStatus = STATUS_EVENT_MAP[code];
            if (newStatus) {
              const updateData: any = { status: newStatus };
              if (isConcluded) {
                updateData.ifoodDriverStatus = "CONCLUDED";
              }
              await (prisma.customerOrder as any).updateMany({
                where: { ifoodOrderId: orderId } as any,
                data: updateData,
              });
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
      await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(processedEventIds),
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
    const merchantId = process.env.JOTAJA_MERCHANT_ID;
    if (!merchantId) return;

    const res = await jotajaFetch("/v1/events:polling", { method: "GET" });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[Jotaja Poll] events:polling falhou: ${res.status} - ${errBody.slice(0, 200)}`);
      return;
    }

    const eventsText = await res.text();
    const events = eventsText ? JSON.parse(eventsText) : [];
    if (!events || events.length === 0) return;

    const processedEventIds: string[] = [];
    for (const event of events) {
      const result = await processJotajaEvent(event, jotajaFetch, jotajaMutate);
      if (result.action !== "error" && result.action !== "skipped") {
        const eid = event.id || event.eventId;
        if (eid) processedEventIds.push(eid);
        console.log(`[Jotaja Poll] ${result.action} - ${result.orderId}${result.message ? ": " + result.message : ""}`);
      } else if (result.action === "error") {
        console.error(`[Jotaja Poll] ERRO ${result.orderId}: ${result.message}`);
      }
    }

    if (processedEventIds.length > 0) {
      await jotajaFetch("/v1/events/acknowledgment", {
        method: "POST",
        body: JSON.stringify(processedEventIds.map((id: string) => ({ id }))),
      });
      console.log(`[Jotaja Poll] ${processedEventIds.length}/${events.length} eventos acknowledged`);
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
    select: { id: true }
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    await Promise.all([
      pollIfoodEvents(user.id),
      pollJotajaEvents(user.id),
    ]);
  } catch (err) {
    console.error("[Poll] Erro no polling:", err);
  }

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id },
    include: {
      items: { include: { menuProduct: { select: { id: true, name: true, cost: true } } } },
      motoboy: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return NextResponse.json(orders);
}
