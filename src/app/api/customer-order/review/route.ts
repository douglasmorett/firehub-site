import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/customer-order/review?orderId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json({ error: "orderId é obrigatório" }, { status: 400 });
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        franchiseeId: true,
        customerName: true,
        customerPhone: true,
        totalAmount: true,
        status: true,
        createdAt: true,
        ifoodReference: true,
        openDeliveryReference: true,
        franchisee: {
          select: {
            id: true,
            name: true,
            storeName: true,
            slug: true,
            storeLogo: true,
          },
        },
        review: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }

    return NextResponse.json(order);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/customer-order/review — Enviar Avaliação do Cliente (1 a 5 estrelas)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, rating, comment } = body;

    if (!orderId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "orderId e nota (1 a 5 estrelas) são obrigatórios" }, { status: 400 });
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        franchiseeId: true,
        customerId: true,
        customerName: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }

    const review = await prisma.storeReview.upsert({
      where: { orderId },
      update: {
        rating: Math.round(rating),
        comment: comment?.trim() || null,
      },
      create: {
        orderId,
        franchiseeId: order.franchiseeId,
        customerId: order.customerId || null,
        rating: Math.round(rating),
        comment: comment?.trim() || null,
      },
    });

    // Também atualiza rating no CustomerOrder para referência direta
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        rating: Math.round(rating),
        ratingComment: comment?.trim() || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: "⭐ Avaliação enviada com sucesso! Muito obrigado pelo feedback.",
      review,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
