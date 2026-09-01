import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { nomeDoItem } from "@/lib/nome-do-item";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado.", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const { orderId } = await params;

  const order = await prisma.customerOrder.findFirst({
    where: {
      id: orderId,
      franchiseeId: auth.franchiseeId,
    },
    include: {
      items: {
        include: {
          menuProduct: { select: { id: true, name: true } },
        },
      },
      motoboy: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado ou não pertence a esta loja." }, { status: 404 });
  }

  const refNum = order.openDeliveryReference || order.ifoodReference || order.id.slice(-4).toUpperCase();
  const channel = order.openDeliveryChannel || (order.openDeliveryReference ? "Jotajá" : order.ifoodReference ? "iFood" : "API_EXTERNA");

  return NextResponse.json({
    id: order.id,
    firehubOrderNumber: refNum,
    channel,
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerAddress: order.customerAddress,
    deliveryType: order.deliveryType,
    paymentMethod: order.paymentMethod,
    subtotal: order.totalAmount - (order.deliveryFee || 0),
    deliveryFee: order.deliveryFee,
    totalAmount: order.totalAmount,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    motoboy: order.motoboy ? { id: order.motoboy.id, name: order.motoboy.name, phone: order.motoboy.phone } : null,
    items: order.items.map((i) => ({
      id: i.id,
      name: nomeDoItem(i),
      quantity: i.quantity,
      unitPrice: i.price,
      totalPrice: i.price * i.quantity,
      comboSelections: typeof i.comboSelections === "string" ? JSON.parse(i.comboSelections) : i.comboSelections,
    })),
  });
}
