/**
 * POST /api/pagarme/webhook
 * Recebe notificações do Pagar.me sobre status de pagamentos.
 * 
 * Ao confirmar pagamento → atualiza pedido + abate do ciclo mensal do franqueado.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseWebhookEvent, getOrder } from "@/lib/pagarme";
import { trackSaleForBilling } from "@/lib/billing";

/**
 * Confirma na API do Pagar.me que o pedido esta realmente pago.
 *
 * O webhook NAO e fonte de verdade: ele so diz "olha o pedido X". Quem decide
 * se foi pago e a consulta autenticada com a NOSSA chave. Sem isso, qualquer
 * POST anonimo com {"type":"order.paid","data":{"code":"ORDER-<id>"}} marcava o
 * pedido como pago e liberava a comanda na cozinha — pedido de graca.
 *
 * Mesmo padrao que /api/webhooks/mercadopago ja usa via checkMpPaymentStatus.
 */
async function confirmarPagamentoNoPagarme(pagarmeOrderId: string): Promise<boolean> {
  if (!pagarmeOrderId) {
    console.warn("[Pagar.me Webhook] Evento sem id do pedido no gateway — recusado");
    return false;
  }
  try {
    const remoto = await getOrder(pagarmeOrderId);
    const status = String(remoto?.status || "").toLowerCase();
    const pago = status === "paid";
    if (!pago) {
      console.warn(`[Pagar.me Webhook] Gateway diz status="${status}" para ${pagarmeOrderId} — nao confirmado`);
    }
    return pago;
  } catch (err: any) {
    // Falha ao consultar = nao confirma. Fail-closed de proposito.
    console.error(`[Pagar.me Webhook] Falha ao confirmar ${pagarmeOrderId}:`, err?.message);
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[Pagar.me Webhook]", body.type, body.data?.id);

    const event = parseWebhookEvent(body);

    if (!event.orderId) {
      return NextResponse.json({ received: true });
    }

    if (event.type === "payment_paid") {
      const confirmado = await confirmarPagamentoNoPagarme(event.pagarmeOrderId);
      if (!confirmado) {
        return NextResponse.json(
          { received: true, confirmed: false, msg: "pagamento nao confirmado no gateway" },
          { status: 202 }
        );
      }
      // 1. Busca o pedido para obter franchiseeId e valor
      const order = await prisma.customerOrder.findUnique({
        where: { id: event.orderId },
        select: { id: true, franchiseeId: true, totalAmount: true, pagarmeStatus: true, pagarmeOrderId: true },
      });

      // ── O PAGAMENTO CONFIRMADO TEM QUE SER DESTE PEDIDO ───────────────────
      //
      // A confirmação acima pergunta ao Pagar.me se o `pagarmeOrderId` está
      // pago — mas quem escolhe os DOIS campos do evento é quem manda o POST.
      // Faltava amarrar um no outro: bastava pegar um pagamento real de R$ 1
      // (o próprio, feito de propósito) e enviá-lo junto com o `code` de
      // QUALQUER outro pedido para quitá-lo. Comida cara paga com R$ 1, e o
      // valor ainda entrava no faturamento da loja como recebido.
      //
      // Agora o id do gateway precisa ser o que está gravado NESTE pedido.
      if (!order) {
        console.warn(`[Pagar.me Webhook] 🚫 Pedido ${event.orderId} não existe — evento ignorado.`);
        return NextResponse.json({ received: true, confirmed: false }, { status: 202 });
      }
      if (!order.pagarmeOrderId || order.pagarmeOrderId !== event.pagarmeOrderId) {
        console.error(
          `[Pagar.me Webhook] 🚨 FRAUDE BARRADA: o pagamento ${event.pagarmeOrderId} não pertence ao ` +
          `pedido ${event.orderId} (gravado: ${order.pagarmeOrderId || "nenhum"}).`
        );
        return NextResponse.json({ received: true, confirmed: false }, { status: 202 });
      }

      // 2. Atualiza o status do pedido
      await prisma.customerOrder.updateMany({
        where: { id: event.orderId, pagarmeStatus: { not: "paid" } },
        data: {
          pagarmeStatus: "paid",
          paymentPaidAt: new Date(),
          status: "ACEITO",
        },
      });

      console.log(`[Pagar.me] Pedido ${event.orderId} PAGO — status atualizado para ACEITO`);

      // 3. Atualiza ciclo de faturamento mensal do franqueado
      if (order && order.franchiseeId) {
        trackSaleForBilling(order.franchiseeId).catch(err =>
          console.error("[Billing] Erro ao atualizar ciclo:", err)
        );
      }
    }

    if (event.type === "payment_failed") {
      // Tambem precisa confirmar: forjar "payment_failed" CANCELAVA pedido
      // legitimo de qualquer loja — sabotagem trivial.
      let falhouDeVerdade = false;
      try {
        const remoto = await getOrder(event.pagarmeOrderId);
        const status = String(remoto?.status || "").toLowerCase();
        falhouDeVerdade = status === "failed" || status === "canceled" || status === "cancelled";
      } catch (err: any) {
        console.error(`[Pagar.me Webhook] Falha ao confirmar cancelamento:`, err?.message);
      }

      if (!falhouDeVerdade) {
        return NextResponse.json(
          { received: true, confirmed: false, msg: "falha nao confirmada no gateway" },
          { status: 202 }
        );
      }

      // Nunca cancelar um pedido que ja foi pago.
      await prisma.customerOrder.updateMany({
        where: { id: event.orderId, paymentPaidAt: null },
        data: {
          pagarmeStatus: "failed",
          status: "CANCELADO",
        },
      });
      console.log(`[Pagar.me] Pedido ${event.orderId} FALHOU (confirmado no gateway)`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("[Pagar.me Webhook Error]", err);
    return NextResponse.json({ received: true, error: err.message });
  }
}
