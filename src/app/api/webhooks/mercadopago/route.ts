/**
 * POST /api/webhooks/mercadopago
 * Recebe notificações do Mercado Pago sobre pagamentos com cartão/PIX.
 * Endpoint deve ser registrado no painel MP → Suas integrações → Webhooks.
 *
 * Validação: verifica assinatura HMAC-SHA256 enviada pelo MP no header x-signature
 * conforme documentação: https://www.mercadopago.com.br/developers/pt/docs/notifications/webhooks
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkMpPaymentStatus } from "@/lib/mercadopago";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const body = JSON.parse(rawBody);
    console.log("[MP Webhook]", rawBody.slice(0, 300));

    // ── Validação de Assinatura HMAC ─────────────────────────────────────────
    //
    // Este bloco tinha DOIS jeitos de ser contornado, e o segundo era o pior:
    //
    //  1. estava inteiro dentro de `if (mpSecret)`. Sem MP_WEBHOOK_SECRET no
    //     ambiente, nada era conferido e qualquer POST era aceito.
    //
    //  2. a comparação era `if (receivedHash && ...)`. Com o segredo configurado
    //     e tudo parecendo protegido, bastava NÃO mandar o cabeçalho x-signature:
    //     receivedHash saía vazio, a condição inteira era falsa e a requisição
    //     passava como se tivesse assinatura válida. Assinatura opcional não é
    //     assinatura.
    //
    // Agora falha fechada nos dois casos. Segredo ausente é erro de configuração
    // e responde 401 — visível no mesmo dia — em vez de virar porta aberta que
    // ninguém percebe.
    const mpSecret = process.env.MP_WEBHOOK_SECRET;
    if (!mpSecret) {
      console.error("[MP Webhook] MP_WEBHOOK_SECRET não configurado — requisição recusada");
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 401 });
    }
    {
      const xSignature = req.headers.get("x-signature") ?? "";
      const xRequestId = req.headers.get("x-request-id") ?? "";

      // Extrair ts e v1 do header x-signature (formato: "ts=...,v1=...")
      const parts: Record<string, string> = {};
      for (const part of xSignature.split(",")) {
        const [k, v] = part.split("=");
        if (k && v) parts[k.trim()] = v.trim();
      }

      const ts = parts["ts"] ?? "";
      const receivedHash = parts["v1"] ?? "";

      if (!receivedHash) {
        console.warn("[MP Webhook] Requisição sem assinatura — rejeitada");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const manifest = `id:${body.data?.id};request-id:${xRequestId};ts:${ts};`;
      const expectedHash = crypto
        .createHmac("sha256", mpSecret)
        .update(manifest)
        .digest("hex");

      // timingSafeEqual exige buffers do mesmo tamanho: uma assinatura curta
      // forjada derrubaria a rota com exceção em vez de ser recusada.
      const esperado = Buffer.from(expectedHash);
      const recebido = Buffer.from(receivedHash);
      if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) {
        console.warn("[MP Webhook] Assinatura inválida — request rejeitado");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // MP envia { action, type, data: { id } }
    const { type, data } = body;

    // Só processamos eventos de payment
    if (type !== "payment") {
      return NextResponse.json({ received: true, msg: `tipo ignorado: ${type}` });
    }

    const mpPaymentId = data?.id ? String(data.id) : null;
    if (!mpPaymentId) {
      return NextResponse.json({ received: true, msg: "sem payment id" });
    }

    // Busca status na API do MP (confirma autenticidade do pagamento)
    const { paid, failed, status } = await checkMpPaymentStatus(mpPaymentId);

    // Busca o pedido pelo gatewayPaymentId
    const order = await prisma.customerOrder.findFirst({
      where: {
        OR: [
          { gatewayPaymentId: mpPaymentId },
          { pagarmeChargeId:  mpPaymentId },
        ],
      },
      select: { id: true, paymentPaidAt: true },
    });

    if (!order) {
      console.warn(`[MP Webhook] Pedido não encontrado para paymentId=${mpPaymentId}`);
      return NextResponse.json({ received: true });
    }

    if (paid) {
      const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
      await confirmOrderPayment(order.id);
      console.log(`[MP Webhook] Pedido ${order.id} confirmado e despachado pro KDS / Impressora / WhatsApp ✅`);
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
