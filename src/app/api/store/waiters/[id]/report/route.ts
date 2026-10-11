/**
 * Relatório de UM garçom (módulo Garçons → "Relatório"): as mesas que ele
 * fechou no período, com a conta de cada uma e a comissão.
 *
 * GET /api/store/waiters/:id/report?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *     /api/store/waiters/:id/report?atalho=hoje|ontem
 *
 * O período é resolvido AQUI, no dia operacional da loja (vira às 5h, fuso do
 * dono) — `periodoDaConsulta` e `janelaDoPeriodo`, as mesmas do Relatório de
 * Mesas e de todo relatório. Antes a tela mandava instantes montados no
 * navegador: `new Date("2026-10-10")` é meia-noite UTC, e com o `setHours`
 * local o "Período" de 10/10 consultava 09/10; "Hoje" virava à meia-noite do
 * navegador, e a mesa fechada à 1h caía no dia seguinte.
 *
 * A conta de cada mesa é a da régua única (lib/relatorios/relatorio-de-mesas.ts,
 * `contaDaMesa`): consumo = soma dos pedidos da conta; total da conta =
 * consumo − desconto + taxa + gorjeta, SEM o troco — o `totalPaid` é a nota
 * que o cliente entregou (a mesa de R$ 7 paga com R$ 100 aparecia como R$ 100).
 *
 * `startDate`/`endDate` (instantes ISO) ainda são aceitos: é o que a tela
 * aberta antes da atualização manda, até o F5.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { janelaDoPeriodo, MAX_DIAS } from "@/lib/relatorios/servidor";
import { contaDaMesa, periodoDaConsulta } from "@/lib/relatorios/relatorio-de-mesas";

const DIA_MS = 24 * 60 * 60 * 1000;

async function lojaDoUsuario(): Promise<{ franchiseeId: string; tz: string | null } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeTimezone: true }
  });
  if (!dbUser) return null;
  // O fuso é o do dono da loja quando quem consulta é funcionário.
  const dono = dbUser.ownerId
    ? await prisma.user.findUnique({ where: { id: dbUser.ownerId }, select: { storeTimezone: true } })
    : null;
  return { franchiseeId: dbUser.ownerId || dbUser.id, tz: dono?.storeTimezone ?? dbUser.storeTimezone };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const loja = await lojaDoUsuario();
    if (!loja) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { franchiseeId, tz } = loja;

    const searchParams = req.nextUrl.searchParams;
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Waiter ID is required" }, { status: 400 });

    // Só o que o relatório usa. Sem select vinha o Waiter inteiro — inclusive
    // o passwordHash — para qualquer usuário do painel que abrisse a aba.
    const waiter = await prisma.waiter.findUnique({
      where: { id, franchiseeId },
      select: { id: true, name: true, commissionRate: true, active: true },
    });

    if (!waiter) return NextResponse.json({ error: "Waiter not found" }, { status: 404 });

    // ── O período ─────────────────────────────────────────────────────────
    const legadoInicio = searchParams.get("startDate");
    const legadoFim = searchParams.get("endDate");
    const pedeDia = searchParams.has("de") || searchParams.has("ate") || searchParams.has("atalho");
    let closedAt: { gte: Date; lt?: Date; lte?: Date };
    let periodo: { de: string; ate: string; hoje: string; inicio: string; fim: string } | null = null;
    if (!pedeDia && legadoInicio && legadoFim) {
      closedAt = { gte: new Date(legadoInicio), lte: new Date(legadoFim) };
    } else {
      const hoje = hojeNaLoja(tz);
      const { de, ate } = periodoDaConsulta(searchParams, hoje);
      const { inicio, fim } = janelaDoPeriodo(de, ate, tz);
      if (fim.getTime() - inicio.getTime() > MAX_DIAS * DIA_MS) {
        return NextResponse.json({ error: "Período maior que um ano." }, { status: 400 });
      }
      closedAt = { gte: inicio, lt: fim };
      periodo = { de, ate, hoje, inicio: inicio.toISOString(), fim: fim.toISOString() };
    }

    const sessions = await prisma.tableSession.findMany({
      where: { franchiseeId, waiterId: id, status: "CLOSED", closedAt },
      select: {
        id: true, openedAt: true, closedAt: true, totalPaid: true, serviceFee: true, waiterTip: true, waiterCommission: true,
        table: { select: { number: true, label: true } },
        // TODOS os pedidos da conta: o consumo e o desconto no fechamento.
        orders: { select: { status: true, totalAmount: true, discountTotal: true } },
      },
      orderBy: { closedAt: 'desc' }
    });

    return NextResponse.json({
      waiter,
      periodo,
      sessions: sessions.map(s => ({
        id: s.id,
        tableNumber: s.table.number,
        tableLabel: s.table.label,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
        /** O que o cliente ENTREGOU (com troco). Não é o total da conta: ver `totalDaConta`. */
        totalPaid: s.totalPaid || 0,
        serviceFee: s.serviceFee || 0,
        waiterTip: s.waiterTip || 0,
        waiterCommission: s.waiterCommission || 0,
        // consumo, taxa, gorjeta, desconto e totalDaConta (sem troco), pela régua única.
        ...contaDaMesa({
          id: s.id, serviceFee: s.serviceFee, waiterTip: s.waiterTip, fechadaEm: s.closedAt, pago: s.totalPaid, pedidos: s.orders,
        }),
      }))
    });
  } catch (error: any) {
    console.error("GET Waiter Report Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
