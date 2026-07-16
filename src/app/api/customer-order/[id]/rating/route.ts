import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { rating, comment } = body;

  // Rate limiting por IP
  const { checkRateLimit, getClientIp } = await import("@/lib/rateLimit");
  const ip = getClientIp(req);
  const { allowed } = checkRateLimit(`rate-order:${ip}`, { windowMs: 60000, maxRequests: 5 });
  if (!allowed) {
    return NextResponse.json({ error: "Muitas requisições de avaliação." }, { status: 429 });
  }

  if (!rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Rating inválido" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id },
    select: { franchiseeId: true, customerId: true, id: true, rating: true },
  });
  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  if (order.rating !== null) return NextResponse.json({ error: "Este pedido já foi avaliado." }, { status: 400 });
  if (!order.customerId) return NextResponse.json({ error: "Cliente não identificado" }, { status: 400 });


  // Salva no pedido
  await prisma.customerOrder.update({
    where: { id },
    data: { rating, ratingComment: comment || null },
  });

  // Salva no StoreReview (se ainda não existir)
  const existing = await prisma.storeReview.findUnique({ where: { orderId: id } });
  if (!existing) {
    await prisma.storeReview.create({
      data: {
        franchiseeId: order.franchiseeId,
        customerId: order.customerId,
        orderId: id,
        rating,
        comment: comment || null,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
