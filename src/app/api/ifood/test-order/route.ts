/**
 * GET /api/ifood/test-order?orderId=xxx
 * Busca um pedido de teste do iFood pelo ID e salva no banco.
 * Útil para testar a integração antes da homologação.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

async function getAccessToken(): Promise<string | null> {
  const clientId     = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType:    "client_credentials",
      clientId,
      clientSecret,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.accessToken ?? null;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
  }

  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({
      error: "Credenciais iFood não configuradas",
      hint: "Configure IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET no Vercel",
    }, { status: 503 });
  }

  // Busca detalhes do pedido
  const orderRes = await fetch(`${IFOOD_BASE}/order/v1.0/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!orderRes.ok) {
    const err = await orderRes.text();
    return NextResponse.json({ error: "Pedido não encontrado no iFood", details: err }, { status: 404 });
  }

  const order = await orderRes.json();

  // Salva no banco como CustomerOrder para testar
  const existing = await prisma.customerOrder.findFirst({
    where: { ifoodOrderId: orderId },
  });

  if (!existing) {
    const ifoodItems: any[] = order.items ?? [];
    const totalAmount: number = order.totalPrice ?? ifoodItems.reduce((s: number, i: any) => s + (i.totalPrice ?? 0), 0);

    // Usa o primeiro admin como franchiseeId para pedidos iFood de teste
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    if (!adminUser) {
      return NextResponse.json({ error: "Nenhum admin encontrado" }, { status: 500 });
    }

    const addr = order.delivery?.deliveryAddress;
    const customerAddress = addr
      ? `${addr.streetName ?? ""}, ${addr.streetNumber ?? ""} - ${addr.neighborhood ?? ""}`.trim()
      : "Retirada";

    await prisma.customerOrder.create({
      data: {
        ifoodOrderId:    orderId,
        ifoodReference:  order.displayId ?? undefined,
        status:          "NOVO",
        source:          "IFOOD",
        customerName:    order.customer?.name ?? "Cliente iFood",
        customerPhone:   order.customer?.phone ?? "",
        customerAddress,
        deliveryType:    order.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
        paymentMethod:   order.payments?.[0]?.name ?? "iFood",
        totalAmount,
        notes:           `[IFOOD] ${order.merchant?.name ?? ""}`,
        franchiseeId:    adminUser.id,
        items: {
          create: ifoodItems.map((i: any) => ({
            quantity: i.quantity ?? 1,
            price:    i.totalPrice ?? i.unitPrice ?? 0,
          })),
        },
      },
    });
  }

  return NextResponse.json({
    success: true,
    saved: !existing,
    order: {
      id:       orderId,
      status:   order.orderStatus,
      customer: order.customer?.name,
      total:    order.totalPrice,
      items:    order.items?.length ?? 0,
    },
  });
}
