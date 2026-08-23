/**
 * GET  /api/meta-ads/campaign  → retorna campanha ativa do franqueado
 * POST /api/meta-ads/campaign  → cria nova campanha
 * PUT  /api/meta-ads/campaign  → pausa/retoma campanha ou atualiza orçamento
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createMetaCampaign, getCampaignInsights, setCampaignStatus, atualizarOrcamentoDoAdSet } from "@/lib/meta-ads";
import { segredoObrigatorio } from "@/lib/segredos";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  const appId = segredoObrigatorio("META_APP_ID");
  // Indica se a integração Meta ainda não foi configurada no Vercel
  if (!appId) {
    return NextResponse.json({ campaigns: [], needsSetup: true });
  }

  // Verifica se o Facebook está conectado
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { metaFbAccessToken: true, metaAdAccountId: true, metaFbPageId: true, metaAdsEnabled: true },
  });

  const campaigns = await prisma.metaAdsCampaign.findMany({
    where: { franchiseeId },
    orderBy: { createdAt: "desc" },
  });

  // Busca métricas atualizadas para campanhas ativas
  for (const campaign of campaigns) {
    if (campaign.status === "ACTIVE" && campaign.metaCampaignId && user?.metaFbAccessToken) {
      try {
        const live = await getCampaignInsights(campaign.metaCampaignId, user.metaFbAccessToken);
        const metrics = {
          spend: (live as any).spend,
          impressions: (live as any).impressions,
          clicks: (live as any).clicks,
          ordersGenerated: (live as any).ordersGenerated ?? (live as any).orders ?? 0,
        };
        Object.assign(campaign, metrics);
        await prisma.metaAdsCampaign.update({
          where: { id: campaign.id },
          data: { ...metrics, updatedAt: new Date() } as any,
        });
      } catch { /* não falha se API tiver offline */ }
    }
  }

  return NextResponse.json({
    campaigns,
    connected: Boolean(user?.metaFbAccessToken),
    hasAdAccount: Boolean(user?.metaAdAccountId),
    hasPage: Boolean(user?.metaFbPageId),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  const body = await req.json();
  const { weeklyBudget = 100, radiusKm = 3, adCopy, adImageUrl } = body;

  if (weeklyBudget < 70) {
    return NextResponse.json(
      { error: "O investimento mínimo é R$ 70/semana (R$ 10/dia — mínimo do Meta)." },
      { status: 400 }
    );
  }

  // Busca dados do franqueado
  const user = await prisma.user.findUnique({ where: { id: franchiseeId } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  if (!user.metaFbAccessToken || !user.metaAdAccountId) {
    return NextResponse.json({ error: "Conta Facebook não conectada" }, { status: 400 });
  }

  const lat = (user.storeLatLng as any)?.lat ?? -23.55;
  const lng = (user.storeLatLng as any)?.lng ?? -46.63;

  try {
    // Cria campanha no Meta
    const meta = await createMetaCampaign({
      adAccountId: user.metaAdAccountId,
      accessToken: user.metaFbAccessToken,
      storeName: user.storeName ?? user.name,
      storeSlug: user.slug ?? "",
      storeAddress: user.storeAddress ?? "",
      lat, lng, radiusKm,
      weeklyBudgetBRL: weeklyBudget,
      adCopy: adCopy ?? `🍔 Peça agora em ${user.storeName ?? user.name}! Entrega rápida, cardápio completo. Clique e aproveite!`,
      adImageUrl: adImageUrl ?? user.storeBanner ?? user.storeLogo ?? "",
      pageId: user.metaFbPageId ?? "",
    });

    // Salva no banco
    const campaign = await prisma.metaAdsCampaign.create({
      data: {
        franchiseeId,
        ...meta,
        weeklyBudget,
        radiusKm,
        adCopy,
        adImageUrl,
        status: "ACTIVE",
      },
    });

    return NextResponse.json({ campaign });
  } catch (err: any) {
    console.error("[MetaAds] Erro ao criar campanha:", err.message);
    return NextResponse.json(
      { error: `Erro ao criar campanha: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  const { action, weeklyBudget, campaignId } = await req.json(); // action: "pause" | "resume" | "update_budget"

  const campaign = campaignId
    ? await prisma.metaAdsCampaign.findFirst({ where: { id: campaignId, franchiseeId } })
    : await prisma.metaAdsCampaign.findFirst({
        where: { franchiseeId },
        orderBy: { createdAt: "desc" },
      });
  if (!campaign) return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });

  const user = await prisma.user.findUnique({ where: { id: franchiseeId } });
  if (!user?.metaFbAccessToken) return NextResponse.json({ error: "Token expirado" }, { status: 400 });

  if (action === "pause" && campaign.metaCampaignId) {
    await setCampaignStatus(campaign.metaCampaignId, user.metaFbAccessToken, "PAUSED");
    // Congela o relógio da gestão. O cron cobra R$50 a cada 7 dias contados a
    // partir de lastBilledAt; sem zerar aqui, uma campanha parada por 3 semanas
    // voltaria cobrando 3 semanas de gestão que não houve.
    await prisma.metaAdsCampaign.update({
      where: { id: campaign.id },
      data: { status: "PAUSED", lastBilledAt: new Date() },
    });
  } else if (action === "resume" && campaign.metaCampaignId) {
    await setCampaignStatus(campaign.metaCampaignId, user.metaFbAccessToken, "ACTIVE");

    // ── COBRANÇA NA ATIVAÇÃO ─────────────────────────────────────────────
    // Regra do produto: a semana é cobrada INTEIRA ao ativar. Ligou e usou um
    // dia, pagou os R$ 50 — e isso está avisado na tela antes de confirmar.
    //
    // A trava dos 7 dias evita a cobrança dupla óbvia: pausar e religar no
    // mesmo dia não gera uma segunda cobrança, porque a semana paga ainda está
    // correndo. Sem isso, alguém que pausasse e voltasse três vezes num dia
    // pagaria R$ 150.
    const ultimaCobranca = campaign.lastBilledAt ? new Date(campaign.lastBilledAt) : null;
    const diasDesdeACobranca = ultimaCobranca
      ? (Date.now() - ultimaCobranca.getTime()) / 86_400_000
      : Infinity;
    const devecobrar = diasDesdeACobranca >= 7;

    const taxaSemanal = user.metaAdsWeeklyFee ?? 50;

    await prisma.metaAdsCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "ACTIVE",
        ...(devecobrar
          ? {
              feeAccrued: (campaign.feeAccrued ?? 0) + taxaSemanal,
              lastBilledAt: new Date(),
            }
          : {}),
      },
    });

    if (devecobrar) {
      // Espelha no ciclo mensal, do mesmo jeito que o cron faz.
      const agora = new Date();
      const cicloMes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
      try {
        const ciclo = await (prisma as any).franchiseeBillingCycle.findFirst({
          where: { userId: campaign.franchiseeId, month: cicloMes },
        });
        if (ciclo) {
          await (prisma as any).franchiseeBillingCycle.update({
            where: { id: ciclo.id },
            data: { metaAdsFee: (ciclo.metaAdsFee ?? 0) + taxaSemanal },
          });
        } else {
          await (prisma as any).franchiseeBillingCycle.create({
            data: { userId: campaign.franchiseeId, month: cicloMes, metaAdsFee: taxaSemanal },
          });
        }
      } catch (e: any) {
        console.error("[MetaAds] falha ao lançar a taxa de ativação:", e?.message);
      }
    }
  } else if (action === "update_budget" && weeklyBudget) {
    const valor = Number(weeklyBudget);
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: "Orçamento inválido." }, { status: 400 });
    }

    // A Meta PRIMEIRO. Se ela recusar, o banco não pode dizer que mudou —
    // era exatamente essa a mentira: o painel confirmava e a cobrança seguia
    // no valor antigo.
    if (campaign.metaAdSetId) {
      try {
        await atualizarOrcamentoDoAdSet(campaign.metaAdSetId, user.metaFbAccessToken, valor);
      } catch (e: any) {
        console.error("[MetaAds] falha ao atualizar orçamento na Meta:", e?.message);
        return NextResponse.json(
          { error: "Não consegui alterar o orçamento no Facebook. Tente de novo." },
          { status: 502 }
        );
      }
    }

    await prisma.metaAdsCampaign.update({
      where: { id: campaign.id },
      data: { weeklyBudget: valor },
    });
  }

  return NextResponse.json({ success: true });
}
