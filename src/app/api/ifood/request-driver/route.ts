/**
 * /api/ifood/request-driver
 * 
 * iFood Entrega Fácil (Logística On-Demand do iFood para Pedidos Próprios e iFood)
 * 
 * GET    — Consulta cotação de frete + tempo estimado para motoboy iFood
 * POST   — Solicita motoboy parceiro do iFood (Entrega Fácil)
 * DELETE — Cancela solicitação de motoboy iFood
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken } from "@/lib/ifood-api";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

// GET: Consulta disponibilidade e cotação de frete (Entrega Fácil)
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
      franchisee: { select: { ifoodMerchantId: true } },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const merchantId = order.franchisee?.ifoodMerchantId || process.env.IFOOD_MERCHANT_ID;

  try {
    const token = await getIfoodToken();

    // FLUXO 1: Pedido originado no próprio iFood
    if (order.ifoodOrderId) {
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
      const options = Array.isArray(data) ? data : data?.availabilities ?? [data];
      const bestOption = options[0];

      if (!bestOption) {
        return NextResponse.json({ available: false, error: "Nenhuma opção de entrega disponível para esta região" });
      }

      return NextResponse.json({
        available: true,
        quoteId: bestOption.id ?? bestOption.quoteId ?? null,
        price: bestOption.price ?? bestOption.fee ?? bestOption.totalPrice ?? 0,
        estimatedMinutes: bestOption.estimatedMinutes ?? bestOption.estimatedDeliveryTime ?? bestOption.eta ?? null,
        options: options.map((o: any) => ({
          id: o.id ?? o.quoteId,
          price: o.price ?? o.fee ?? o.totalPrice ?? 0,
          estimatedMinutes: o.estimatedMinutes ?? o.estimatedDeliveryTime ?? o.eta ?? null,
          description: o.description ?? o.name ?? "iFood Entrega Própria/Parceira",
        })),
      });
    }

    // FLUXO 2: Pedido Próprio (WhatsApp / Cardápio Digital / Balcão) — iFood Entrega Fácil
    if (!merchantId) {
      return NextResponse.json({
        available: false,
        error: "Para usar o iFood Entrega Fácil em pedidos próprios, conecte sua conta do iFood no painel de Integrações.",
      });
    }

    // Solicita cotação na API do iFood Entrega Fácil
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

    const resText = await res.text().catch(() => "");
    if (!res.ok) {
      console.warn(`[iFood Entrega Fácil] Cotação externa ${order.id}: ${res.status} ${resText.slice(0, 200)}`);
      // Fallback para endpoint de availabilities se quote falhar
      const fallbackRes = await fetch(`${IFOOD_BASE}/shipping/v1.0/deliveryAvailabilities`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, orderId: order.id }),
      }).catch(() => null);

      if (fallbackRes && fallbackRes.ok) {
        const fbData = await fallbackRes.json();
        const fbOptions = Array.isArray(fbData) ? fbData : fbData?.availabilities ?? [fbData];
        const fbBest = fbOptions[0];
        if (fbBest) {
          return NextResponse.json({
            available: true,
            quoteId: fbBest.id ?? fbBest.quoteId ?? null,
            price: fbBest.price ?? fbBest.fee ?? 12.5,
            estimatedMinutes: fbBest.estimatedMinutes ?? 25,
          });
        }
      }

      return NextResponse.json({
        available: false,
        error: `Não foi possível calcular frete iFood para este endereço.`,
        details: resText.slice(0, 200),
      });
    }

    const data = JSON.parse(resText);
    return NextResponse.json({
      available: true,
      quoteId: data.id ?? data.quoteId ?? null,
      price: data.price ?? data.fee ?? data.deliveryFee ?? 0,
      estimatedMinutes: data.estimatedMinutes ?? data.deliveryEta ?? 25,
      description: "iFood Entrega Fácil",
    });
  } catch (err: any) {
    console.error("[iFood Driver] Erro na cotação:", err.message);
    return NextResponse.json({ available: false, error: err.message }, { status: 500 });
  }
}

// POST: Solicitar motoboy iFood (Entrega Fácil ou Pedido iFood)
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
      // Pedido originado no iFood
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
      // Pedido Próprio — iFood Entrega Fácil
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
    console.log(`[iFood Driver] requestDriver ${order.id}: ${res.status} ${resText.slice(0, 200)}`);

    if (!res.ok && res.status !== 202 && res.status !== 200 && res.status !== 201) {
      return NextResponse.json(
        {
          error: `iFood retornou ${res.status}`,
          details: resText.slice(0, 300),
        },
        { status: res.status >= 500 ? 502 : 400 }
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

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

    console.log(`[iFood Driver] cancel ${order.id}: ${res.status}`);

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
