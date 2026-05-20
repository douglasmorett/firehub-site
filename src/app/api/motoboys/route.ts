import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// GET - listar motoboys do franqueado
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const motoboys = await prisma.motoboy.findMany({
    where: { franchiseeId: user.id },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      orders: {
        where: {
          createdAt: { gte: today },
          status: { notIn: ["CANCELADO"] },
        },
        select: { id: true, totalAmount: true, deliveryType: true, deliveryFee: true },
      },
    },
  });

  // Calculate earnings for each motoboy
  const result = motoboys.map((mb) => {
    const todayOrders = mb.orders || [];
    const deliveryCount = todayOrders.length;
    const daily = mb.dailyRate || 0;

    let deliveryFees = 0;
    if (mb.paymentType === "DAILY_PLUS_FEE") {
      // Sum actual delivery fees from orders
      deliveryFees = todayOrders.reduce((sum, o) => sum + (o.deliveryFee || 0), 0);
    } else {
      // Fixed per-delivery rate
      deliveryFees = (mb.perDeliveryRate || 0) * deliveryCount;
    }

    const totalEarnings = daily + deliveryFees;

    return {
      ...mb,
      orders: undefined, // don't send full orders to client
      todayDeliveryCount: deliveryCount,
      todayDeliveryFees: deliveryFees,
      todayDailyRate: daily,
      todayTotalEarnings: totalEarnings,
    };
  });

  return NextResponse.json(result);
}

// POST - criar motoboy
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const body = await req.json();
  const { name, phone, paymentType, dailyRate, perDeliveryRate, perKmRate, notes } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  const motoboy = await prisma.motoboy.create({
    data: {
      franchiseeId: user.id,
      name: name.trim(),
      phone: phone?.trim() || null,
      paymentType: paymentType || "PER_DELIVERY",
      dailyRate: dailyRate ? Number(dailyRate) : null,
      perDeliveryRate: perDeliveryRate ? Number(perDeliveryRate) : null,
      perKmRate: perKmRate ? Number(perKmRate) : null,
      notes: notes?.trim() || null,
    },
  });

  return NextResponse.json(motoboy, { status: 201 });
}
