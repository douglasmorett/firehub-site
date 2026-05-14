/**
 * GET /api/payments/status?orderId=xxx
 * Polling: verifica se o pagamento foi confirmado (PIX Celcoin ou Cartão MP).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkCelcoinPixStatus } from "@/lib/celcoin";
import { checkMpPaymentStatus } from "@/lib/mercadopago";

export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      paymentPaidAt:    true,
      gatewayProvider:  true,
      gatewayPaymentId: true,
      pagarmeStatus:    true,
    },
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  // Já está pago no banco
  if (order.paymentPaidAt) return NextResponse.json({ paid: true, failed: false });

  // Sem gateway configurado ainda
  if (!order.gatewayPaymentId) return NextResponse.json({ paid: false, failed: false });

  try {
    if (order.gatewayProvider === "celcoin") {
      const status = await checkCelcoinPixStatus(order.gatewayPaymentId);
      const paid = status === "PAID";

      if (paid) {
        await prisma.customerOrder.update({
          where: { id: orderId },
          data: { paymentPaidAt: new Date(), status: "CONFIRMADO", pagarmeStatus: "paid" },
        });
      }

      return NextResponse.json({ paid, failed: status === "EXPIRED", status });
    }

    if (order.gatewayProvider === "mercadopago") {
      const result = await checkMpPaymentStatus(order.gatewayPaymentId);

      if (result.paid) {
        await prisma.customerOrder.update({
          where: { id: orderId },
          data: { paymentPaidAt: new Date(), status: "CONFIRMADO", pagarmeStatus: "approved" },
        });
      }

      return NextResponse.json(result);
    }

    return NextResponse.json({ paid: false, failed: false, status: "unknown" });

  } catch (err: any) {
    console.error("[Payment Status]", err.message);
    return NextResponse.json({ paid: false, failed: false, error: err.message });
  }
}
