/**
 * PATCH /api/customer-order/assign-motoboy
 * Atribui ou remove um motoboy de um pedido.
 * O relatório do motoboy é baseado em CustomerOrder.motoboyId.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { orderId, motoboyId } = await req.json();
  if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

  const order = await prisma.customerOrder.update({
    where: { id: orderId },
    data: { motoboyId: motoboyId || null },
    include: { motoboy: { select: { id: true, name: true, phone: true } } },
  });

  return NextResponse.json({ success: true, motoboy: order.motoboy });
}
