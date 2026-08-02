import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/store-reviews?slug=xxx ou franchiseeId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    let franchiseeId = searchParams.get("franchiseeId");

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

    const storeConfig = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { id: true, storeName: true, showReviewsOnMenu: true },
    });

    const reviews = await prisma.storeReview.findMany({
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

    // Calcular estatísticas de avaliações (NPS e Média)
    const totalReviews = reviews.length;
    const ratingSum = reviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = totalReviews > 0 ? Number((ratingSum / totalReviews).toFixed(1)) : 5.0;

    const distribution = {
      5: reviews.filter((r) => r.rating === 5).length,
      4: reviews.filter((r) => r.rating === 4).length,
      3: reviews.filter((r) => r.rating === 3).length,
      2: reviews.filter((r) => r.rating === 2).length,
      1: reviews.filter((r) => r.rating === 1).length,
    };

    return NextResponse.json({
      showReviewsOnMenu: storeConfig?.showReviewsOnMenu ?? true,
      stats: {
        totalReviews,
        averageRating,
        distribution,
      },
      reviews,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/store-reviews — Atualizar Visibilidade no Cardápio ou Responder Avaliação
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
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

    // 2. Responder uma Avaliação Específica
    if (body.reviewId && typeof body.reply === "string") {
      const review = await prisma.storeReview.update({
        where: { id: body.reviewId },
        data: {
          reply: body.reply.trim() || null,
          replyAt: body.reply.trim() ? new Date() : null,
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
