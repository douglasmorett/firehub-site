/**
 * GET /api/cron/pix-online — a cada 2 minutos (scripts/cron-runner.js).
 *
 * A rede de segurança do Pix pelo site (lib/pix-online.ts). O webhook e a
 * tela do cliente fazem quase tudo; isto cobre o que eles não alcançam:
 *
 *   1. Pedido esperando Pix cujo prazo acabou → cancela e exclui a cobrança
 *      (sem isso o QR do Asaas valeria 12 meses). Inclui o pedido cujo Pix
 *      nem chegou a ser gerado — o cliente fechou a página antes.
 *   2. Pix pago com o webhook fora do ar e o cliente fora da tela → confirma.
 *   3. Pix pago DEPOIS do cancelamento → estorna.
 *   4. Estorno pendente → acompanha até concluir.
 *   5. Uma vez por dia, usa a chave de cada loja conectada: o Asaas desativa
 *      chave parada há 3 meses, e loja que vende pouco online chegaria lá.
 *
 * Só olha pedido do cardápio (source ONLINE). O totem também nasce esperando
 * pagamento — mas espera o caixa, e não tem prazo.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { conferirPagamentoDoPedido, verificarChaveDaLoja } from "@/lib/pix-online-pedido";
import { MINUTOS_PARA_PAGAR } from "@/lib/pix-online";

export const dynamic = "force-dynamic";

const UM_DIA_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const agora = Date.now();
  const lojaConectada = { asaasChaveCifrada: { not: null } };
  const resumo = { conferidos: 0, pagos: 0, encerrados: 0, chaves: 0, chavesRecusadas: 0, erros: 0 };

  try {
    const pedidos = await prisma.customerOrder.findMany({
      where: {
        source: "ONLINE",
        createdAt: { gte: new Date(agora - UM_DIA_MS) },
        franchisee: lojaConectada,
        OR: [
          // 1 e 2: esperando pagamento — com cobrança (conferir sempre) ou sem
          // (só depois do prazo, que é quando há o que fazer).
          { status: "AGUARDANDO_PAGAMENTO", gatewayProvider: "asaas" },
          {
            status: "AGUARDANDO_PAGAMENTO",
            gatewayPaymentId: null,
            paymentMethod: { in: ["PIX", "PIX_ONLINE"] },
            createdAt: { lt: new Date(agora - MINUTOS_PARA_PAGAR * 60_000) },
          },
          // 3: cancelado nas últimas 2 h com a cobrança ainda aberta no Asaas
          //    (a exclusão falhou): pode ter sido paga — confere e estorna.
          //    Cobrança já excluída vira "expired" e sai da ronda.
          {
            status: "CANCELADO",
            gatewayProvider: "asaas",
            pagarmeStatus: "pending",
            createdAt: { gte: new Date(agora - 2 * 60 * 60 * 1000) },
          },
          // 4: estorno em andamento.
          { status: "CANCELADO", gatewayProvider: "asaas", pagarmeStatus: "refund_pending" },
        ],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: 150,
    });

    for (const p of pedidos) {
      try {
        const s = await conferirPagamentoDoPedido(p.id);
        resumo.conferidos++;
        if (s.pago) resumo.pagos++;
        if (s.encerrado) resumo.encerrados++;
      } catch (err: any) {
        resumo.erros++;
        console.error(`[cron pix-online] Pedido ${p.id}:`, err?.message);
      }
    }

    // 5: a chave de cada loja, uma vez por dia.
    const lojas = await prisma.user.findMany({
      where: lojaConectada,
      select: { id: true, asaasConexao: true },
    });
    for (const loja of lojas) {
      const verificadoEm = Date.parse((loja.asaasConexao as any)?.verificadoEm || "") || 0;
      if (agora - verificadoEm < UM_DIA_MS - 10 * 60_000) continue;
      const r = await verificarChaveDaLoja(loja.id).catch(() => "falha" as const);
      resumo.chaves++;
      if (r === "recusada") resumo.chavesRecusadas++;
    }

    return NextResponse.json({ ok: true, ...resumo });
  } catch (err: any) {
    console.error("[cron pix-online] Falha:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message, ...resumo }, { status: 500 });
  }
}
