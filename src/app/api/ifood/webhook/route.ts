import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { getIfoodItemUnitPrice } from "@/lib/ifood-api";

// Valida assinatura HMAC do iFood (segurança)
function validateIfoodSignature(body: string, signature: string | null): boolean {
  if (!process.env.IFOOD_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto
    .createHmac("sha256", process.env.IFOOD_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  return `sha256=${expected}` === signature;
}

import { parseOrderPaymentInfo } from "@/lib/payment-parser";

export function parseIfoodPaymentInfo(orderData: any): { paymentMethod: string; changeAmount: number | null } {
  const parsed = parseOrderPaymentInfo(orderData, "IFOOD");
  return {
    paymentMethod: parsed.paymentMethod,
    changeAmount: parsed.changeAmount,
  };
}

// Mapeia status do iFood (curto e longo) para status do FireHub
const STATUS_MAP: Record<string, string> = {
  PLC:                 "NOVO",
  PLACED:              "NOVO",
  CFM:                 "ACEITO",
  CONFIRMED:           "ACEITO",
  PRP:                 "PREPARANDO",
  PRS:                 "PREPARANDO",
  IN_PREPARATION:      "PREPARANDO",
  PREPARATION_STARTED: "PREPARANDO",
  RTP:                 "PREPARANDO",
  READY_TO_PICKUP:     "PREPARANDO",
  DSP:                 "SAIU_ENTREGA",
  DISPATCHED:          "SAIU_ENTREGA",
  CON:                 "ENTREGUE",
  CONCLUDED:           "ENTREGUE",
  CAN:                 "CANCELADO",
  CANCELLED:           "CANCELADO",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-ifood-signature");

  // Log payload recebido
  console.log(`[iFood Webhook] 📥 Request recebido: ${rawBody.slice(0, 300)}`);

  // Em produção, valida assinatura mas não bloqueia se falhar para não perder pedidos
  if (process.env.NODE_ENV === "production" && process.env.IFOOD_WEBHOOK_SECRET) {
    if (!validateIfoodSignature(rawBody, signature)) {
      console.warn("[iFood Webhook] ⚠️ Assinatura não bateu ou ausente. Processando mesmo assim.");
    }
  }

  let events: any[];
  try {
    const body = JSON.parse(rawBody);
    events = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // Processa eventos sincronicamente (Vercel serverless termina ao retornar response)
  for (const event of events) {
    try {
      await processIfoodEvent(event);
    } catch (err) {
      console.error("[iFood Webhook] Erro ao processar evento:", event?.id, err);
    }
  }

  // Responde 200 ao iFood (exige resposta em até 8 segundos)
  return NextResponse.json({ received: true });
}

// Polling de eventos (alternativa/backup ao webhook)
export async function GET(req: NextRequest) {
  const { getIfoodToken } = await import("@/lib/ifood-api");
  const merchantId = process.env.IFOOD_MERCHANT_UUID;
  if (!merchantId) return NextResponse.json({ error: "IFOOD_MERCHANT_UUID não configurado" }, { status: 500 });

  let token: string;
  try {
    token = await getIfoodToken();
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json({ events: [], error: `${res.status} ${errText}` });
  }
  
  const dataText = await res.text();
  const data = dataText ? JSON.parse(dataText) : [];

  const franchisee = await prisma.user.findFirst({
    where: { email: "contatohakim@gmail.com" }
  }) || await prisma.user.findFirst({
    where: { ifoodMerchantId: merchantId } as any,
  });
  
  if (!franchisee) {
    return NextResponse.json({ events: [], error: `Nenhum franqueado encontrado para merchantId: ${merchantId}` });
  }

  for (const event of data ?? []) {
    try {
      await processIfoodEvent(event, franchisee.id);
    } catch (err) {
      console.error("[iFood Polling] Erro ao processar evento:", event?.id, err);
    }
  }

  const eventsToAck = (data ?? []).filter((e: any) => e.id).map((e: any) => ({
    id: e.id,
  }));
  if (eventsToAck.length > 0) {
    await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventsToAck),
    });
  }

  return NextResponse.json({ processed: eventsToAck.length, events: data ?? [] });
}

// ─── Processa um evento do iFood ──────────────────────────────────────────
async function processIfoodEvent(event: any, franchiseeIdOverride?: string) {
  const { code, orderId, merchantId } = event;
  if (!orderId) return;

  const eventCode = code || event.fullCode || "";
  console.log(`[iFood Webhook] 📋 Evento: code=${code}, fullCode=${event.fullCode}, orderId=${orderId}`);

  const isCancelled = eventCode === "CAN" || eventCode === "CANCELLED";

  // Busca se o pedido já existe no DB
  const exists = await prisma.customerOrder.findFirst({
    where: { ifoodOrderId: orderId } as any,
  });

  // CATCH-ALL CREATOR: Se o pedido ainda não existe no DB e não é cancelamento, cria agora!
  if (!exists && !isCancelled) {
    const { getIfoodToken } = await import("@/lib/ifood-api");
    const token = await getIfoodToken();

    let franchisee = await prisma.user.findFirst({
      where: { email: "contatohakim@gmail.com" }
    }) || (merchantId ? await prisma.user.findFirst({
      where: { ifoodMerchantId: merchantId } as any,
    }) : null);

    if (!franchisee && franchiseeIdOverride) {
      franchisee = await prisma.user.findUnique({ where: { id: franchiseeIdOverride } });
    }
    if (!franchisee) {
      console.error(`[iFood Webhook] ❌ Nenhum franqueado encontrado para merchantId: ${merchantId}`);
      return;
    }

    const orderData = event.data ?? await fetchIfoodOrderDetails(orderId, token);
    if (!orderData) {
      console.error(`[iFood Webhook] ❌ Falha ao buscar detalhes do pedido ${orderId}`);
      return;
    }

    // Extrai itens e sub-itens (comboSelections)
    const rawItems = orderData.items ?? [];
    const items = rawItems.map((i: any) => {
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
              id:           `ifood-${i.id}`,
              franchiseeId: franchisee.id,
              name:         i.name ?? i.description ?? "Item iFood",
              description:  "",
              price:        itemUnitPrice,
              category:     "iFood",
              active:       true,
            } as any,
          } as any,
        },
      };
    });

    const total = typeof orderData.total === "object"
      ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
      : (orderData.totalPrice ?? orderData.total ?? 0);

    const scheduledDatetime = orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime
      ? new Date(orderData.scheduledDatetime)
      : null;

    const { paymentMethod: parsedPaymentMethod, changeAmount } = parseIfoodPaymentInfo(orderData);
    const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber
      ?? orderData.customer?.documentNumber
      ?? orderData.customer?.cpf
      ?? orderData.taxPayerIdentificationNumber
      ?? orderData.additionalInfo?.taxPayerIdentificationNumber
      ?? null;

    const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

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

    const deliveryFee = typeof orderData.total?.deliveryFee === "number"
      ? orderData.total.deliveryFee
      : typeof orderData.delivery?.deliveryFee === "number"
        ? orderData.delivery.deliveryFee
        : typeof orderData.deliveryFee === "number"
          ? orderData.deliveryFee
          : 0;

    // iFood API usa "deliveredBy" (não "deliveryBy") para indicar quem entrega.
    // "MERCHANT" = entrega própria da loja. "IFOOD" ou qualquer outro valor = entrega parceira/logística iFood.
    const deliveredByRaw = (
      orderData.deliveredBy || orderData.deliveryBy ||
      orderData.delivery?.deliveredBy || orderData.delivery?.deliveryBy ||
      orderData.merchant?.deliveredBy || orderData.logistics?.deliveredBy ||
      ""
    ).toString().toUpperCase();
    const deliveryBy = deliveredByRaw === "IFOOD" ? "IFOOD" : (deliveredByRaw === "MERCHANT" || deliveredByRaw === "" ? "MERCHANT" : "MERCHANT");

      const createdOrder = await (prisma.customerOrder as any).create({
        data: {
          franchiseeId:     franchisee.id,
          ifoodOrderId:     orderId,
          ifoodReference:   orderData.displayId ?? undefined,
          scheduledDatetime,
          changeAmount,
          customerCpfCnpj,
          deliveryBy,
          deliveryFee,
          discountTotal: discountTotal > 0 ? discountTotal : null,
          discountIfood: discountIfood > 0 ? discountIfood : null,
          discountMerchant: discountMerchant > 0 ? discountMerchant : null,
          discountDetails: discountDetails.length > 0 ? discountDetails : undefined,
          source:           "IFOOD",
          customerName:     orderData.customer?.name ?? "Cliente iFood",
          customerPhone:    (() => {
            const phone = orderData.customer?.phone;
            const number = phone?.number ?? (typeof phone === 'string' ? phone : '');
            const localizer = phone?.localizer;
            return localizer ? `${number} ID: ${localizer}` : number;
          })(),
          customerAddress:  (() => {
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
          deliveryType:     orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
          paymentMethod:    parsedPaymentMethod,
          totalAmount:      total,
          status:           "NOVO",
          notes:            notesArr,
          items:            { create: items },
        },
      });
      console.log(`[iFood Webhook] 🎉 Pedido ${orderId} (${orderData.customer?.name}) criado no FireHub`);

      // 🖨️ AUTO-PRINT: Enfileira na Fila de Impressão na Nuvem para impressão automática imediata!
      try {
        const startOfTodayBrazil = new Date(new Date().toLocaleDateString("en-US", { timeZone: "America/Sao_Paulo" }) + "T00:00:00-03:00");
        const countToday = await prisma.customerOrder.count({
          where: { franchiseeId: franchisee.id, createdAt: { gte: startOfTodayBrazil } }
        });

        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        const formattedForPrint = {
          id: createdOrder.id,
          dailyOrderNumber: countToday,
          customerName: createdOrder.customerName,
          customerPhone: createdOrder.customerPhone,
          customerAddress: createdOrder.customerAddress,
          deliveryType: createdOrder.deliveryType,
          paymentMethod: createdOrder.paymentMethod,
          items: (orderData.items || []).map((i: any) => ({
            name: i.name || i.description || "Item",
            qty: i.quantity || 1,
            price: getIfoodItemUnitPrice(i),
            comboSelections: i.options ? JSON.stringify(i.options) : null,
          })),
          totalAmount: createdOrder.totalAmount,
          deliveryFee: createdOrder.deliveryFee,
          discountTotal: createdOrder.discountTotal,
          discountIfood: createdOrder.discountIfood,
          discountMerchant: createdOrder.discountMerchant,
          changeAmount: createdOrder.changeAmount,
          ifoodReference: createdOrder.ifoodReference,
          source: "IFOOD",
          notes: createdOrder.notes,
          createdAt: createdOrder.createdAt,
        };
        pushJobToPrintQueue(franchisee.id, formattedForPrint, franchisee.storeName || "HAKIM CENTRO");
      } catch (printErr: any) {
        console.warn("[iFood Webhook] Erro ao enfileirar impressão automática:", printErr?.message);
      }

    await autoConfirmIfoodOrder(orderId, token);
  }

  // ATUALIZAÇÕES DE STATUS (se o pedido já existia ou para atualizar status recebido)
  const firehubStatus = STATUS_MAP[code] || STATUS_MAP[event.fullCode || ""];

  // === DRIVER LOGISTICS EVENTS ===
  const driverEventCodes = ["ASSIGN_DRIVER", "ADR", "GOING_TO_ORIGIN", "GTO", "ARRIVED_AT_ORIGIN", "AAO", "COLLECTED", "COL", "ARRIVED_AT_DESTINATION", "AAD", "REQUEST_DRIVER_SUCCESS", "RDS", "REQUEST_DRIVER_FAILED", "RDF"];
  const isDriverEvent = driverEventCodes.includes(code) ||
    ["ASSIGN_DRIVER", "GOING_TO_ORIGIN", "ARRIVED_AT_ORIGIN", "COLLECTED", "ARRIVED_AT_DESTINATION", "REQUEST_DRIVER_SUCCESS", "REQUEST_DRIVER_FAILED"].includes(event.fullCode ?? "");

  if (isDriverEvent) {
    const meta = event.metadata || {};
    const driverUpdate: any = {};

    if (code === "ASSIGN_DRIVER" || code === "ADR" || event.fullCode === "ASSIGN_DRIVER" || code === "REQUEST_DRIVER_SUCCESS" || code === "RDS" || event.fullCode === "REQUEST_DRIVER_SUCCESS") {
      driverUpdate.ifoodDriverName = meta.driverName || meta.name || null;
      driverUpdate.ifoodDriverPhone = meta.driverPhone || null;
      driverUpdate.ifoodDriverVehicle = meta.vehicle || null;
      driverUpdate.ifoodDriverPhotoUrl = meta.driverPhotoUrl || null;
      driverUpdate.ifoodDriverStatus = "ASSIGNED";
    } else if (code === "GOING_TO_ORIGIN" || code === "GTO" || event.fullCode === "GOING_TO_ORIGIN") {
      driverUpdate.ifoodDriverStatus = "GOING_TO_ORIGIN";
    } else if (code === "ARRIVED_AT_ORIGIN" || code === "AAO" || event.fullCode === "ARRIVED_AT_ORIGIN") {
      driverUpdate.ifoodDriverStatus = "ARRIVED_AT_ORIGIN";
    } else if (code === "COLLECTED" || code === "COL" || event.fullCode === "COLLECTED") {
      driverUpdate.ifoodDriverStatus = "COLLECTED";
    } else if (code === "ARRIVED_AT_DESTINATION" || code === "AAD" || event.fullCode === "ARRIVED_AT_DESTINATION") {
      driverUpdate.ifoodDriverStatus = "ARRIVED_AT_DESTINATION";
    } else if (code === "REQUEST_DRIVER_FAILED" || code === "RDF" || event.fullCode === "REQUEST_DRIVER_FAILED") {
      driverUpdate.ifoodDriverStatus = "FAILED";
    }

    if (Object.keys(driverUpdate).length > 0) {
      await (prisma.customerOrder as any).updateMany({
        where: { ifoodOrderId: orderId } as any,
        data: driverUpdate,
      });
    }
  }

  if (firehubStatus) {
    const updateData: any = { status: firehubStatus };

    if (code === "HSD" || code === "CRR" || code === "DDC" || event.fullCode === "HANDSHAKE_DISPUTE" || event.fullCode === "CANCELLATION_REQUESTED" || event.fullCode === "DUE_DATE_CHANGE_REQUESTED") {
      const meta = event.metadata || {};
      const actionType = (meta.action || meta.handshakeType || event.fullCode || "").toUpperCase();
      const isDueDateChange = actionType.includes("DUE_DATE") || actionType.includes("PREDICTION") || code === "DDC";

      const disputeData = {
        pending: true,
        disputeId: meta.disputeId || "",
        type: isDueDateChange ? "DUE_DATE_CHANGE" : "CANCELLATION",
        reason: meta.message || meta.cancelCodeDescription || (isDueDateChange ? "O pedido está atrasado. Quero uma nova previsão de entrega." : "Cliente solicitou cancelamento"),
        customerName: meta.customerName || "",
        handshakeType: meta.handshakeType || "",
        expiresAt: meta.expiresAt || "",
        requestedAt: meta.createdAt || new Date().toISOString(),
      };
      await (prisma.customerOrder as any).updateMany({
        where: { ifoodOrderId: orderId } as any,
        data: { cancelDispute: disputeData },
      });
      return;
    }

    if (code === "CAN" || code === "CANCELLED" || event.fullCode === "CANCELLED") {
      const existingOrder: any = await prisma.customerOrder.findFirst({
        where: { ifoodOrderId: orderId } as any,
        select: { cancelledBy: true } as any,
      });
      if (!existingOrder?.cancelledBy || existingOrder.cancelledBy !== "LOJA") {
        updateData.cancelledBy = "IFOOD";
      }
    }

    if (code === "CON" || code === "CONCLUDED" || event.fullCode === "CONCLUDED") {
      updateData.ifoodDriverStatus = "CONCLUDED";
    }

    await (prisma.customerOrder as any).updateMany({
      where: { ifoodOrderId: orderId } as any,
      data:  updateData,
    });
  }
}

async function fetchIfoodOrderDetails(orderId: string, token: string) {
  // Retry up to 3 times with increasing delay — iFood may not have the order ready immediately
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[iFood Webhook] ✅ Detalhes obtidos para ${orderId} (tentativa ${attempt})`);
        return data;
      }
      const errText = await res.text().catch(() => "");
      console.error(`[iFood Webhook] ⚠️ Tentativa ${attempt}/3 falhou para ${orderId}: ${res.status} — ${errText.slice(0, 200)}`);
      
      // If 401, try refreshing the token
      if (res.status === 401 && attempt < 3) {
        const { getIfoodToken } = await import("@/lib/ifood-api");
        // Force token refresh by waiting and retrying
        token = await getIfoodToken();
      }

      // Wait before retrying (500ms, 1s, 2s)
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    } catch (err: any) {
      console.error(`[iFood Webhook] ❌ Tentativa ${attempt}/3 erro de rede para ${orderId}: ${err.message}`);
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }
  }
  return null;
}

async function autoConfirmIfoodOrder(orderId: string, token: string) {
  await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
