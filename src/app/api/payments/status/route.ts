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
        const result = await prisma.customerOrder.updateMany({
          where: { id: orderId, paymentPaidAt: null }, // atômico — só 1 chamada vence
          data: { paymentPaidAt: new Date(), status: "CONFIRMADO", pagarmeStatus: "paid" },
        });
        if (result.count === 0) {
          console.log(`[Payment Status] Celcoin: pedido ${orderId} já marcado como pago por outra instância`);
        }
      }

      return NextResponse.json({ paid, failed: status === "EXPIRED", status });
    }

    if (order.gatewayProvider === "mercadopago") {
      const result = await checkMpPaymentStatus(order.gatewayPaymentId);

      if (result.paid) {
        const updated = await prisma.customerOrder.updateMany({
          where: { id: orderId, paymentPaidAt: null }, // atômico — só 1 chamada vence
          data: { paymentPaidAt: new Date(), status: "CONFIRMADO", pagarmeStatus: "approved" },
        });
        if (updated.count === 0) {
          console.log(`[Payment Status] MP: pedido ${orderId} já marcado como pago por outra instância`);
        }
      }

      return NextResponse.json(result);
    }

    return NextResponse.json({ paid: false, failed: false, status: "unknown" });

  } catch (err: any) {
    console.error("[Payment Status]", err.message);
    return NextResponse.json({ paid: false, failed: false, error: err.message });
  }
}
