import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarLogistica, NAO_AUTORIZADO, problema } from "@/lib/open-delivery-saida/acesso";
import { pedidoNoFormatoOD, vaiParaALogistica } from "@/lib/open-delivery-saida/pedido";

/**
 * GET /api/opendelivery/v1/orders/{orderId} — o pedido no formato Order do Open Delivery V1.
 *
 * Só pedido da loja do token E que vai para a logística (entrega de canal
 * próprio — lib/open-delivery-saida/pedido.ts). O resto é 404, inclusive o
 * pedido do iFood da mesma loja: a logística não tem o que fazer com ele.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const integ = await autenticarLogistica(req);
  if (!integ) return NAO_AUTORIZADO();

  const { orderId } = await params;
  const pedido = await prisma.customerOrder.findFirst({
    where: { id: orderId, franchiseeId: integ.franchiseeId },
    include: { items: { include: { menuProduct: { select: { name: true } } } } },
  });
  if (!pedido || !vaiParaALogistica(pedido)) return problema(404, "Pedido não encontrado.");

  const loja = await prisma.user.findUnique({
    where: { id: integ.franchiseeId },
    select: { storeName: true, city: true, storeAddress: true },
  });

  return NextResponse.json(pedidoNoFormatoOD(pedido, loja || {}, integ));
}
