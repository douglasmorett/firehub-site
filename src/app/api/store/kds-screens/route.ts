import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });

  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  const storeOwner = await prisma.user.findUnique({
    where: { id: targetFranchiseeId },
    select: { kdsScreens: true },
  });

  return NextResponse.json(storeOwner?.kdsScreens || []);
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });

  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;
  const screens = await req.json();

  if (!Array.isArray(screens)) {
    return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: targetFranchiseeId },
    data: { kdsScreens: screens },
  });

  return NextResponse.json({ ok: true, screens });
}
