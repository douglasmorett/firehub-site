/**
 * GET /api/pagarme/status?orderId=xxx
 * Polling de status do pagamento PIX (cliente aguardando QR code)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId");

  if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { pagarmeStatus: true, paymentPaidAt: true, status: true }
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  return NextResponse.json({
    paid: order.pagarmeStatus === "paid",
    failed: order.pagarmeStatus === "failed",
    orderStatus: order.status,
    paidAt: order.paymentPaidAt,
  });
}
