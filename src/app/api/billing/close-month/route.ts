/**
 * POST /api/billing/close-month
 * Fecha o ciclo de um mês para um (ou todos os) franqueados.
 * Gera link Asaas apenas com a diferença que faltou.
 * 
 * Body: { franchiseeId?: string, yearMonth: string }
 * Se franchiseeId não for informado, fecha para TODOS os franqueados.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { closeBillingCycle, getCurrentYearMonth } from "@/lib/billing";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { franchiseeId, yearMonth } = await req.json();

  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: "yearMonth inválido. Use formato YYYY-MM" }, { status: 400 });
  }

  // Fechar para um franqueado específico
  if (franchiseeId) {
    const result = await closeBillingCycle(franchiseeId, yearMonth);
    return NextResponse.json({ success: true, franchiseeId, yearMonth, ...result });
  }

  // Fechar para todos os franqueados com ciclo OPEN no mês
  const cycles = await prisma.franchiseeBillingCycle.findMany({
    where: { yearMonth, status: "OPEN" },
    select: { franchiseeId: true },
  });

  const results = [];
  for (const c of cycles) {
    try {
      const r = await closeBillingCycle(c.franchiseeId, yearMonth);
      results.push({ franchiseeId: c.franchiseeId, success: true, ...r });
    } catch (err: any) {
      results.push({ franchiseeId: c.franchiseeId, success: false, error: err.message });
    }
  }

  return NextResponse.json({ success: true, yearMonth, results });
}

/**
 * GET /api/billing/close-month?yearMonth=2025-05
 * Lista todos os ciclos do mês com resumo
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Sem parâmetro, o mês corrente EM BRASÍLIA — toISOString() é UTC e, das
  // 21:00 às 24:00 do último dia, apontava para o mês seguinte.
  const yearMonth = req.nextUrl.searchParams.get("yearMonth") ?? getCurrentYearMonth();

  const cycles = await prisma.franchiseeBillingCycle.findMany({
    where: { yearMonth },
    include: {
      franchisee: { select: { id: true, name: true, email: true, city: true, planPercent: true } },
    },
    orderBy: { amountPending: "desc" },
  });

  // Inclui franqueados sem ciclo ainda (para o admin saber quem não tem vendas)
  const allFranchisees = await prisma.user.findMany({
    where: { role: "FRANCHISEE" },
    select: { id: true, name: true, email: true, city: true, planPercent: true },
  });

  const cycleIds = new Set(cycles.map(c => c.franchiseeId));
  const withoutCycle = allFranchisees.filter(f => !cycleIds.has(f.id));

  return NextResponse.json({
    yearMonth,
    cycles: cycles.map(c => ({
      id: c.id,
      franchiseeId: c.franchiseeId,
      franchiseeName: c.franchisee.name,
      franchiseeEmail: c.franchisee.email,
      city: c.franchisee.city,
      planPercent: c.planPercent,
      totalSales: c.totalSales,
      amountDue: c.amountDue,
      amountOffset: c.amountOffset,
      amountPending: c.amountPending,
      status: c.status,
      closedAt: c.closedAt,
      asaasBoletoUrl: c.asaasBoletoUrl,
      asaasBoletoCode: c.asaasBoletoCode,
      offsetLog: c.offsetLog,
    })),
    withoutCycle,
  });
}
