/**
 * POST /api/payments/cancelar   { orderId }
 *
 * O cliente fechou a tela do Pix e confirmou que desiste.
 *
 * A tela chamava `PATCH /api/customer-order/<id>/status`, uma rota que só tem
 * GET: o 405 era engolido pelo try/catch e o pedido ficava esperando
 * pagamento com o QR ainda pagável. Aqui o cancelamento é de verdade — e,
 * antes de cancelar, confere se o Pix não caiu no meio do caminho.
 *
 * Pública (o cliente não tem login), mas só mexe em pedido que ainda está
 * esperando pagamento: pedido pago ou já na loja não é cancelado por aqui.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`pay-cancel:${ip}`, { windowMs: 60_000, maxRequests: 10 }).allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
  }

  const { orderId } = await req.json().catch(() => ({} as any));
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
  }

  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { status: true, paymentPaidAt: true, gatewayProvider: true },
  });
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

  if (pedido.gatewayProvider === "asaas") {
    const { cancelarPeloCliente } = await import("@/lib/pix-online-pedido");
    const r = await cancelarPeloCliente(orderId);
    if (r.erro) return NextResponse.json({ error: r.erro, pago: r.pago, cancelado: r.cancelado }, { status: 409 });
    return NextResponse.json({ pago: r.pago, cancelado: r.cancelado });
  }

  // Outros gateways (Mercado Pago, desligado) e pedido cujo Pix nem chegou a
  // ser gerado: basta tirar da espera.
  if (pedido.paymentPaidAt) return NextResponse.json({ pago: true, cancelado: false });
  const r = await prisma.customerOrder.updateMany({
    where: { id: orderId, status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: null },
    data: {
      status: "CANCELADO",
      cancelledBy: "CUSTOMER",
      cancelReason: "O cliente desistiu na tela de pagamento",
      kdsStage: "FINISHED",
    },
  });
  if (r.count === 0 && pedido.status !== "CANCELADO") {
    return NextResponse.json(
      { error: "Este pedido já foi para a loja e não pode ser cancelado por aqui.", pago: false, cancelado: false },
      { status: 409 },
    );
  }
  return NextResponse.json({ pago: false, cancelado: true });
}
