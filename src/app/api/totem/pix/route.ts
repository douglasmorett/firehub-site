/**
 * POST /api/totem/pix — o Pix do FireHub na tela do totem (lib/forma-do-totem).
 *
 * Corpo: { token, orderId, cpf }              → gera (ou devolve) o QR do pedido
 *        { token, orderId, acao: "desistir" } → o QR deixa de valer, o pedido fica
 *
 * É a mesma cobrança do Pix pelo site (lib/pix-online-pedido.ts): Asaas da
 * loja, split do FireHub, webhook confirmando e `confirmOrderPayment` mandando
 * para a cozinha. O Asaas exige o CPF de quem paga — por isso o totem pede.
 * Nunca o Pix da maquininha (Douglas, 12/11/2026: "só pode ter o nosso").
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarTotem } from "@/lib/totem-auth";
import { cpfValido } from "@/lib/fiscal-validacao";
import { ESTADOS_DA_COBRANCA } from "@/lib/terminal-app";
import { ESTADO_TEF_NO_PINPAD } from "@/lib/tef-do-totem";
import { textoDaForma } from "@/lib/forma-do-totem";
import { gerarCobrancaDoPedido, largarPixDoPedido } from "@/lib/pix-online-pedido";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { token, orderId, cpf, acao } = await req.json().catch(() => ({}));

    const auth = await autenticarTotem(token);
    if (!auth.ok) return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    if (!orderId || typeof orderId !== "string") return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const pedido = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        franchiseeId: true,
        status: true,
        paymentPaidAt: true,
        posStatus: true,
        gatewayPaymentId: true,
        franchisee: { select: { pixOnlineAtivo: true } },
      },
    });
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    // Isolamento: o totem só mexe em pedido da própria loja.
    if (pedido.franchiseeId !== auth.licenca.franchiseeId) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
    if (pedido.paymentPaidAt) return NextResponse.json({ pago: true });

    if (acao === "desistir") {
      const r = await largarPixDoPedido(pedido.id);
      if (r.pago) return NextResponse.json({ pago: true });
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
      return NextResponse.json({ ok: true });
    }

    if (pedido.status !== "AGUARDANDO_PAGAMENTO") {
      return NextResponse.json({ error: "Este pedido não está mais esperando pagamento." }, { status: 409 });
    }
    // Cartão no visor agora: um Pix em cima seria o cliente pagando duas vezes.
    if (pedido.posStatus === ESTADOS_DA_COBRANCA.noTerminal || pedido.posStatus === ESTADO_TEF_NO_PINPAD) {
      return NextResponse.json(
        { error: "O pagamento no cartão deste pedido ainda está em andamento. Cancele na maquininha antes de pagar com Pix." },
        { status: 409 },
      );
    }

    // Cobrança nova: só com o Pix do FireHub ligado na loja e o CPF de quem paga.
    if (!pedido.gatewayPaymentId) {
      if (!pedido.franchisee?.pixOnlineAtivo) {
        return NextResponse.json({ error: "Esta loja não está recebendo Pix pelo totem agora. Escolha outra forma." }, { status: 409 });
      }
      const documento = String(cpf || "").replace(/\D/g, "");
      if (!cpfValido(documento)) return NextResponse.json({ error: "Digite um CPF válido para pagar com Pix.", code: "CPF_INVALIDO" }, { status: 400 });

      // Sai da fila da maquininha (uma tentativa de cartão que ficou para trás)
      // na mesma gravação que vira Pix: a maquininha não pode pegar este pedido
      // com o QR na tela.
      const virou = await prisma.customerOrder.updateMany({
        where: {
          id: pedido.id,
          status: "AGUARDANDO_PAGAMENTO",
          paymentPaidAt: null,
          OR: [{ posStatus: null }, { posStatus: { notIn: [ESTADOS_DA_COBRANCA.noTerminal, ESTADO_TEF_NO_PINPAD] } }],
        },
        data: { paymentMethod: textoDaForma("PIX"), customerCpfCnpj: documento, posStatus: null },
      });
      if (virou.count === 0) {
        return NextResponse.json({ error: "O pedido mudou enquanto o Pix era gerado. Tente de novo." }, { status: 409 });
      }
    }

    const r = await gerarCobrancaDoPedido(pedido.id);
    if (!r.ok) {
      if (r.pago) return NextResponse.json({ pago: true });
      return NextResponse.json({ error: r.erro }, { status: r.status });
    }
    return NextResponse.json({
      ok: true,
      qrCodeBase64: r.dados.qrCodeBase64,
      copiaECola: r.dados.pixKey,
      expiraEm: r.dados.expiresAt,
    });
  } catch (err) {
    console.error("[Totem Pix] Erro:", err);
    return NextResponse.json({ error: "Erro ao gerar o Pix" }, { status: 500 });
  }
}
