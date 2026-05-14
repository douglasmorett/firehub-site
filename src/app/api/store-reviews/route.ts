import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET: Get reviews for a store
export async function GET(req: NextRequest) {
  const franchiseeId = req.nextUrl.searchParams.get("franchiseeId");
  if (!franchiseeId) return NextResponse.json({ error: "Falta franchiseeId" }, { status: 400 });

  const reviews = await prisma.storeReview.findMany({
    where: { franchiseeId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { customer: { select: { name: true } } }
  });

  const avgResult = await prisma.storeReview.aggregate({
    where: { franchiseeId },
    _avg: { rating: true },
    _count: { rating: true }
  });

  return NextResponse.json({
    reviews,
    average: avgResult._avg.rating || 0,
    count: avgResult._count.rating || 0
  });
}

// POST: Submit a review
export async function POST(req: Request) {
  const body = await req.json();
  const { orderId, customerId, rating, comment } = body;

  if (!orderId || !customerId || !rating) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  if (rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Avaliação deve ser entre 1 e 5" }, { status: 400 });
  }

  // Check if order exists and belongs to customer
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, customerId: true, franchiseeId: true, status: true }
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  if (order.customerId !== customerId) return NextResponse.json({ error: "Este pedido não é seu" }, { status: 403 });
  if (order.status !== "ENTREGUE") return NextResponse.json({ error: "Só pode avaliar pedidos entregues" }, { status: 400 });

  // Check if already reviewed
  const existing = await prisma.storeReview.findUnique({ where: { orderId } });
  if (existing) return NextResponse.json({ error: "Pedido já avaliado" }, { status: 409 });

  const review = await prisma.storeReview.create({
    data: {
      franchiseeId: order.franchiseeId,
      customerId,
      orderId,
      rating,
      comment: comment || null
    }
  });

  // Also save on the order
  await prisma.customerOrder.update({
    where: { id: orderId },
    data: { rating, ratingComment: comment || null }
  });

  return NextResponse.json(review);
}
