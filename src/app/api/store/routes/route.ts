import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Helper para obter IDs da franquia vinculados
async function getValidFranchiseeIds(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, ownerId: true, email: true },
  });

  const targetId = user?.ownerId || user?.id || "";

  const allStoreUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: targetId },
        { ownerId: targetId },
      ],
    },
    select: { id: true },
  });

  return Array.from(
    new Set([
      ...allStoreUsers.map((u) => u.id),
      targetId,
      user?.id,
      user?.ownerId,
    ].filter(Boolean))
  ) as string[];
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const validFranchiseeIds = await getValidFranchiseeIds(user.id);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const routes = await prisma.routeSchedule.findMany({
      where: {
        franchiseeId: { in: validFranchiseeIds },
        createdAt: { gte: twentyFourHoursAgo },
      },
      include: {
        motoboy: {
          select: { id: true, name: true, phone: true },
        },
        orders: {
          select: {
            id: true,
            status: true,
            customerName: true,
            customerPhone: true,
            customerAddress: true,
            ifoodReference: true,
            openDeliveryReference: true,
            isRoutePriority: true,
            totalAmount: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ routes });
  } catch (err: any) {
    console.error("[GET /api/store/routes Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const body = await req.json();
    const { orderIds, motoboyId, color, routeNumber } = body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: "Informe ao menos 1 pedido para criar a rota" }, { status: 400 });
    }

    const validFranchiseeIds = await getValidFranchiseeIds(user.id);
    const primaryFranchiseeId = validFranchiseeIds[0] || user.id;

    // Gera número sequencial de rota se não enviado
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const existingTodayCount = await prisma.routeSchedule.count({
      where: {
        franchiseeId: { in: validFranchiseeIds },
        createdAt: { gte: todayStart },
      },
    });

    const finalRouteNumber = routeNumber || `Rota #${existingTodayCount + 1}`;

    // Cria o registro da Rota
    const newRoute = await prisma.routeSchedule.create({
      data: {
        franchiseeId: primaryFranchiseeId,
        routeNumber: finalRouteNumber,
        motoboyId: motoboyId || null, // Permite criar sem motoboy!
        color: color || "#3B82F6",
        status: "PENDING",
      },
    });

    // Associa os pedidos à rota e ativa PRIORIDADE PARA ROTA no KDS se o pedido não estiver PRONTO
    const ordersToUpdate = await prisma.customerOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, status: true },
    });

    for (const ord of ordersToUpdate) {
      const isNotReady = ord.status !== "PRONTO" && ord.status !== "SAIU_ENTREGA" && ord.status !== "ENTREGUE";
      await prisma.customerOrder.update({
        where: { id: ord.id },
        data: {
          routeId: newRoute.id,
          motoboyId: motoboyId || undefined,
          isRoutePriority: isNotReady, // 🚨 Marca PRIORIDADE PARA ROTA no KDS se não estiver pronto!
        },
      });
    }

    const fullRoute = await prisma.routeSchedule.findUnique({
      where: { id: newRoute.id },
      include: {
        motoboy: true,
        orders: true,
      },
    });

    return NextResponse.json({ success: true, route: fullRoute });
  } catch (err: any) {
    console.error("[POST /api/store/routes Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json();
    const { routeId, motoboyId, color, orderIds } = body;

    if (!routeId) {
      return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    }

    const updatedRoute = await prisma.routeSchedule.update({
      where: { id: routeId },
      data: {
        motoboyId: motoboyId === null ? null : (motoboyId || undefined),
        color: color || undefined,
      },
    });

    // Se informou motoboyId, atualiza nos pedidos da rota também
    if (motoboyId !== undefined) {
      await prisma.customerOrder.updateMany({
        where: { routeId },
        data: { motoboyId: motoboyId === null ? null : motoboyId },
      });
    }

    // Se orderIds foram atualizados na rota
    if (Array.isArray(orderIds)) {
      // Remove pedidos antigos que saíram da rota
      await prisma.customerOrder.updateMany({
        where: { routeId, id: { notIn: orderIds } },
        data: { routeId: null, isRoutePriority: false },
      });

      // Adiciona novos pedidos à rota
      for (const id of orderIds) {
        const ord = await prisma.customerOrder.findUnique({ where: { id }, select: { status: true } });
        const isNotReady = ord && ord.status !== "PRONTO" && ord.status !== "SAIU_ENTREGA" && ord.status !== "ENTREGUE";
        await prisma.customerOrder.update({
          where: { id },
          data: {
            routeId,
            motoboyId: motoboyId || undefined,
            isRoutePriority: !!isNotReady,
          },
        });
      }
    }

    const route = await prisma.routeSchedule.findUnique({
      where: { id: routeId },
      include: { motoboy: true, orders: true },
    });

    return NextResponse.json({ success: true, route });
  } catch (err: any) {
    console.error("[PATCH /api/store/routes Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const routeId = req.nextUrl.searchParams.get("routeId");
    if (!routeId) {
      return NextResponse.json({ error: "ID da rota não informado" }, { status: 400 });
    }

    // Remove referência nos pedidos
    await prisma.customerOrder.updateMany({
      where: { routeId },
      data: { routeId: null, isRoutePriority: false },
    });

    await prisma.routeSchedule.delete({
      where: { id: routeId },
    });

    return NextResponse.json({ success: true, message: "Rota desfeita com sucesso" });
  } catch (err: any) {
    console.error("[DELETE /api/store/routes Error]:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
