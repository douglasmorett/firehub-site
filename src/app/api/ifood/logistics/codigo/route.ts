/**
 * /api/ifood/logistics/codigo
 *
 * Cenário 4 — o item que a documentação marca como OBRIGATÓRIO para todas as
 * integradoras, e cuja ausência aparece na lista das reprovações mais comuns.
 *
 * Duas sutilezas que a homologação cobra:
 *
 *   O pedido só é elegível se tiver chegado o evento DELIVERY_DROP_CODE_REQUESTED.
 *   Pedir o código sem isso é chamar o endpoint fora de hora.
 *
 *   Código errado NÃO é falha da integração: volta como `{success:false}` ou 422,
 *   e a tela precisa deixar digitar de novo. Por isso a resposta distingue
 *   "não conferiu" de "deu erro".
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import { validarCodigoEntrega, exigeCodigo } from "@/lib/ifood-logistics";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    const orderId: string = corpo?.orderId ?? "";
    if (!orderId) {
      return NextResponse.json({ error: "Informe o pedido." }, { status: 400 });
    }

    // Elegibilidade primeiro: o endpoint só deve ser chamado para pedidos que
    // receberam o evento. `?forcar=1` existe para o caso de o evento ter chegado
    // antes de o pedido ser gravado aqui — sem isso, um pedido legítimo ficaria
    // sem como confirmar a entrega.
    const elegivel = await exigeCodigo(prisma, orderId);
    if (!elegivel && corpo?.forcar !== true) {
      return NextResponse.json({
        ok: true,
        elegivel: false,
        mensagem:
          "Este pedido ainda não pediu código de entrega. O iFood avisa por um evento quando ele passa a exigir.",
      });
    }

    const r = await validarCodigoEntrega(ctx, orderId, corpo?.codigo ?? "");

    // 422 é o iFood dizendo "esse código não confere" — resposta legítima da
    // API, não erro nosso. Vira uma mensagem que convida a tentar de novo.
    if (!r.ok && r.status !== 422) return responder(r);

    if (r.conferido) {
      await prisma.customerOrder.updateMany({
        where: { ifoodOrderId: orderId },
        data: { ifoodDriverStatus: "DELIVERED" },
      }).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      conferido: r.conferido,
      mensagem: r.conferido
        ? "Código conferido. Entrega confirmada."
        : "Código não confere. Peça ao cliente e digite novamente.",
      ifood: { status: r.status, ok: r.ok, origem: r.origem },
      endpoint: "POST /logistics/v1.0/orders/{id}/verifyDeliveryCode",
    });
  });
}
