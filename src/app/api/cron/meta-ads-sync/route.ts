import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";

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
    const { getCampaignInsights, renovarTokenDoLojista, tokenAindaVale } =
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
