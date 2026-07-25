import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const franchisee = await prisma.user.findFirst({
    where: {
      OR: [
        { email: "contatohakim@gmail.com" },
        { jotajaConnected: true },
        { role: { in: ["FRANQUEADO", "ADMIN", "LOJA"] } }
      ]
    }
  });

  if (!franchisee) return NextResponse.json({ error: "Franqueado não encontrado" });

  const openSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: franchisee.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  const lastSessions = await prisma.cashSession.findMany({
    where: { franchiseeId: franchisee.id },
    orderBy: { openedAt: "desc" },
    take: 5
  });

  return NextResponse.json({
    userCashOpen: franchisee.cashOpen,
    openSession,
    lastSessions
  });
}
