import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { dataHoraDaLoja } from "@/lib/fuso";
import { toLocalISODate, getStartOfDayUTC } from "@/lib/timezone";
import { getIfoodItemUnitPrice } from "@/lib/ifood-api";
import { montarItensDoPedidoIfood } from "@/lib/ifood-itens";


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
  // Teto de vazão: o iFood manda rajadas legítimas em hora de pico, então o
  // limite é alto de propósito — ele existe para barrar flood e tentativa de
  // adivinhar merchantId em massa, não para atrapalhar movimento real.
  const { checkRateLimit, getClientIp } = await import("@/lib/rateLimit");
  const ipOrigem = getClientIp(req);
  const vazao = checkRateLimit(`ifood-webhook:${ipOrigem}`, { windowMs: 60_000, maxRequests: 600 });
  if (!vazao.allowed) {
    console.warn(`[iFood Webhook] 🚦 Vazão excedida de ${ipOrigem} — requisição descartada.`);
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-ifood-signature");

  // Log payload recebido
  console.log(`[iFood Webhook] 📥 Request recebido: ${rawBody.slice(0, 300)}`);

  // ── ASSINATURA: OBSERVAR AGORA, EXIGIR QUANDO OS DADOS DEIXAREM ──────────
  //
  // O modo observação já respondeu QUAL é a fórmula: os logs mostram
  // "FÓRMULA ENCONTRADA — IFOOD_CLIENT_SECRET com hmac-sha256(corpo)". Só que
  // mostram também que METADE dos eventos não bate com NENHUM dos segredos que
  // temos (provável segundo app do iFood). Exigir hoje recusaria essa metade —
  // e pedido recusado é pedido perdido.
  //
  // Por isso a exigência fica atrás de um interruptor: quando o log mostrar
  // 100% de acerto, basta definir IFOOD_WEBHOOK_ENFORCE=true no servidor. Sem
  // mexer em código, sem adivinhar valor de segredo.
  const candidatosIfood = [
    { rotulo: "IFOOD_WEBHOOK_SECRET", valor: process.env.IFOOD_WEBHOOK_SECRET },
    { rotulo: "IFOOD_CLIENT_SECRET", valor: process.env.IFOOD_CLIENT_SECRET },
    { rotulo: "IFOOD_CLIENT_SECRET_DISTRIBUTED", valor: process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED },
    { rotulo: "IFOOD_HOMOLOG_CLIENT_SECRET", valor: process.env.IFOOD_HOMOLOG_CLIENT_SECRET },
  ];
  let assinaturaConfere = false;
  try {
    const { diagnosticarAssinatura } = await import("@/lib/webhook-assinatura");
    // O código do evento entra no log: precisamos saber se é KEEPALIVE (ruído)
    // ou um PEDIDO de verdade que estaria sendo recusado.
    let codigoDoEvento = "?";
    try {
      const p = JSON.parse(rawBody);
      const e = Array.isArray(p) ? p[0] : p;
      codigoDoEvento = String(e?.fullCode || e?.code || "?");
    } catch { /* corpo ilegível: segue como "?" */ }

    assinaturaConfere = Boolean(
      diagnosticarAssinatura({
        parceiro: `iFood/${codigoDoEvento}`,
        corpoCru: rawBody,
        assinaturaRecebida: signature,
        candidatos: candidatosIfood,
      })
    );
  } catch { /* diagnóstico nunca pode derrubar o webhook */ }

  if (process.env.IFOOD_WEBHOOK_ENFORCE === "true" && !assinaturaConfere) {
    console.error("[iFood Webhook] 🚫 Assinatura não confere e IFOOD_WEBHOOK_ENFORCE está ligado — recusado.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A recusa acontece no bloco acima (IFOOD_WEBHOOK_ENFORCE), que confere a
  // assinatura contra TODOS os segredos conhecidos e tolera o prefixo
  // "sha256=". A checagem antiga ficava aqui e era rígida demais: comparava só
  // com IFOOD_WEBHOOK_SECRET e exigia o prefixo exato — ligar aquela variável
  // recusaria até os eventos que sabemos serem legítimos.
  if (!assinaturaConfere && process.env.NODE_ENV === "production" && process.env.IFOOD_WEBHOOK_ENFORCE !== "true") {
    console.warn(
      "[iFood Webhook] ⚠️ Requisição aceita SEM assinatura confirmada. " +
      "Ela só serve para dizer QUAL pedido buscar — o conteúdo vem da API do iFood, " +
      "então um evento forjado não cria pedido. Para recusar, ligue IFOOD_WEBHOOK_ENFORCE=true."
    );
  }

  let events: any[];
  try {
    const body = JSON.parse(rawBody);
    events = Array.isArray(body) ? body : [body];
  } catch {
    // Sonda de disponibilidade chega com corpo vazio ou não-JSON — e responder
    // 400 fazia o iFood contar o webhook como FORA DO AR (e-mail "Erros no
    // Webhook" de 06/09/2026, com o endpoint de pé e respondendo KEEPALIVE
    // normalmente; medido: POST sem corpo levava 400 em 0,6s). Corpo sem
    // evento não tem nada a processar: 200 e pronto. Nenhuma segurança mora
    // neste 400 — evento forjado já não cria pedido, porque o conteúdo vem
    // sempre da API do iFood, nunca do corpo da requisição.
    return NextResponse.json({ received: true, events: 0 });
  }

  // Processa eventos assincronicamente no background para não estourar o Timeout da Vercel
  after(async () => {
    for (const event of events) {
      try {
        await processIfoodEvent(event);
      } catch (err) {
        console.error("[iFood Webhook] Erro ao processar evento:", event?.id, err);
      }
    }
  });

  // Responde 200 ao iFood (exige resposta em até 3 segundos para evitar retries infinitos)
  return NextResponse.json({ received: true });
}

// Sonda HEAD responde leve e sem efeito colateral. Sem isto o Next atendia
// HEAD com o GET abaixo — ou seja, uma sonda de disponibilidade disparava o
// polling de eventos com ACK, e um soluço no token virava 500 na cara do
// healthcheck.
export function HEAD() {
  return new NextResponse(null, { status: 200 });
}

// Polling de eventos (alternativa/backup ao webhook)
export async function GET(req: NextRequest) {
  const { getIfoodToken } = await import("@/lib/ifood-api");

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

  for (const event of data ?? []) {
    try {
      // Confiável: estes eventos vieram do events:polling da API do iFood,
      // autenticado com o nosso token — não da internet aberta.
      await processIfoodEvent(event, undefined, true);
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
/**
 * @param origemConfiavel  `true` só para eventos que NÓS buscamos na API do
 *   iFood (o polling). O webhook é `false`: o corpo dele vem da internet e
 *   qualquer um pode postar.
 */
async function processIfoodEvent(event: any, franchiseeIdOverride?: string, origemConfiavel = false) {
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

    let franchisee = merchantId 
      ? await prisma.user.findFirst({ where: { ifoodMerchantId: merchantId } as any })
      : null;

    if (!franchisee && franchiseeIdOverride) {
      franchisee = await prisma.user.findUnique({ where: { id: franchiseeIdOverride } });
    }
    if (!franchisee) {
      console.error(`[iFood Webhook] ❌ Nenhum franqueado encontrado para merchantId: ${merchantId}`);
      return;
    }

    // ── O PEDIDO VEM DA API DO IFOOD, NUNCA DO CORPO DA REQUISIÇÃO ──────────
    //
    // Antes era `event.data ?? fetch(...)`: bastava um POST nesta URL com um
    // `data` inventado (itens, preços, endereço) para nascer um pedido FALSO
    // na cozinha da loja — sem passar pelo iFood em momento nenhum. Combinado
    // com a assinatura que não é exigida enquanto o segredo não existe, era
    // injeção direta na operação.
    //
    // Agora o corpo do webhook serve só para dizer QUAL pedido olhar; o
    // conteúdo vem sempre do iFood, autenticado com o token da loja. Id
    // inventado devolve 404 e nada é criado. O polling continua podendo usar
    // o que já trouxe, porque aquilo saiu da API deles.
    const orderData = (origemConfiavel && event.data)
      ? event.data
      : await fetchIfoodOrderDetails(orderId, token);
    if (!orderData) {
      console.error(`[iFood Webhook] ❌ Falha ao buscar detalhes do pedido ${orderId}`);
      return;
    }

    // Extrai itens e sub-itens (comboSelections)
    const rawItems = orderData.items ?? [];
    const items = await montarItensDoPedidoIfood(rawItems, {
      franchiseeId: franchisee.id,
    });

    const total = typeof orderData.total === "object"
      ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
      : (orderData.totalPrice ?? orderData.total ?? 0);

    const isExplicitlyScheduled = orderData.orderTiming === "SCHEDULED" || Boolean(orderData.schedule);
    const rawScheduled = isExplicitlyScheduled
      ? (orderData.schedule?.scheduledDatetimeEnd
        ?? orderData.schedule?.scheduledDatetimeStart
        ?? orderData.scheduledDatetime
        ?? orderData.preparationStartDateTime)
      : null;

    const scheduledDatetime = rawScheduled ? new Date(rawScheduled) : null;

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
      scheduledDatetime ? `📅 AGENDADO para ${dataHoraDaLoja(scheduledDatetime, franchisee.storeTimezone)}` : null,
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

    const deliveredByRaw = (
      orderData.deliveredBy || orderData.deliveryBy ||
      orderData.delivery?.deliveredBy || orderData.delivery?.deliveryBy ||
      orderData.merchant?.deliveredBy || orderData.logistics?.deliveredBy ||
      ""
    ).toString().toUpperCase();

    // "IFOOD" = entrega parceira iFood (motoboy iFood). "MERCHANT" = entrega própria da loja.
    const deliveryBy = (deliveredByRaw.includes("IFOOD") || deliveredByRaw.includes("LOGISTICS") || deliveredByRaw.includes("PARTNER")) ? "IFOOD" : "MERCHANT";

    const ifoodPickupCode = (
      orderData.delivery?.pickupCode ||
      orderData.driver?.pickupCode ||
      orderData.logistics?.pickupCode ||
      event?.pickupCode ||
      event?.data?.pickupCode ||
      null
    )?.toString().trim() || null;

      // Número e pedido na MESMA transação. Este webhook e o cron
      // (src/lib/ifood-eventos.ts) processam o MESMO pedido do iFood; quando os
      // dois corriam, um perdia na trava de ifoodOrderId único e o número que ele
      // já tinha tirado do contador ficava queimado. Em produção, 23/08/2026, a
      // Hakim ficou com a sequência 93, 94, 96, 98 — sem 95 nem 97. Dentro da
      // transação, a falha desfaz o incremento junto.
      const createdOrder = await prisma.$transaction(async (tx) =>
        (tx.customerOrder as any).create({
        data: {
          franchiseeId:     franchisee.id,
          ifoodOrderId:     orderId,
          ifoodReference:   orderData.displayId ?? undefined,
          ifoodPickupCode:  ifoodPickupCode ?? undefined,
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
          kdsStage:         "PRODUCTION",
          kdsProductionAt:  new Date(),
          notes:            notesArr,
          dailyOrderNumber: await (async () => {
            const { generateDailyOrderNumberTx } = await import("@/lib/order-number");
            return generateDailyOrderNumberTx(tx, franchisee.id);
          })(),
          items:            { create: items },
        },
        }),
        { timeout: 20000 }
      );
      console.log(`[iFood Webhook] 🎉 Pedido ${orderId} (${orderData.customer?.name}) criado no FireHub`);

      // 🖨️ AUTO-PRINT: Enfileira na Fila de Impressão na Nuvem para impressão automática imediata!
      try {
        const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
        const formattedForPrint = {
          id: createdOrder.id,
          dailyOrderNumber: createdOrder.dailyOrderNumber,
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

    const pickupCodeCandidate = (
      meta.pickupCode ||
      meta.delivery?.pickupCode ||
      event.pickupCode ||
      event.data?.pickupCode ||
      null
    )?.toString().trim();
    if (pickupCodeCandidate) {
      driverUpdate.ifoodPickupCode = pickupCodeCandidate;
    }

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
