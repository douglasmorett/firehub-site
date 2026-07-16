/**
 * lib/processJotajaEvent.ts
 * Lógica centralizada de processamento de eventos Open Delivery (JotaJá).
 * Usada por: webhook, cron-poll e dashboard-poll — elimina triplicação.
 */
import { prisma } from "@/lib/prisma";

export interface JotajaEvent {
  id?: string;
  code?: string;
  fullCode?: string;
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
): Promise<ProcessResult> {
  const { code, orderId } = event;
  if (!orderId) return { action: "skipped", orderId: "", message: "sem orderId" };

  const isPlaced         = code === "PLC" || event.fullCode === "PLACED";
  const isConfirmed      = code === "CFM" || event.fullCode === "CONFIRMED";
  const isPreparation    = code === "PRP" || event.fullCode === "IN_PREPARATION" || event.fullCode === "PREPARATION_STARTED";
  const isReadyPickup    = code === "RTP" || event.fullCode === "READY_TO_PICKUP";
  const isDispatched     = code === "DSP" || event.fullCode === "DISPATCHED";
  const isConcluded      = code === "CON" || event.fullCode === "CONCLUDED";
  const isCancelled      = code === "CAN" || event.fullCode === "CANCELLED";
  const isCancellationRequest =
    code === "HSD" || code === "CRR" ||
    event.fullCode === "HANDSHAKE_DISPUTE" ||
    event.fullCode === "CANCELLATION_REQUESTED";

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
      where: { openDeliveryOrderId: orderId } as any,
    });

    if (!existing) {
      // ── CRIAR pedido novo ──────────────────────────────────────────────
      const orderRes = await jotajaFetch(`/v1/orders/${orderId}`);
      if (!orderRes.ok) {
        return { action: "error", orderId, message: `GET /orders falhou: ${orderRes.status}` };
      }
      const orderData = await orderRes.json();

      // Resolve franqueado
      const merchantId = process.env.JOTAJA_MERCHANT_ID;
      const eventMerchantId = merchantId || orderData.merchant?.id;
      const franchisee = await prisma.user.findFirst({
        where: { jotajaMerchantId: eventMerchantId } as any,
      });
      if (!franchisee) {
        return { action: "error", orderId, message: `Franqueado não encontrado para merchantId=${eventMerchantId}` };
      }

      // Itens
      const items = (orderData.items ?? []).map((i: any) => ({
        price: i.unitPrice ?? i.price ?? 0,
        quantity: i.quantity ?? 1,
        menuProduct: {
          connectOrCreate: {
            where: { id: `jotaja-${i.id}` } as any,
            create: {
              id: `jotaja-${i.id}`,
              franchiseeId: franchisee.id,
              name: i.name ?? "Item Jotajá",
              description: "",
              price: i.unitPrice ?? i.price ?? 0,
              category: "Jotajá",
              active: true,
            } as any,
          } as any,
        },
      }));

      // Totais
      const total = typeof orderData.total === "object"
        ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
        : (orderData.totalPrice ?? orderData.total ?? 0);

      const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
      const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];
      const deliveryFeeValue =
        orderData.total?.deliveryFee ?? orderData.delivery?.deliveryFee ?? orderData.deliveryFee ?? 0;

      // Agendamento
      const rawScheduled =
        (orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime)
          ? orderData.scheduledDatetime
          : orderData.schedule?.scheduledDatetimeEnd
            ?? orderData.schedule?.scheduledDatetimeStart
            ?? (orderData.orderTiming === "SCHEDULED" && orderData.preparationStartDateTime
              ? orderData.preparationStartDateTime : null);
      const scheduledDatetime = rawScheduled ? new Date(rawScheduled) : null;
      const deliveryDeadline = !scheduledDatetime && orderData.delivery?.deliveryDateTime
        ? new Date(orderData.delivery.deliveryDateTime) : null;

      // Pagamento
      const cashPayment = paymentList.find((p: any) =>
        p.method === "CASH" || p.name?.toLowerCase().includes("dinheir")
      );
      const changeAmount = cashPayment?.changeFor ?? cashPayment?.cash?.changeFor ?? null;
      const payMethodName = paymentList[0]?.method ?? "Jotajá Online";
      const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? null;

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

      // Notas
      const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;
      const phone = orderData.customer?.phone;
      const phoneNumber = phone?.number ?? (typeof phone === "string" ? phone : "");
      const phoneLocalizer = phone?.localizer;

      const notesArr = [
        `Pedido Jotajá #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
        scheduledDatetime ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString("pt-BR")}` : null,
        discountTotal > 0
          ? `🏷️ Desconto R$${discountTotal.toFixed(2)} (Plataforma: R$${discountPlatform.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})`
          : null,
        customerNote ? `💬 ${customerNote}` : null,
      ].filter(Boolean).join(" | ");

      // Status inicial
      let initialStatus = "NOVO";
      if (isConfirmed)   initialStatus = "ACEITO";
      else if (isPreparation)  initialStatus = "PREPARANDO";
      else if (isReadyPickup)  initialStatus = "PRONTO";
      else if (isDispatched)   initialStatus = "SAIU_ENTREGA";
      else if (isConcluded)    initialStatus = "ENTREGUE";

      await (prisma.customerOrder as any).create({
        data: {
          franchiseeId: franchisee.id,
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

      // Auto-confirmar pedidos PLACED
      if (isPlaced) {
        try {
          await jotajaMutate(`/v1/orders/${orderId}/confirm`, { method: "POST" });
        } catch { /* não crítico */ }
      }

      return { action: "created", orderId, message: `status=${initialStatus}` };

    } else {
      // ── ATUALIZAR pedido existente ─────────────────────────────────────
      let newStatus: string | null = null;
      if (isConfirmed)   newStatus = "ACEITO";
      else if (isPreparation) newStatus = "PREPARANDO";
      else if (isReadyPickup) newStatus = "PRONTO";
      else if (isDispatched)  newStatus = "SAIU_ENTREGA";
      else if (isConcluded)   newStatus = "ENTREGUE";

      if (newStatus) {
        await (prisma.customerOrder as any).updateMany({
          where: { openDeliveryOrderId: orderId } as any,
          data: { status: newStatus },
        });
        return { action: "updated", orderId, message: `→ ${newStatus}` };
      }
      return { action: "skipped", orderId, message: "sem mudança de status" };
    }
  } catch (err: any) {
    return { action: "error", orderId, message: err.message };
  }
}
