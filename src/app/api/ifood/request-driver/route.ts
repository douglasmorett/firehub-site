/**
 * /api/ifood/request-driver
 * 
 * iFood Entrega Fácil / Motoboy iFood
 * 
 * GET    — Consulta cotação de frete + tempo estimado para motoboy iFood
 * POST   — Solicita motoboy parceiro do iFood
 * DELETE — Cancela solicitação de motoboy iFood
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken } from "@/lib/ifood-api";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

// GET: Consulta disponibilidade e cotação de frete (Motoboy iFood)
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
    select: {
      id: true,
      ifoodOrderId: true,
      customerName: true,
      customerPhone: true,
      customerAddress: true,
      totalAmount: true,
      franchiseeId: true,
      franchisee: {
        select: {
          ifoodMerchantId: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ available: false, error: "Pedido não encontrado" }, { status: 404 });
  }

  const merchantId = order.franchisee?.ifoodMerchantId || process.env.IFOOD_MERCHANT_ID;

  try {
    const token = await getIfoodToken();

    // FLUXO 1: Pedido do iFood (origem iFood)
    if (order.ifoodOrderId) {
      const res = await fetch(
        `${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/deliveryAvailabilities`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn(`[iFood Driver] cotação falhou no pedido ${order.ifoodOrderId}: status ${res.status} ${errText.slice(0, 100)}`);
        
        // Se a API do iFood recusar (403, 400, 404, 422, etc)
        return NextResponse.json({
          available: false,
          error: "Motoboy iFood não está liberado para este pedido",
        });
      }

      const data = await res.json();
      const options = Array.isArray(data) ? data : data?.availabilities ?? [data];
      const bestOption = options[0];

      if (!bestOption) {
        return NextResponse.json({
          available: false,
          error: "Motoboy iFood não está liberado para este pedido",
        });
      }

      return NextResponse.json({
        available: true,
        quoteId: bestOption.id ?? bestOption.quoteId ?? null,
        price: bestOption.price ?? bestOption.fee ?? bestOption.totalPrice ?? 0,
        estimatedMinutes: bestOption.estimatedMinutes ?? bestOption.estimatedDeliveryTime ?? bestOption.eta ?? 25,
      });
    }

    // FLUXO 2: Pedido Próprio da Loja (WhatsApp / Cardápio Digital / Balcão) — iFood Entrega Fácil
    if (!merchantId) {
      return NextResponse.json({
        available: false,
        error: "Para usar o iFood Entrega Fácil em pedidos próprios, conecte sua conta iFood nas Configurações de Integrações.",
      });
    }

    // Cotação para pedido externo via Entrega Fácil
    const quotePayload = {
      merchantId,
      externalOrderId: order.id,
      orderValue: order.totalAmount,
      customer: {
        name: order.customerName || "Cliente",
        phone: (order.customerPhone || "").replace(/\D/g, ""),
      },
      deliveryAddress: {
        rawAddress: order.customerAddress || "",
      },
    };

    const res = await fetch(`${IFOOD_BASE}/delivery/v1.0/deliveries/quote`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(quotePayload),
    });

    if (!res.ok) {
      // Fallback para cotação estimada de frete iFood Entrega Fácil (R$ 11,90)
      return NextResponse.json({
        available: true,
        quoteId: `quote-${order.id.slice(-6)}`,
        price: 11.90,
        estimatedMinutes: 25,
        description: "iFood Entrega Fácil",
      });
    }

    const data = await res.json();
    return NextResponse.json({
      available: true,
      quoteId: data.id ?? data.quoteId ?? null,
      price: data.price ?? data.fee ?? data.deliveryFee ?? 11.90,
      estimatedMinutes: data.estimatedMinutes ?? data.deliveryEta ?? 25,
      description: "iFood Entrega Fácil",
    });
  } catch (err: any) {
    console.error("[iFood Driver] Exceção na cotação:", err.message);
    return NextResponse.json({ available: false, error: "Motoboy iFood não está liberado para este pedido" }, { status: 500 });
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
    select: {
      id: true,
      ifoodOrderId: true,
      franchiseeId: true,
      franchisee: { select: { ifoodMerchantId: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const merchantId = order.franchisee?.ifoodMerchantId || process.env.IFOOD_MERCHANT_ID;

  try {
    const token = await getIfoodToken();

    let res: Response;
    if (order.ifoodOrderId) {
      const body: any = {};
      if (quoteId) body.quoteId = quoteId;

      res = await fetch(`${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/requestDriver`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } else {
      res = await fetch(`${IFOOD_BASE}/delivery/v1.0/deliveries`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          merchantId,
          externalOrderId: order.id,
          quoteId,
        }),
      });
    }

    const resText = await res.text().catch(() => "");
    console.log(`[iFood Driver] requestDriver ${order.id}: ${res.status}`);

    if (!res.ok && res.status !== 202 && res.status !== 200 && res.status !== 201) {
      return NextResponse.json(
        {
          error: "Motoboy iFood não está liberado para este pedido",
        },
        { status: 400 }
      );
    }

    // Atualiza status no banco
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        ifoodDriverStatus: "REQUESTED",
        ifoodDriverRequestedAt: new Date(),
        deliveryBy: "IFOOD",
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
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, ifoodOrderId: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  try {
    const token = await getIfoodToken();

    const url = order.ifoodOrderId
      ? `${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/cancelRequestDriver`
      : `${IFOOD_BASE}/delivery/v1.0/deliveries/${order.id}/cancel`;

    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

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
        deliveryBy: null,
      } as any,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[iFood Driver] Erro ao cancelar:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
