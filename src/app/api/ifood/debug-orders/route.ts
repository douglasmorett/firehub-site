import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken, getMerchantIdForUser } from "@/lib/ifood-api";

/**
 * GET /api/ifood/debug-orders
 * Diagnóstico: tenta múltiplas formas de buscar pedidos do iFood.
 * Retorna todas as respostas brutas para debug.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const results: Record<string, any> = {};

  try {
    const token = await getIfoodToken();
    const email = session.user.email;
    const merchantId = await getMerchantIdForUser(email);
    results.tokenOk = true;
    results.merchantId = merchantId;

    // 1. Poll events (padrão)
    try {
      const r1 = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const t1 = await r1.text();
      results.eventsPoll = { status: r1.status, body: t1 ? JSON.parse(t1) : [] };
    } catch (e: any) {
      results.eventsPoll = { error: e.message };
    }

    // 2. Poll events com groups
    for (const group of ["ORDER_STATUS", "DELIVERY", "ORDER"]) {
      try {
        const r = await fetch(`https://merchant-api.ifood.com.br/events/v1.0/events:polling?groups=${group}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const t = await r.text();
        results[`eventsPoll_${group}`] = { status: r.status, body: t ? JSON.parse(t) : [] };
      } catch (e: any) {
        results[`eventsPoll_${group}`] = { error: e.message };
      }
    }

    // 3. Tentar listar pedidos direto pela API do merchant
    const orderEndpoints = [
      `/order/v1.0/orders?merchantId=${merchantId}`,
      `/order/v1.0/merchants/${merchantId}/orders`,
      `/merchant/v1.0/merchants/${merchantId}/orders`,
    ];

    for (const ep of orderEndpoints) {
      try {
        const r = await fetch(`https://merchant-api.ifood.com.br${ep}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const t = await r.text();
        results[ep] = { status: r.status, body: t.slice(0, 500) };
      } catch (e: any) {
        results[ep] = { error: e.message };
      }
    }

    // 4. Checar pedidos no banco do FireHub (últimos 5)
    const dbOrders = await prisma.customerOrder.findMany({
      where: { source: "IFOOD" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        ifoodOrderId: true,
        ifoodReference: true,
        status: true,
        createdAt: true,
        scheduledDatetime: true,
        customerName: true,
      },
    });
    results.dbRecentIfoodOrders = dbOrders;

  } catch (e: any) {
    results.error = e.message;
  }

  return NextResponse.json(results, { status: 200 });
}
