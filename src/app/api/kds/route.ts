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

  if (stage === "production") {
    // Show orders that are ACEITO/PREPARANDO and in production stage (or not yet assigned to any stage)
    where = {
      franchiseeId: user.role === "ADMIN" ? undefined : targetFranchiseeId,
      status: { in: ["ACEITO", "PREPARANDO"] },
      OR: [
        { kdsStage: "PRODUCTION" },
        { kdsStage: null },
      ],
    };
  } else if (stage === "finishing") {
    // Show orders in finishing stage (only active ones: ACEITO/PREPARANDO)
    where = {
      franchiseeId: user.role === "ADMIN" ? undefined : targetFranchiseeId,
      status: { in: ["ACEITO", "PREPARANDO"] },
      kdsStage: "FINISHING",
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

  return NextResponse.json(orders);
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
    select: { id: true, kdsStage: true, status: true, deliveryType: true, franchiseeId: true },
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
    // Finishing done → order is ready
    const newStatus = order.deliveryType === "RETIRADA" ? "ENTREGUE" : "SAIU_ENTREGA";
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        kdsStage: null,
        kdsStationId: null,
        status: newStatus,
      },
    });

    // Track billing
    try {
      const { trackSaleForBilling } = await import("@/lib/billing");
      const fullOrder = await prisma.customerOrder.findUnique({
        where: { id: orderId },
        select: { franchiseeId: true },
      });
      if (fullOrder) {
        trackSaleForBilling(fullOrder.franchiseeId).catch(() => {});
      }
    } catch {}

    return NextResponse.json({ success: true, stage: null, status: newStatus });
  }

  return NextResponse.json({ error: "Action inválida" }, { status: 400 });
}
