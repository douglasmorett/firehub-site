import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarTotem } from "@/lib/totem-auth";

export const dynamic = "force-dynamic";

/** Status em que o pedido claramente não vai mais ser pago. */
const ENCERRADOS_SEM_PAGAR = ["CANCELADO"];

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    const orderId = req.nextUrl.searchParams.get("orderId");
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const auth = await autenticarTotem(token);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        franchiseeId: true,
        paymentPaidAt: true,
        gatewayProvider: true,
        gatewayPaymentId: true,
        pagarmeStatus: true,
      },
    });

    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

    // Isolamento: o totem só enxerga pedido da própria loja.
    if (order.franchiseeId !== auth.licenca.franchiseeId) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    // ── PAGO É PAGO, NÃO "NÃO-CANCELADO" ─────────────────────────────────────
    // A regra antiga era `status !== "AGUARDANDO_PAGAMENTO" && status !==
    // "CANCELADO"`. Como o pedido do totem nasce "NOVO" ou "ACEITO", ela
    // respondia `paid: true` no instante em que o pedido era criado — antes de
    // qualquer maquininha encostar no cartão. O totem liberava o cliente e
    // mandava para a cozinha sem ninguém ter pagado.
    //
    // Agora só é pago com prova: carimbo de confirmação, ou o gateway dizendo
    // que pagou. Sem prova, o totem continua esperando.
    const confirmadoPeloGateway = order.pagarmeStatus === "paid";
    const pago = Boolean(order.paymentPaidAt) || confirmadoPeloGateway;
    const cancelado = ENCERRADOS_SEM_PAGAR.includes(order.status);

    return NextResponse.json({
      orderId: order.id,
      status: order.status,
      paid: pago,
      canceled: cancelado,
      // `aguardando` é o que a tela usa para decidir se continua consultando.
      aguardando: !pago && !cancelado,
      valor: order.totalAmount,
      provedor: order.gatewayProvider,
    });
  } catch (err) {
    console.error("[Totem PaymentStatus] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
