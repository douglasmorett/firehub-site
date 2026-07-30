/**
 * GET /api/cron/billing-close
 * Cron job diário — fecha ciclos do mês anterior + verifica bloqueios
 * Roda todo dia 1 do mês (ou manualmente)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { closeBillingCycle, getCurrentYearMonth } from "@/lib/billing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV !== "development" && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const log: string[] = [];
  let closed = 0;
  let blocked = 0;

  try {
    // 1. Fechar ciclos do mês anterior que ainda estão OPEN
    const prevMonth = getCurrentYearMonth(-1);
    const openCycles = await prisma.franchiseeBillingCycle.findMany({
      where: { yearMonth: prevMonth, status: "OPEN" },
      select: { franchiseeId: true },
    });

    log.push(`📊 ${openCycles.length} ciclos OPEN de ${prevMonth} para fechar`);

    for (const cycle of openCycles) {
      try {
        const result = await closeBillingCycle(cycle.franchiseeId, prevMonth);
        log.push(`✅ ${cycle.franchiseeId}: ${result.message}`);

        // Setar dueDate = closedAt + 10 dias
        if (result.charged) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 10);
          await prisma.franchiseeBillingCycle.updateMany({
            where: { franchiseeId: cycle.franchiseeId, yearMonth: prevMonth },
            data: { dueDate },
          });
        }
        closed++;
      } catch (err: any) {
        log.push(`❌ ${cycle.franchiseeId}: ${err.message}`);
      }
    }

    // 2. Verificar ciclos CLOSED com dueDate vencido → bloquear sistema
    const now = new Date();
    const overdueCycles = await prisma.franchiseeBillingCycle.findMany({
      where: {
        status: "CLOSED",
        amountPending: { gt: 0 },
        dueDate: { lt: now },
      },
      select: { franchiseeId: true, amountPending: true, yearMonth: true },
    });

    log.push(`⚠️ ${overdueCycles.length} ciclos com dueDate vencido`);

    // Nota: O bloqueio já é feito no layout.tsx verificando se o ciclo CLOSED
    // está vencido. Não precisamos de um campo systemBlocked pois o layout
    // já calcula isso em runtime (closedAt + 7 dias, que atualizaremos para 10).

    // 3. Acumular taxa de Meta Ads nos ciclos ativos
    const currentMonth = getCurrentYearMonth();
    const activeCampaigns = await (prisma as any).metaAdsCampaign.findMany({
      where: { status: "ACTIVE" },
      select: { franchiseeId: true, weeklyBudget: true },
    });

    for (const campaign of activeCampaigns) {
      try {
        // Adicionar R$50/semana proporcional (R$7.14/dia) ao ciclo atual
        const dailyFee = 50 / 7; // ~R$7.14/dia
        await prisma.franchiseeBillingCycle.upsert({
          where: {
            franchiseeId_yearMonth: {
              franchiseeId: campaign.franchiseeId,
              yearMonth: currentMonth,
            },
          },
          create: {
            franchiseeId: campaign.franchiseeId,
            yearMonth: currentMonth,
            metaAdsFee: dailyFee,
            status: "OPEN",
          },
          update: {
            metaAdsFee: { increment: dailyFee },
          },
        });
      } catch (err: any) {
        log.push(`⚠️ Meta Ads fee ${campaign.franchiseeId}: ${err.message}`);
      }
    }

    return NextResponse.json({ ok: true, closed, blocked, log });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
