/**
 * Relatório de mesas da loja: as mesas fechadas no período (consumo, taxa de
 * serviço, gorjeta e desconto no fechamento — total e por garçom) e as vendas
 * separadas por origem — balcão, mesa, delivery e retirada.
 *
 * GET /api/store/mesas/relatorio?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *     /api/store/mesas/relatorio?atalho=hoje|ontem
 * (sem parâmetros = hoje, no dia operacional da loja)
 *
 * As contas estão em lib/relatorios/relatorio-de-mesas.ts, pela régua única
 * de venda (lib/relatorios/regua-da-venda.ts) — inclusive por que o consumo
 * não é mais pago − taxa − gorjeta (o pago tem o troco) e por que a linha
 * "Mesa" das vendas conta mesas, não rodadas. Aqui só se busca.
 *
 * ── Duas fontes, cada uma com o seu nome ────────────────────────────────────
 *
 * A TAXA DE SERVIÇO, a gorjeta e o desconto do fechamento moram na SESSÃO da
 * mesa (TableSession), gravados no fechamento: vêm das mesas FECHADAS no
 * período, com TODOS os pedidos da conta para o consumo (lib/conta-da-mesa.ts
 * e o fechamento em table-sessions/[id]/close).
 *
 * As VENDAS POR ORIGEM moram nos PEDIDOS (CustomerOrder), pela hora do pedido,
 * a mesa inclusive (aberta ou fechada) — o mesmo número do Vendas por período.
 *
 * ── O dia operacional ───────────────────────────────────────────────────────
 *
 * A janela vira às 5h no fuso da LOJA (`janelaDoPeriodo`, a de todo
 * relatório): a mesa fechada à 1h da manhã é do expediente de ontem, e o
 * "hoje" das 2h da manhã ainda é ontem (`hojeNaLoja`). Com meia-noite UTC (o
 * relógio do servidor), o relatório de "hoje" numa pizzaria perdia as últimas
 * 3 h de todo turno; com o dia do calendário, o "Hoje" pedido às 2h era um
 * dia que ainda não tinha começado.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hojeNaLoja, STATUS_FORA_DA_VENDA } from "@/lib/relatorios/base";
import { janelaDoPeriodo, MAX_DIAS } from "@/lib/relatorios/servidor";
import { mesasFechadasDoRelatorio, periodoDaConsulta, vendasPorOrigem } from "@/lib/relatorios/relatorio-de-mesas";

const DIA_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeTimezone: true },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const lojaId = usuario.ownerId || usuario.id;

  // O fuso é o do dono da loja quando quem consulta é funcionário.
  const dono = usuario.ownerId
    ? await prisma.user.findUnique({ where: { id: usuario.ownerId }, select: { storeTimezone: true } })
    : null;
  const tz = dono?.storeTimezone ?? usuario.storeTimezone;

  const hoje = hojeNaLoja(tz);
  const { de, ate } = periodoDaConsulta(req.nextUrl.searchParams, hoje);
  const { inicio, fim } = janelaDoPeriodo(de, ate, tz);
  if (fim.getTime() - inicio.getTime() > MAX_DIAS * DIA_MS) {
    return NextResponse.json({ error: "Período maior que um ano." }, { status: 400 });
  }

  const [sessoes, pedidos] = await Promise.all([
    prisma.tableSession.findMany({
      where: { franchiseeId: lojaId, status: "CLOSED", closedAt: { gte: inicio, lt: fim } },
      select: {
        id: true, waiterId: true, waiterName: true, serviceFee: true, waiterTip: true, totalPaid: true, closedAt: true,
        waiter: { select: { name: true } },
        // TODOS os pedidos da conta (de qualquer dia): o consumo e o desconto no fechamento.
        orders: { select: { status: true, totalAmount: true, discountTotal: true } },
      },
    }),
    prisma.customerOrder.findMany({
      where: {
        franchiseeId: lojaId,
        createdAt: { gte: inicio, lt: fim },
        // Venda é o que não foi cancelado nem é intenção (pedido do totem
        // antes de pagar, rascunho do robô). A régua de todo relatório.
        status: { notIn: [...STATUS_FORA_DA_VENDA] },
      },
      select: {
        id: true, createdAt: true, status: true, totalAmount: true, tableSessionId: true, parentOrderId: true,
        deliveryType: true, source: true, ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true,
        // Preço e quantidade: a trava do valor impossível olha os itens também (regua-da-venda.ts).
        items: { select: { quantity: true, price: true } },
      },
    }),
  ]);

  const mesas = mesasFechadasDoRelatorio(sessoes.map((s) => ({
    id: s.id,
    waiterId: s.waiterId,
    garcom: s.waiter?.name || s.waiterName,
    serviceFee: s.serviceFee,
    waiterTip: s.waiterTip,
    fechadaEm: s.closedAt,
    pago: s.totalPaid,
    pedidos: s.orders,
  })));

  return NextResponse.json({
    periodo: { de, ate, hoje, inicio: inicio.toISOString(), fim: fim.toISOString() },
    mesas,
    vendas: vendasPorOrigem(pedidos),
  });
}
