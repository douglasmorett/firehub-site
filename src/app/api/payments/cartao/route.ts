/**
 * POST /api/payments/cartao   { orderId }
 *
 * Cartão pelo site, na conta Asaas da loja (lib/pix-online.ts). Cria a
 * cobrança SEM dado de cartão e devolve a página do Asaas onde o cliente digita
 * o cartão (`linkDePagamento`). O número do cartão nunca passa pelo FireHub —
 * mandar pela API poria o servidor no escopo do PCI-DSS.
 *
 * O cartão online antigo (Mercado Pago, /api/payments/card) continua atrás do
 * interruptor global de src/lib/pagamento-online.ts.
 *
 * Retorna: { paymentId, linkDePagamento, expiresAt, forma, provedor }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`pay-cartao:${ip}`, { windowMs: 60_000, maxRequests: 10 }).allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
  }

  const { orderId } = await req.json().catch(() => ({} as any));
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
  }

  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { franchisee: { select: { asaasChaveCifrada: true } } },
  });
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  if (!pedido.franchisee?.asaasChaveCifrada) {
    return NextResponse.json(
      { error: "Esta loja não está recebendo cartão pelo site agora. Escolha outra forma de pagamento." },
      { status: 503 },
    );
  }

  const { gerarCobrancaDoPedido } = await import("@/lib/pix-online-pedido");
  const r = await gerarCobrancaDoPedido(orderId);
  if (!r.ok) return NextResponse.json({ error: r.erro, pago: r.pago === true }, { status: r.status });
  return NextResponse.json(r.dados);
}
