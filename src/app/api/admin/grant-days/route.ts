import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { role: true },
  });

  if (me?.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { userId, days } = await req.json();

  if (!userId || typeof days !== "number" || days <= 0) {
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, trialEndsAt: true, name: true, storeName: true },
  });

  if (!targetUser) {
    return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });
  }

  const now = new Date();
  const currentEnd = targetUser.trialEndsAt && new Date(targetUser.trialEndsAt) > now
    ? new Date(targetUser.trialEndsAt)
    : now;

  const newTrialEndsAt = new Date(currentEnd.getTime() + days * 86400000);

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { trialEndsAt: newTrialEndsAt },
    select: { id: true, trialEndsAt: true, name: true, storeName: true },
  });

  return NextResponse.json({
    ok: true,
    trialEndsAt: updatedUser.trialEndsAt?.toISOString(),
    daysGranted: days,
    message: `${days} dias liberados com sucesso para ${updatedUser.storeName || updatedUser.name}!`,
  });
}
