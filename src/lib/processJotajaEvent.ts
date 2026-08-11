/**
 * lib/processJotajaEvent.ts
 * Lógica centralizada de processamento de eventos Open Delivery (JotaJá).
 * Usada por: webhook, cron-poll e dashboard-poll — elimina triplicação.
 */
import { prisma } from "@/lib/prisma";
import { isBeverageName } from "@/lib/beverage";

export interface JotajaEvent {
  id?: string;
  eventId?: string;
  code?: string;
  fullCode?: string;
  eventType?: string;
  orderId: string;
  metadata?: Record<string, any>;
}

export interface ProcessResult {
  action: "created" | "updated" | "cancelled" | "dispute" | "skipped" | "error";
  orderId: string;
  message?: string;
}

/**
 * Processa um único evento Open Delivery do JotaJá.
 * Retorna o resultado do processamento.
 * Auto-confirma pedidos PLACED via API.
 */
export async function processJotajaEvent(
  event: JotajaEvent,
  jotajaFetch: (path: string, options?: RequestInit) => Promise<Response>,
  jotajaMutate: (path: string, options?: RequestInit) => Promise<Response>,
  targetFranchiseeId?: string,
): Promise<ProcessResult> {
  const { code, orderId } = event;
  if (!orderId) return { action: "skipped", orderId: "", message: "sem orderId" };

  // Jotajá uses eventType (CREATED, CONFIRMED, etc.) in addition to code/fullCode
  const et = event.eventType?.toUpperCase() ?? "";
  const isPlaced         = code === "PLC" || event.fullCode === "PLACED" || et === "CREATED" || et === "PLACED";
  const isConfirmed      = code === "CFM" || event.fullCode === "CONFIRMED" || et === "CONFIRMED";
  const isPreparation    = code === "PRP" || event.fullCode === "IN_PREPARATION" || event.fullCode === "PREPARATION_STARTED" || et === "IN_PREPARATION" || et === "PREPARATION_STARTED";
  const isReadyPickup    = code === "RTP" || event.fullCode === "READY_TO_PICKUP" || et === "READY_TO_PICKUP";
  const isDispatched     = code === "DSP" || event.fullCode === "DISPATCHED" || et === "DISPATCHED";
  const isConcluded      = code === "CON" || event.fullCode === "CONCLUDED" || et === "CONCLUDED";
  const isCancelled      = code === "CAN" || event.fullCode === "CANCELLED" || et === "CANCELLED";
  const isCancellationRequest =
    code === "HSD" || code === "CRR" ||
    event.fullCode === "HANDSHAKE_DISPUTE" ||
    event.fullCode === "CANCELLATION_REQUESTED" ||
    et === "CANCELLATION_REQUESTED" || et === "HANDSHAKE_DISPUTE";

  try {
    // ── Negociação de cancelamento ─────────────────────────────────────────
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
          where: { openDeliveryOrderId: orderId } as any,
          data: { cancelDispute: disputeData },
        });
        return { action: "dispute", orderId, message: `disputeId=${meta.disputeId}` };
      }
      return { action: "skipped", orderId, message: "handshake ignorado" };
    }

    // ── Cancelamento definitivo ────────────────────────────────────────────
    if (isCancelled) {
      const existing: any = await prisma.customerOrder.findFirst({
        where: { openDeliveryOrderId: orderId } as any,
        select: { cancelledBy: true } as any,
      });
      const cancelData: any = { status: "CANCELADO", cancelDispute: { pending: false } };
      if (!existing?.cancelledBy || existing.cancelledBy !== "LOJA") {
        cancelData.cancelledBy = "JOTAJA";
      }
      await (prisma.customerOrder as any).updateMany({
        where: { openDeliveryOrderId: orderId } as any,
        data: cancelData,
      });
      return { action: "cancelled", orderId };
    }

    // ── Verifica idempotência ──────────────────────────────────────────────
    const existing = await prisma.customerOrder.findFirst({
      where: {
        OR: [
          { openDeliveryOrderId: orderId },
          { openDeliveryOrderId: { startsWith: `${orderId}_` } },
          { openDeliveryReference: orderId },
          { openDeliveryReference: (event as any).displayId || (event as any).orderSeqNumber }
        ].filter(Boolean)
      } as any,
    });

    if (!existing) {
      // ── CRIAR pedido novo (com até 3 tentativas resilientes) ──────────────
      let orderRes: Response | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await jotajaFetch(`/v1/orders/${orderId}`);
          if (res.ok) { orderRes = res; break; }
        } catch (e) {}
        if (attempt < 3) await new Promise(r => setTimeout(r, 500));
      }

      if (!orderRes || !orderRes.ok) {
        return { action: "error", orderId, message: `GET /orders falhou após 3 tentativas (${orderRes?.status || "network error"})` };
      }
      const orderData = await orderRes.json();

      // Resolve franqueado — MULTI-TENANT: resolução estrita por merchantId, sem fallbacks hardcoded
      let franchisee = targetFranchiseeId
        ? await prisma.user.findUnique({ where: { id: targetFranchiseeId } })
        : null;

      if (!franchisee) {
        // Resolver pelo merchantId do evento — cada loja tem seu merchantId único
        const eventMerchantId = orderData.merchant?.id;
        if (eventMerchantId) {
          franchisee = await prisma.user.findFirst({
            where: {
              jotajaMerchantId: eventMerchantId,
              jotajaConnected: true,
              NOT: { email: { startsWith: "deleted_" } },
            } as any,
          });
        }
      }
      if (!franchisee) {
        return { action: "error", orderId, message: `Nenhuma loja com merchantId correspondente (merchant: ${orderData.merchant?.id || "N/A"})` };
      }

      const franchiseeIdToUse = franchisee.ownerId || franchisee.id;

      // Helper: extract numeric value from price (handles {value, currency} objects or plain numbers)
      const priceVal = (p: any): number => typeof p === "object" && p !== null ? (p.value ?? 0) : (p ?? 0);

      // Helper: extrai recursivamente todas as opções / subitens / sabores / adições de um item do JotaJá
      const extractJotajaOptions = (item: any): any[] => {
        if (!item || typeof item !== "object") return [];
        const rawList =
          (Array.isArray(item.options) && item.options.length > 0 ? item.options : null) ??
          (Array.isArray(item.subItems) && item.subItems.length > 0 ? item.subItems : null) ??
          (Array.isArray(item.sub_items) && item.sub_items.length > 0 ? item.sub_items : null) ??
          (Array.isArray(item.garnishItems) && item.garnishItems.length > 0 ? item.garnishItems : null) ??
          (Array.isArray(item.choices) && item.choices.length > 0 ? item.choices : null) ??
          (Array.isArray(item.items) && item.items.length > 0 ? item.items : null) ??
          (Array.isArray(item.additions) && item.additions.length > 0 ? item.additions : null) ??
          (Array.isArray(item.customizations) && item.customizations.length > 0 ? item.customizations : null) ??
          (Array.isArray(item.toppings) && item.toppings.length > 0 ? item.toppings : null) ??
          [];

        const extracted: any[] = [];
        for (const o of rawList) {
          const nested = extractJotajaOptions(o);
          if (nested.length > 0) {
            extracted.push(...nested);
          } else {
            const name = o.name || o.productName || o.label || o.optionName || o.description || o.nameOption || "";
            if (name) {
              extracted.push({
                id: o.id || `opt-${Math.random().toString(36).slice(2)}`,
                name,
                quantity: o.quantity ?? o.qty ?? 1,
                price: priceVal(o.unitPrice) || priceVal(o.price) || priceVal(o.totalPrice) || priceVal(o.addition) || 0,
              });
            }
          }
        }
        return extracted;
      };

      // Itens — inclui suporte a todos os formatos de payload do Open Delivery / JotaJá
      const rawItemsList = (
        (Array.isArray(orderData.items) && orderData.items.length > 0 ? orderData.items : null) ??
        (Array.isArray(orderData.orderItems) && orderData.orderItems.length > 0 ? orderData.orderItems : null) ??
        (Array.isArray(orderData.order?.items) && orderData.order?.items.length > 0 ? orderData.order?.items : null) ??
        (Array.isArray(orderData.products) && orderData.products.length > 0 ? orderData.products : null) ??
        (Array.isArray(orderData.cart?.items) && orderData.cart?.items.length > 0 ? orderData.cart?.items : null) ??
        []
      );

      const items = rawItemsList.map((i: any) => {
        const itemName = i.name || i.productName || i.title || i.label || "Item Jotajá";
        const options = extractJotajaOptions(i);
        const optionNames = options.map((o: any) => `${o.quantity > 1 ? o.quantity + 'x ' : ''}${o.name}`);
        const fullName = optionNames.length > 0
          ? `${itemName} | ${optionNames.join(" | ")}`
          : itemName;
        const qty = i.quantity ?? i.qty ?? 1;
        const rawUnit = priceVal(i.unitPrice) || priceVal(i.price) || 0;
        const rawTotal = priceVal(i.totalPrice) || priceVal(i.total) || 0;
        const optionsSum = options.reduce(
          (sum: number, o: any) => sum + (priceVal(o.price) || priceVal(o.addition) || priceVal(o.unitPrice) || 0) * (o.quantity || 1),
          0
        );

        // Se o payload informar totalPrice da linha (incluindo subitens e acréscimos), ele tem prioridade se for maior que o preço base.
        // Caso contrário, soma o unitPrice base do item aos acréscimos das opções/sabores adicionais.
        let itemPrice = 0;
        if (rawTotal > 0 && qty > 0 && (rawTotal / qty) > rawUnit) {
          itemPrice = rawTotal / qty;
        } else if (rawUnit > 0 || optionsSum > 0) {
          itemPrice = rawUnit + optionsSum;
        } else if (rawTotal > 0 && qty > 0) {
          itemPrice = rawTotal / qty;
        }

        const comboSelsList = options.length > 0 ? options.map((o: any) => ({
          id: o.id,
          name: o.name,
          quantity: o.quantity ?? 1,
          price: priceVal(o.price) || 0,
        })) : null;

        const comboSelectionsJson = comboSelsList ? JSON.stringify(comboSelsList) : null;
        const itemId = i.id || i.externalId || `item-${Math.random().toString(36).slice(2)}`;

        return {
          price: itemPrice,
          quantity: qty,
          comboSelections: comboSelectionsJson,
          menuProduct: {
            connectOrCreate: {
              where: { id: `jotaja-${itemId}` } as any,
              create: {
                id: `jotaja-${itemId}`,
                franchiseeId: franchisee.id,
                name: fullName,
                description: i.specialInstructions || i.observations || i.notes || "",
                price: itemPrice,
                category: i.category || "Jotajá",
                isBeverage: isBeverageName(fullName) || options.some((o: any) => isBeverageName(o.name)),
                active: true,
              } as any,
            } as any,
          },
        };
      });

      // Totais — handles {value, currency} objects
      const rawTotal = orderData.total?.orderAmount ?? orderData.total?.subTotal ?? orderData.totalPrice ?? orderData.total;
      const total = priceVal(rawTotal);

      const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
      const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

      // Delivery fee — Jotajá sends in total.deliveryFee or otherFees array
      let deliveryFeeValue = priceVal(orderData.total?.deliveryFee) || priceVal(orderData.delivery?.deliveryFee) || priceVal(orderData.deliveryFee) || 0;
      if (!deliveryFeeValue && Array.isArray(orderData.otherFees)) {
        const delFee = orderData.otherFees.find((f: any) =>
          (f.type || f.name || "").toUpperCase().includes("DELIVERY") ||
          (f.type || f.name || "").toUpperCase().includes("FRETE") ||
          (f.type || f.name || "").toUpperCase().includes("FEE")
        );
        if (delFee) deliveryFeeValue = priceVal(delFee.price ?? delFee.value);
      }

      // Descontos/benefits (completo)
      const benefits = orderData.benefits ?? [];
      let discountPlatform = 0, discountMerchant = 0, discountTotal = 0;
      const discountDetails: any[] = [];
      for (const benefit of benefits) {
        const value = benefit.value ?? 0;
        discountTotal += value;
        const sponsorships = Array.isArray(benefit.sponsorshipValues)
          ? benefit.sponsorshipValues
          : benefit.sponsorshipValues ? [benefit.sponsorshipValues] : [];
        let bPlatform = 0, bMerchant = 0;
        for (const sp of sponsorships) {
          const spName = (sp.name ?? sp.sponsorship ?? "").toUpperCase();
          const spValue = sp.value ?? 0;
          if (spName === "MERCHANT") bMerchant += spValue;
          else bPlatform += spValue;
        }
        if (sponsorships.length === 0 && value > 0) {
          if ((benefit.sponsorship ?? "").toUpperCase() === "MERCHANT") bMerchant += value;
          else bPlatform += value;
        }
        discountPlatform += bPlatform;
        discountMerchant += bMerchant;
        discountDetails.push({
          target: benefit.target ?? "CART",
          value, platform: bPlatform, merchant: bMerchant,
          description: benefit.campaign?.name ?? benefit.description ?? null,
        });
      }

      // Se a taxa de entrega ainda veio 0 em pedido DELIVERY, calcula como a diferença entre total e subtotal
      if (deliveryFeeValue === 0 && (orderData.total?.orderAmount || orderData.totalPrice) && orderData.total?.subTotal) {
        const orderTotal = priceVal(orderData.total?.orderAmount ?? orderData.totalPrice);
        const subTotal = priceVal(orderData.total?.subTotal);
        const benefitsValue = discountTotal || 0;
        const calcFee = orderTotal - subTotal + benefitsValue;
        if (calcFee > 0 && calcFee < 100) {
          deliveryFeeValue = Math.round(calcFee * 100) / 100;
        }
      }
      // Data de entrega / Prazo limite do JotaJá
      const isTakeout =
        orderData.orderType === "TAKEOUT" ||
        Boolean(orderData.takeout) ||
        orderData.deliveryType === "TAKEOUT" ||
        orderData.deliveryType === "RETIRADA";

      const createdMs = orderData.createdAt ? new Date(orderData.createdAt).getTime() : Date.now();

      const isExplicitScheduled =
        orderData.orderTiming === "SCHEDULED" ||
        Boolean(orderData.schedule?.scheduledDatetimeEnd) ||
        Boolean(orderData.schedule?.scheduledDatetimeStart) ||
        orderData.takeout?.mode === "SCHEDULED" ||
        orderData.delivery?.mode === "SCHEDULED";

      let scheduledDatetime: Date | null = null;

      if (isExplicitScheduled) {
        const rawScheduled =
          orderData.schedule?.scheduledDatetimeEnd ??
          orderData.schedule?.scheduledDatetimeStart ??
          orderData.scheduledDatetime ??
          orderData.preparationStartDateTime;
        if (rawScheduled) {
          scheduledDatetime = new Date(rawScheduled);
        }
      } else {
        // Pedido Imediato: Se for Retirada no local, o prazo é 40 minutos a partir da criação
        if (isTakeout) {
          const rawTakeoutEnd = orderData.takeout?.estimatedTakeoutWindow?.end || orderData.takeout?.takeoutDeadline;
          if (rawTakeoutEnd && new Date(rawTakeoutEnd).getTime() > createdMs + 5 * 60000) {
            scheduledDatetime = new Date(rawTakeoutEnd);
          } else {
            scheduledDatetime = new Date(createdMs + 40 * 60000); // 40 minutos para Retirada
          }
        } else {
          const rawDeliveryEnd = orderData.delivery?.deliveryDeadline || orderData.delivery?.estimatedDeliveryWindow?.end;
          if (rawDeliveryEnd && new Date(rawDeliveryEnd).getTime() > createdMs + 5 * 60000) {
            scheduledDatetime = new Date(rawDeliveryEnd);
          } else {
            scheduledDatetime = new Date(createdMs + 50 * 60000); // 50 minutos para Entrega
          }
        }
      }
      const deliveryDeadline = scheduledDatetime;

      // Pagamento
      const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
      const parsedPay = parseOrderPaymentInfo(orderData, "JOTAJA");
      const resolvedPaymentMethod = parsedPay.paymentMethod;
      const changeAmount = parsedPay.changeAmount;

      const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? orderData.customer?.documentNumber ?? null;

      // Notas — customer observations prominent
      const customerNote = orderData.extraInfo ?? orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;
      const phone = orderData.customer?.phone;
      const phoneNumber = phone?.number ?? (typeof phone === "string" ? phone : "");
      const phoneLocalizer = phone?.localizer;

      // Collect item-level special instructions
      const itemNotes = (orderData.items ?? [])
        .filter((i: any) => i.specialInstructions?.trim())
        .map((i: any) => `${i.name}: ${i.specialInstructions.trim()}`);

      const notesArr = [
        `Pedido Jotajá #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
        scheduledDatetime ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString("pt-BR")}` : null,
        discountTotal > 0
          ? `🏷️ Desconto R$${discountTotal.toFixed(2)} (Plataforma: R$${discountPlatform.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})`
          : null,
        customerNote ? `📝 OBS: ${customerNote}` : null,
        ...itemNotes.map((n: string) => `📝 ${n}`),
      ].filter(Boolean).join("\n");

      // Status inicial
      let initialStatus = "NOVO";
      if (isConfirmed)   initialStatus = "ACEITO";
      else if (isPreparation)  initialStatus = "PREPARANDO";
      else if (isReadyPickup)  initialStatus = "PRONTO";
      else if (isDispatched)   initialStatus = "SAIU_ENTREGA";
      else if (isConcluded)    initialStatus = "ENTREGUE";

      // === CRIAR PEDIDO COM RETRY (barreira anti-perda) ===
      let createSuccess = false;
      let lastCreateError: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchiseeIdToUse,
              openDeliveryOrderId: orderId,
              openDeliveryReference: orderData.displayId ?? undefined,
              openDeliveryChannel: "JOTAJA",
              scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
              changeAmount,
              customerCpfCnpj,
              discountTotal: discountTotal > 0 ? discountTotal : null,
              discountMerchant: discountMerchant > 0 ? discountMerchant : null,
              discountDetails: discountDetails.length > 0 ? discountDetails : undefined,
              source: "JOTAJA",
              customerName: orderData.customer?.name ?? "Cliente Jotajá",
              customerPhone: phoneLocalizer ? `${phoneNumber} ID: ${phoneLocalizer}` : phoneNumber,
              customerAddress: (() => {
                const addr = orderData.delivery?.deliveryAddress;
                if (!addr) return "";
                const formatted = addr.formattedAddress || "";
                const street = addr.streetName ? `${addr.streetName}${addr.streetNumber ? ` ${addr.streetNumber}` : ""}${addr.complement ? ` ${addr.complement}` : ""}` : formatted;
                const neighborhood = addr.neighborhood || "";
                const city = addr.city || "";
                const parts: string[] = [];
                if (street) parts.push(street);
                if (neighborhood && (!street || !street.toLowerCase().includes(neighborhood.toLowerCase()))) {
                  parts.push(neighborhood);
                }
                if (city) parts.push(city);
                return parts.join(" - ");
              })(),
              deliveryType: (() => {
                const ot = (orderData.orderType || "").toUpperCase();
                const dm = (orderData.deliveryMode || orderData.takeoutMode || "").toUpperCase();
                const isTakeout =
                  ot === "TAKEOUT" ||
                  ot === "TOGO" ||
                  ot === "PICKUP" ||
                  ot === "RETIRADA" ||
                  ot === "IN_STORE" ||
                  Boolean(orderData.takeout) ||
                  (dm !== "" && dm !== "DELIVERY") ||
                  (!orderData.delivery?.deliveryAddress?.streetName && !orderData.delivery?.deliveryAddress?.formattedAddress && deliveryFeeValue === 0);
                return isTakeout ? "RETIRADA" : "DELIVERY";
              })(),
              paymentMethod: resolvedPaymentMethod,
              totalAmount: total,
              deliveryFee: deliveryFeeValue,
              status: initialStatus,
              createdAt: new Date(),
              items: {
                create: items,
              },
            },
          });
          createSuccess = true;
          break; // Sucesso — sai do loop de retry
        } catch (createErr: any) {
          lastCreateError = createErr;
          // Unique constraint = pedido já existe (race condition) — não é erro real
          if (createErr?.code === "P2002") {
            console.log(`[Jotaja] ℹ️ Pedido ${orderId} já existe (race condition detectada) — ok`);
            return { action: "skipped", orderId, message: "duplicata detectada via constraint" };
          }
          console.error(`[Jotaja] ❌ Tentativa ${attempt}/3 de criar pedido ${orderId} FALHOU:`, createErr?.message);
          if (attempt < 3) {
            await new Promise(res => setTimeout(res, 2000)); // Espera 2s antes de retry
          }
        }
      }

      if (!createSuccess) {
        // FALLBACK: Salvar dados mínimos do pedido para recuperação manual
        console.error(`[Jotaja] 🚨 PEDIDO PERDIDO APÓS 3 TENTATIVAS — orderId=${orderId}, cliente=${orderData.customer?.name}, total=${total}`);
        try {
          // Tenta criar com dados mínimos (sem itens complexos) como última barreira
          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchiseeIdToUse,
              openDeliveryOrderId: `${orderId}_recovered`,
              openDeliveryReference: orderData.displayId ?? undefined,
              openDeliveryChannel: "JOTAJA",
              source: "JOTAJA",
              customerName: orderData.customer?.name ?? "Cliente Jotajá (RECUPERADO)",
              customerPhone: phoneLocalizer ? `${phoneNumber} ID: ${phoneLocalizer}` : phoneNumber,
              customerAddress: orderData.delivery?.deliveryAddress?.formattedAddress || "",
              deliveryType: "DELIVERY",
              paymentMethod: resolvedPaymentMethod || "Verificar",
              totalAmount: total,
              deliveryFee: deliveryFeeValue,
              status: "NOVO",
              notes: `⚠️ PEDIDO RECUPERADO — Erro original: ${lastCreateError?.message?.slice(0, 200)}. Verifique itens manualmente.`,
              createdAt: new Date(),
              items: {
                create: [{
                  quantity: 1,
                  price: total,
                  menuProduct: {
                    connectOrCreate: {
                      where: { id: `jotaja-recovered-${orderId}` } as any,
                      create: {
                        id: `jotaja-recovered-${orderId}`,
                        franchiseeId: franchiseeIdToUse,
                        name: `Pedido JotaJá #${orderData.displayId || orderId.slice(-6)} (verificar itens)`,
                        description: "Pedido recuperado automaticamente",
                        price: total,
                        category: "Jotajá",
                        active: true,
                      } as any,
                    } as any,
                  },
                }],
              },
            },
          });
          console.log(`[Jotaja] 🛟 Pedido ${orderId} RECUPERADO com dados mínimos!`);
          return { action: "created", orderId, message: `RECUPERADO com dados mínimos após falha: ${lastCreateError?.message}` };
        } catch (fallbackErr: any) {
          console.error(`[Jotaja] 🚨🚨 FALHA TOTAL — nem o fallback funcionou para ${orderId}:`, fallbackErr?.message);
          return { action: "error", orderId, message: `FALHA TOTAL: ${lastCreateError?.message}` };
        }
      }

      // BROADCAST REMOVIDO — Esse bloco criava cópias do pedido para contas secundárias,
      // causando duplicatas massivas (7x por pedido). Cada pedido Jotajá deve existir
      // APENAS UMA VEZ, vinculado ao franchisee principal (contatohakim@gmail.com).

      // Auto-confirmar pedidos PLACED
      if (isPlaced) {
        try {
          await jotajaMutate(`/v1/orders/${orderId}/confirm`, { method: "POST" });
        } catch { /* não crítico */ }
      }
      // Auto-enfileira impressão térmica para novos pedidos do JotaJá
      try {
        const fullOrder = await prisma.customerOrder.findFirst({
          where: { openDeliveryOrderId: orderId },
          include: {
            items: {
              include: { menuProduct: { select: { id: true, name: true, isBeverage: true } } }
            }
          }
        });
        if (fullOrder) {
          const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
          pushJobToPrintQueue(franchisee.id, fullOrder, (franchisee as any).storeName || "HAKIM RIO DAS OSTRAS");
        }
      } catch (printErr) {
        console.error("[Jotaja] Erro ao enfileirar auto-impressão:", printErr);
      }

      return { action: "created", orderId, message: `status=${initialStatus}` };

    } else {
      // ── ATUALIZAR pedido existente (Apenas avançar status, NUNCA retroceder) ─────────────────
      const FINAL_STATUSES = ["ENTREGUE", "ENCERRADO", "CANCELADO"];
      if (existing && FINAL_STATUSES.includes(existing.status)) {
        return { action: "skipped", orderId, message: `pedido já finalizado (${existing.status}) - mantido` };
      }

      let newStatus: string | null = null;
      if (isConfirmed)   newStatus = "ACEITO";
      else if (isPreparation) newStatus = "PREPARANDO";
      else if (isReadyPickup) newStatus = "PRONTO";
      else if (isDispatched)  newStatus = "SAIU_ENTREGA";
      else if (isConcluded)   newStatus = "ENTREGUE";

      if (newStatus) {
        const STATUS_RANK: Record<string, number> = {
          NOVO: 0, ACEITO: 1, PREPARANDO: 2, PRONTO: 3, SAIU_ENTREGA: 4, ENTREGUE: 5, ENCERRADO: 5, CANCELADO: 5
        };
        const currentRank = STATUS_RANK[existing?.status || "NOVO"] || 0;
        const newRank = STATUS_RANK[newStatus] || 0;

        if (newRank >= currentRank) {
          await (prisma.customerOrder as any).updateMany({
            where: {
              OR: [
                { openDeliveryOrderId: orderId },
                { openDeliveryOrderId: { startsWith: `${orderId}_` } },
                { openDeliveryReference: orderId }
              ]
            } as any,
            data: { status: newStatus },
          });
          return { action: "updated", orderId, message: `→ ${newStatus}` };
        } else {
          return { action: "skipped", orderId, message: `ignorado regresso de status ${existing?.status} → ${newStatus}` };
        }
      }
      return { action: "skipped", orderId, message: "sem mudança de status" };
    }
  } catch (err: any) {
    return { action: "error", orderId, message: err.message };
  }
}
