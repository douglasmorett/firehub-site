import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, employeeAccountEnabled: true },
  });

  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const masterUserId = user.ownerId || user.id;
  const masterUser = await prisma.user.findUnique({
    where: { id: masterUserId },
    select: { employeeAccountEnabled: true },
  });

  return NextResponse.json({
    employeeAccountEnabled: masterUser?.employeeAccountEnabled ?? false,
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { enabled } = await req.json();
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });

  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetId = user.ownerId || user.id;

  const updatedUser = await prisma.user.update({
    where: { id: targetId },
    data: { employeeAccountEnabled: Boolean(enabled) },
    select: { employeeAccountEnabled: true },
  });

  return NextResponse.json({
    success: true,
    employeeAccountEnabled: updatedUser.employeeAccountEnabled,
  });
}
