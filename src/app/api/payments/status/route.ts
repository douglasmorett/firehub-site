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
      status:           true,
      gatewayProvider:  true,
      gatewayPaymentId: true,
      pagarmeStatus:    true,
      franchisee: { select: { mpAccessToken: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  // Já está pago no banco. Cancelado com pagamento é Pix que caiu depois do
  // cancelamento e está sendo devolvido: para o cliente, não foi pago.
  if (order.paymentPaidAt && order.status !== "CANCELADO") return NextResponse.json({ paid: true, failed: false });
  if (order.status === "CANCELADO") return NextResponse.json({ paid: false, failed: true, status: "cancelado" });

  // Sem gateway configurado ainda
  if (!order.gatewayPaymentId) return NextResponse.json({ paid: false, failed: false });

  try {
    // Pix pelo site na conta Asaas da loja: a conferência consulta o Asaas,
    // confirma, e também expira o pedido quando o prazo para pagar acaba.
    if (order.gatewayProvider === "asaas") {
      const { conferirPagamentoDoPedido } = await import("@/lib/pix-online-pedido");
      const s = await conferirPagamentoDoPedido(orderId);
      return NextResponse.json({ paid: s.pago, failed: s.encerrado, status: s.motivo || (s.pago ? "paid" : "pending") });
    }

    if (order.gatewayProvider === "celcoin") {
      const status = await checkCelcoinPixStatus(order.gatewayPaymentId);
      const paid = status === "PAID";

      if (paid) {
        const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
        await confirmOrderPayment(orderId);
      }

      return NextResponse.json({ paid, failed: status === "EXPIRED", status });
    }

    if (order.gatewayProvider === "mercadopago") {
      const result = await checkMpPaymentStatus(order.gatewayPaymentId, order.franchisee?.mpAccessToken || undefined);

      if (result.paid) {
        const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
        await confirmOrderPayment(orderId);
      }

      return NextResponse.json(result);
    }

    return NextResponse.json({ paid: false, failed: false, status: "unknown" });

  } catch (err: any) {
    console.error("[Payment Status]", err.message);
    return NextResponse.json({ paid: false, failed: false, error: err.message });
  }
}
