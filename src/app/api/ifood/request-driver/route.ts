/**
 * /api/ifood/request-driver
 * 
 * GET  — Consulta cotação: preço + tempo estimado para motoboy iFood
 * POST — Solicita motoboy iFood para um pedido
 * DELETE — Cancela solicitação de motoboy iFood
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken } from "@/lib/ifood-api";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

// GET: Consulta disponibilidade e cotação
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { ifoodOrderId: true, franchiseeId: true },
  });

  if (!order?.ifoodOrderId) {
    return NextResponse.json({ error: "Pedido não é do iFood ou não encontrado" }, { status: 404 });
  }

  try {
    const token = await getIfoodToken();

    const res = await fetch(
      `${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/deliveryAvailabilities`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[iFood Driver] Cotação falhou: ${res.status} — ${errText.slice(0, 300)}`);
      return NextResponse.json({
        available: false,
        error: `iFood retornou ${res.status}`,
        details: errText.slice(0, 200),
      });
    }

    const data = await res.json();

    // iFood retorna array de opções de entrega
    const options = Array.isArray(data) ? data : data?.availabilities ?? [data];
    const bestOption = options[0]; // Primeira opção disponível

    if (!bestOption) {
      return NextResponse.json({ available: false, error: "Nenhuma opção de entrega disponível" });
    }

    return NextResponse.json({
      available: true,
      quoteId: bestOption.id ?? bestOption.quoteId ?? null,
      price: bestOption.price ?? bestOption.fee ?? bestOption.totalPrice ?? 0,
      estimatedMinutes: bestOption.estimatedMinutes ?? bestOption.estimatedDeliveryTime ?? bestOption.eta ?? null,
      estimatedPickupMinutes: bestOption.estimatedPickupTime ?? null,
      options: options.map((o: any) => ({
        id: o.id ?? o.quoteId,
        price: o.price ?? o.fee ?? o.totalPrice ?? 0,
        estimatedMinutes: o.estimatedMinutes ?? o.estimatedDeliveryTime ?? o.eta ?? null,
        description: o.description ?? o.name ?? null,
      })),
    });
  } catch (err: any) {
    console.error("[iFood Driver] Erro na cotação:", err.message);
    return NextResponse.json({ available: false, error: err.message }, { status: 500 });
  }
}

// POST: Solicitar motoboy iFood
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { orderId, quoteId } = await req.json();
  if (!orderId) {
    return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { ifoodOrderId: true, franchiseeId: true },
  });

  if (!order?.ifoodOrderId) {
    return NextResponse.json({ error: "Pedido não é do iFood ou não encontrado" }, { status: 404 });
  }

  try {
    const token = await getIfoodToken();

    const body: any = {};
    if (quoteId) body.quoteId = quoteId;

    const res = await fetch(
      `${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/requestDriver`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const resText = await res.text().catch(() => "");
    console.log(`[iFood Driver] requestDriver ${order.ifoodOrderId}: ${res.status} ${resText.slice(0, 200)}`);

    if (!res.ok && res.status !== 202) {
      return NextResponse.json({
        error: `iFood retornou ${res.status}`,
        details: resText.slice(0, 300),
      }, { status: res.status >= 500 ? 502 : 400 });
    }

    // Atualiza status no banco
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        ifoodDriverStatus: "REQUESTED",
        ifoodDriverRequestedAt: new Date(),
      } as any,
    });

    return NextResponse.json({ success: true, status: "REQUESTED" });
  } catch (err: any) {
    console.error("[iFood Driver] Erro ao solicitar:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: Cancelar solicitação de motoboy iFood
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { ifoodOrderId: true },
  });

  if (!order?.ifoodOrderId) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  try {
    const token = await getIfoodToken();

    const res = await fetch(
      `${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/cancelRequestDriver`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      }
    );

    console.log(`[iFood Driver] cancelRequestDriver ${order.ifoodOrderId}: ${res.status}`);

    // Limpa campos do driver no banco
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        ifoodDriverStatus: null,
        ifoodDriverName: null,
        ifoodDriverPhone: null,
        ifoodDriverVehicle: null,
        ifoodDriverPhotoUrl: null,
        ifoodDriverRequestedAt: null,
        ifoodDeliveryEta: null,
      } as any,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[iFood Driver] Erro ao cancelar:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
