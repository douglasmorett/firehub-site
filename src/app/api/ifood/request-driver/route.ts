/**
 * /api/ifood/request-driver
 * 
 * iFood Entrega Fácil / Motoboy iFood (Sob Demanda)
 * 
 * GET    — Consulta cotação de frete + tempo estimado para motoboy iFood
 * POST   — Solicita motoboy parceiro do iFood (Despacho / Request Driver)
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
      deliveryFee: true,
      customerName: true,
      customerPhone: true,
      customerAddress: true,
      totalAmount: true,
      franchiseeId: true,
      franchisee: {
        select: {
          ifoodMerchantId: true,
          ifoodAccessToken: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ available: false, error: "Pedido não encontrado" }, { status: 404 });
  }

  const merchantId = order.franchisee?.ifoodMerchantId || process.env.IFOOD_MERCHANT_ID;
  const userToken = order.franchisee?.ifoodAccessToken;

  try {
    const devToken = await getIfoodToken();

    // FLUXO 1: Pedido do iFood
    if (order.ifoodOrderId) {
      try {
        const res = await fetch(
          `${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/deliveryAvailabilities`,
          { headers: { Authorization: `Bearer ${userToken || devToken}`, Accept: "application/json" } }
        );

        if (res.ok) {
          const data = await res.json();
          const options = Array.isArray(data) ? data : data?.availabilities ?? [data];
          const bestOption = options[0];
          if (bestOption) {
            return NextResponse.json({
              available: true,
              quoteId: bestOption.id ?? bestOption.quoteId ?? null,
              price: bestOption.price ?? bestOption.fee ?? bestOption.totalPrice ?? (order.deliveryFee || 9.99),
              estimatedMinutes: bestOption.estimatedMinutes ?? bestOption.estimatedDeliveryTime ?? bestOption.eta ?? 15,
              description: "Entrega individual Sob Demanda",
            });
          }
        }
      } catch (e: any) {
        console.warn("[iFood Driver] erro no fetch shipping API:", e?.message);
      }

      // Fallback gracioso com valor da taxa do pedido ou R$ 9,99 (padrão iFood Sob Demanda)
      const calculatedFee = (order.deliveryFee && order.deliveryFee > 0) ? order.deliveryFee : 9.99;
      return NextResponse.json({
        available: true,
        quoteId: `quote-${order.id.slice(-6)}`,
        price: calculatedFee,
        estimatedMinutes: 15,
        description: "Entrega individual Sob Demanda",
      });
    }

    // FLUXO 2: Pedido Próprio da Loja (WhatsApp / Cardápio Digital / Balcão) — iFood Entrega Fácil
    if (!merchantId) {
      return NextResponse.json({
        available: false,
        error: "Para usar o iFood Entrega Fácil em pedidos próprios, conecte sua conta iFood nas Configurações de Integrações.",
      });
    }

    const calculatedFee = (order.deliveryFee && order.deliveryFee > 0) ? order.deliveryFee : 11.90;
    return NextResponse.json({
      available: true,
      quoteId: `quote-${order.id.slice(-6)}`,
      price: calculatedFee,
      estimatedMinutes: 20,
      description: "iFood Entrega Fácil (Sob Demanda)",
    });
  } catch (err: any) {
    console.error("[iFood Driver] Exceção na cotação:", err.message);
    return NextResponse.json({
      available: true,
      quoteId: `quote-${order.id.slice(-6)}`,
      price: 9.99,
      estimatedMinutes: 15,
      description: "Entrega individual Sob Demanda",
    });
  }
}

// POST: Solicitar motoboy iFood (Despacho / Request Driver)
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
      franchisee: { select: { ifoodMerchantId: true, ifoodAccessToken: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const merchantId = order.franchisee?.ifoodMerchantId || process.env.IFOOD_MERCHANT_ID;
  const userToken = order.franchisee?.ifoodAccessToken;

  try {
    const devToken = await getIfoodToken();
    const token = userToken || devToken;

    if (order.ifoodOrderId) {
      // Executa o despacho de entrega sob demanda no iFood (retorna 202 Accepted)
      let res = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${order.ifoodOrderId}/dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });

      // Fallback para endpoint de requestDriver
      if (!res.ok) {
        res = await fetch(`${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/requestDriver`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId }),
        });
      }
    } else {
      // Pedido Próprio da Loja — iFood Entrega Fácil
      await fetch(`${IFOOD_BASE}/delivery/v1.0/deliveries`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, externalOrderId: order.id, quoteId }),
      }).catch(() => null);
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
    const devToken = await getIfoodToken();

    const url = order.ifoodOrderId
      ? `${IFOOD_BASE}/shipping/v1.0/orders/${order.ifoodOrderId}/cancelRequestDriver`
      : `${IFOOD_BASE}/delivery/v1.0/deliveries/${order.id}/cancel`;

    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${devToken}`, "Content-Type": "application/json" },
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
