/**
 * POST /api/payments/pix
 * Gera QR Code PIX via Mercado Pago.
 * Retorna: { paymentId, pixKey, qrCodeBase64, expiresAt }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";

export async function POST(req: NextRequest) {
  try {
    // Rate limiting: 10 tentativas por minuto por IP
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`pay-pix:${ip}`, { windowMs: 60_000, maxRequests: 10 });
    if (!allowed) {
      return NextResponse.json({ error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
    }

    const { orderId } = await req.json();
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: { franchisee: { select: { storeName: true, mpSellerId: true, mpAccessToken: true } } },
    });

    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.paymentPaidAt) return NextResponse.json({ error: "Pedido já pago" }, { status: 400 });

    const accessToken =
      order.franchisee?.mpAccessToken ||
      process.env.MP_ACCESS_TOKEN ||
      process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      process.env.MERCADOPAGO_ACCESS_TOKEN ||
      "";

    if (!accessToken) {
      return NextResponse.json(
        { error: "Não foi possível gerar o PIX no momento. Por favor, tente novamente ou escolha pagamento na entrega." },
        { status: 400 }
      );
    }

    const client = new MercadoPagoConfig({ accessToken });
    const payment = new Payment(client);

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    const cleanPhone = (order.customerPhone || "").replace(/\D/g, "") || "21999999999";
    const nameParts = (order.customerName || "Cliente").trim().split(" ");
    const firstName = nameParts[0] || "Cliente";
    const lastName = nameParts.slice(1).join(" ") || "Consumidor";

    const paymentBody: any = {
      transaction_amount: Number(order.totalAmount),
      payment_method_id:  "pix",
      description:        `Pedido #${order.id.slice(-6).toUpperCase()} — ${order.franchisee?.storeName || "FireHub"}`,
      payer: {
        email:      `cliente${cleanPhone}@firehub.com.br`,
        first_name: firstName,
        last_name:  lastName,
      },
      external_reference: order.id,
      date_of_expiration: expiresAt.toISOString(),
    };

    const result = await payment.create({
      body: paymentBody,
    });

    const pixData = result.point_of_interaction?.transaction_data;

    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        gatewayProvider:  "mercadopago",
        gatewayPaymentId: String(result.id),
        pagarmeOrderId:   String(result.id),
        pagarmePixQrCode: pixData?.qr_code || "",
        pagarmePixExpiry: expiresAt,
        pagarmeMethod:    "pix",
        pagarmeStatus:    "pending",
      },
    });

    return NextResponse.json({
      paymentId:     String(result.id),
      pixKey:        pixData?.qr_code || "",
      qrCodeBase64:  pixData?.qr_code_base64 || null,
      expiresAt:     expiresAt.toISOString(),
    });

  } catch (err: any) {
    console.error("[PIX MP]", err);
    return NextResponse.json({ error: err.message || "Erro ao gerar PIX" }, { status: 500 });
  }
}
