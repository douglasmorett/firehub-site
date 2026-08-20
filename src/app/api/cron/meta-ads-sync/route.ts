import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * GET /api/cron/meta-ads-sync
 * Cron job diário — sincroniza métricas de campanhas ativas com o Meta
 * e calcula a taxa de 10% do FireHub sobre o spend.
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
    const { getCampaignInsights } = await import("@/lib/meta-ads");

    // Busca todas as campanhas ativas
    const campaigns = await (prisma as any).metaAdsCampaign.findMany({
      where: { status: "ACTIVE" },
      include: { franchisee: { select: { id: true, metaFbAccessToken: true, metaAdsWeeklyFee: true } } },
    });

    log.push(`📊 ${campaigns.length} campanhas ativas encontradas`);

    for (const campaign of campaigns) {
      if (!campaign.metaCampaignId || !campaign.franchisee?.metaFbAccessToken) {
        log.push(`⏭️ ${campaign.id}: sem campaignId ou token`);
        continue;
      }

      try {
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

        await (prisma as any).metaAdsCampaign.update({
          where: { id: campaign.id },
          data: {
            spend: newSpend,
            impressions: (insights as any).impressions ?? 0,
            clicks: (insights as any).clicks ?? 0,
            ordersGenerated: (insights as any).orders ?? 0,
            feeAccrued: newFeeAccrued,
            lastBilledAt: newLastBilledAt,
            updatedAt: new Date(),
          },
        });

        // Vincular taxa de gestão ao ciclo de faturamento mensal
        if (newFeeAccrued > (campaign.feeAccrued ?? 0)) {
          const feeToAdd = newFeeAccrued - (campaign.feeAccrued ?? 0);
          const now = new Date();
          const cycleMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          try {
            // Tenta incrementar no ciclo existente
            const existing = await (prisma as any).franchiseeBillingCycle.findFirst({
              where: { userId: campaign.franchiseeId, month: cycleMonth },
            });
            if (existing) {
              await (prisma as any).franchiseeBillingCycle.update({
                where: { id: existing.id },
                data: { metaAdsFee: (existing.metaAdsFee ?? 0) + feeToAdd },
              });
            } else {
              await (prisma as any).franchiseeBillingCycle.create({
                data: { userId: campaign.franchiseeId, month: cycleMonth, metaAdsFee: feeToAdd },
              });
            }
            log.push(`  💸 +R$${feeToAdd.toFixed(2)} taxa adicionada ao ciclo ${cycleMonth}`);
          } catch (billingErr: any) {
            log.push(`  ⚠️ Billing: ${billingErr.message}`);
          }
        }


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
