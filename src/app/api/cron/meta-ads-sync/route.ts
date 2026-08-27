import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getCurrentYearMonth } from "@/lib/billing";

/**
 * GET /api/cron/meta-ads-sync
 * Cron job — sincroniza métricas das campanhas ativas com o Meta, cobra a
 * gestão de R$ 50 por semana ATIVA (não é percentual do gasto) e renova os
 * tokens do Facebook antes que expirem.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  let synced = 0;

  try {
    const { getCampaignInsights, renovarTokenDoLojista, tokenAindaVale, statusEfetivoDaCampanha } =
      await import("@/lib/meta-ads");

    // ── RENOVAÇÃO DOS TOKENS ────────────────────────────────────────────────
    // O token do Facebook vale ~60 dias e não havia nenhuma renovação: depois
    // disso a campanha parava de sincronizar e o lojista seguia pagando R$ 50
    // por semana sem ninguém perceber. Falha silenciosa e cobrada — a pior
    // combinação.
    //
    // A troca só funciona com token AINDA válido, então roda com folga, a cada
    // passagem do cron, em vez de esperar o vencimento.
    try {
      const comToken = await prisma.user.findMany({
        where: { metaFbAccessToken: { not: null }, metaAdsEnabled: true },
        select: { id: true, storeName: true, metaFbAccessToken: true },
      });

      for (const loja of comToken) {
        const atual = loja.metaFbAccessToken as string;
        const novo = await renovarTokenDoLojista(atual);

        if (novo && novo !== atual) {
          await prisma.user.update({
            where: { id: loja.id },
            data: { metaFbAccessToken: novo },
          });
          log.push(`🔑 token renovado: ${loja.storeName ?? loja.id}`);
          continue;
        }

        // Não renovou: só é problema se o token atual já morreu. Aí a loja
        // precisa reconectar, e é melhor desligar o módulo do que seguir
        // cobrando por um serviço que parou.
        if (!(await tokenAindaVale(atual))) {
          await prisma.user.update({
            where: { id: loja.id },
            data: { metaAdsEnabled: false },
          });
          log.push(`⚠️ token expirado: ${loja.storeName ?? loja.id} — precisa reconectar o Facebook`);
          console.warn(`[MetaAds] token expirado na loja ${loja.id}; módulo desligado até reconectar.`);
        }
      }
    } catch (e: any) {
      log.push(`⚠️ renovação de tokens: ${e?.message}`);
    }

    // Busca todas as campanhas ativas
    const campaigns = await (prisma as any).metaAdsCampaign.findMany({
      where: { status: "ACTIVE" },
      include: { franchisee: { select: { id: true, metaFbAccessToken: true, metaAdsWeeklyFee: true, storeTimezone: true, planPercent: true } } },
    });

    log.push(`📊 ${campaigns.length} campanhas ativas encontradas`);

    for (const campaign of campaigns) {
      if (!campaign.metaCampaignId || !campaign.franchisee?.metaFbAccessToken) {
        log.push(`⏭️ ${campaign.id}: sem campaignId ou token`);
        continue;
      }

      try {
        // A Meta é a fonte da verdade do status. Campanha pausada no Ads
        // Manager ou encerrada pelo end_time continuava "ACTIVE" no banco — e
        // a gestão de R$ 50/semana era cobrada PARA SEMPRE por uma campanha
        // que não veicula. Se a Meta diz que não está ativa, o banco espelha
        // e esta rodada não cobra nada.
        const statusNaMeta = await statusEfetivoDaCampanha(
          campaign.metaCampaignId,
          campaign.franchisee.metaFbAccessToken
        );
        if (statusNaMeta && statusNaMeta !== "ACTIVE") {
          const statusLocal =
            ["ARCHIVED", "DELETED", "COMPLETED"].includes(statusNaMeta) ? "ENDED" : "PAUSED";
          await (prisma as any).metaAdsCampaign.update({
            where: { id: campaign.id },
            data: { status: statusLocal, lastBilledAt: new Date(), updatedAt: new Date() },
          });
          log.push(`⏸️ ${campaign.id}: ${statusNaMeta} na Meta → ${statusLocal} aqui; cobrança interrompida`);
          continue;
        }

        const insights = await getCampaignInsights(
          campaign.metaCampaignId,
          campaign.franchisee.metaFbAccessToken
        );

        const newSpend = (insights as any).spend ?? 0;
        // Modelo R$50/semana de gestão
        const weeklyFee = campaign.franchisee.metaAdsWeeklyFee ?? 50;
        const lastBilled = campaign.lastBilledAt ? new Date(campaign.lastBilledAt) : new Date(campaign.createdAt);
        const daysSinceLastBill = (Date.now() - lastBilled.getTime()) / (1000 * 60 * 60 * 24);
        
        let newFeeAccrued = campaign.feeAccrued ?? 0;
        let newLastBilledAt = campaign.lastBilledAt;
        
        // Cobra R$50 a cada 7 dias
        if (daysSinceLastBill >= 7) {
          const weeksToCharge = Math.floor(daysSinceLastBill / 7);
          newFeeAccrued += weeklyFee * weeksToCharge;
          newLastBilledAt = new Date();
        }

        // A taxa entra no ciclo ANTES de o contador da campanha avançar.
        //
        // Na ordem antiga a campanha era atualizada primeiro: se a gravação no
        // ciclo falhasse, `feeAccrued` já tinha subido e a rodada seguinte não
        // via mais diferença nenhuma — a semana era perdida em silêncio. Agora,
        // se o ciclo não aceitar a taxa, o contador não anda e a próxima
        // execução tenta de novo.
        const feeToAdd = newFeeAccrued - (campaign.feeAccrued ?? 0);
        let feeGravada = feeToAdd <= 0;

        if (feeToAdd > 0) {
          const tz = campaign.franchisee.storeTimezone || "America/Sao_Paulo";
          const yearMonth = getCurrentYearMonth(0, tz);
          try {
            // Os nomes dos campos estavam errados aqui (`userId`/`month` em vez
            // de `franchiseeId`/`yearMonth`). A query lançava, o catch abaixo
            // engolia, e a gestão de R$50/semana nunca chegou a um boleto.
            await prisma.franchiseeBillingCycle.upsert({
              where: { franchiseeId_yearMonth: { franchiseeId: campaign.franchiseeId, yearMonth } },
              update: { metaAdsFee: { increment: feeToAdd } },
              create: {
                franchiseeId: campaign.franchiseeId,
                yearMonth,
                planPercent: campaign.franchisee.planPercent ?? 1,
                metaAdsFee: feeToAdd,
                status: "OPEN",
              },
            });
            feeGravada = true;
            log.push(`  💸 +R$${feeToAdd.toFixed(2)} de gestão no ciclo ${yearMonth}`);
          } catch (billingErr: any) {
            // Não avança o contador: a taxa fica pendente para a próxima rodada.
            log.push(`  ❌ FALHA ao lançar R$${feeToAdd.toFixed(2)} no ciclo ${yearMonth} de ${campaign.franchiseeId}: ${billingErr.message}`);
            console.error("[meta-ads-sync] taxa de gestão não lançada", {
              franchiseeId: campaign.franchiseeId, yearMonth, feeToAdd, erro: billingErr.message,
            });
          }
        }

        await (prisma as any).metaAdsCampaign.update({
          where: { id: campaign.id },
          data: {
            spend: newSpend,
            impressions: (insights as any).impressions ?? 0,
            clicks: (insights as any).clicks ?? 0,
            ordersGenerated: (insights as any).orders ?? 0,
            revenue: (insights as any).revenue ?? 0,
            // Só sobe se a taxa entrou no ciclo.
            ...(feeGravada ? { feeAccrued: newFeeAccrued, lastBilledAt: newLastBilledAt } : {}),
            updatedAt: new Date(),
          },
        });

        log.push(`✅ ${campaign.id}: spend=R$${newSpend.toFixed(2)}, fee=R$${newFeeAccrued.toFixed(2)}`);
        synced++;
      } catch (err: any) {
        log.push(`❌ ${campaign.id}: ${err.message}`);
      }
    }

    return NextResponse.json({ ok: true, synced, total: campaigns.length, log });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
