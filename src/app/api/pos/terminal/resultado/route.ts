import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarTerminal, ESTADOS_DA_COBRANCA } from "@/lib/terminal-app";
import { confirmOrderPayment } from "@/lib/order-payment-confirm";

export const dynamic = "force-dynamic";

/**
 * POST /api/pos/terminal/resultado
 * { token, pedidoId, aprovado, referencia?, bandeira?, nsu?, autorizacao?,
 *   parcelas?, tipo?, motivoRecusa? }
 *
 * O app da maquininha devolve o que aconteceu com o cartão.
 *
 * A confirmação passa por `confirmOrderPayment`, a mesma função que o webhook do
 * Mercado Pago usa: ela carimba o pagamento, gera a senha do pedido, manda para
 * o KDS e para a impressora, e ignora duplicata. Escrever uma segunda
 * confirmação aqui abriria a porta para os dois caminhos divergirem — e o que
 * diverge em código de pagamento é sempre descoberto pelo cliente.
 */
export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json().catch(() => ({}));
    const {
      token, pedidoId, aprovado, referencia,
      bandeira, nsu, autorizacao, parcelas, tipo, motivoRecusa,
    } = corpo;

    const auth = await autenticarTerminal(token);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }
    const { terminal } = auth;

    if (!pedidoId || typeof aprovado !== "boolean") {
      return NextResponse.json(
        { error: "Informe pedidoId e aprovado (true/false)." },
        { status: 400 },
      );
    }

    const pedido = await prisma.customerOrder.findUnique({
      where: { id: pedidoId },
      select: {
        id: true,
        franchiseeId: true,
        posTerminalId: true,
        posStatus: true,
        paymentPaidAt: true,
        totalAmount: true,
        dailyOrderNumber: true,
      },
    });

    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

    // Isolamento: a maquininha de uma loja não responde por pedido de outra.
    if (pedido.franchiseeId !== terminal.franchiseeId) {
      return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
    }

    // Só quem pegou a cobrança pode responder por ela. Sem isto, uma segunda
    // maquininha da loja poderia confirmar um pedido que ela nunca cobrou.
    if (pedido.posTerminalId && pedido.posTerminalId !== terminal.id) {
      return NextResponse.json(
        { error: "Esta cobrança está com outra maquininha.", code: "COBRANCA_DE_OUTRO_TERMINAL" },
        { status: 409 },
      );
    }

    // Reenvio depois de já confirmado é comum: o app perde a rede logo após
    // aprovar e tenta de novo quando volta. Responder ok evita que ele fique
    // repetindo para sempre, e `confirmOrderPayment` já é idempotente.
    if (pedido.paymentPaidAt) {
      return NextResponse.json({ success: true, jaConfirmado: true, pedidoId: pedido.id });
    }

    const dadosDaTransacao = {
      terminal: terminal.label,
      terminalId: terminal.id,
      provedor: terminal.provider,
      bandeira: bandeira ?? null,
      nsu: nsu ?? null,
      autorizacao: autorizacao ?? null,
      parcelas: parcelas ?? null,
      tipo: tipo ?? null,
      referencia: referencia ?? null,
      em: new Date().toISOString(),
    };

    if (!aprovado) {
      // Recusado volta para a fila, não morre: o cliente costuma tentar outro
      // cartão na mesma hora, e obrigá-lo a refazer o pedido inteiro no totem
      // é o que faz desistir da compra.
      await prisma.customerOrder.update({
        where: { id: pedido.id },
        data: {
          posStatus: ESTADOS_DA_COBRANCA.aguardando,
          posTerminalId: null,
          // A recusa fica registrada mesmo voltando para a fila: três recusas
          // seguidas no mesmo pedido é o padrão de cartão clonado, e quem
          // fecha o caixa precisa conseguir enxergar isso.
          posDadosTransacao: { ...dadosDaTransacao, aprovado: false, motivo: motivoRecusa ?? null },
        },
      });

      console.warn(
        `[Terminal] Cobrança recusada no pedido ${pedido.id} (${terminal.label}): ${motivoRecusa ?? "sem motivo informado"}`,
      );

      return NextResponse.json({
        success: true,
        aprovado: false,
        // O totem lê isto para mostrar "recusado, tente outro cartão" em vez de
        // devolver o cliente para o começo.
        podeTentarDeNovo: true,
        motivo: motivoRecusa ?? null,
      });
    }

    // Aprovado: registra o rastro da transação ANTES de confirmar, para que a
    // confirmação nunca aconteça sem o comprovante do lado de cá.
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: {
        posStatus: ESTADOS_DA_COBRANCA.pago,
        posTerminalId: terminal.id,
        // O NSU NÃO vai para `posOrderId`. Aquele campo guarda o id da Order do
        // Mercado Pago ("ORD01J..."), e /api/totem/payment/start usa a presença
        // dele para reconsultar a cobrança na nuvem do MP: um NSU ali faria a
        // rota pedir ao Mercado Pago uma ordem que não existe. O comprovante
        // inteiro fica em `posDadosTransacao`, que é onde ele pertence.
        gatewayProvider: terminal.provider,
        gatewayPaymentId: autorizacao ? String(autorizacao) : null,
        paymentMethod: tipo ? `Cartão ${tipo} (maquininha)` : "Cartão (maquininha)",
        posDadosTransacao: dadosDaTransacao,
      },
    });

    const confirmado = await confirmOrderPayment(pedido.id);

    return NextResponse.json({
      success: true,
      aprovado: true,
      pedidoId: pedido.id,
      numero: confirmado?.dailyOrderNumber ?? pedido.dailyOrderNumber ?? null,
    });
  } catch (err) {
    console.error("[Terminal Resultado] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
