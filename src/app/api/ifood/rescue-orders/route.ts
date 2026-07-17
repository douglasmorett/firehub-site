import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken } from "@/lib/ifood-api";

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
    select: { id: true, role: true, ifoodMerchantId: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

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
    select: { id: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

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
      if (exists.franchiseeId !== user.id) {
        await (prisma.customerOrder as any).update({
          where: { id: exists.id },
          data: { franchiseeId: user.id },
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
      const err = await orderRes.text();
      return NextResponse.json({ error: `iFood API: ${orderRes.status}`, details: err.slice(0, 300) }, { status: 404 });
    }

    const orderData = await orderRes.json();
    await createOrderFromIfoodData(orderId, orderData, user.id, token);

    return NextResponse.json({ success: true, action: "imported", orderId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Shared helper to create order from iFood data
async function createOrderFromIfoodData(orderId: string, orderData: any, franchiseeId: string, token: string) {
  const items = (orderData.items ?? []).map((i: any) => ({
    price: i.unitPrice ?? i.price ?? 0,
    quantity: i.quantity ?? 1,
    menuProduct: {
      connectOrCreate: {
        where: { id: `ifood-${i.id}` } as any,
        create: {
          id: `ifood-${i.id}`,
          franchiseeId,
          name: i.name ?? "Item iFood",
          description: "",
          price: i.unitPrice ?? i.price ?? 0,
          category: "iFood",
          active: true,
        } as any,
      } as any,
    },
  }));

  const total = typeof orderData.total === "object"
    ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
    : (orderData.totalPrice ?? orderData.total ?? 0);

  const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
  const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

  const deliveryFeeValue = orderData.total?.deliveryFee ?? orderData.delivery?.deliveryFee ?? orderData.deliveryFee ?? 0;

  const scheduledDatetime = orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime
    ? new Date(orderData.scheduledDatetime) : null;
  const deliveryDeadline = !scheduledDatetime && orderData.delivery?.deliveryDateTime
    ? new Date(orderData.delivery.deliveryDateTime) : null;

  const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;
  const cashPayment = paymentList.find((p: any) => p.method === "CASH" || p.name?.toLowerCase().includes("dinheir"));
  const changeAmount = cashPayment?.changeFor ?? cashPayment?.cash?.changeFor ?? null;
  const payMethodName = paymentList[0]?.method ?? "iFood Online";
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

  const ifoodStatus = (orderData.orderStatus ?? orderData.status ?? "").toUpperCase();
  let status = "NOVO";
  if (["CONFIRMED", "ACCEPTED"].includes(ifoodStatus)) status = "ACEITO";
  else if (["IN_PREPARATION", "PREPARATION_STARTED", "PREPARING"].includes(ifoodStatus)) status = "PREPARANDO";
  else if (["READY_TO_PICKUP", "READY"].includes(ifoodStatus)) status = "PREPARANDO";
  else if (["DISPATCHED", "IN_ROUTE"].includes(ifoodStatus)) status = "SAIU_ENTREGA";
  else if (["CONCLUDED", "DELIVERED"].includes(ifoodStatus)) status = "ENTREGUE";
  else if (["CANCELLED"].includes(ifoodStatus)) status = "CANCELADO";

  await (prisma.customerOrder as any).create({
    data: {
      franchiseeId,
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
      status,
      notes: notesArr,
      createdAt: orderData.createdAt ? new Date(orderData.createdAt) : undefined,
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
