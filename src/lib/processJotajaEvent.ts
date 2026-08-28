/**
 * lib/processJotajaEvent.ts
 * Lógica centralizada de processamento de eventos Open Delivery (JotaJá).
 * Usada por: webhook, cron-poll e dashboard-poll — elimina triplicação.
 */
import { prisma } from "@/lib/prisma";
import { isBeverageName } from "@/lib/beverage";
import { generateDailyOrderNumber } from "@/lib/order-number";

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
  const { code, orderId } = event || {} as JotajaEvent;
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
    // openDeliveryOrderId é globalmente único (@unique no schema) — busca global
    // openDeliveryReference NÃO é único (schema.prisma: só @@index) e é gravado
    // também por 99Food, pela API v1 e pelo import manual. Casar só por ele
    // encontrava o pedido de outro canal, o evento virava "sem mudança de
    // status", vinha o ACK e o pedido novo sumia. Por isso exige canal + loja.
    const idempotencyConditions: any[] = [
      { openDeliveryOrderId: orderId },
      { openDeliveryOrderId: { startsWith: `${orderId}_` } },
    ];
    if (targetFranchiseeId) {
      idempotencyConditions.push({
        openDeliveryReference: orderId,
        franchiseeId: targetFranchiseeId,
        openDeliveryChannel: "JOTAJA",
      });
      const displayRef = (event as any).displayId || (event as any).orderSeqNumber;
      if (displayRef) {
        idempotencyConditions.push({
          openDeliveryReference: String(displayRef),
          franchiseeId: targetFranchiseeId,
          openDeliveryChannel: "JOTAJA",
        });
      }
    }
    const existing = await prisma.customerOrder.findFirst({
      where: { OR: idempotencyConditions } as any,
    });

    if (!existing) {
      // ── CRIAR pedido novo (com até 3 tentativas resilientes) ──────────────
      let orderRes: Response | null = null;
      let ultimoErro = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await jotajaFetch(`/v1/orders/${orderId}`);
          if (res.ok) { orderRes = res; break; }
          ultimoErro = `HTTP ${res.status}`;
        } catch (e: any) {
          ultimoErro = e?.message || "erro de rede";
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, 500));
      }

      if (!orderRes || !orderRes.ok) {
        const msg = `GET /orders falhou após 3 tentativas (${ultimoErro || "network error"})`;
        // Sem log, este era o caminho em que o pedido sumia sem deixar rastro.
        console.error(`[Jotaja] ❌ ${orderId}: ${msg}`);
        return { action: "error", orderId, message: msg };
      }
      const orderData = await orderRes.json();

      // Resolve franqueado — MULTI-TENANT: resolução estrita por merchantId
      const eventMerchantId = orderData.merchant?.id;
      let franchisee: any = null;

      // 1. Prioridade absoluta: buscar loja que possui exatamente o jotajaMerchantId do evento
      if (eventMerchantId) {
        franchisee = await prisma.user.findFirst({
          where: {
            jotajaMerchantId: eventMerchantId,
            NOT: { email: { startsWith: "deleted_" } },
          } as any,
        });
      }

      // 2. Se não encontrou por merchantId e temos targetFranchiseeId, verificar se o target é compatível
      if (!franchisee && targetFranchiseeId) {
        const candidate = await prisma.user.findUnique({ where: { id: targetFranchiseeId } });
        if (candidate) {
          // MULTI-TENANT: aceitar APENAS se o merchantId bate OU se não veio merchantId no evento
          if (!eventMerchantId || candidate.jotajaMerchantId === eventMerchantId) {
            franchisee = candidate;
          }
        }
      }

      // 3. SEM FALLBACK — se não encontrou loja, é erro (nunca atribuir a outra loja)
      if (!franchisee) {
        const msg = `Nenhuma loja com merchantId correspondente (merchant: ${eventMerchantId || "N/A"})`;
        console.error(`[Jotaja] ❌ ${orderId}: ${msg}`);
        return { action: "error", orderId, message: msg };
      }

      const franchiseeIdToUse = franchisee.ownerId || franchisee.id;

      // ── 2ª barreira de idempotência: pelo NÚMERO do pedido no JotaJá ───────
      // O evento do feed traz só o UUID. O número que o lojista vê (displayId)
      // aparece agora, no corpo do pedido — e é por ele que casam os pedidos
      // que entraram por outro caminho: import manual ou resgate de um pedido
      // que o feed não entregou. Sem esta checagem o mesmo pedido vai duas
      // vezes para a cozinha.
      const displayIdReal = orderData.displayId ?? orderData.orderSeqNumber ?? null;
      if (displayIdReal) {
        const jaImportado = await prisma.customerOrder.findFirst({
          where: {
            franchiseeId: franchiseeIdToUse,
            openDeliveryChannel: "JOTAJA",
            OR: [
              { openDeliveryReference: String(displayIdReal) },
              { openDeliveryOrderId: String(displayIdReal) },
            ],
          } as any,
          select: { id: true, dailyOrderNumber: true, openDeliveryOrderId: true },
        });
        if (jaImportado) {
          // Amarra o UUID ao pedido que já está lá, para os eventos de status
          // seguintes (CONFIRMED, DISPATCHED…) o encontrarem pelo caminho normal.
          if (jaImportado.openDeliveryOrderId !== orderId) {
            await prisma.customerOrder
              .update({
                where: { id: jaImportado.id },
                data: { openDeliveryOrderId: orderId, openDeliveryReference: String(displayIdReal) },
              })
              .catch(() => {});
          }
          console.log(`[Jotaja] ℹ️ ${orderId} já existe como #${jaImportado.dailyOrderNumber} (entrou por outro caminho) — não duplicado`);
          return { action: "updated", orderId, message: `já existia como #${jaImportado.dailyOrderNumber}; UUID vinculado` };
        }
      }

      // REGRA DE OURO: Gerar dailyOrderNumber sequencial — entra no FINAL da fila sem mexer em nada existente
      const dailyOrderNumber = await generateDailyOrderNumber(franchiseeIdToUse);

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

        // Preço do item:
        // 1. Se totalPrice disponível → usar direto (já inclui opções pagas corretamente)
        // 2. Senão, calcular: unitPrice base + soma de opções que são ADIÇÕES
        let itemPrice = 0;
        if (rawTotal > 0 && qty > 0) {
          // totalPrice do JotaJá já inclui tudo (base + opções cobradas)
          itemPrice = rawTotal / qty;
        } else if (rawUnit > 0) {
          // Sem totalPrice — somar manualmente apenas adições
          const additionsSum = options.reduce(
            (sum: number, o: any) => sum + (priceVal(o.addition) || 0) * (o.quantity || 1),
            0
          );
          itemPrice = rawUnit + additionsSum;
        } else {
          // Fallback: usar soma de opções como preço total
          const optionsSum = options.reduce(
            (sum: number, o: any) => sum + (priceVal(o.price) || priceVal(o.addition) || priceVal(o.unitPrice) || 0) * (o.quantity || 1),
            0
          );
          itemPrice = optionsSum;
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
          price: Math.round(itemPrice * 100) / 100,
          quantity: qty,
          productName: fullName,
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
                active: false,
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

      // ── CUPOM / DESCONTO ───────────────────────────────────────────────────
      // O JotaJá aplica cupom (ex.: HAKIM10, -10%) e manda o total já abatido,
      // mas nem sempre preenche `benefits` (padrão Open Delivery). O resultado
      // na comanda era um total menor que a soma dos itens, sem uma linha
      // dizendo por quê — a cozinha e o caixa viam "sumir" dinheiro.
      // Aqui: primeiro procuramos o cupom nos campos conhecidos; se não houver
      // valor de desconto, deduzimos pela diferença (itens + taxa − total),
      // que é aritmética e não depende do formato do payload.
      // Verificado contra a API real em 23/08/2026: o payload do JotaJá NÃO tem
      // `benefits` (o array que este código lia). O desconto vem em
      // `total.discount`, ao lado de itemsPrice / otherFees / orderAmount:
      //   total: { itemsPrice: {value}, otherFees: {value},
      //            discount: {value}, orderAmount: {value} }
      // Por isso o cupom (ex.: HAKIM10 -10%) sumia: o total chegava abatido, o
      // desconto ficava em zero e a comanda mostrava um total menor que a soma
      // dos itens, sem explicação. O código do cupom não vem no Open Delivery —
      // só o valor —, então mostramos o percentual.
      const cupomCodigo: string | null =
        orderData.coupon?.code ?? orderData.cupom?.codigo ?? orderData.voucher?.code ?? orderData.promoCode ?? null;

      if (discountTotal === 0) {
        const descontoDoPayload = priceVal(orderData.total?.discount);
        const somaItens = priceVal(orderData.total?.itemsPrice) ||
          items.reduce((s: number, it: any) => s + (it.price || 0) * (it.quantity || 1), 0);

        // Fonte primária: total.discount. Se vier ausente, deduz pela aritmética
        // (itens + taxa − total), que independe do formato do payload.
        const valor = descontoDoPayload > 0
          ? descontoDoPayload
          : Math.round((somaItens + deliveryFeeValue - total) * 100) / 100;

        if (valor > 0.01 && somaItens > 0) {
          discountTotal = Math.round(valor * 100) / 100;
          discountMerchant = discountTotal; // sem sponsorship no payload: é da loja
          const pct = Math.round((discountTotal / somaItens) * 100);
          discountDetails.push({
            target: "CART",
            value: discountTotal,
            platform: 0,
            merchant: discountTotal,
            description: cupomCodigo
              ? `Cupom ${String(cupomCodigo).toUpperCase()}${pct > 0 ? ` (-${pct}%)` : ""}`
              : `Cupom JotaJá${pct > 0 ? ` (-${pct}%)` : ""}`,
          });
        }
      } else if (cupomCodigo && discountDetails.length > 0 && !discountDetails[0].description) {
        discountDetails[0].description = `Cupom ${String(cupomCodigo).toUpperCase()}`;
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
      const itemNotes = rawItemsList
        .filter((i: any) => i.specialInstructions?.trim())
        .map((i: any) => `${i.name || i.productName || 'Item'}: ${i.specialInstructions.trim()}`);

      const notesArr = [
        `Pedido Jotajá #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
        (scheduledDatetime && isExplicitScheduled) ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString("pt-BR")}` : null,
        discountTotal > 0
          ? `🏷️ ${discountDetails[0]?.description || "Desconto"}: -R$${discountTotal.toFixed(2)}` +
            (discountPlatform > 0 ? ` (Plataforma: R$${discountPlatform.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : "")
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

      const dByRaw = (
        orderData.delivery?.deliveredBy ||
        orderData.delivery?.deliveryBy ||
        orderData.deliveredBy ||
        orderData.deliveryBy ||
        orderData.logistics?.deliveryBy ||
        orderData.logistics?.deliveredBy ||
        ""
      ).toString().toUpperCase();

      const deliveryBy = (
        dByRaw.includes("PARTNER") ||
        dByRaw.includes("LOGISTICS") ||
        dByRaw.includes("JOTAJA")
      ) ? "JOTAJA" : "MERCHANT";

      const pickupCode = (
        orderData.delivery?.pickupCode ||
        orderData.pickupCode ||
        orderData.driver?.pickupCode ||
        orderData.logistics?.pickupCode ||
        null
      )?.toString().trim() || null;

      // === CRIAR PEDIDO COM RETRY (barreira anti-perda) ===
      let createSuccess = false;
      let lastCreateError: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchiseeIdToUse,
              dailyOrderNumber,
              kdsStage: "PRODUCTION",
              kdsProductionAt: new Date(),
              openDeliveryOrderId: orderId,
              openDeliveryReference: orderData.displayId ?? undefined,
              openDeliveryChannel: "JOTAJA",
              scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
              changeAmount,
              customerCpfCnpj,
              deliveryBy,
              ifoodPickupCode: pickupCode ?? undefined,
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
              totalAmount: Math.round(total * 100) / 100,
              deliveryFee: Math.round(deliveryFeeValue * 100) / 100,
              status: initialStatus,
              notes: notesArr || undefined,
              createdAt: new Date(),
              items: {
                create: items,
              },
            },
          });
          createSuccess = true;

          // ── BAIXA DE ESTOQUE ──────────────────────────────────────────────
          //
          // Não existia neste caminho (nem em nenhum outro de marketplace): o
          // pedido do Jotajá entrava e o estoque não sentia. O único gatilho
          // do sistema era a TRANSIÇÃO para ACEITO, e o pedido importado já
          // nasce no status final — nunca transita.
          //
          // A ficha técnica do produto-espelho é resolvida em src/lib/stock.ts
          // pelo nome do produto no cardápio. Idempotente por `sourceRef`, e
          // sem await para não segurar a importação.
          try {
            const criado = await prisma.customerOrder.findFirst({
              // O Jotajá grava em `openDeliveryOrderId` (o padrão Open
              // Delivery), não num campo próprio — é o mesmo campo que o
              // Brendi e o 99Food usam.
              where: { franchiseeId: franchisee.id, openDeliveryOrderId: orderId } as any,
              select: { id: true },
              orderBy: { createdAt: "desc" },
            });
            if (criado) {
              const { deductStockForOrder } = await import("@/lib/stock");
              deductStockForOrder(criado.id).catch((e) =>
                console.error(`[Jotaja] Baixa de estoque falhou para ${orderId}:`, e?.message)
              );
            }
          } catch (e: any) {
            console.error(`[Jotaja] Não consegui disparar a baixa de ${orderId}:`, e?.message);
          }

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
          // Gerar novo número sequencial para o fallback (pode ter mudado desde o primeiro try)
          const recoveryDailyNumber = await generateDailyOrderNumber(franchiseeIdToUse);
          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchiseeIdToUse,
              dailyOrderNumber: recoveryDailyNumber,
              kdsStage: "PRODUCTION",
              kdsProductionAt: new Date(),
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
          const updateConditions: any[] = [
            { openDeliveryOrderId: orderId },
            { openDeliveryOrderId: { startsWith: `${orderId}_` } },
          ];
          if (targetFranchiseeId) {
            updateConditions.push({ openDeliveryReference: orderId, franchiseeId: targetFranchiseeId });
          }
          await (prisma.customerOrder as any).updateMany({
            where: { OR: updateConditions } as any,
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
    console.error(`[Jotaja] ❌ Exceção processando ${orderId}:`, err?.message, err?.stack?.split("\n")[1]?.trim());
    return { action: "error", orderId, message: err.message };
  }
}
