/**
 * GET /api/ifood/tracking?orderId=xxx
 * 
 * Retorna posição em tempo real do motoboy iFood.
 * Tracking só disponível após evento ASSIGN_DRIVER.
 * Polling recomendado: a cada 30 segundos.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { chamarPeloPedido } from "@/lib/ifood-pedido";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
  }

  const order: any = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      ifoodOrderId: true,
      ifoodStoreMerchant: true,
      franchiseeId: true,
      ifoodDriverName: true,
      ifoodDriverPhone: true,
      ifoodDriverVehicle: true,
      ifoodDriverPhotoUrl: true,
      ifoodDriverStatus: true,
      ifoodDriverRequestedAt: true,
      ifoodDeliveryEta: true,
    } as any,
  });

  if (!order?.ifoodOrderId) {
    return NextResponse.json({ error: "Pedido não encontrado ou não é do iFood" }, { status: 404 });
  }

  // Dados do driver do banco
  const driverInfo = {
    driverName: order.ifoodDriverName,
    driverPhone: order.ifoodDriverPhone,
    driverVehicle: order.ifoodDriverVehicle,
    driverPhotoUrl: order.ifoodDriverPhotoUrl,
    driverStatus: order.ifoodDriverStatus,
    requestedAt: order.ifoodDriverRequestedAt,
    deliveryEta: order.ifoodDeliveryEta,
  };

  // Se o driver ainda não foi atribuído, tracking não está disponível
  if (!order.ifoodDriverStatus || order.ifoodDriverStatus === "REQUESTED" || order.ifoodDriverStatus === "FAILED") {
    return NextResponse.json({
      tracking: null,
      driver: driverInfo,
      message: order.ifoodDriverStatus === "FAILED"
        ? "Nenhum motoboy disponível no momento"
        : "Aguardando atribuição de motoboy",
    });
  }

  // Buscar tracking na API do iFood
  try {
    // Com a credencial do dono do pedido (o token central só alcança a Hakim).
    const res = await chamarPeloPedido(
      order,
      `/order/v1.0/orders/${order.ifoodOrderId}/tracking`,
      { method: "GET", idempotente: true },
      "iFood Tracking",
    );

    if (!res.ok) {
      // 404 = tracking ainda não disponível (normal antes de ASSIGN_DRIVER)
      if (res.status === 404) {
        return NextResponse.json({
          tracking: null,
          driver: driverInfo,
          message: "Tracking ainda não disponível",
        });
      }
      console.error(`[iFood Tracking] Erro ${res.status}: ${res.texto.slice(0, 200)}`);
      return NextResponse.json({
        tracking: null,
        driver: driverInfo,
        error: `iFood retornou ${res.status}`,
      });
    }

    const data = res.data ?? {};

    // Atualiza ETA no banco se disponível
    if (data.expectedDelivery || data.deliveryEtaEnd) {
      const eta = data.expectedDelivery ?? data.deliveryEtaEnd;
      try {
        await prisma.customerOrder.update({
          where: { id: orderId },
          data: { ifoodDeliveryEta: new Date(eta) } as any,
        });
      } catch {}
    }

    return NextResponse.json({
      tracking: {
        latitude: data.latitude ?? data.lat ?? null,
        longitude: data.longitude ?? data.lng ?? null,
        expectedDelivery: data.expectedDelivery ?? data.deliveryEtaEnd ?? null,
        pickupEtaMinutes: data.pickupEtaStart
          ? Math.max(0, Math.ceil(data.pickupEtaStart / 60))
          : null,
        deliveryEtaMinutes: data.deliveryEtaEnd
          ? Math.max(0, Math.ceil(data.deliveryEtaEnd / 60))
          : null,
        trackDate: data.trackDate ?? new Date().toISOString(),
      },
      driver: driverInfo,
    });
  } catch (err: any) {
    console.error("[iFood Tracking] Erro:", err.message);
    return NextResponse.json({
      tracking: null,
      driver: driverInfo,
      error: err.message,
    }, { status: 500 });
  }
}
