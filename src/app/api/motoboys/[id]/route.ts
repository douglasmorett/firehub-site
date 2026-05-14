import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// PUT - atualizar motoboy
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Verifica se o motoboy pertence a este franqueado
  const existing = await prisma.motoboy.findFirst({
    where: { id, franchiseeId: user.id },
  });
  if (!existing) return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });

  const body = await req.json();
  const { name, phone, paymentType, dailyRate, perDeliveryRate, perKmRate, notes, active } = body;

  const motoboy = await prisma.motoboy.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(phone !== undefined && { phone: phone?.trim() || null }),
      ...(paymentType !== undefined && { paymentType }),
      ...(dailyRate !== undefined && { dailyRate: dailyRate ? Number(dailyRate) : null }),
      ...(perDeliveryRate !== undefined && { perDeliveryRate: perDeliveryRate ? Number(perDeliveryRate) : null }),
      ...(perKmRate !== undefined && { perKmRate: perKmRate ? Number(perKmRate) : null }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(active !== undefined && { active }),
    },
  });

  return NextResponse.json(motoboy);
}

// DELETE - remover motoboy
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const existing = await prisma.motoboy.findFirst({
    where: { id, franchiseeId: user.id },
  });
  if (!existing) return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });

  await prisma.motoboy.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
