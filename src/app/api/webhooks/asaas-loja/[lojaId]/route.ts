/**
 * POST /api/webhooks/asaas-loja/<lojaId>
 *
 * Os avisos da conta Asaas DA LOJA (Pix pelo site, lib/pix-online.ts). O
 * webhook é criado pelo FireHub na conta do lojista ao conectar, com um token
 * só daquela loja — por isso a loja vai no caminho: é ela que diz qual token
 * conferir. O webhook do FireHub mesmo (mensalidade, insumos) é outro:
 * /api/webhooks/asaas.
 *
 * O corpo do aviso só diz QUAL cobrança mexeu. Quem decide se pagou é a
 * consulta ao Asaas com a chave da loja (lib/pix-online-pedido.ts) — um aviso
 * forjado, mesmo com o token, não confirma pedido nenhum.
 *
 * Responde 2xx para tudo que processou ou que não é da conta dele: o Asaas
 * pausa a fila da loja depois de várias falhas seguidas, e aí nenhum Pix seria
 * confirmado pelo webhook (a tela do cliente e o cron ainda confirmariam).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decifrar, mesmoSegredo } from "@/lib/cofre";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ lojaId: string }> }) {
  const { lojaId } = await params;

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { id: true, asaasConexao: true, asaasChaveCifrada: true },
  });
  const conexao = (loja?.asaasConexao as any) || {};
  const esperado = decifrar(conexao.webhookTokenCifrado);
  const recebido = req.headers.get("asaas-access-token");

  if (!loja || !esperado || !mesmoSegredo(recebido, esperado)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const corpo = await req.json().catch(() => null);
  const evento = String(corpo?.event || "");

  try {
    if (evento.startsWith("PAYMENT_")) {
      const { pedidoDaReferencia, conferirPagamentoDoPedido } = await import("@/lib/pix-online-pedido");
      const orderId = pedidoDaReferencia(corpo?.payment?.externalReference);
      // Cobrança que a loja fez por fora do FireHub: não é nossa.
      if (!orderId) return NextResponse.json({ ok: true, ignorado: "cobrança de fora do cardápio" });

      const pedido = await prisma.customerOrder.findUnique({
        where: { id: orderId },
        select: { franchiseeId: true, gatewayPaymentId: true },
      });
      // A cobrança tem que ser DESTA loja e DESTE pedido.
      if (!pedido || pedido.franchiseeId !== lojaId || pedido.gatewayPaymentId !== corpo?.payment?.id) {
        return NextResponse.json({ ok: true, ignorado: "cobrança não confere com o pedido" });
      }

      // Evento do split da taxa do pagamento online: só registra o que houve.
      if (evento.startsWith("PAYMENT_SPLIT_")) {
        const { conferirSplitDoPedido } = await import("@/lib/pix-online-pedido");
        await conferirSplitDoPedido(orderId);
        return NextResponse.json({ ok: true, split: true });
      }

      const situacao = await conferirPagamentoDoPedido(orderId);
      return NextResponse.json({ ok: true, ...situacao });
    }

    if (evento === "ACCESS_TOKEN_DISABLED" || evento === "ACCESS_TOKEN_DELETED" || evento === "ACCESS_TOKEN_EXPIRED") {
      // O aviso pode ser de OUTRA chave da conta. Só a chave do FireHub
      // recusada desliga o Pix pelo site.
      const { verificarChaveDaLoja } = await import("@/lib/pix-online-pedido");
      const r = await verificarChaveDaLoja(lojaId);
      return NextResponse.json({ ok: true, chave: r });
    }

    return NextResponse.json({ ok: true, ignorado: evento || "sem evento" });
  } catch (err: any) {
    console.error(`[Webhook Asaas loja ${lojaId}] ${evento}:`, err?.message);
    // 500: o Asaas reenvia. A conferência é idempotente.
    return NextResponse.json({ error: "Falha ao processar" }, { status: 500 });
  }
}
