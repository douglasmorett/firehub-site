/**
 * POST /api/pagarme/order
 * Cria pagamento online (PIX, cartão, voucher) para um pedido existente
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPixOrder, createCardOrder } from "@/lib/pagarme";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export async function POST(req: Request) {
  try {
    // Rate limiting: 10 tentativas por minuto por IP
    const ip = getClientIp(req);
    const { allowed } = checkRateLimit(`pagarme:${ip}`, { windowMs: 60_000, maxRequests: 10 });
    if (!allowed) {
      return NextResponse.json({ error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
    }

    const body = await req.json();
    const { orderId, paymentMethod, cardToken, customerDocument, installments } = body;

    if (!orderId || !paymentMethod) {
      return NextResponse.json({ error: "orderId e paymentMethod são obrigatórios" }, { status: 400 });
    }

    // Buscar pedido e restaurante
    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        franchisee: { select: { id: true, storeName: true, name: true, pagarmeRecipientId: true } },
        items: { include: { menuProduct: { select: { name: true } } } }
      }
    });

    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.pagarmeStatus === "paid") return NextResponse.json({ error: "Pedido já pago" }, { status: 400 });

    const storeName = order.franchisee.storeName || order.franchisee.name || "Restaurante";
    const description = `Pedido #${orderId.slice(-6).toUpperCase()} — ${storeName}`;
    const recipientId = order.franchisee.pagarmeRecipientId || undefined;

    const customerEmail = `${order.customerPhone.replace(/\D/g, "")}@cliente.firehub.com.br`;

    let pagarmeOrder: any;

    if (paymentMethod === "pix") {
      pagarmeOrder = await createPixOrder({
        orderId, amount: order.totalAmount,
        customerName: order.customerName, customerEmail, customerDocument,
        recipientId, description,
      });
    } else if (["credit_card", "debit_card", "voucher"].includes(paymentMethod)) {
      if (!cardToken) return NextResponse.json({ error: "cardToken obrigatório para cartão" }, { status: 400 });
      pagarmeOrder = await createCardOrder({
        orderId, amount: order.totalAmount,
        customerName: order.customerName, customerEmail, customerDocument,
        cardToken, paymentMethod, recipientId, description,
        installments: installments || 1,
      });
    } else {
      return NextResponse.json({ error: "paymentMethod inválido" }, { status: 400 });
    }

    // Extrair dados do PIX
    const charges = pagarmeOrder.charges || [];
    const firstCharge = charges[0] || {};
    const pixData = firstCharge.last_transaction?.qr_code;
    const pixExpiry = firstCharge.last_transaction?.expires_at;
    const pagarmeStatus = pagarmeOrder.status; // pending | paid | failed

    // Atualizar pedido no banco
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        pagarmeOrderId: pagarmeOrder.id,
        pagarmeChargeId: firstCharge.id || null,
        pagarmeStatus,
        pagarmeMethod: paymentMethod,
        pagarmePixQrCode: pixData || null,
        pagarmePixExpiry: pixExpiry ? new Date(pixExpiry) : null,
        paymentPaidAt: pagarmeStatus === "paid" ? new Date() : null,
        // Se cartão aprovado na hora, já aceita o pedido
        ...(pagarmeStatus === "paid" ? { status: "ACEITO" } : {}),
      }
    });

    return NextResponse.json({
      success: true,
      pagarmeOrderId: pagarmeOrder.id,
      status: pagarmeStatus,
      // PIX: retorna QR code para o frontend renderizar
      pix: paymentMethod === "pix" ? {
        qrCode: pixData,
        qrCodeUrl: firstCharge.last_transaction?.qr_code_url,
        expiresAt: pixExpiry,
      } : null,
      // Cartão: aprovado ou reprovado na hora
      paid: pagarmeStatus === "paid",
    });

  } catch (err: any) {
    console.error("[Pagar.me Order]", err);
    return NextResponse.json({ error: err.message || "Erro ao criar pagamento" }, { status: 500 });
  }
}
