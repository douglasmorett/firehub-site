import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const asaasToken = process.env.ASAAS_WEBHOOK_TOKEN;
    const receivedToken = req.headers.get("asaas-access-token");

    // Validação de segurança do Webhook
    if (asaasToken && receivedToken !== asaasToken) {
      console.error("Tentativa de Webhook com Token Inválido!");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { event, payment } = body;

    console.log(`Webhook Asaas recebido: Evento ${event} para Pagamento ${payment.id}`);

    // Procurar o pedido no banco de dados pelo ID do pagamento do Asaas
    const order = await prisma.order.findFirst({
      where: { asaasPaymentId: payment.id }
    });

    if (!order) {
      console.warn(`Pedido não encontrado para o Pagamento ID ${payment.id}`);
      // Respondemos 200 para o Asaas não ficar tentando reenviar algo que não temos
      return NextResponse.json({ received: true });
    }

    // Processar eventos de confirmação de pagamento
    if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
      const oldStatus = order.status;
      
      if (oldStatus !== "PAID") {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: "PAID" }
        });

        // Registrar no histórico do pedido
        await prisma.orderHistory.create({
          data: {
            orderId: order.id,
            statusFrom: oldStatus,
            statusTo: "PAID",
            actionBy: "Asaas Webhook",
            actionEmail: "financeiro@asaas.com.br",
            notes: `Pagamento confirmado via Asaas (ID: ${payment.id}). Valor: R$ ${payment.value}`
          }
        });

        console.log(`Pedido ${order.id} marcado como PAGO via Webhook.`);
      }
    }

    // Processar evento de vencimento (opcional)
    if (event === "PAYMENT_OVERDUE") {
        console.warn(`O pagamento ${payment.id} do pedido ${order.id} está VENCIDO.`);
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Erro no Webhook Asaas:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
