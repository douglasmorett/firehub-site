import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken, getIfoodItemUnitPrice } from "@/lib/ifood-api";
import { generateDailyOrderNumber } from "@/lib/order-number";

/**
 * GET /api/ifood/rescue-orders
 * Busca pedidos recentes do iFood que podem ter sido perdidos.
 * 
 * POST /api/ifood/rescue-orders
 * Importa um pedido específico do iFood pelo orderId.
 * Body: { orderId: "uuid-do-pedido" }
 *
 * Diferente do events:polling (fila destrutiva), este endpoint
 * busca diretamente na API de pedidos do iFood.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, ifoodMerchantId: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let merchantId = user.ifoodMerchantId;
  const targetFranchiseeId = user.ownerId || user.id;
  if (!merchantId && user.ownerId) {
    const owner = await prisma.user.findUnique({
      where: { id: user.ownerId },
      select: { ifoodMerchantId: true }
    });
    if (owner?.ifoodMerchantId) merchantId = owner.ifoodMerchantId;
  }

  const results: any = {};

  try {
    const token = await getIfoodToken();
    const merchantId = user.ifoodMerchantId;
    results.tokenOk = true;
    results.merchantId = merchantId;
    results.userId = user.id;
    results.userIfoodMerchantId = user.ifoodMerchantId;
    results.merchantIdMatch = true;

    // Check: user has ifoodMerchantId set?
    if (!merchantId) {
      results.warning = "⚠️ Você não possui uma loja iFood integrada no seu perfil!";
    }

    // 1. Check recent iFood orders in DB (across ALL users)
    const allRecentIfood = await (prisma.customerOrder as any).findMany({
      where: { source: "IFOOD" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        ifoodOrderId: true,
        ifoodReference: true,
        status: true,
        createdAt: true,
        customerName: true,
        totalAmount: true,
        franchiseeId: true,
      },
    });
    results.recentIfoodOrders = allRecentIfood;
    results.ordersUnderYou = allRecentIfood.filter((o: any) => o.franchiseeId === user.id).length;
    results.ordersUnderOthers = allRecentIfood.filter((o: any) => o.franchiseeId !== user.id).length;

    // 2. Try events:polling (just peek, don't acknowledge)
    const eventsRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (eventsRes.ok) {
      const eventsText = await eventsRes.text();
      const events = eventsText ? JSON.parse(eventsText) : [];
      results.pendingEvents = events.length;
      results.events = events.map((e: any) => ({ id: e.id, code: e.code, fullCode: e.fullCode, orderId: e.orderId }));
      
      // If there are events, process them now (don't just peek)
      if (events.length > 0) {
        results.processingEvents = true;
        const processedIds: { id: string; orderId: string; eventType: string }[] = [];
        
        for (const event of events) {
          try {
            const { code, orderId } = event;
            if (!orderId) continue;

            const isCancelled = code === "CAN" || event.fullCode === "CANCELLED";
            
            // Check if order exists
            const exists = await prisma.customerOrder.findFirst({
              where: { ifoodOrderId: orderId } as any,
            });

            if (!exists && !isCancelled) {
              // Import the order
              const orderRes = await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              
              if (orderRes.ok) {
                const orderData = await orderRes.json();
                await createOrderFromIfoodData(orderId, orderData, user.id, token);
                results[`imported_${orderId.slice(-6)}`] = "✅ Importado!";
              } else {
                results[`failed_${orderId.slice(-6)}`] = `❌ ${orderRes.status}`;
              }
            }
            
            if (event.id) {
              processedIds.push({
                id: event.id,
                orderId: event.orderId || "",
                eventType: event.fullCode || event.code || "",
              });
            }
          } catch (err: any) {
            results[`error_${event?.orderId?.slice(-6)}`] = err.message;
          }
        }

        // Acknowledge
        if (processedIds.length > 0) {
          await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(processedIds),
          });
        }
      }
    } else {
      results.eventsError = `${eventsRes.status} ${eventsRes.statusText}`;
    }

    // 3. Count all franchisees to detect potential mismatch
    const franchisees = await prisma.user.findMany({
      where: { role: "FRANCHISEE" } as any,
      select: { id: true, name: true, email: true, ifoodMerchantId: true },
    });
    results.franchisees = franchisees.map((f: any) => ({
      id: f.id,
      name: f.name,
      email: f.email,
      ifoodMerchantId: f.ifoodMerchantId,
      isYou: f.id === user.id,
    }));

  } catch (err: any) {
    results.error = err.message;
  }

  return NextResponse.json(results);
}

// POST: Import a specific order by iFood orderId
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  const body = await req.json().catch(() => ({}));
  const orderId = body.orderId;
  if (!orderId) {
    return NextResponse.json({ error: "orderId obrigatório no body" }, { status: 400 });
  }

  try {
    // Check if already exists
    const exists = await prisma.customerOrder.findFirst({
      where: { ifoodOrderId: orderId } as any,
    });
    if (exists) {
      // If exists but under wrong user, fix it
      if (exists.franchiseeId !== targetFranchiseeId) {
        await (prisma.customerOrder as any).update({
          where: { id: exists.id },
          data: { franchiseeId: targetFranchiseeId },
        });
        return NextResponse.json({ success: true, action: "reassigned", orderId });
      }
      return NextResponse.json({ success: true, action: "already_exists", orderId });
    }

    const token = await getIfoodToken();
    const orderRes = await fetch(
      `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!orderRes.ok) {
      return NextResponse.json({ error: `iFood API error: ${orderRes.status}` }, { status: orderRes.status });
    }

    const orderData = await orderRes.json();
    await createOrderFromIfoodData(orderId, orderData, targetFranchiseeId, token);

    return NextResponse.json({ success: true, action: "imported", orderId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Shared helper to create order from iFood data
async function createOrderFromIfoodData(orderId: string, orderData: any, franchiseeId: string, token: string) {
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
            franchiseeId,
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

  const total = typeof orderData.total === "object"
    ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
    : (orderData.totalPrice ?? orderData.total ?? 0);

  const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
  const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

  const deliveryFeeValue = orderData.total?.deliveryFee ?? orderData.delivery?.deliveryFee ?? orderData.deliveryFee ?? 0;

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
    // Como o pedido resgatado entra no fim da fila (createdAt = agora), a hora
    // original do iFood fica registrada aqui para nao se perder no relatorio.
    orderData.createdAt ? `🕐 Feito no iFood às ${new Date(orderData.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (resgatado depois)` : null,
    scheduledDatetime ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString("pt-BR")}` : null,
    discountTotal > 0 ? `🏷️ Desconto R$${discountTotal.toFixed(2)} (iFood: R$${discountIfood.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : null,
    customerNote ? `💬 ${customerNote}` : null,
  ].filter(Boolean).join(" | ");

  const ifoodStatus = (orderData.orderStatus ?? orderData.status ?? "").toUpperCase();
  let status = "NOVO";
  if (["CONFIRMED", "ACCEPTED"].includes(ifoodStatus)) status = "ACEITO";
  else if (["IN_PREPARATION", "PREPARATION_STARTED", "PREPARING"].includes(ifoodStatus)) status = "PREPARANDO";
  else if (["READY_TO_PICKUP", "READY"].includes(ifoodStatus)) status = "PREPARANDO";
  else if (["DISPATCHED", "IN_ROUTE"].includes(ifoodStatus)) status = "SAIU_ENTREGA";
  else if (["CONCLUDED", "DELIVERED"].includes(ifoodStatus)) status = "ENTREGUE";
  else if (["CANCELLED"].includes(ifoodStatus)) status = "CANCELADO";

  // ── QUEM ENTREGA ──────────────────────────────────────────────────────────
  // Esta rota não gravava `deliveryBy`, e o pedido resgatado nascia com o campo
  // NULO. Como o painel tratava a existência de código de coleta como prova de
  // entrega parceira, o pedido aparecia com "ENTREGA PARCEIRA IFOOD — não enviar
  // motoboy da loja" mesmo sendo entrega própria. Aconteceu com o pedido #94
  // (iFood #8288): ninguém foi entregar e o cliente cancelou por atraso.
  //
  // A regra do painel foi corrigida, mas o campo precisa vir preenchido na
  // origem — é a mesma leitura que o webhook e o cron já fazem.
  const entreguePorRaw = (
    orderData.deliveredBy || orderData.deliveryBy ||
    orderData.delivery?.deliveredBy || orderData.delivery?.deliveryBy ||
    orderData.merchant?.deliveredBy || orderData.logistics?.deliveredBy ||
    ""
  ).toString().toUpperCase();

  const deliveryBy =
    entreguePorRaw.includes("IFOOD") ||
    entreguePorRaw.includes("LOGISTICS") ||
    entreguePorRaw.includes("PARTNER")
      ? "IFOOD"
      : "MERCHANT";

  await (prisma.customerOrder as any).create({
    data: {
      franchiseeId,
      deliveryBy,
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
      status,
      notes: notesArr,
      // REGRA DO PROJETO (AGENTS.md): pedido resgatado entra no FIM DA FILA da
      // cozinha, sem bagunçar numero ja impresso. O KDS ordena por createdAt
      // (StoreOrdersDashboard sortByOrderNumberAsc, linha ~1903), entao gravar a
      // hora ORIGINAL do iFood colocaria o resgatado no MEIO da fila, na frente
      // de pedidos que a cozinha ja esta produzindo.
      // Por isso createdAt = momento em que foi SALVO. A hora original do iFood
      // fica registrada em notes, para nao se perder no relatorio.
      createdAt: new Date(),
      dailyOrderNumber: await generateDailyOrderNumber(franchiseeId),
      items: { create: items },
    },
  });

  console.log(`[iFood Rescue] ✅ Pedido ${orderId} importado (status: ${status})`);

  // Auto-confirm if still PLACED
  if (ifoodStatus === "PLACED" || !ifoodStatus) {
    await fetch(
      `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    ).catch(() => {});
  }
}
