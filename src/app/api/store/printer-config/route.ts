import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const config = await req.json();

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const targetId = user.ownerId || user.id;

  await prisma.user.update({
    where: { id: targetId },
    data: { printerConfig: config },
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!currentUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const targetId = currentUser.ownerId || currentUser.id;

  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { printerConfig: true },
  });

  return NextResponse.json(user?.printerConfig || { autoprint: true, printers: [] });
}
