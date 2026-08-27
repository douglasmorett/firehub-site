/**
 * GET  /api/meta-ads/campaign  → retorna campanha ativa do franqueado
 * POST /api/meta-ads/campaign  → cria nova campanha
 * PUT  /api/meta-ads/campaign  → pausa/retoma campanha ou atualiza orçamento
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createMetaCampaign, getCampaignInsights, setCampaignStatus, ativarCampanhaCompleta, atualizarOrcamentoDoAdSet, atualizarTetoDaCampanha } from "@/lib/meta-ads";
import { segredoOpcional } from "@/lib/segredos";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const franchiseeId = (session.user as any).id;

  // Opcional aqui de propósito: `segredoObrigatorio` LANÇA quando a variável
  // não existe — este GET virava 500 e o "needsSetup" abaixo era código morto.
  // Sem a credencial, a tela precisa carregar e dizer que falta configurar.
  const appId = segredoOpcional("META_APP_ID");
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
          revenue: (live as any).revenue ?? 0,
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
  const { weeklyBudget = 100, radiusKm = 3, adCopy, adImageUrl, adDescription } = body;

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

  // Uma campanha ativa por loja: criar outra por cima duplicaria o gasto no
  // Meta e a taxa de gestão. Quem quer mudar a campanha pausa a atual antes.
  const jaAtiva = await prisma.metaAdsCampaign.findFirst({
    where: { franchiseeId, status: "ACTIVE" },
  });
  if (jaAtiva) {
    return NextResponse.json(
      { error: "Você já tem uma campanha ativa. Pause a campanha atual antes de criar outra." },
      { status: 409 }
    );
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
      adDescription: typeof adDescription === "string" && adDescription.trim() ? adDescription.trim() : undefined,
      adImageUrl: adImageUrl ?? user.storeBanner ?? user.storeLogo ?? "",
      pageId: user.metaFbPageId ?? "",
    });

    // A criação na Meta nasce com campanha, conjunto e anúncio PAUSADOS (é o
    // desenho seguro da lib). O clique em "criar campanha" — depois dos termos
    // e do aviso de cobrança — é a ordem do lojista para LIGAR. Sem esta
    // ativação dos três níveis, nada jamais veiculava: o banco dizia ACTIVE,
    // a tela dizia "rodando" e a Meta estava 100% pausada.
    try {
      await ativarCampanhaCompleta(
        { metaCampaignId: meta.metaCampaignId, metaAdSetId: meta.metaAdSetId, metaAdId: meta.metaAdId },
        user.metaFbAccessToken
      );
    } catch (e: any) {
      // Não ligou = não cobra e não diz que rodou. Os objetos criados ficam
      // pausados na Meta; o lojista tenta ativar pelo "Retomar".
      console.error("[MetaAds] campanha criada mas a ativação falhou:", e?.message);
      const campaign = await prisma.metaAdsCampaign.create({
        data: {
          franchiseeId,
          ...meta,
          weeklyBudget,
          radiusKm,
          adCopy,
          adImageUrl,
          status: "PAUSED",
        },
      });
      return NextResponse.json(
        {
          campaign,
          error:
            "A campanha foi criada no Facebook mas ainda não está no ar — a ativação falhou. " +
            "Use o botão Retomar no painel para tentar ligar de novo. Nada foi cobrado.",
        },
        { status: 502 }
      );
    }

    // A primeira semana de gestão é cobrada NA CRIAÇÃO — mesma regra da
    // reativação ("ligou, pagou a semana"). Antes, lastBilledAt nascia nulo e
    // o cron só cobrava no 7º dia: a primeira semana saía de graça, diferente
    // do que a tela avisa. Ciclo primeiro; se a gravação falhar, o contador
    // fica para trás e o cron cobra na próxima passagem.
    const taxaSemanal = user.metaAdsWeeklyFee ?? 50;
    let cobrancaGravada = false;
    try {
      const { getCurrentYearMonth } = await import("@/lib/billing");
      const yearMonth = getCurrentYearMonth(0, user.storeTimezone || "America/Sao_Paulo");
      await prisma.franchiseeBillingCycle.upsert({
        where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
        update: { metaAdsFee: { increment: taxaSemanal } },
        create: {
          franchiseeId,
          yearMonth,
          planPercent: user.planPercent ?? 1,
          metaAdsFee: taxaSemanal,
          status: "OPEN",
        },
      });
      cobrancaGravada = true;
    } catch (e: any) {
      console.error("[MetaAds] falha ao lançar a taxa da primeira semana:", e?.message);
    }

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
        ...(cobrancaGravada ? { feeAccrued: taxaSemanal, lastBilledAt: new Date() } : {}),
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

  // Sem id na Meta não há o que pausar/retomar — responder "success" aqui era
  // no-op silencioso: a tela dizia "retomada!" e a cobrança seguia correndo.
  if ((action === "pause" || action === "resume") && !campaign.metaCampaignId) {
    return NextResponse.json(
      { error: "Esta campanha não tem vínculo com o Facebook. Crie uma nova campanha." },
      { status: 409 }
    );
  }

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
    // Os TRÊS níveis, não só a campanha: a Meta exige anúncio, conjunto e
    // campanha ativos para veicular. Ativar só a campanha deixava o resto
    // pausado — a tela dizia "rodando", a taxa corria e nada entrava no ar.
    // Também conserta campanhas antigas criadas com os filhos pausados.
    await ativarCampanhaCompleta(
      {
        metaCampaignId: campaign.metaCampaignId,
        metaAdSetId: campaign.metaAdSetId,
        metaAdId: campaign.metaAdId,
      },
      user.metaFbAccessToken
    );

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

    // O ciclo mensal PRIMEIRO, com os MESMOS campos do cron. A versão antiga
    // usava `userId`/`month` — que não existem no modelo (é
    // `franchiseeId`/`yearMonth`): o Prisma lançava, o catch engolia e a taxa
    // de reativação nunca chegava a um boleto. E o contador da campanha subia
    // ANTES da gravação: se o ciclo falhasse, o cron via lastBilledAt recente
    // e a semana se perdia em silêncio. Agora o contador só avança se a taxa
    // entrou no ciclo — senão, fica para o cron cobrar na próxima passagem.
    let cobrancaGravada = false;
    if (devecobrar) {
      try {
        const { getCurrentYearMonth } = await import("@/lib/billing");
        const yearMonth = getCurrentYearMonth(0, user.storeTimezone || "America/Sao_Paulo");
        await prisma.franchiseeBillingCycle.upsert({
          where: { franchiseeId_yearMonth: { franchiseeId: campaign.franchiseeId, yearMonth } },
          update: { metaAdsFee: { increment: taxaSemanal } },
          create: {
            franchiseeId: campaign.franchiseeId,
            yearMonth,
            planPercent: user.planPercent ?? 1,
            metaAdsFee: taxaSemanal,
            status: "OPEN",
          },
        });
        cobrancaGravada = true;
      } catch (e: any) {
        console.error("[MetaAds] falha ao lançar a taxa de ativação:", e?.message);
      }
    }

    await prisma.metaAdsCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "ACTIVE",
        ...(devecobrar && cobrancaGravada
          ? {
              feeAccrued: (campaign.feeAccrued ?? 0) + taxaSemanal,
              lastBilledAt: new Date(),
            }
          : {}),
      },
    });
  } else if (action === "update_budget" && weeklyBudget) {
    const valor = Number(weeklyBudget);
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: "Orçamento inválido." }, { status: 400 });
    }
    // Mesmo piso da criação. Abaixo disso o mínimo diário da Meta (R$ 6/dia)
    // faria a conta gastar MAIS do que o lojista pediu — sem ele perceber.
    if (valor < 70) {
      return NextResponse.json(
        { error: "O investimento mínimo é R$ 70/semana (R$ 10/dia — mínimo do Meta)." },
        { status: 400 }
      );
    }

    // A Meta PRIMEIRO. Se ela recusar, o banco não pode dizer que mudou —
    // era exatamente essa a mentira: o painel confirmava e a cobrança seguia
    // no valor antigo.
    if (campaign.metaAdSetId) {
      try {
        await atualizarOrcamentoDoAdSet(campaign.metaAdSetId, user.metaFbAccessToken, valor);
        // O teto de gasto acompanha: sem isto, subir o orçamento esbarrava no
        // spend_cap calculado com o valor antigo e a campanha parava no meio.
        if (campaign.metaCampaignId) {
          await atualizarTetoDaCampanha(campaign.metaCampaignId, user.metaFbAccessToken, valor);
        }
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
