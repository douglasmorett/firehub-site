/**
 * PATCH /api/billing/plan-percent
 * Define ou atualiza o % do plano de um franqueado
 * Body: { franchiseeId: string, planPercent: number }
 * 
 * GET /api/billing/plan-percent?franchiseeId=xxx
 * Retorna ciclo atual + histórico do franqueado
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { franchiseeId, planPercent } = await req.json();
  if (!franchiseeId || planPercent == null || isNaN(planPercent)) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: franchiseeId },
    data: { planPercent: parseFloat(planPercent) },
  });

  return NextResponse.json({ success: true, franchiseeId, planPercent });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const franchiseeId = req.nextUrl.searchParams.get("franchiseeId");
  if (!franchiseeId) {
    return NextResponse.json({ error: "franchiseeId obrigatório" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { id: true, name: true, planPercent: true },
  });

  const cycles = await prisma.franchiseeBillingCycle.findMany({
    where: { franchiseeId },
    orderBy: { yearMonth: "desc" },
    take: 12,
  });

  return NextResponse.json({ user, cycles });
}
