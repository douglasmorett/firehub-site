import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  autenticarTerminal,
  ESTADOS_DA_COBRANCA,
  TENTATIVAS_ATE_SAIR_DA_FILA,
} from "@/lib/terminal-app";
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
      // O contador sobe A CADA recusa, e não só quando o totem manda cobrar de
      // novo. Ele entra no `userReference` que vai ao cartão: sem subir aqui, a
      // segunda tentativa do mesmo pedido leva a MESMA referência da primeira,
      // e as duas passagens ficam indistinguíveis no extrato da adquirente —
      // que é exatamente o que se precisa consultar para saber se o cliente foi
      // cobrado duas vezes.
      const { posTentativas } = await prisma.customerOrder.update({
        where: { id: pedido.id },
        data: {
          posTentativas: { increment: 1 },
          posTerminalId: null,
          // A recusa fica registrada mesmo voltando para a fila: três recusas
          // seguidas no mesmo pedido é o padrão de cartão clonado, e quem
          // fecha o caixa precisa conseguir enxergar isso.
          posDadosTransacao: { ...dadosDaTransacao, aprovado: false, motivo: motivoRecusa ?? null },
        },
        select: { posTentativas: true },
      });

      // ── PEDIDO ABANDONADO NÃO PODE PRENDER A FILA ────────────────────────
      // A fila entrega sempre o mais antigo. O cliente que fecha o pedido no
      // totem e vai embora sem passar o cartão deixa a cobrança dele na cabeça
      // da fila; ela é recusada por tempo, volta para o começo, e prende TODOS
      // os pedidos seguintes da loja num laço. Uma fila de almoço inteira ficaria
      // parada por causa de uma pessoa que desistiu.
      //
      // Depois de algumas recusas o pedido sai da fila. Ele não é cancelado: o
      // operador ainda cobra pelo painel se o cliente voltar.
      const saiuDaFila = posTentativas >= TENTATIVAS_ATE_SAIR_DA_FILA;
      await prisma.customerOrder.update({
        where: { id: pedido.id },
        data: {
          posStatus: saiuDaFila ? ESTADOS_DA_COBRANCA.expirado : ESTADOS_DA_COBRANCA.aguardando,
        },
      });

      if (saiuDaFila) {
        console.warn(
          `[Terminal] Pedido ${pedido.id} saiu da fila depois de ${posTentativas} tentativas sem pagamento.`,
        );
        return NextResponse.json({
          success: true,
          aprovado: false,
          podeTentarDeNovo: false,
          motivo: motivoRecusa ?? null,
          saiuDaFila: true,
          mensagem:
            "Este pedido saiu da fila da maquininha depois de várias tentativas. " +
            "Cobre pelo painel se o cliente voltar.",
        });
      }

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
