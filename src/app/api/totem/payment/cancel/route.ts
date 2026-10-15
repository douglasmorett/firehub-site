/**
 * POST /api/totem/payment/cancel
 *
 * Apaga a cobrança do visor da maquininha.
 *
 * Serve para o cliente que desistiu do cartão e quer pagar de outro jeito, e
 * para o totem que voltou da tela de pagamento. Sem isso a cobrança fica presa
 * no visor até expirar (15 min) e o próximo cliente não consegue pagar naquela
 * maquininha.
 *
 * Cancela SÓ a cobrança — o pedido continua de pé, esperando pagamento.
 *
 * Corpo: { token, orderId }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarTotem } from "@/lib/totem-auth";
import { cancelarOrdem, consultarOrdem } from "@/lib/mp-point";
import { ESTADOS_DA_COBRANCA } from "@/lib/terminal-app";
import { credencialStone } from "@/lib/stone-connect-loja";
import { aplicarPedidoStoneNoTotem, cancelarPedidoStone, cobrancaEhDaStone } from "@/lib/cobranca-stone-do-totem";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { token, orderId } = await req.json().catch(() => ({}));

    const auth = await autenticarTotem(token);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });
    }

    const pedido = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        franchiseeId: true,
        paymentPaidAt: true,
        posOrderId: true,
        posTerminalId: true,
      },
    });
    if (!pedido) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }
    // Isolamento: o totem só mexe em pedido da própria loja.
    if (pedido.franchiseeId !== auth.licenca.franchiseeId) {
      return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    }

    if (!pedido.posOrderId) {
      return NextResponse.json(
        { error: "Este pedido não tem cobrança na maquininha.", code: "SEM_COBRANCA" },
        { status: 409 },
      );
    }

    // Cancelar depois de pago apagaria do sistema uma venda que já saiu no
    // cartão. Estorno é outra operação, feita no painel.
    if (pedido.paymentPaidAt) {
      return NextResponse.json(
        {
          error: "Este pedido já foi pago na maquininha. Para devolver o valor, faça o estorno no painel.",
          code: "JA_PAGO",
          pago: true,
        },
        { status: 409 },
      );
    }

    // ── Stone pela nuvem ─────────────────────────────────────────────────
    // Fecha o pedido na Stone como "canceled" e RECONSULTA: fechar não estorna
    // cartão já aprovado, então o pagamento que entrou no meio vira JA_PAGO.
    if (await cobrancaEhDaStone(pedido.franchiseeId, pedido.posTerminalId, pedido.posOrderId)) {
      const cred = await credencialStone(pedido.franchiseeId);
      if (!cred) {
        return NextResponse.json(
          {
            error: "Esta loja está sem a chave da Stone. Cancele na tela da maquininha (X vermelho).",
            code: "STONE_NAO_CONECTADO",
          },
          { status: 409 },
        );
      }
      const c = await cancelarPedidoStone(cred.chave, pedido.posOrderId);
      if (!c.ok) {
        return NextResponse.json(
          { error: `Não foi possível cancelar a cobrança na Stone: ${c.erro}`, code: "STONE_FALHOU" },
          { status: 502 },
        );
      }
      const efeito = await aplicarPedidoStoneNoTotem(pedido.id, cred.chave, c.ordem);
      if (efeito.pago) {
        return NextResponse.json(
          {
            error: "O pagamento foi aprovado na maquininha antes do cancelamento.",
            code: "JA_PAGO",
            pago: true,
            status: ESTADOS_DA_COBRANCA.pago,
          },
          { status: 409 },
        );
      }
      if (!c.ordem.fechado) {
        return NextResponse.json(
          {
            error: "A Stone não confirmou o cancelamento. Cancele na tela da maquininha (X vermelho).",
            code: "STONE_FALHOU",
          },
          { status: 502 },
        );
      }
      return NextResponse.json({
        ok: true,
        status: ESTADOS_DA_COBRANCA.cancelado,
        posOrderId: pedido.posOrderId,
        // A POS tira o pedido da tela em até 1 minuto (ou no X vermelho).
        mensagem: "Cobrança cancelada. Nada foi cobrado do seu cartão.",
      });
    }

    const loja = await prisma.user.findUnique({
      where: { id: pedido.franchiseeId },
      select: { mpAccessToken: true },
    });
    if (!loja?.mpAccessToken) {
      return NextResponse.json(
        {
          error:
            "Esta loja ainda não conectou a conta Mercado Pago. O lojista precisa conectar em Integrações > Mercado Pago.",
          code: "MP_NAO_CONECTADO",
        },
        { status: 409 },
      );
    }

    const r = await cancelarOrdem(loja.mpAccessToken, pedido.posOrderId);

    if (!r.ok) {
      // O MP recusa cancelar o que já não dá para cancelar — ordem paga, já
      // cancelada ou expirada. Nesse caso a resposta certa não é "deu erro" e
      // sim descobrir em que pé a cobrança está, senão o totem fica preso na
      // tela de espera de uma cobrança que não existe mais.
      const atual = await consultarOrdem(loja.mpAccessToken, pedido.posOrderId);
      if (atual.ok) {
        const pagou = atual.dados.status === "processed";
        await prisma.customerOrder.update({
          where: { id: pedido.id },
          data: {
            posStatus: atual.dados.status,
            // Só com o pagamento provado. Sem esses dois campos a venda existe
            // no pedido mas some do DRE e do repasse, que exigem identificador
            // de gateway junto com a marca de pago.
            ...(pagou
              ? {
                  gatewayProvider: "MERCADOPAGO_POINT",
                  ...(atual.dados.paymentId ? { gatewayPaymentId: atual.dados.paymentId } : {}),
                }
              : {}),
          },
        });

        if (pagou) {
          const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
          await confirmOrderPayment(pedido.id);
          return NextResponse.json(
            {
              error: "O pagamento foi aprovado na maquininha antes do cancelamento.",
              code: "JA_PAGO",
              pago: true,
              status: atual.dados.status,
            },
            { status: 409 },
          );
        }

        // Já estava morta (cancelada/expirada/recusada): para o totem o efeito
        // é o mesmo que cancelar agora, e o visor está livre.
        if (["canceled", "expired", "failed"].includes(atual.dados.status)) {
          return NextResponse.json({
            ok: true,
            status: atual.dados.status,
            mensagem: "A cobrança já não estava mais ativa na maquininha.",
          });
        }
      }

      if (r.status === 401 || r.status === 403) {
        return NextResponse.json(
          {
            error: "A conexão da loja com o Mercado Pago expirou. O lojista precisa reconectar a conta em Integrações.",
            code: "MP_RECONECTAR",
            detalhe: r.erro,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: `Não foi possível cancelar a cobrança: ${r.erro}`, code: "MP_FALHOU" },
        { status: 502 },
      );
    }

    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: { posStatus: r.dados.status || "canceled" },
    });

    return NextResponse.json({
      ok: true,
      status: r.dados.status || "canceled",
      posOrderId: pedido.posOrderId,
    });
  } catch (err) {
    console.error("[Totem Point Cancel] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
