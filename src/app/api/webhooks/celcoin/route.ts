/**
 * POST /api/webhooks/celcoin
 * Recebe notificações da Celcoin sobre pagamentos PIX confirmados.
 * Endpoint deve ser registrado no painel Celcoin.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    // Validação de segurança: Celcoin envia um token no header
    const secret = req.headers.get("x-celcoin-signature") || req.headers.get("authorization");
    const expected = process.env.CELCOIN_WEBHOOK_SECRET;
    if (expected && secret !== expected && secret !== `Bearer ${expected}`) {
      console.warn("[Celcoin Webhook] Assinatura inválida");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    console.log("[Celcoin Webhook]", JSON.stringify(body).slice(0, 300));

    // Celcoin pode enviar diferentes estruturas — normalizamos
    const transactionId = body.transactionId || body.id || body.txId;
    const eventType     = (body.status || body.event || "").toUpperCase();

    if (!transactionId) {
      return NextResponse.json({ received: true, msg: "sem transactionId" });
    }

    // Status de pagamento confirmado
    const isPaid = ["PAID", "COMPLETED", "APPROVED", "PAYMENT_RECEIVED"].includes(eventType);

    if (!isPaid) {
      return NextResponse.json({ received: true, msg: `status ignorado: ${eventType}` });
    }

    // Busca o pedido pelo gatewayPaymentId
    const order = await prisma.customerOrder.findFirst({
      where: {
        OR: [
          { gatewayPaymentId: transactionId },
          { pagarmeOrderId: transactionId },
        ],
      },
    });

    if (!order) {
      console.warn(`[Celcoin Webhook] Pedido não encontrado para transactionId=${transactionId}`);
      return NextResponse.json({ received: true });
    }

    if (!order.paymentPaidAt) {
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: {
          paymentPaidAt:   new Date(),
          status:          "CONFIRMADO",
          pagarmeStatus:   "paid",
          gatewayProvider: "celcoin",
        },
      });
      console.log(`[Celcoin] Pedido ${order.id} marcado como PAGO ✅`);
    }

    return NextResponse.json({ received: true, paid: true });
  } catch (err: any) {
    console.error("[Celcoin Webhook Error]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
