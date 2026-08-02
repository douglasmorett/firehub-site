import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/kds?stage=production|finishing
 * Returns orders relevant for the specified KDS stage.
 * 
 * PUT /api/kds
 * Updates KDS stage for an order (production → finishing → done).
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const email = session.user?.email;
  if (!email) return NextResponse.json({ error: "Email não encontrado" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, ownerId: true } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;
  const stage = req.nextUrl.searchParams.get("stage") || "production";

  let where: any;

  // Filtro de status ativo amplo para capturar qualquer pedido em andamento (iFood, Jotajá, WhatsApp ou Site)
  const activeStatusFilter = { in: ["NOVO", "ACEITO", "PREPARANDO", "EM_PREPARO", "RECEBIDO", "CONFIRMADO", "PENDENTE"] };

  // Buscar data de abertura do caixa ativo (ou últimas 24h) para ignorar pedidos antigos esquecidos de dias anteriores
  const activeSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: targetFranchiseeId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { openedAt: true }
  });

  const sessionStartCutoff = activeSession?.openedAt
    ? new Date(activeSession.openedAt)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (stage === "production") {
    // Tela de Preparo: mostra apenas pedidos ativos da sessão/turno atual
    where = {
      franchiseeId: user.role === "ADMIN" ? undefined : targetFranchiseeId,
      status: activeStatusFilter,
      createdAt: { gte: sessionStartCutoff },
      OR: [
        { kdsStage: "PRODUCTION" },
        { kdsStage: null },
      ],
    };
  } else if (stage === "finishing") {
    // Tela de Finalização: mostra apenas pedidos ativos da sessão/turno atual
    where = {
      franchiseeId: user.role === "ADMIN" ? undefined : targetFranchiseeId,
      status: activeStatusFilter,
      createdAt: { gte: sessionStartCutoff },
      OR: [
        { kdsStage: "PRODUCTION" },
        { kdsStage: "FINISHING" },
        { kdsStage: null },
      ],
    };
  } else {
    return NextResponse.json({ error: "Stage inválido" }, { status: 400 });
  }

  const orders = await prisma.customerOrder.findMany({
    where,
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      customerAddress: true,
      deliveryType: true,
      paymentMethod: true,
      totalAmount: true,
      deliveryFee: true,
      status: true,
      source: true,
      notes: true,
      ifoodReference: true,
      openDeliveryReference: true,
      kdsStage: true,
      kdsStationId: true,
      kdsProductionAt: true,
      kdsFinishingAt: true,
      createdAt: true,
      updatedAt: true,
      items: {
        select: {
          id: true,
          quantity: true,
          price: true,
          comboSelections: true,
          menuProduct: {
            select: {
              name: true,
              category: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  // Numeração PERMANENTE E IMUTÁVEL baseada no dia do calendário (America/Sao_Paulo)
  const allRecentOrders = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: user.role === "ADMIN" ? undefined : targetFranchiseeId,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const dailyNumMap = new Map<string, number>();
  const dayCounters = new Map<string, number>();

  allRecentOrders.forEach((o: any) => {
    if (o.dailyOrderNumber && typeof o.dailyOrderNumber === "number") {
      dailyNumMap.set(o.id, o.dailyOrderNumber);
    } else {
      const dateKey = new Date(o.createdAt).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }).split(",")[0];
      const nextSeq = (dayCounters.get(dateKey) || 0) + 1;
      dayCounters.set(dateKey, nextSeq);
      dailyNumMap.set(o.id, nextSeq);
    }
  });

  const ordersWithDailyNum = orders.map((o: any) => ({
    ...o,
    dailyOrderNumber: o.dailyOrderNumber || dailyNumMap.get(o.id) || null,
  }));

  return NextResponse.json(ordersWithDailyNum, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const { orderId, action, stationId } = body;

  if (!orderId || !action) {
    return NextResponse.json({ error: "orderId e action obrigatórios" }, { status: 400 });
  }

  const email = session.user?.email;
  if (!email) return NextResponse.json({ error: "Email não encontrado" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, ownerId: true } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, kdsStage: true, status: true, deliveryType: true, franchiseeId: true, ifoodOrderId: true, openDeliveryOrderId: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  // Security check: only ADMIN or the order owner (franchiseeId) can update KDS
  if (user.role !== "ADMIN" && order.franchiseeId !== targetFranchiseeId) {
    return NextResponse.json({ error: "Sem permissão para este pedido." }, { status: 403 });
  }


  if (action === "start_production") {
    // Mark order as being worked on in production
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        kdsStage: "PRODUCTION",
        kdsStationId: stationId || null,
        kdsProductionAt: new Date(),
        status: "PREPARANDO",
      },
    });
    return NextResponse.json({ success: true, stage: "PRODUCTION" });
  }

  if (action === "finish_production") {
    // Production done → move to finishing stage
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        kdsStage: "FINISHING",
        kdsFinishingAt: new Date(),
        kdsStationId: null, // Reset station for finishing team to pick up
        status: order.status === "ACEITO" ? "PREPARANDO" : undefined,
      },
    });
    return NextResponse.json({ success: true, stage: "FINISHING" });
  }

  if (action === "finish_order") {
    const isPickup = order.deliveryType !== "DELIVERY";
    const updateData: any = {
      kdsStage: "FINISHED",
      kdsFinishingAt: new Date(),
      kdsStationId: null,
    };

    // Para pedidos de RETIRADA, avança o status automaticamente para SAIU_ENTREGA (Pronto)
    if (isPickup) {
      updateData.status = "SAIU_ENTREGA";
    }

    await prisma.customerOrder.update({
      where: { id: orderId },
      data: updateData,
    });

    // 🚀 Sincronizar com o iFood (readyToPickup): acelera a vinda do motoboy parceiro do iFood e notifica o cliente
    if (order.ifoodOrderId) {
      try {
        const { getIfoodToken } = await import("@/lib/ifood-api");
        const token = await getIfoodToken();
        const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
        const readyRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}/readyToPickup`, {
          method: "POST",
          headers,
        });
        console.log(`[KDS iFood Sync] readyToPickup ${order.ifoodOrderId}: ${readyRes.status}`);
      } catch (errIfood) {
        console.warn("[KDS iFood Sync Error]:", errIfood);
      }
    }

    // Sincronizar com o Jotajá / OpenDelivery
    if (order.openDeliveryOrderId) {
      try {
        const { jotajaFetch } = await import("@/lib/jotaja-api");
        await jotajaFetch(`/v1/orders/${order.openDeliveryOrderId}/readyToPickup`, { method: "POST" });
      } catch (errOd) {
        console.warn("[KDS Jotajá Sync Error]:", errOd);
      }
    }

    // Notificação WhatsApp automática ao dar pronto para retirada no KDS
    if (isPickup) {
      try {
        const { sendOrderNotification } = await import("@/lib/order-notifications");
        sendOrderNotification(orderId, "PRONTO_RETIRADA").catch(() => {});
      } catch (errWp) {
        console.warn("[KDS API] Erro ao disparar notificação WhatsApp:", errWp);
      }
    }

    return NextResponse.json({ success: true, stage: "FINISHED" });
  }

  return NextResponse.json({ error: "Action inválida" }, { status: 400 });
}
