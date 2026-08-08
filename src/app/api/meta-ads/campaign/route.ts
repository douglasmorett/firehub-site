/**
 * GET  /api/meta-ads/campaign  → retorna campanha ativa do franqueado
 * POST /api/meta-ads/campaign  → cria nova campanha
 * PUT  /api/meta-ads/campaign  → pausa/retoma campanha ou atualiza orçamento
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createMetaCampaign, getCampaignInsights, setCampaignStatus } from "@/lib/meta-ads";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  const appId = process.env.META_APP_ID || "4084810071817607";
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
    await prisma.metaAdsCampaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });
  } else if (action === "resume" && campaign.metaCampaignId) {
    await setCampaignStatus(campaign.metaCampaignId, user.metaFbAccessToken, "ACTIVE");
    await prisma.metaAdsCampaign.update({ where: { id: campaign.id }, data: { status: "ACTIVE" } });
  } else if (action === "update_budget" && weeklyBudget) {
    await prisma.metaAdsCampaign.update({ where: { id: campaign.id }, data: { weeklyBudget } });
  }

  return NextResponse.json({ success: true });
}
