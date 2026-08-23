/**
 * POST /api/payments/card
 * Processa pagamento com cartão via Mercado Pago Marketplace (D+2).
 * O cardToken é gerado pelo MP Brick no frontend — dados do cartão NUNCA chegam ao servidor.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createMpCardPayment } from "@/lib/mercadopago";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { PAGAMENTO_ONLINE_ATIVO, MOTIVO_PAGAMENTO_ONLINE_OFF } from "@/lib/pagamento-online";

export async function POST(req: NextRequest) {
  try {
    // Pagamento online desligado — ver src/lib/pagamento-online.ts.
    // Esconder os botões no cardápio não basta: esta rota é pública e
    // continuaria aceitando chamada direta.
    if (!PAGAMENTO_ONLINE_ATIVO) {
      return NextResponse.json({ error: MOTIVO_PAGAMENTO_ONLINE_OFF }, { status: 503 });
    }

    // Rate limiting: 10 tentativas por minuto por IP
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`pay-card:${ip}`, { windowMs: 60_000, maxRequests: 10 });
    if (!allowed) {
      return NextResponse.json({ error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
    }

    const { orderId, cardToken, paymentMethodId, installments = 1, payerEmail, payerCpf } = await req.json();
    if (!orderId || !cardToken) {
      return NextResponse.json({ error: "orderId e cardToken são obrigatórios" }, { status: 400 });
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        franchisee: { select: { id: true, storeName: true, mpSellerId: true, mpAccessToken: true } },
      },
    });

    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.paymentPaidAt) return NextResponse.json({ error: "Pedido já pago" }, { status: 400 });

    const storeName = order.franchisee?.storeName || "Restaurante FireHub";
    const description = `Pedido #${order.id.slice(-6).toUpperCase()} — ${storeName}`;

    const cleanPhone = (order.customerPhone || "").replace(/\D/g, "") || "21999999999";
    const email = payerEmail && payerEmail.includes("@") ? payerEmail.trim() : `cliente${cleanPhone}@firehub.com.br`;

    const result = await createMpCardPayment({
      amount:          order.totalAmount,
      orderId:         order.id,
      cardToken,
      paymentMethodId: paymentMethodId || undefined,
      installments:    Number(installments),
      payerEmail:      email,
      payerCpf,
      mpSellerId:      order.franchisee?.mpSellerId || undefined,
      mpAccessToken:   order.franchisee?.mpAccessToken || undefined,
      description,
    });

    const paid = result.status === "approved";

    // Atualiza o pedido com dados do pagamento
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        gatewayProvider:  "mercadopago",
        gatewayPaymentId: result.paymentId,
        pagarmeMethod:    "credit_card",
        pagarmeStatus:    result.status,
      },
    });

    if (paid) {
      const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
      await confirmOrderPayment(orderId);
    }

    return NextResponse.json({
      paid,
      status:       result.status,
      statusDetail: result.statusDetail,
      paymentId:    result.paymentId,
    });

  } catch (err: any) {
    console.error("[Card MP]", err);
    return NextResponse.json({ error: err.message || "Erro ao processar cartão" }, { status: 500 });
  }
}
