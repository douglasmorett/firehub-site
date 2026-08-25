import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { confirmOrderPayment } from "@/lib/order-payment-confirm";

export const dynamic = "force-dynamic";

/**
 * O atendente confirma que recebeu o pagamento no balcão.
 *
 * O pedido do totem passou a nascer em AGUARDANDO_PAGAMENTO — antes ele ia
 * direto para a cozinha, e quem desistisse na tela de pagamento já tinha o
 * lanche sendo feito. Isso abriu um caminho sem saída: o cliente que escolhe
 * "pagar no caixa" fica esperando alguém liberar, e não existia esse alguém.
 * Nenhuma tela do painel chamava `confirmOrderPayment`; só o webhook do gateway
 * e o app da maquininha chamavam.
 *
 * É a mesma função dos outros caminhos, de propósito: ela carimba o pagamento,
 * gera a senha, despacha para o KDS e a impressora, dá baixa no estoque e conta
 * o faturamento. Escrever uma confirmação separada aqui faria os dois caminhos
 * divergirem, e divergência em código de pagamento sempre aparece no caixa.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, name: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const lojaId = user.ownerId || user.id;

    const { orderId, formaDePagamento } = await req.json().catch(() => ({}));
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const pedido = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true, franchiseeId: true, status: true, paymentPaidAt: true,
        totalAmount: true, dailyOrderNumber: true, customerName: true,
      },
    });
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

    // Isolamento: um atendente não confirma pagamento de pedido de outra loja.
    if (pedido.franchiseeId !== lojaId) {
      return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
    }

    if (pedido.paymentPaidAt) {
      return NextResponse.json({
        success: true,
        jaConfirmado: true,
        mensagem: `O pedido #${pedido.dailyOrderNumber} já estava confirmado.`,
      });
    }

    if (pedido.status === "CANCELADO") {
      return NextResponse.json(
        { error: "Este pedido foi cancelado e não pode ser confirmado." },
        { status: 409 }
      );
    }

    // Quem confirmou fica no registro: é o que permite conferir uma divergência
    // de caixa no fim do dia sem depender da memória de quem estava no balcão.
    if (formaDePagamento) {
      await prisma.customerOrder.update({
        where: { id: pedido.id },
        data: { paymentMethod: `${formaDePagamento} (recebido por ${user.name})` },
      });
    }

    const confirmado = await confirmOrderPayment(pedido.id);

    return NextResponse.json({
      success: true,
      pedidoId: pedido.id,
      numero: confirmado?.dailyOrderNumber ?? pedido.dailyOrderNumber,
      status: confirmado?.status ?? null,
      mensagem: `Pagamento do pedido #${pedido.dailyOrderNumber} confirmado. Já foi para a cozinha.`,
    });
  } catch (err) {
    console.error("[Confirmar Pagamento] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
