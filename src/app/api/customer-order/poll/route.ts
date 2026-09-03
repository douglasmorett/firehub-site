import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function withRetry<T>(operation: () => Promise<T>, retries = 3, delay = 500): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("Operation failed after retries");
}


// Throttle iFood polling — max once every 5s for faster order detection
let lastIfoodPoll = 0;



async function pollIfoodEvents(sessionUserId?: string) {
  const now = Date.now();
  if (now - lastIfoodPoll < 5_000) return; // Skip if polled less than 5s ago
  lastIfoodPoll = now;

  try {
    const { getIfoodToken, getTokenDaLojaIfood } = await import("@/lib/ifood-api");
    // TODAS as lojas iFood da conta, não só a do campo `ifoodMerchantId`.
    // Quem integrou três lojas no mesmo login (Ragnar Burguer, Ragnar Pizza e
    // Tadala Burguer) precisa ver os pedidos das três com o painel aberto — e
    // não só as da loja que por acaso está no campo único do User.
    let merchantPrincipal = process.env.IFOOD_MERCHANT_UUID || "";
    let merchants: string[] = [];
    if (sessionUserId) {
      const u = await prisma.user.findUnique({ where: { id: sessionUserId }, select: { ifoodMerchantId: true } });
      if (u?.ifoodMerchantId) merchantPrincipal = u.ifoodMerchantId;
      const integracoes = await prisma.ifoodIntegration.findMany({
        where: { userId: sessionUserId, active: true },
        select: { merchantId: true },
      });
      merchants = [...new Set([merchantPrincipal, ...integracoes.map((i) => i.merchantId)].filter(Boolean))];
    } else if (merchantPrincipal) {
      merchants = [merchantPrincipal];
    }

    if (merchants.length === 0) return; // Se a loja não tem integração com iFood, aborta em vez de puxar do Hakim

    // O app do iFood é DISTRIBUÍDO: não existe token central que enxergue as
    // lojas — cada uma tem o seu. Usar o token global com o merchant da loja
    // fazia o iFood recusar a chamada inteira com
    // 403 "Some polling merchants are not authorized" (era o caso da Brasa
    // Burguer, que enchia o log a cada minuto). O cron de fundo já fazia certo.
    let token = sessionUserId
      ? await getTokenDaLojaIfood(sessionUserId)
      : await getIfoodToken();
    let origemDoToken: "distribuido" | "central" = sessionUserId ? "distribuido" : "central";

    // ── QUANDO O DISTRIBUÍDO MORRE, O CENTRAL ASSUME ────────────────────────
    //
    // A loja pode estar conectada nos DOIS apps (distribuído e centralizado).
    // Esta rota só tentava o distribuído: com o refresh_token dele inválido,
    // ela devolvia o access_token velho e o iFood respondia
    // 401 "token expired" a cada 5 segundos — o polling da loja parava de
    // funcionar mesmo com o app central conectado e saudável.
    //
    // O resto do sistema já resolve assim (lib/ifood-token.ts tenta em
    // cascata e só o `IFOOD_CENTRAL_FALLBACK=off` desliga o central). Aqui
    // faltava a mesma rede de proteção.
    if (!token && process.env.IFOOD_CENTRAL_FALLBACK !== "off") {
      token = await getIfoodToken().catch(() => null as any);
      origemDoToken = "central";
      if (token) console.warn(`[iFood Poll] ↩️ loja ${sessionUserId}: token distribuído indisponível, usando o app CENTRAL.`);
    }

    if (!token) {
      console.error(`[iFood Poll] ⚠️ loja ${sessionUserId} sem token utilizável — precisa reconectar o iFood`);
      return;
    }

    // Poll events from iFood
    const montarHeaders = (t: string): Record<string, string> => {
      const h: Record<string, string> = { Authorization: `Bearer ${t}` };
      if (merchants.length > 0) h["x-polling-merchants"] = merchants.join(",");
      return h;
    };

    const url = "https://merchant-api.ifood.com.br/events/v1.0/events:polling?excludeHeartbeat=true";
    let res = await fetch(url, { method: "GET", headers: montarHeaders(token) });

    // 401 com token distribuído = token da loja venceu e não renovou. Antes o
    // polling simplesmente desistia aqui; agora tenta o central uma vez.
    if (res.status === 401 && origemDoToken === "distribuido" && process.env.IFOOD_CENTRAL_FALLBACK !== "off") {
      const central = await getIfoodToken().catch(() => null as any);
      if (central) {
        console.warn(`[iFood Poll] ↩️ 401 no token da loja ${sessionUserId} — repetindo com o app CENTRAL.`);
        // `token` PRECISA passar a ser o central: todo o resto desta rota
        // (buscar detalhe do pedido, confirmar, dar ACK nos eventos) usa esta
        // variável. Sem trocar aqui, o polling voltaria a funcionar e os
        // passos seguintes continuariam batendo com o token morto.
        token = central;
        res = await fetch(url, { method: "GET", headers: montarHeaders(central) });
        origemDoToken = "central";
      }
    }

    // ── 403 COM VÁRIAS LOJAS NO HEADER ──────────────────────────────────────
    // O `x-polling-merchants` é tudo ou nada: se UMA das lojas da lista não for
    // autorizada para este token, o iFood recusa a chamada inteira e o painel
    // ficaria cego — inclusive para a loja que funciona. Aqui ele volta a puxar
    // só a principal; o cron, que tenta loja a loja, é quem descobre e registra
    // qual delas precisa reconectar.
    if (res.status === 403 && merchants.length > 1 && merchantPrincipal && token) {
      console.warn(`[iFood Poll] 403 com ${merchants.length} lojas no header — repetindo só com a principal.`);
      merchants = [merchantPrincipal];
      res = await fetch(url, { method: "GET", headers: montarHeaders(token) });
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[iFood Poll] ❌ events:polling falhou (${origemDoToken}): ${res.status} ${res.statusText} — ${errBody.slice(0, 200)}`);
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
            // MULTI-TENANT: resolver EXCLUSIVAMENTE por merchantId do evento, NUNCA por email hardcoded
            const eventFranchisee = (eventMerchantId
              ? (await prisma.user.findFirst({
                  where: { ifoodMerchantId: eventMerchantId, role: "FRANCHISEE" } as any,
                }) || await prisma.ifoodIntegration.findFirst({ where: { merchantId: eventMerchantId, active: true } })
                    .then(async (int: any) => int ? prisma.user.findUnique({ where: { id: int.userId } }) : null))
              : null)
            || (sessionUserId
              ? await prisma.user.findUnique({ where: { id: sessionUserId } })
              : null);
            if (!eventFranchisee) {
              console.error(`[iFood Poll] ❌ Nenhum franqueado encontrado para merchantId: ${eventMerchantId} no pedido ${orderId}`);
              continue;
            }

            // Extract items
            const { montarItensDoPedidoIfood } = await import("@/lib/ifood-itens");
            const rawIfoodItems = (
              (Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : null) ??
              (Array.isArray(orderData.orderItems) && orderData.orderItems.length > 0 ? orderData.orderItems : null) ??
              (Array.isArray(orderData.products) && orderData.products.length > 0 ? orderData.products : null) ??
              []
            );

            // A categoria do espelho aqui era `i.category || "iFood"`. Categoria de
            // verdade ("Bebidas", "Combos") faz o produto do iFood atravessar o
            // filtro de src/lib/cardapio-interno.ts e aparecer no PDV, na mesa e
            // no totem. O espelho é sempre categoria "iFood".
            const items = await montarItensDoPedidoIfood(rawIfoodItems, {
              franchiseeId: eventFranchisee.id,
              active: false,
              idDoItem: (i: any, idx: number) =>
                i?.id || i?.externalCode || i?.code || `ifitem-${idx}-${Math.random().toString(36).slice(2)}`,
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
                dailyOrderNumber: await (async () => {
                  const { generateDailyOrderNumber } = await import("@/lib/order-number");
                  return generateDailyOrderNumber(eventFranchisee.id);
                })(),
                ifoodOrderId: orderId,
                // De qual loja iFood veio, e o conserto do rótulo da integração
                // — este é o caminho que roda durante o movimento (5s), então é
                // aqui que a correção precisa acontecer para valer na prática.
                ...(await (async () => {
                  const { nomeDaLojaDoPedidoIfood } = await import("@/lib/ifood-eventos");
                  const nome = await nomeDaLojaDoPedidoIfood({
                    franchiseeId: eventFranchisee.id,
                    merchantId: eventMerchantId,
                    orderData,
                  });
                  return {
                    ifoodStoreName: nome ?? undefined,
                    ifoodStoreMerchant: eventMerchantId ?? undefined,
                  };
                })()),
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

// Throttle Jotajá polling PER-STORE — evita cruzamento entre lojas
const lastJotajaPollMap = new Map<string, number>();

async function pollJotajaEvents(sessionUserId?: string) {
  const storeKey = sessionUserId || "global";
  const now = Date.now();
  const lastPoll = lastJotajaPollMap.get(storeKey) || 0;
  if (now - lastPoll < 2_000) return;

  lastJotajaPollMap.set(storeKey, now);

  try {
    const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");
    const { processJotajaEvent } = await import("@/lib/processJotajaEvent");

    // Usar credenciais da loja do usuário logado
    const res = await jotajaFetch("/v1/events:polling", { method: "GET" }, sessionUserId).catch(err => {
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
      const result = await processJotajaEvent(
        event,
        (path: string, opts?: RequestInit) => jotajaFetch(path, opts, sessionUserId),
        (path: string, opts?: RequestInit) => jotajaMutate(path, opts, sessionUserId),
        sessionUserId
      );
      const eid = event.eventId || event.id;

      // ACK apaga o evento do feed do JotaJá em definitivo, e não há endpoint de
      // listagem para recuperá-lo depois (GET /v1/orders responde 404). Só ackamos
      // se o pedido realmente existir no banco — antes, "skipped" também ackava.
      let podeAckar = result.action !== "error";
      if (podeAckar && event.orderId) {
        const { prisma } = await import("@/lib/prisma");
        const gravado = await prisma.customerOrder.findFirst({
          where: {
            OR: [
              { openDeliveryOrderId: event.orderId },
              { openDeliveryOrderId: { startsWith: `${event.orderId}_` } },
            ],
          } as any,
          select: { id: true },
        });
        if (!gravado) {
          podeAckar = false;
          console.error(`[Jotaja Poll] ⛔ SEM ACK ${event.orderId}: ${result.action} não gravou pedido (${result.message || "-"}) — fica na fila`);
        }
      }

      if (podeAckar && eid) {
        processedEvents.push({
          id: eid,
          orderId: event.orderId || "",
          eventType: event.eventType || event.fullCode || event.code || "",
        });
      }
      if (result.action === "error") {
        console.error(`[Jotaja Poll] ERRO ${result.orderId}: ${result.message}`);
      } else {
        // "skipped" era o único caso não logado — e era justamente o que sumia
        // com o pedido em silêncio.
        console.log(`[Jotaja Poll] ${result.action} - ${result.orderId}${result.message ? ": " + result.message : ""}`);
      }
    }

    if (processedEvents.length > 0) {
      await jotajaMutate("/v1/events/acknowledgment", {
        method: "POST",
        body: JSON.stringify(processedEvents),
      }, sessionUserId);
      console.log(`[Jotaja Poll] ${processedEvents.length}/${events.length} eventos acknowledged`);
    }
  } catch (err) {
    console.error("[Jotaja Poll] Erro geral:", err);
  }
}

// Throttle Brendi polling PER-STORE — Map PRÓPRIO, não o do JotaJá: a chave é
// a mesma loja, e dividir o Map faria o poll de um canal consumir a janela de
// 2s do outro (um canal "calaria" o irmão a cada ciclo do dashboard).
const lastBrendiPollMap = new Map<string, number>();

async function pollBrendiEvents(franchiseeId?: string) {
  // Sem loja não há credencial: a Brendi é multi-tenant estrito (credencial no
  // banco, sem fallback ENV — lição JotaJá), então poll "global" não existe.
  if (!franchiseeId) return;

  const now = Date.now();
  const lastPoll = lastBrendiPollMap.get(franchiseeId) || 0;
  if (now - lastPoll < 2_000) return;

  lastBrendiPollMap.set(franchiseeId, now);

  try {
    const { getBrendiCredentials, brendiFetch, brendiMutate } = await import("@/lib/brendi-api");
    const { processBrendiEvent } = await import("@/lib/processBrendiEvent");

    // Gate real: flag `brendiConnected` gravada só após o oauth/token da Brendi
    // autenticar de verdade. Loja sem credencial (ou com colunas brendi* ainda
    // não criadas) devolve null aqui e o poll simplesmente não roda.
    const creds = await getBrendiCredentials(franchiseeId);
    if (!creds || !creds.connected) return;

    const res = await brendiFetch("/v1/events:polling", franchiseeId).catch(err => {
      console.warn("[Brendi Poll] Erro de rede no polling:", err.message);
      return null;
    });
    if (!res || !res.ok) {
      if (res) {
        const errBody = await res.text().catch(() => "");
        console.error(`[Brendi Poll] events:polling falhou: ${res.status} - ${errBody.slice(0, 200)}`);
      }
      return;
    }

    const eventsText = await res.text();
    const events = eventsText ? JSON.parse(eventsText) : [];
    if (!events || events.length === 0) return;

    const processedEvents: { id: string; orderId: string; eventType: string }[] = [];
    for (const event of events) {
      const result = await processBrendiEvent(event, { targetFranchiseeId: franchiseeId });
      const eid = event.eventId || event.id;

      // Mesma regra do JotaJá (mesmo contrato Abrasel): o ACK apaga o evento do
      // feed em definitivo e não há endpoint de listagem para recuperá-lo
      // depois. Só ackamos se o pedido realmente existir no banco — "skipped"
      // sem gravação ficaria na fila para o cron retentar.
      let podeAckar = result.action !== "error";
      if (podeAckar && event.orderId) {
        const gravado = await prisma.customerOrder.findFirst({
          where: {
            OR: [
              { openDeliveryOrderId: event.orderId },
              { openDeliveryOrderId: { startsWith: `${event.orderId}_` } },
            ],
          } as any,
          select: { id: true },
        });
        if (!gravado) {
          podeAckar = false;
          console.error(`[Brendi Poll] ⛔ SEM ACK ${event.orderId}: ${result.action} não gravou pedido (${result.message || "-"}) — fica na fila`);
        }
      }

      if (podeAckar && eid) {
        processedEvents.push({
          id: eid,
          orderId: event.orderId || "",
          eventType: event.eventType || event.fullCode || event.code || "",
        });
      }
      if (result.action === "error") {
        console.error(`[Brendi Poll] ERRO ${result.orderId}: ${result.message}`);
      } else {
        console.log(`[Brendi Poll] ${result.action} - ${result.orderId}${result.message ? ": " + result.message : ""}`);
      }
    }

    if (processedEvents.length > 0) {
      await brendiMutate("POST", "/v1/events/acknowledgment", processedEvents, franchiseeId);
      console.log(`[Brendi Poll] ${processedEvents.length}/${events.length} eventos acknowledged`);
    }
  } catch (err) {
    console.error("[Brendi Poll] Erro geral:", err);
  }
}

// GET: Fast polling endpoint - returns orders + auto-polls iFood, Jotaja & Brendi
export async function GET(req: NextRequest) {
  try {
    let email = "";
    try {
      const session = await getServerSession(authOptions);
      email = session?.user?.email || "";
    } catch {}

    let user = email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, storeTimezone: true } })
      : null;

    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const targetFranchiseeId = user.ownerId || user.id;

    try {
      await Promise.allSettled([
        pollIfoodEvents(targetFranchiseeId),
        pollJotajaEvents(targetFranchiseeId),
        pollBrendiEvents(targetFranchiseeId),
      ]);
    } catch (err) {
      console.error("[Poll] Erro no polling:", err);
    }

    const validFranchiseeIds = Array.from(new Set([
      targetFranchiseeId,
      user.id,
      user.ownerId
    ].filter(Boolean))) as string[];

    // ── O FEED SÓ DEVOLVE O QUE A TELA DESENHA ───────────────────────────────
    //
    // Este endpoint roda em loop enquanto o painel está aberto. Sem recorte ele
    // trazia os 200 pedidos mais recentes da loja, com TODAS as 87 colunas de
    // CustomerOrder, a cada poucos segundos — 670 KB por rodada, dos quais o
    // navegador jogava fora 182 pedidos já finalizados (o mais antigo tinha 11
    // dias). Era a maior fonte de transferência de dados da fatura do banco.
    //
    // O corte abaixo reproduz o filtro que `filteredOrders` já aplica no
    // cliente (StoreOrdersDashboard.tsx), então nada some da tela:
    //   • ENCERRADO o cliente descarta sempre → não vem;
    //   • pedido EM ANDAMENTO fica visível independente de data → sempre vem;
    //   • finalizado/cancelado respeita o período escolhido → só vem no período.
    //
    // `from`/`to` chegam do próprio navegador, que é quem sabe o fuso do
    // lojista. Sem os parâmetros o padrão é as últimas 24h, que cobre o SSR e
    // qualquer chamada antiga que não os envie.
    const ACTIVE_STATUSES = ["NOVO", "CRIANDO_IA", "ACEITO", "PREPARANDO", "PRONTO", "SAIU_ENTREGA"];

    const parseDate = (raw: string | null, fallback: Date) => {
      if (!raw) return fallback;
      const d = new Date(raw);
      return isNaN(d.getTime()) ? fallback : d;
    };
    const from = parseDate(req.nextUrl.searchParams.get("from"), new Date(Date.now() - 24 * 60 * 60 * 1000));
    const to = parseDate(req.nextUrl.searchParams.get("to"), new Date(Date.now() + 24 * 60 * 60 * 1000));

    const orders = await withRetry(() => prisma.customerOrder.findMany({
      where: {
        franchiseeId: { in: validFranchiseeIds },
        // ENCERRADO nunca é desenhado no painel — `filteredOrders` o descarta
        // na primeira linha. Trazê-lo era transferência pura sem destino.
        status: { not: "ENCERRADO" },
        AND: [{
          OR: [
            // Em andamento: sempre visível, mesmo de ontem. É o pedido que a
            // loja ainda precisa tocar.
            { status: { in: ACTIVE_STATUSES } },
            // Finalizado/cancelado: só dentro do período que a tela mostra.
            { createdAt: { gte: from, lte: to } },
            // Agendado para o período, ainda que criado antes dele.
            { scheduledDatetime: { gte: from, lte: to } },
          ],
        }],
        // ── PENDENTE DE PAGAMENTO: O DO BALCÃO APARECE, O DO CHECKOUT NÃO ─────
        //
        // Este feed escondia TODO AGUARDANDO_PAGAMENTO. Como é ele que alimenta
        // o painel de pedidos, o pedido do totem — que nasce nesse status — dava
        // as caras por um segundo (o SSR o traz) e sumia assim que o primeiro
        // poll substituía a lista inteira. O cliente que escolhe "Pagar no
        // caixa" entrega o dinheiro no balcão e o atendente não tinha o pedido
        // em tela NENHUMA para liberar: comanda nunca ia para a cozinha,
        // paymentPaidAt nunca era carimbado, estoque não baixava. Dinheiro na
        // gaveta sem venda registrada.
        //
        // Devolver todo AGUARDANDO_PAGAMENTO trocaria um problema por outro: o
        // checkout do site usa o MESMO status enquanto o cliente está na tela do
        // gateway (api/customer-order/route.ts:257), e ali quem confirma é o
        // webhook — sem nada para uma pessoa fazer. Cada carrinho abandonado no
        // Pix online viraria card permanente no painel.
        //
        // O critério é "precisa de gente": no totem o cliente está de pé no
        // balcão e só o atendente move o pedido adiante. Por isso só a origem
        // TOTEM atravessa o filtro. A impressão continua protegida à parte
        // (print-queue e GlobalPrintListener excluem este status), então
        // aparecer no painel não imprime comanda antes da hora.
        OR: [
          { status: { notIn: ["AGUARDANDO_PAGAMENTO"] } },
          { status: "AGUARDANDO_PAGAMENTO", source: "TOTEM" },
        ],
      },
      // `include` puxava as 87 colunas do pedido — nota fiscal, dados da
      // maquininha, QR do Pix, tokens de gateway — e o painel usa 41 delas.
      // No JSON o custo não é só o valor: cada chave nula ainda viaja com o
      // nome dela, 200 vezes por rodada. Campo novo no schema NÃO entra aqui
      // sozinho: se a tela passar a precisar dele, some-o nesta lista.
      select: {
        id: true, dailyOrderNumber: true, franchiseeId: true,
        customerName: true, customerPhone: true, customerAddress: true,
        deliveryType: true, deliveryBy: true, deliveryFee: true,
        paymentMethod: true, paymentPaidAt: true, gatewayProvider: true,
        totalAmount: true, changeAmount: true,
        discountTotal: true, discountIfood: true, discountMerchant: true, discountDetails: true,
        status: true, source: true, notes: true, kdsStage: true,
        createdAt: true, updatedAt: true, scheduledDatetime: true,
        cancelledBy: true, cancelReason: true, cancelDispute: true,
        motoboyId: true, motoboyFee: true,
        isRoutePriority: true, routeId: true, tableSessionId: true,
        ifoodOrderId: true, ifoodReference: true, ifoodPickupCode: true,
        ifoodStoreName: true, ifoodStoreMerchant: true,
        ifoodDriverName: true, ifoodDriverPhone: true,
        ifoodDriverStatus: true, ifoodDriverRequestedAt: true,
        openDeliveryOrderId: true, openDeliveryReference: true, openDeliveryChannel: true,
        items: {
          select: {
            id: true, quantity: true, price: true, notes: true,
            productName: true, comboSelections: true,
            menuProduct: { select: { id: true, name: true, cost: true, price: true, imageUrl: true, category: true, active: true } },
          },
        },
        motoboy: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200
    }));

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
              const parsed = typeof zeroIt.comboSelections === "string" ? JSON.parse(zeroIt.comboSelections) : (Array.isArray(zeroIt.comboSelections) ? zeroIt.comboSelections : []);
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

    // Apenas passamos os pedidos diretamente (A numeração será tratada no Client via getDisplayOrderNumber)
    const ordersWithDailyNum = orders;

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
  } catch (err: any) {
    console.error("[Poll GET Error]:", err?.message || err);
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
