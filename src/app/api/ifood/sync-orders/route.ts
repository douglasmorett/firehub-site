import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken } from "@/lib/ifood-api";

/**
 * POST /api/ifood/sync-orders
 * Busca pedidos ativos do iFood que podem estar faltando no FireHub.
 * Tenta o events:polling + busca direta por orderId se fornecido.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, ifoodMerchantId: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const merchantId = user.ifoodMerchantId;
  if (!merchantId) {
    return NextResponse.json({ error: "Você não possui uma loja iFood integrada no seu perfil." }, { status: 400 });
  }

  const franchisee = user;

  try {
    const token = await getIfoodToken();

    const imported: string[] = [];
    const errors: string[] = [];

    // 1. Poll events (sem acknowledgar) para descobrir orderIds
    const eventsRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const discoveredOrderIds = new Set<string>();

    if (eventsRes.ok) {
      // iFood events:polling can return 204 No Content or empty body
      const eventsText = await eventsRes.text();
      const events = eventsText ? JSON.parse(eventsText) : [];
      if (Array.isArray(events)) {
        const processedEventIds: { id: string; orderId: string; eventType: string }[] = [];

        for (const event of events) {
          const { orderId } = event;
          if (orderId) {
            discoveredOrderIds.add(orderId);

            // Check if exists
            const exists = await prisma.customerOrder.findFirst({
              where: { ifoodOrderId: orderId } as any,
            });

            if (!exists) {
              try {
                await createIfoodOrder(orderId, token, franchisee);
                imported.push(orderId);
              } catch (err: any) {
                errors.push(`${orderId}: ${err.message}`);
              }
            }

            if (event.id) {
              processedEventIds.push({
                id: event.id,
                orderId: event.orderId || "",
                eventType: event.fullCode || event.code || "",
              });
            }
          }
        }

        // Acknowledge processed events
        if (processedEventIds.length > 0) {
          await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(processedEventIds),
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported: imported.length,
      importedIds: imported,
      eventsChecked: discoveredOrderIds.size,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error("[iFood Sync] Erro:", err);
    return NextResponse.json({ error: err.message ?? "Erro ao sincronizar" }, { status: 500 });
  }
}

// Função reutilizável para criar pedido iFood no FireHub
async function createIfoodOrder(orderId: string, token: string, franchisee: any) {
  const orderRes = await fetch(
    `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!orderRes.ok) {
    throw new Error(`iFood API retornou ${orderRes.status}`);
  }

  const orderData = await orderRes.json();

  // Extract items
  const items = (orderData.items ?? []).map((i: any) => ({
    price: i.unitPrice ?? i.price ?? 0,
    quantity: i.quantity ?? 1,
    menuProduct: {
      connectOrCreate: {
        where: { id: `ifood-${i.id}` } as any,
        create: {
          id: `ifood-${i.id}`,
          franchiseeId: franchisee.id,
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

  const deliveryFeeValue = orderData.total?.deliveryFee
    ?? orderData.delivery?.deliveryFee
    ?? orderData.deliveryFee
    ?? 0;

  const scheduledDatetime = orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime
    ? new Date(orderData.scheduledDatetime)
    : null;

  const deliveryDeadline = !scheduledDatetime && orderData.delivery?.deliveryDateTime
    ? new Date(orderData.delivery.deliveryDateTime)
    : null;

  const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

  const cashPayment = paymentList.find((p: any) =>
    p.method === "CASH" || p.name?.toLowerCase().includes("dinheir")
  );
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

  // Mapear status do iFood
  const ifoodStatus = (orderData.orderStatus ?? orderData.status ?? "").toUpperCase();
  let status = "NOVO";
  if (["CONFIRMED", "ACCEPTED"].includes(ifoodStatus)) status = "ACEITO";
  else if (["IN_PREPARATION", "PREPARATION_STARTED", "PREPARING"].includes(ifoodStatus)) status = "PREPARANDO";
  else if (["READY_TO_PICKUP", "READY"].includes(ifoodStatus)) status = "PREPARANDO";
  else if (["DISPATCHED", "IN_ROUTE"].includes(ifoodStatus)) status = "SAIU_ENTREGA";
  else if (["CONCLUDED", "DELIVERED"].includes(ifoodStatus)) status = "ENTREGUE";
  else if (["CANCELLED"].includes(ifoodStatus)) status = "CANCELADO";

  const deliveryByRaw = (orderData.deliveryBy || orderData.delivery?.deliveryBy || orderData.merchant?.deliveryBy || "").toUpperCase();
  const deliveryBy = deliveryByRaw === "IFOOD" || deliveryByRaw === "TOGO" || deliveryByRaw === "TAKEOUT" ? "IFOOD" : "MERCHANT";

  await (prisma.customerOrder as any).create({
    data: {
      franchiseeId: franchisee.id,
      ifoodOrderId: orderId,
      ifoodReference: orderData.displayId ?? undefined,
      scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
      changeAmount,
      customerCpfCnpj,
      deliveryBy,
      deliveryFee: deliveryFeeValue,
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
        const parts: string[] = [];
        if (formatted) {
          parts.push(formatted);
        } else if (addr.streetName) {
          parts.push(`${addr.streetName}${addr.streetNumber ? `, ${addr.streetNumber}` : ""}`);
        }
        if (neighborhood && (!parts[0] || !parts[0].toLowerCase().includes(neighborhood.toLowerCase()))) {
          parts.push(neighborhood);
        }
        if (city) parts.push(city);
        return parts.join(" - ");
      })(),
      deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
      paymentMethod: cashPayment ? "Dinheiro" : payMethodName,
      totalAmount: total,
      status,
      notes: notesArr,
      createdAt: orderData.createdAt ? new Date(orderData.createdAt) : undefined,
      items: { create: items },
    },
  });

  console.log(`[iFood Sync] ✅ Pedido ${orderId} importado (status: ${status})`);

  // Auto-confirm se status é PLACED
  if (ifoodStatus === "PLACED" || !ifoodStatus) {
    await fetch(
      `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    ).catch(() => {});
  }
}
