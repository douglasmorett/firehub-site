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

async function withRetry<T>(fn: () => Promise<T>, retries = 4, delayMs = 600): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function GET(req: NextRequest) {
  try {
    let email: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      email = session?.user?.email || null;
    } catch {}

    let userStoreIds: string[] = [];
    let user: any = null;

    if (email) {
      user = await withRetry(() =>
        prisma.user.findUnique({
          where: { email },
          select: { id: true, ownerId: true, isFranqueadoHakim: true, storeTimezone: true },
        })
      ).catch(() => null);

      if (user) {
        if (user.id) userStoreIds.push(user.id);
        if (user.ownerId) userStoreIds.push(user.ownerId);
      }
    }

    userStoreIds = Array.from(new Set(userStoreIds.filter(Boolean)));

    const stage = req.nextUrl.searchParams.get("stage") || "production";

    // Buscar data de abertura do caixa ativo (ou últimas 24h) para ignorar pedidos antigos esquecidos
    const activeSession = await withRetry(() =>
      prisma.cashSession.findFirst({
        where: { franchiseeId: { in: userStoreIds }, status: "OPEN" },
        orderBy: { openedAt: "desc" },
        select: { openedAt: true },
      })
    ).catch(() => null);

    // Usar corte amplo de 48 horas para NUNCA ocultar pedidos criados antes da abertura do caixa ativo!
    const safeCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    let storeCondition: any[] = [];
    if (userStoreIds.length > 0) {
      storeCondition = [
        { franchiseeId: { in: userStoreIds } },
        { franchisee: { ownerId: { in: userStoreIds } } },
        { franchiseeId: null }
      ];
    }

    let where: any = {
      franchiseeId: { in: userStoreIds },
      status: { notIn: ["CANCELADO", "ENTREGUE", "ENCERRADO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] },
      createdAt: { gte: safeCutoff },
    };

    if (stage === "finishing") {
      where.kdsStage = "FINISHING";
    } else if (stage === "production") {
      where.OR = [
        { kdsStage: "PRODUCTION" },
        { kdsStage: "PENDING" },
        { kdsStage: null },
      ];
    } else if (stage !== "all") {
      where.kdsStage = { not: "FINISHED" };
    }

    const orders = await withRetry(() =>
      prisma.customerOrder.findMany({
        where,
        select: {
          id: true,
          dailyOrderNumber: true,
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
          isRoutePriority: true,
          routeId: true,
          routeSchedule: {
            select: {
              routeNumber: true,
            },
          },
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
              notes: true, // observacao por item ("sem cebola") — precisa chegar na cozinha
              // Nome do item como a plataforma mandou. Sem ele no select, a
              // cozinha lê o nome do cadastro, que pode estar desatualizado.
              productName: true,
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
        orderBy: [
          { isRoutePriority: "desc" },
          { createdAt: "asc" },
        ],
        take: 100,
      })
    ).catch(() => []);

    const ordersWithDailyNum = orders;

    return NextResponse.json(ordersWithDailyNum, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (err: any) {
    console.error("[KDS GET Error]:", err?.message || err);
    return NextResponse.json({ error: err?.message || String(err), stack: err?.stack }, { status: 500 });
  }
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
    // `openDeliveryChannel`/`source`/`deliveryBy` entram porque o id do 99Food
    // mora no mesmo campo do JotaJá: sem o canal aqui, não há como saber para
    // qual parceiro mandar o "pronto".
    select: {
      id: true, kdsStage: true, status: true, deliveryType: true, franchiseeId: true,
      ifoodOrderId: true, openDeliveryOrderId: true,
      openDeliveryChannel: true, source: true, deliveryBy: true,
    },
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

    // 🚀 Sincronizar com iFood, Jotajá e WhatsApp de forma assíncrona (não-bloqueante para resposta instantânea no KDS)
    (async () => {
      if (order.ifoodOrderId) {
        try {
          const { getIfoodToken } = await import("@/lib/ifood-api");
          const token = await getIfoodToken();
          const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
          await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${order.ifoodOrderId}/readyToPickup`, {
            method: "POST",
            headers,
          });
        } catch (errIfood) {
          console.warn("[KDS iFood Sync Error]:", errIfood);
        }
      }

      // O "pronto" do KDS vale para os dois parceiros que usam este campo, mas
      // a chamada é de cada um. Mandar pedido do 99Food para a API do JotaJá
      // era avisar o parceiro errado e deixar o entregador do 99 sem chamado.
      const { ehPedido99Food, sincronizar99Food } = await import("@/lib/food99-status");

      if (ehPedido99Food(order)) {
        await sincronizar99Food(
          {
            openDeliveryOrderId: order.openDeliveryOrderId!,
            franchiseeId: order.franchiseeId,
            status: order.status,
            deliveryBy: order.deliveryBy,
          },
          "PRONTO"
        ).catch((e) => console.warn("[KDS 99Food Sync Error]:", e?.message));
      } else if (order.openDeliveryOrderId) {
        try {
          const { jotajaFetch } = await import("@/lib/jotaja-api");
          await jotajaFetch(`/v1/orders/${order.openDeliveryOrderId}/readyToPickup`, { method: "POST" }, order.franchiseeId);
        } catch (errOd) {
          console.warn("[KDS Jotajá Sync Error]:", errOd);
        }
      }

      if (isPickup) {
        try {
          const { sendOrderNotification } = await import("@/lib/order-notifications");
          sendOrderNotification(orderId, "PRONTO_RETIRADA").catch(() => {});
        } catch (errWp) {
          console.warn("[KDS API] Erro ao disparar notificação WhatsApp:", errWp);
        }
      }
    })();

    return NextResponse.json({ success: true, stage: "FINISHED" });
  }

  if (action === "revert_production" || action === "undo_production") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        kdsStage: "PRODUCTION",
        kdsFinishingAt: null,
      },
    });
    return NextResponse.json({ success: true, stage: "PRODUCTION" });
  }

  if (action === "revert_finishing" || action === "undo_finishing") {
    const isPickup = order.deliveryType !== "DELIVERY";
    const updateData: any = {
      kdsStage: "FINISHING",
    };
    if (isPickup && order.status === "SAIU_ENTREGA") {
      updateData.status = "PREPARANDO";
    }
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: updateData,
    });
    return NextResponse.json({ success: true, stage: "FINISHING" });
  }

  return NextResponse.json({ error: "Action inválida" }, { status: 400 });
}
