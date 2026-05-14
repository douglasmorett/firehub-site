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

  const motoboys = await prisma.motoboy.findMany({
    where: { franchiseeId: user.id },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return NextResponse.json(motoboys);
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
