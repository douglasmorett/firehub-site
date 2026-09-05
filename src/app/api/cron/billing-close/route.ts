/**
 * GET /api/cron/billing-close
 * Cron job diário — fecha ciclos do mês anterior + verifica bloqueios
 * Roda todo dia 1 do mês (ou manualmente)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { closeBillingCycle, getCurrentYearMonth, garantirCiclosDoMes } from "@/lib/billing";
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
    const prevMonth = getCurrentYearMonth(-1);

    // 0. ANTES de fechar: criar o ciclo de quem vendeu e não tem ciclo.
    //
    // O passo 1 procura ciclos `OPEN` — quem não tem ciclo nenhum não aparece
    // na busca e simplesmente não era cobrado. Isso atingia toda loja que vende
    // só por integração (iFood, 99Food, Jotajá), totem, balcão, mesa ou robô do
    // WhatsApp: esses caminhos gravam o pedido direto no banco e nunca chamam
    // `trackSaleForBilling`, que é quem criava o ciclo. Ver o comentário longo
    // em `garantirCiclosDoMes` (src/lib/billing.ts).
    //
    // A varredura é idempotente: recalcula do banco, então rodar de novo no
    // mesmo dia não duplica nada. Quem não vendeu continua sem ciclo, e quem
    // está em teste ou isento segue perdoado pelo `closeBillingCycle`.
    const varredura = await garantirCiclosDoMes(prevMonth);
    log.push(
      `🧾 Varredura ${prevMonth}: ${varredura.lojasComVenda} lojas venderam · ${varredura.criados} ciclos criados agora · ${varredura.atualizados} recalculados · ${varredura.jaFechados} já fechados (intocados)`
    );
    for (const e of varredura.erros) log.push(`⚠️ Varredura ${prevMonth}: ${e}`);

    // 1. Fechar ciclos do mês anterior que ainda estão OPEN
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

    const currentMonth = getCurrentYearMonth();

    // 3b. Mesma varredura no mês CORRENTE, para o painel não mentir durante o mês.
    //
    // Sem isto o admin só enxergaria a loja de integração no dia 1º do mês
    // seguinte, quando o fechamento criasse o ciclo: durante 30 dias ela
    // aparece com Receita R$ 0,00 e margem negativa no painel de Custos.
    const varreduraAtual = await garantirCiclosDoMes(currentMonth);
    log.push(
      `📆 Varredura ${currentMonth}: ${varreduraAtual.lojasComVenda} lojas venderam · ${varreduraAtual.criados} ciclos criados agora · ${varreduraAtual.atualizados} recalculados · ${varreduraAtual.jaFechados} já fechados (intocados)`
    );
    for (const e of varreduraAtual.erros) log.push(`⚠️ Varredura ${currentMonth}: ${e}`);

    // 4. Acumular taxa de Totem nos ciclos ativos (R$100/mês por totem ativo)
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
