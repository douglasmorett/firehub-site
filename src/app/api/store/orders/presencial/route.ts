import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await req.json();
  const { customerName, customerPhone, customerAddress, deliveryType, paymentMethod, notes, totalAmount, deliveryFee, items } = data;

  if (!items || items.length === 0) return NextResponse.json({ error: "Nenhum item informado" }, { status: 400 });

  const dbUser = await prisma.user.findUnique({ where: { email: session.user.email! }, select: { id: true } });
  if (!dbUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const order = await prisma.customerOrder.create({
    data: {
      franchiseeId: dbUser.id,
      customerName: customerName || "Balcão",
      customerPhone: customerPhone || "00000000000",
      customerAddress: customerAddress || "",
      deliveryType: deliveryType || "RETIRADA",
      paymentMethod: paymentMethod || "Dinheiro",
      notes: notes || "",
      totalAmount: totalAmount || 0,
      deliveryFee: deliveryFee || 0,
      status: "ACEITO",
      source: "PRESENCIAL",
      items: {
        create: items.map((item: any) => ({
          menuProductId: item.menuProductId,
          quantity: item.quantity,
          price: item.price,
        })),
      },
    },
  });

  return NextResponse.json({ success: true, orderId: order.id });
}
