/**
 * GET /api/cron/billing-close
 * Cron job diário — fecha ciclos do mês anterior + verifica bloqueios
 * Roda todo dia 1 do mês (ou manualmente)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { closeBillingCycle, getCurrentYearMonth } from "@/lib/billing";
import { verifyCronAuth } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // 3. Taxa de Meta Ads — NÃO é cobrada aqui.
    //
    // Este bloco somava R$ 7,14 (50/7) ao ciclo A CADA EXECUÇÃO do cron, sem
    // nenhuma idempotência: rodando de hora em hora, virava R$ 171/dia em vez
    // de R$ 7,14 — e ainda por cima DUPLICAVA a cobrança que o
    // /api/cron/meta-ads-sync já faz do jeito certo (R$ 50 por semana ATIVA,
    // com trava em lastBilledAt). A gestão do tráfego pago tem um único
    // cobrador: meta-ads-sync (semanal) + a ativação/criação da campanha.

    // 4. Acumular taxa de Totem nos ciclos ativos (R$100/mês por totem ativo)
    const currentMonth = getCurrentYearMonth();
    const allActiveTotemStores = await prisma.totemLicense.groupBy({
      by: ["franchiseeId"],
      where: { active: true },
      _count: { id: true },
    });

    for (const store of allActiveTotemStores) {
      try {
        const totemFee = store._count.id * 100; // R$ 100/totem/mês
        await prisma.franchiseeBillingCycle.upsert({
          where: {
            franchiseeId_yearMonth: {
              franchiseeId: store.franchiseeId,
              yearMonth: currentMonth,
            },
          },
          create: {
            franchiseeId: store.franchiseeId,
            yearMonth: currentMonth,
            totemFee,
            status: "OPEN",
          },
          update: {
            totemFee, // Substitui (não incrementa) — recalcula cada vez
          },
        });
        log.push(`📲 Totem ${store.franchiseeId}: ${store._count.id} totens = R$${totemFee}`);
      } catch (err: any) {
        log.push(`⚠️ Totem fee ${store.franchiseeId}: ${err.message}`);
      }
    }

    return NextResponse.json({ ok: true, closed, blocked, log });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
