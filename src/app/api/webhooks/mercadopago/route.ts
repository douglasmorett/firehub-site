/**
 * POST /api/webhooks/mercadopago
 * Recebe notificações do Mercado Pago sobre pagamentos com cartão.
 * Endpoint deve ser registrado no painel MP → Suas integrações → Webhooks.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkMpPaymentStatus } from "@/lib/mercadopago";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[MP Webhook]", JSON.stringify(body).slice(0, 300));

    // MP envia { action, type, data: { id } }
    const { type, action, data } = body;

    // Só processamos eventos de payment
    if (type !== "payment") {
      return NextResponse.json({ received: true, msg: `tipo ignorado: ${type}` });
    }

    const mpPaymentId = data?.id ? String(data.id) : null;
    if (!mpPaymentId) {
      return NextResponse.json({ received: true, msg: "sem payment id" });
    }

    // Busca status na API do MP (confirma autenticidade)
    const { paid, failed, status } = await checkMpPaymentStatus(mpPaymentId);

    // Busca o pedido pelo gatewayPaymentId
    const order = await prisma.customerOrder.findFirst({
      where: {
        OR: [
          { gatewayPaymentId: mpPaymentId },
          { pagarmeChargeId:  mpPaymentId },
        ],
      },
    });

    if (!order) {
      console.warn(`[MP Webhook] Pedido não encontrado para paymentId=${mpPaymentId}`);
      return NextResponse.json({ received: true });
    }

    if (paid && !order.paymentPaidAt) {
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: {
          paymentPaidAt:   new Date(),
          status:          "CONFIRMADO",
          pagarmeStatus:   "approved",
          gatewayProvider: "mercadopago",
        },
      });
      console.log(`[MP] Pedido ${order.id} marcado como PAGO ✅`);
    } else if (failed) {
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: { pagarmeStatus: status },
      });
    }

    return NextResponse.json({ received: true, paid, status });
  } catch (err: any) {
    console.error("[MP Webhook Error]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
