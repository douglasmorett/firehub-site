import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { entraNoCardapio, minimoDeEstrelas, notaDasAvaliacoes } from "@/lib/avaliacoes-no-cardapio";

export const dynamic = "force-dynamic";

// GET /api/store-reviews?slug=xxx ou franchiseeId=xxx
//
// Com `slug` é o CARDÁPIO: só as avaliações que a loja deixa aparecer (a
// partir do mínimo de estrelas, lib/avaliacoes-no-cardapio.ts). Sem `slug` é
// o PAINEL da loja logada: todas, para responder, com a nota do cardápio ao
// lado.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    let franchiseeId = searchParams.get("franchiseeId");
    const doCardapio = Boolean(slug);

    // Se veio slug (cardápio público), busca o franqueado
    if (slug) {
      const store = await prisma.user.findUnique({
        where: { slug },
        select: { id: true, showReviewsOnMenu: true },
      });
      if (store) {
        franchiseeId = store.id;
      }
    }

    // Se autenticado e sem franchiseeId, descobre o ID do usuário logado
    if (!franchiseeId) {
      const session = await getServerSession(authOptions);
      if (session?.user?.email) {
        const user = await prisma.user.findUnique({
          where: { email: session.user.email },
          select: { id: true, ownerId: true },
        });
        if (user) franchiseeId = user.ownerId || user.id;
      }
    }

    if (!franchiseeId) {
      return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
    }

    const storeConfig: any = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { id: true, storeName: true, showReviewsOnMenu: true, reviewsMinStars: true } as any,
    });
    const minimo = minimoDeEstrelas(storeConfig?.reviewsMinStars);

    const todas = await prisma.storeReview.findMany({
      where: { franchiseeId },
      orderBy: { createdAt: "desc" },
      include: {
        order: {
          select: {
            id: true,
            customerName: true,
            createdAt: true,
            ifoodReference: true,
            openDeliveryReference: true,
          },
        },
      },
    });
    const noCardapio = todas.filter((r) => entraNoCardapio(r.rating, minimo));
    const reviews = doCardapio ? noCardapio : todas;

    // Calcular estatísticas de avaliações (NPS e Média)
    const { media: averageRating, total: totalReviews } = notaDasAvaliacoes(reviews);

    const distribution = {
      5: reviews.filter((r) => r.rating === 5).length,
      4: reviews.filter((r) => r.rating === 4).length,
      3: reviews.filter((r) => r.rating === 3).length,
      2: reviews.filter((r) => r.rating === 2).length,
      1: reviews.filter((r) => r.rating === 1).length,
    };

    const nota = notaDasAvaliacoes(noCardapio);
    return NextResponse.json({
      showReviewsOnMenu: storeConfig?.showReviewsOnMenu ?? true,
      // null = todas as avaliações aparecem no cardápio.
      reviewsMinStars: minimo,
      stats: {
        totalReviews,
        averageRating,
        distribution,
      },
      // O que o CLIENTE lê no cardápio — no painel, para a loja ver o efeito
      // do mínimo que escolheu.
      noCardapio: { averageRating: nota.media, totalReviews: nota.total },
      reviews,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/store-reviews — Visibilidade no cardápio, mínimo de estrelas ou resposta
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Sua sessão expirou. Entre de novo e tente outra vez." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const franchiseeId = user.ownerId || user.id;
    const body = await req.json();

    // 1. Toggle de Exibição no Cardápio Digital
    if (typeof body.showReviewsOnMenu === "boolean") {
      await prisma.user.update({
        where: { id: franchiseeId },
        data: { showReviewsOnMenu: body.showReviewsOnMenu },
      });
      return NextResponse.json({
        success: true,
        showReviewsOnMenu: body.showReviewsOnMenu,
        message: body.showReviewsOnMenu
          ? "✅ Avaliações visíveis no cardápio digital!"
          : "🔒 Avaliações ocultas no cardápio digital.",
      });
    }

    // 2. A partir de quantas estrelas a avaliação aparece no cardápio.
    //    null / 1 = todas.
    if ("reviewsMinStars" in body) {
      const minimo = minimoDeEstrelas(body.reviewsMinStars);
      await prisma.user.update({
        where: { id: franchiseeId },
        data: { reviewsMinStars: minimo } as any,
      });
      return NextResponse.json({
        success: true,
        reviewsMinStars: minimo,
        message: minimo
          ? `⭐ No cardápio aparecem só avaliações de ${minimo} estrelas ou mais.`
          : "⭐ No cardápio aparecem todas as avaliações.",
      });
    }

    // 3. Responder uma Avaliação Específica
    if (body.reviewId && typeof body.reply === "string") {
      // Só a avaliação DESTA loja. O update era pelo id puro: qualquer conta
      // de loja respondia (ou apagava a resposta) de avaliação de outra.
      const daLoja = await prisma.storeReview.findFirst({
        where: { id: String(body.reviewId), franchiseeId },
        select: { id: true },
      });
      if (!daLoja) {
        return NextResponse.json(
          { error: "Esta avaliação não é desta loja (ou foi apagada). Atualize a página e tente de novo." },
          { status: 404 },
        );
      }
      const texto = body.reply.trim().slice(0, 1000);
      const review = await prisma.storeReview.update({
        where: { id: daLoja.id },
        data: {
          reply: texto || null,
          replyAt: texto ? new Date() : null,
        },
      });

      return NextResponse.json({
        success: true,
        message: "💬 Resposta à avaliação salva com sucesso!",
        review,
      });
    }

    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  } catch (err: any) {
    console.error("[store-reviews PATCH]", err?.message || err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
