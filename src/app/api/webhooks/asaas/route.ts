import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const asaasToken = process.env.ASAAS_WEBHOOK_TOKEN;
    const receivedToken = req.headers.get("asaas-access-token");

    // Validação de segurança do Webhook
    if (!asaasToken) {
      console.error("[webhook/asaas] ASAAS_WEBHOOK_TOKEN não está configurada no ambiente!");
      return NextResponse.json({ error: "Webhook token not configured" }, { status: 401 });
    }
    if (receivedToken !== asaasToken) {
      console.error("[webhook/asaas] Token inválido recebido!");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { event, payment } = body;

    console.log(`[webhook/asaas] Evento: ${event} | Payment: ${payment?.id} | externalRef: ${payment?.externalReference}`);

    if (!payment?.id) {
      return NextResponse.json({ received: true });
    }

    // Procurar o pedido: primeiro por asaasPaymentId, depois por externalReference (orderId)
    let order = await prisma.order.findFirst({
      where: { asaasPaymentId: payment.id }
    });

    if (!order && payment.externalReference) {
      order = await prisma.order.findFirst({
        where: { id: payment.externalReference }
      });

      // Se encontrou por externalReference, salvar o asaasPaymentId que estava faltando
      if (order && !order.asaasPaymentId) {
        await prisma.order.update({
          where: { id: order.id },
          data: { asaasPaymentId: payment.id }
        });
        console.log(`[webhook/asaas] asaasPaymentId ${payment.id} salvo no pedido ${order.id}`);
      }
    }

    if (!order) {
      console.warn(`[webhook/asaas] Pedido não encontrado para payment ${payment.id}`);
      return NextResponse.json({ received: true });
    }

    const shortId = order.id.slice(-6).toUpperCase();

    // Processar eventos de confirmação de pagamento
    if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
      const oldStatus = order.status;
      
      if (oldStatus !== "PAGO") {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: "PAGO" }
        });

        // Registrar no histórico do pedido (com try/catch para não bloquear)
        try {
          await prisma.orderHistory.create({
            data: {
              orderId: order.id,
              statusFrom: oldStatus,
              statusTo: "PAGO",
              actionBy: "Asaas Webhook",
              actionEmail: "financeiro@asaas.com.br",
              notes: `Pagamento confirmado via Asaas (ID: ${payment.id}). Valor: R$ ${payment.value}`
            }
          });
        } catch (historyErr) {
          console.error(`[webhook/asaas] Erro ao criar histórico para #${shortId}:`, historyErr);
        }

        console.log(`[webhook/asaas] ✅ Pedido #${shortId} marcado como PAGO.`);
      }
    }

    // Atualizar boletoUrl se ainda não tiver
    if (!order.boletoUrl && (payment.invoiceUrl || payment.bankSlipUrl)) {
      await prisma.order.update({
        where: { id: order.id },
        data: { boletoUrl: payment.invoiceUrl || payment.bankSlipUrl }
      });
      console.log(`[webhook/asaas] boletoUrl atualizado para #${shortId}`);
    }

    // Processar evento de vencimento
    if (event === "PAYMENT_OVERDUE") {
      console.warn(`[webhook/asaas] ⚠️ Pagamento ${payment.id} do pedido #${shortId} está VENCIDO.`);
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("[webhook/asaas] Erro:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

