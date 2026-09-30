/**
 * As mesas FECHADAS no período, já com os filtros do relatório — a fonte da
 * taxa de serviço, da gorjeta, do desconto dado no fechamento e do pagamento
 * da mesa (lib/relatorios/regua-da-venda.ts, regras 3 a 5).
 *
 * Existia três vezes, e cada uma filtrava de um jeito: o Vendas por período
 * vestia a sessão de "pedido de mesa" e passava por `filtrarPedidos`; o
 * Faturamento por dia usava o PRIMEIRO PEDIDO da conta com a hora do
 * fechamento (numa conta sem pedido, a mesa sumia); o Formas de pagamento
 * vestia a sessão de novo, com outra lista de colunas. Três réguas que
 * divergiriam no primeiro filtro novo. Agora é uma só.
 *
 * A sessão vira um "pedido de mesa" fechado na HORA DO FECHAMENTO e passa pela
 * mesma régua dos pedidos (lib/relatorios/servidor.ts, filtrarPedidos):
 * filtrar Entrega some com a taxa de serviço, filtrar 18h–23h pega a mesa
 * fechada nessa faixa, a marca é a da loja. O pago e os pedidos da conta
 * (TODOS, de qualquer dia — quatro colunas) vêm para deduzir o desconto no
 * fechamento; as baixas (`paymentMethods`) só para quem mostra pagamento.
 */
import { prisma } from "@/lib/prisma";
import { filtrarPedidos, type ContextoDoRelatorio, type PedidoBase } from "@/lib/relatorios/servidor";
import type { MesaFechada } from "@/lib/relatorios/regua-da-venda";

export type PedidoDaMesaFechada = { id: string; status: string; totalAmount: number; discountTotal: number | null };

export type MesaFechadaDoPeriodo = Omit<MesaFechada, "fechadaEm" | "pedidos"> & {
  franchiseeId: string;
  fechadaEm: Date;
  pedidos: PedidoDaMesaFechada[];
  /** TableSession.paymentMethods, cru — só com `comPagamentos`. */
  pagamentos?: unknown;
};

/** A sessão vestida de pedido de mesa, no instante do fechamento, para `filtrarPedidos`. */
export function mesaComoPedido(s: { id: string; franchiseeId: string; closedAt: Date }): PedidoBase {
  return {
    id: s.id, franchiseeId: s.franchiseeId, createdAt: s.closedAt, status: "ENTREGUE", totalAmount: 0,
    deliveryType: "MESA", source: "PRESENCIAL", tableSessionId: s.id, totemLicenseId: null,
    ifoodOrderId: null, ifoodReference: null, openDeliveryOrderId: null, openDeliveryChannel: null,
    ifoodStoreMerchant: null, food99AppShopId: null, food99ShopId: null,
  };
}

/**
 * As mesas fechadas em [janela.inicio, janela.fim), das lojas do contexto,
 * que passam nos filtros do relatório. `comPagamentos` traz as baixas.
 */
export async function mesasFechadasDoPeriodo(
  ctx: ContextoDoRelatorio,
  janela: { inicio: Date; fim: Date } = { inicio: ctx.inicio, fim: ctx.fim },
  opts: { comPagamentos?: boolean } = {},
): Promise<MesaFechadaDoPeriodo[]> {
  const sessoes = await prisma.tableSession.findMany({
    where: { franchiseeId: { in: ctx.lojaIds }, status: "CLOSED", closedAt: { gte: janela.inicio, lt: janela.fim } },
    select: {
      id: true, franchiseeId: true, closedAt: true, serviceFee: true, waiterTip: true, totalPaid: true,
      ...(opts.comPagamentos ? { paymentMethods: true } : {}),
      orders: { select: { id: true, status: true, totalAmount: true, discountTotal: true } },
    },
  });
  const passam = new Set(filtrarPedidos(
    sessoes.filter((s) => s.closedAt).map((s) => mesaComoPedido({ id: s.id, franchiseeId: s.franchiseeId, closedAt: s.closedAt as Date })),
    ctx,
  ).map((p) => p.id));
  return sessoes.filter((s) => passam.has(s.id)).map((s) => ({
    id: s.id,
    franchiseeId: s.franchiseeId,
    fechadaEm: s.closedAt as Date,
    serviceFee: s.serviceFee,
    waiterTip: s.waiterTip,
    pago: s.totalPaid,
    pedidos: s.orders,
    ...(opts.comPagamentos ? { pagamentos: (s as { paymentMethods?: unknown }).paymentMethods } : {}),
  }));
}
