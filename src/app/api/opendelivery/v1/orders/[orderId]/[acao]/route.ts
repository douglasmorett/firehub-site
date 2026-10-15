import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarLogistica, NAO_AUTORIZADO, problema } from "@/lib/open-delivery-saida/acesso";
import { vaiParaALogistica } from "@/lib/open-delivery-saida/pedido";
import { aplicarAcaoDaLogistica, ACOES_DA_LOGISTICA, type AcaoDaLogistica } from "@/lib/open-delivery-saida/status";
import { cicloDaLoja } from "@/lib/open-delivery-saida/eventos";

/**
 * POST /api/opendelivery/v1/orders/{orderId}/{readyForPickup|dispatch|delivered}
 *
 * A logística devolvendo o andamento (corpo vazio). Muda o status pelos mesmos
 * efeitos do painel e do app do motoboy (lib/open-delivery-saida/status.ts).
 * `confirm` é aceito e não faz nada: quem aceita o pedido na cozinha é a loja,
 * não a logística. 202 sem corpo; pedido cancelado → 422.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string; acao: string }> }) {
  const integ = await autenticarLogistica(req);
  if (!integ) return NAO_AUTORIZADO();

  const { orderId, acao } = await params;
  if (acao !== "confirm" && !ACOES_DA_LOGISTICA.includes(acao)) return problema(404, "Ação não existe.");

  const pedido = await prisma.customerOrder.findFirst({
    where: { id: orderId, franchiseeId: integ.franchiseeId },
    select: {
      id: true, franchiseeId: true, status: true, acceptedAt: true, deliveryType: true, deliveryBy: true, source: true,
      ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true,
      openDeliveryReference: true, food99AppShopId: true, tableSessionId: true, parentOrderId: true,
    },
  });
  if (!pedido || !vaiParaALogistica(pedido)) return problema(404, "Pedido não encontrado.");

  if (acao === "confirm") return new NextResponse(null, { status: 202 });

  const r = await aplicarAcaoDaLogistica(pedido, acao as AcaoDaLogistica, integ.parceiro);
  if (!r.ok) return problema(r.status, r.motivo);

  // O evento da etapa (READY_FOR_PICKUP, DISPATCHED, DELIVERED) sai já, sem esperar o cron.
  if (r.mudou) cicloDaLoja(integ).catch(() => {});
  return new NextResponse(null, { status: 202 });
}
