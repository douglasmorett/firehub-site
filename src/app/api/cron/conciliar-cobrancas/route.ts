/**
 * GET /api/cron/conciliar-cobrancas
 *
 * Deixa o pedido de insumos dizendo o mesmo que o boleto do cliente.
 *
 * A conciliação já acontece quando alguém abre o painel (do cliente ou do
 * admin), mas depender disso é frágil pelo motivo óbvio: o cliente costuma
 * abrir o painel UMA vez, logo depois de comprar, e é justamente depois que a
 * cobrança pode ser refeita com o preço novo do catálogo. Quem não voltar à
 * tela nunca vê o número certo — e o boleto chega com outro valor.
 *
 * De hora em hora, então, os pedidos aguardando pagamento são acertados pela
 * cobrança viva no Asaas. Sem cobrança, ou com o Asaas fora do ar, nada muda:
 * a função é toda try/catch e pedido pago nunca é tocado.
 *
 * Ver src/lib/pedido-cobranca.ts para a regra ("o boleto manda") e o caso que
 * a originou (Icebox, 08/09/2026: painel R$ 2.286, boleto R$ 2.461).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { sincronizarComCobranca } from "@/lib/pedido-cobranca";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pedidos = await prisma.order.findMany({
      where: { status: "PENDING_PAYMENT", asaasPaymentId: { not: null } },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const ajustes = await sincronizarComCobranca(pedidos);
    const lista = Object.entries(ajustes).map(([id, a]) => ({
      pedido: id.slice(-6).toUpperCase(),
      cobrado: a.cobrado,
      diferenca: a.diferenca,
      itensReprecificados: a.itensReprecificados,
    }));

    if (lista.length > 0) {
      console.log(`[conciliar-cobrancas] ${lista.length} pedido(s) acertados pelo boleto:`, JSON.stringify(lista));
    }

    return NextResponse.json({ conferidos: pedidos.length, acertados: lista.length, ajustes: lista });
  } catch (e: any) {
    console.error("[conciliar-cobrancas]", e?.message);
    return NextResponse.json({ error: "Falha ao conciliar cobranças." }, { status: 500 });
  }
}
