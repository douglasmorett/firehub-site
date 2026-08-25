/**
 * /api/ifood/logistics/pedido/[orderId]
 * Cenário 2 da homologação de Logistics: os dados completos do pedido —
 * cliente, endereço, itens e pagamento — para a tela do entregador exibir.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import { detalhesDoPedido } from "@/lib/ifood-logistics";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  return comContextoIfood(req, async ({ ctx }) => {
    const r = await detalhesDoPedido(ctx, orderId);
    if (!r.ok) return responder(r);

    // O estado da viagem é nosso, não do iFood: é ele que diz qual botão a tela
    // pode oferecer em seguida.
    const local = await prisma.customerOrder.findUnique({
      where: { ifoodOrderId: orderId },
      select: {
        id: true, ifoodDriverStatus: true, ifoodDriverName: true,
        ifoodDriverPhone: true, ifoodDriverVehicle: true, ifoodPickupCode: true,
      },
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      ifood: { status: r.status, ok: true, origem: r.origem },
      pedido: r.data,
      local,
    });
  });
}
