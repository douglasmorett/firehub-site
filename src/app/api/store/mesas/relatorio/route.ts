/**
 * Relatório de mesas da loja: taxa de serviço arrecadada (total e por garçom)
 * e vendas separadas por origem — balcão, mesa, delivery e retirada.
 *
 * GET /api/store/mesas/relatorio?de=YYYY-MM-DD&ate=YYYY-MM-DD
 * (sem parâmetros = hoje)
 *
 * ── Duas fontes, e por que não é uma só ─────────────────────────────────────
 *
 * A TAXA DE SERVIÇO mora na SESSÃO da mesa (TableSession.serviceFee), gravada
 * no fechamento sobre o consumo já com desconto — é o número que o garçom
 * recebe e que o dono quer conferir. O pedido não sabe nada disso
 * (ver lib/conta-da-mesa.ts e o fechamento em table-sessions/[id]/close).
 *
 * As VENDAS POR ORIGEM moram nos PEDIDOS (CustomerOrder), porque balcão,
 * delivery e retirada não têm sessão. A linha "Mesa" desse bloco vem das
 * SESSÕES (pago − taxa − gorjeta), não dos pedidos: é o que de fato entrou no
 * caixa pelas mesas, já com o desconto dado na conta. Medido em 17/09/2026 na
 * Pastel da Paulista: pelos pedidos dava R$ 37.256,78, pelas sessões
 * R$ 37.353,77 — a diferença é desconto na mesa e pedido de mesa aberta que
 * fechou noutra janela. Mostrar os dois números para "Mesa" na mesma tela seria
 * pedir para o lojista escolher em qual acreditar.
 *
 * ── O dia operacional ───────────────────────────────────────────────────────
 *
 * A janela vira às 5h no fuso da LOJA (lib/fuso.ts): a mesa fechada à 1h da
 * manhã é do expediente de ontem. Com meia-noite UTC (o relógio do servidor),
 * o relatório de "hoje" numa pizzaria perdia as últimas 3 h de todo turno.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inicioDoDiaDaLoja, HORA_DE_VIRADA_DO_EXPEDIENTE } from "@/lib/fuso";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { origemDaVenda, canalDentroDoDelivery, type OrigemDaVenda } from "@/lib/origem-da-venda";

const DIA_MS = 24 * 60 * 60 * 1000;
const VIRADA_MS = HORA_DE_VIRADA_DO_EXPEDIENTE * 60 * 60 * 1000;

/** "YYYY-MM-DD" válido, ou null. Qualquer outra coisa cai em "hoje". */
function lerDia(bruto: string | null): string | null {
  return bruto && /^\d{4}-\d{2}-\d{2}$/.test(bruto) ? bruto : null;
}

/**
 * O início do DIA OPERACIONAL de uma data do calendário, no fuso da loja.
 * Meio-dia local está dentro daquele dia em qualquer offset (−02/−03), então
 * serve de âncora para `inicioDoDiaDaLoja` achar a meia-noite certa.
 */
function inicioOperacional(dia: string, tz: string | null | undefined): Date {
  const meioDia = new Date(`${dia}T12:00:00-03:00`);
  return new Date(inicioDoDiaDaLoja(tz, meioDia).getTime() + VIRADA_MS);
}

const c2 = (n: number) => Math.round(n * 100) / 100;

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

  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const de = lerDia(req.nextUrl.searchParams.get("de")) ?? hoje;
  const ate = lerDia(req.nextUrl.searchParams.get("ate")) ?? de;

  const inicio = inicioOperacional(de, tz);
  const fim = new Date(inicioOperacional(ate, tz).getTime() + DIA_MS);
  if (fim.getTime() - inicio.getTime() > 400 * DIA_MS) {
    return NextResponse.json({ error: "Período maior que um ano." }, { status: 400 });
  }

  const [sessoes, pedidos] = await Promise.all([
    prisma.tableSession.findMany({
      where: { franchiseeId: lojaId, status: "CLOSED", closedAt: { gte: inicio, lt: fim } },
      select: {
        id: true, waiterId: true, waiterName: true, serviceFee: true, waiterTip: true, totalPaid: true, closedAt: true,
        waiter: { select: { name: true } },
        table: { select: { number: true } },
      },
    }),
    prisma.customerOrder.findMany({
      where: {
        franchiseeId: lojaId,
        createdAt: { gte: inicio, lt: fim },
        // Venda é o que não foi cancelado nem é intenção (pedido do totem
        // antes de pagar, rascunho do robô). Mesma régua da cobrança.
        status: { notIn: ["AGUARDANDO_PAGAMENTO", "CRIANDO_IA", ...STATUS_CANCELADOS] },
      },
      select: {
        totalAmount: true, tableSessionId: true, deliveryType: true, source: true,
        ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true, status: true,
      },
    }),
  ]);

  // ── Mesas: taxa de serviço, total e por garçom ────────────────────────────
  let taxaServico = 0, gorjetas = 0, pago = 0;
  const porGarcom = new Map<string, { waiterId: string | null; nome: string; mesas: number; taxaServico: number; gorjetas: number; consumo: number }>();
  for (const s of sessoes) {
    const taxa = s.serviceFee || 0, gorjeta = s.waiterTip || 0, total = s.totalPaid || 0;
    taxaServico += taxa; gorjetas += gorjeta; pago += total;
    // Mesa fechada sem garçom vinculado entra numa linha própria, nunca some:
    // na Pastel da Paulista eram 157 de 552 mesas (R$ 372 de taxa) em 30 dias.
    const chave = s.waiterId || "__sem__";
    const nome = s.waiter?.name || s.waiterName || "Sem garçom";
    const g = porGarcom.get(chave) ?? { waiterId: s.waiterId, nome, mesas: 0, taxaServico: 0, gorjetas: 0, consumo: 0 };
    g.mesas++; g.taxaServico += taxa; g.gorjetas += gorjeta; g.consumo += total - taxa - gorjeta;
    porGarcom.set(chave, g);
  }
  const consumoMesas = pago - taxaServico - gorjetas;

  // ── Vendas por origem ─────────────────────────────────────────────────────
  const porOrigem: Record<OrigemDaVenda, { valor: number; pedidos: number }> = {
    MESA: { valor: 0, pedidos: 0 }, BALCAO: { valor: 0, pedidos: 0 }, DELIVERY: { valor: 0, pedidos: 0 }, RETIRADA: { valor: 0, pedidos: 0 },
  };
  const deliveryPorCanal = new Map<string, { valor: number; pedidos: number }>();
  for (const p of pedidos) {
    const o = origemDaVenda(p);
    porOrigem[o].pedidos++;
    if (o === "MESA") continue; // o valor da mesa vem das sessões (ver cabeçalho)
    porOrigem[o].valor += p.totalAmount || 0;
    if (o === "DELIVERY") {
      const canal = canalDentroDoDelivery(p);
      const c = deliveryPorCanal.get(canal) ?? { valor: 0, pedidos: 0 };
      c.valor += p.totalAmount || 0; c.pedidos++;
      deliveryPorCanal.set(canal, c);
    }
  }
  porOrigem.MESA.valor = consumoMesas;
  const totalVendas = Object.values(porOrigem).reduce((s, o) => s + o.valor, 0);

  return NextResponse.json({
    periodo: { de, ate, inicio: inicio.toISOString(), fim: fim.toISOString() },
    mesas: {
      fechadas: sessoes.length,
      consumo: c2(consumoMesas),
      taxaServico: c2(taxaServico),
      gorjetas: c2(gorjetas),
      totalPago: c2(pago),
      porGarcom: [...porGarcom.values()]
        .map((g) => ({ ...g, taxaServico: c2(g.taxaServico), gorjetas: c2(g.gorjetas), consumo: c2(g.consumo) }))
        .sort((a, b) => b.taxaServico - a.taxaServico),
    },
    vendas: {
      total: c2(totalVendas),
      porOrigem: Object.fromEntries(Object.entries(porOrigem).map(([k, v]) => [k, { valor: c2(v.valor), pedidos: v.pedidos }])),
      deliveryPorCanal: [...deliveryPorCanal.entries()]
        .map(([canal, v]) => ({ canal, valor: c2(v.valor), pedidos: v.pedidos }))
        .sort((a, b) => b.valor - a.valor),
    },
  });
}
