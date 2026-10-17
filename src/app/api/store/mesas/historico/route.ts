/**
 * Histórico de mesas: as contas FECHADAS no dia (ou no período), mesa a mesa.
 *
 * GET /api/store/mesas/historico?atalho=hoje|ontem
 *     /api/store/mesas/historico?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *     (sem parâmetros = hoje, no dia operacional da loja)
 *     → { periodo, resumo, mesas, itens }
 *
 * GET /api/store/mesas/historico?sessao=<id>
 *     → { mesa }: o detalhe de UMA conta (rodadas com os itens, cada baixa com
 *       hora e quem lançou, consumo por pessoa).
 *
 * As contas estão em lib/relatorios/historico-de-mesas.ts, pela régua do
 * Relatório de Mesas (o "Consumo" daqui = "Consumo nas mesas" de lá). Aqui só
 * se busca, com o mesmo dia operacional do Relatório de Mesas: a janela vira
 * às 5h no fuso do DONO da loja (`janelaDoPeriodo` + `hojeNaLoja`), e a mesa
 * entra pelo `closedAt` — a mesa fechada à 1h da manhã é do expediente de
 * ontem.
 *
 * A lista NÃO traz os itens de cada mesa (só a soma por produto): o detalhe
 * vem no clique. Com o salão cheio, mandar todas as rodadas com todos os
 * itens a cada troca de dia seria muito dado para quem só quer a lista.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { periodoDaConsulta } from "@/lib/relatorios/relatorio-de-mesas";
import { detalheDaMesa, historicoDeMesas, type SessaoDoHistorico } from "@/lib/relatorios/historico-de-mesas";

const DIA_MS = 24 * 60 * 60 * 1000;
/** Histórico é lista mesa a mesa: um mês já é muita linha. Período maior é o Relatório de Mesas. */
const MAX_DIAS_DO_HISTORICO = 31;

/** O item como o detalhe e a soma por produto precisam (nome, preço, quantidade, dono, combo). */
const ITEM_DO_HISTORICO = {
  select: {
    quantity: true, price: true, productName: true, tableGuestId: true, comboSelections: true, notes: true,
    menuProduct: { select: { name: true } },
  },
} as const;

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

  const sp = req.nextUrl.searchParams;

  // ── O detalhe de uma conta ────────────────────────────────────────────────
  const sessaoId = sp.get("sessao");
  if (sessaoId) {
    const s = await prisma.tableSession.findFirst({
      where: { id: sessaoId, franchiseeId: lojaId, status: "CLOSED" },
      select: {
        id: true, customerName: true, waiterId: true, waiterName: true, openedAt: true, closedAt: true, closedByName: true,
        serviceFee: true, waiterTip: true, totalPaid: true, paymentMethods: true, notes: true,
        waiter: { select: { name: true } },
        table: { select: { number: true, label: true } },
        guests: { select: { id: true, name: true }, orderBy: { sortOrder: "asc" } },
        orders: {
          select: { id: true, status: true, totalAmount: true, discountTotal: true, dailyOrderNumber: true, createdAt: true, items: ITEM_DO_HISTORICO },
        },
      },
    });
    if (!s || !s.closedAt) return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
    return NextResponse.json({
      mesa: detalheDaMesa({ ...sessaoDoBanco(s), pessoas: s.guests, observacao: s.notes }, tz),
    });
  }

  // ── A lista do período ────────────────────────────────────────────────────
  const hoje = hojeNaLoja(tz);
  const { de, ate } = periodoDaConsulta(sp, hoje);
  const { inicio, fim } = janelaDoPeriodo(de, ate, tz);
  if (fim.getTime() - inicio.getTime() > MAX_DIAS_DO_HISTORICO * DIA_MS) {
    return NextResponse.json({ error: `O histórico mostra até ${MAX_DIAS_DO_HISTORICO} dias. Para um período maior, use o Relatório de Mesas (Garçons).` }, { status: 400 });
  }

  const sessoes = await prisma.tableSession.findMany({
    where: { franchiseeId: lojaId, status: "CLOSED", closedAt: { gte: inicio, lt: fim } },
    orderBy: { closedAt: "desc" },
    select: {
      id: true, customerName: true, waiterId: true, waiterName: true, openedAt: true, closedAt: true, closedByName: true,
      serviceFee: true, waiterTip: true, totalPaid: true, paymentMethods: true,
      waiter: { select: { name: true } },
      table: { select: { number: true, label: true } },
      // TODOS os pedidos da conta (de qualquer dia): o consumo, o desconto no
      // fechamento e a soma do que foi vendido. Do item, só o que a soma lê.
      orders: {
        select: {
          id: true, status: true, totalAmount: true, discountTotal: true,
          items: { select: { quantity: true, price: true, productName: true, menuProduct: { select: { name: true } } } },
        },
      },
    },
  });

  return NextResponse.json({
    periodo: { de, ate, hoje, inicio: inicio.toISOString(), fim: fim.toISOString() },
    ...historicoDeMesas(sessoes.filter((s) => s.closedAt).map(sessaoDoBanco), tz),
  });
}

type SessaoDoBanco = {
  id: string;
  customerName: string | null;
  waiterId: string | null;
  waiterName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  closedByName: string | null;
  serviceFee: number | null;
  waiterTip: number | null;
  totalPaid: number | null;
  paymentMethods: unknown;
  waiter: { name: string } | null;
  table: { number: number; label: string | null };
  orders: SessaoDoHistorico["pedidos"];
};

/** A sessão do banco no formato da lib. O garçom do cadastro vem antes do nome gravado na abertura. */
function sessaoDoBanco(s: SessaoDoBanco): SessaoDoHistorico {
  return {
    id: s.id,
    mesa: { numero: s.table.number, nome: s.table.label },
    cliente: s.customerName,
    waiterId: s.waiterId,
    garcom: s.waiter?.name || s.waiterName,
    abertaEm: s.openedAt,
    fechadaEm: s.closedAt as Date,
    fechadaPor: s.closedByName,
    serviceFee: s.serviceFee,
    waiterTip: s.waiterTip,
    totalPaid: s.totalPaid,
    paymentMethods: s.paymentMethods,
    pedidos: s.orders,
  };
}
