/**
 * lib/billing.ts
 *
 * Motor de faturamento "Use First, Pay Later" — 100% automático.
 *
 * Regra:
 *   Taxa = 1% do faturamento mensal do franqueado
 *   Mínimo: R$50 · Máximo: R$400
 *
 * Fluxo:
 *   1. Pedido é confirmado (status ACEITO/ENTREGUE) → trackSaleForBilling()
 *      - Recalcula o totalSales e amountDue do ciclo do mês
 *      - Mostra pro franqueado quanto deve em tempo real
 *
 *   2. Ao final do mês → closeBillingCycle() (via API ou Asaas webhook)
 *      - Gera cobrança Asaas pelo valor ainda pendente
 *
 * Sem Pagar.me, sem ação manual do admin.
 */

import { prisma } from "@/lib/prisma";
import { calcMensalidade } from "@/lib/firehub-billing";
import { getAsaasKey } from "@/lib/asaas";

export function getCurrentYearMonth(offset = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Garante que existe um ciclo OPEN para o franqueado no mês atual.
 * Criado automaticamente ao primeiro pedido do mês.
 */
async function ensureCycle(franchiseeId: string, yearMonth: string) {
  const existing = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
  });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { planPercent: true },
  });

  return prisma.franchiseeBillingCycle.create({
    data: {
      franchiseeId,
      yearMonth,
      planPercent: user?.planPercent ?? 1, // default 1%
      status: "OPEN",
    },
  });
}

/**
 * Chamada quando um CustomerOrder é confirmado (ACEITO / ENTREGUE / qualquer status não cancelado).
 *
 * Recalcula totalSales do mês inteiro e atualiza amountDue em tempo real.
 * O franqueado vê imediatamente quanto deve no painel financeiro.
 */
export async function trackSaleForBilling(franchiseeId: string) {
  const yearMonth = getCurrentYearMonth();

  await ensureCycle(franchiseeId, yearMonth);

  const [y, m] = yearMonth.split("-").map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd   = new Date(y, m, 1);

  // Soma todos os pedidos não cancelados do mês (fonte de verdade)
  const agg = await prisma.customerOrder.aggregate({
    where: {
      franchiseeId,
      status: { not: "CANCELADO" },
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: { totalAmount: true },
  });

  const totalSales = agg._sum.totalAmount ?? 0;

  // Aplica regra: 3%, mín R$60, máx R$400
  const { mensalidade: amountDue } = calcMensalidade(totalSales);

  await prisma.franchiseeBillingCycle.update({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
    data: { totalSales, amountDue, amountPending: amountDue },
  });

  console.log(
    `[Billing] ${franchiseeId} ${yearMonth} | Vendas=${totalSales.toFixed(2)} Devido=${amountDue.toFixed(2)}`
  );
}

/**
 * Fecha o mês de um franqueado e gera cobrança Asaas pelo valor pendente.
 * Chamado automaticamente no último dia do mês (ou via API de fechamento).
 */
export async function closeBillingCycle(franchiseeId: string, yearMonth: string) {
  const cycle = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
    include: { franchisee: true },
  });

  if (!cycle) throw new Error(`Ciclo ${yearMonth} não encontrado para ${franchiseeId}`);
  if (cycle.status !== "OPEN") return { charged: false, message: `Ciclo já está ${cycle.status}` };

  // Recalcula valores finais (pedidos confirmados do mês)
  const [y, m] = yearMonth.split("-").map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd   = new Date(y, m, 1);

  const agg = await prisma.customerOrder.aggregate({
    where: {
      franchiseeId,
      status: { not: "CANCELADO" },
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    _sum: { totalAmount: true },
  });

  const totalSales = agg._sum.totalAmount ?? 0;
  const { mensalidade: amountDue } = calcMensalidade(totalSales);
  const amountPending = parseFloat(Math.max(0, amountDue - cycle.amountOffset).toFixed(2));

  // Nada a cobrar
  if (amountPending < 1 || totalSales === 0) {
    await prisma.franchiseeBillingCycle.update({
      where: { id: cycle.id },
      data: { totalSales, amountDue, amountPending: 0, status: "PAID", closedAt: new Date() },
    });
    return { charged: false, amountPending: 0, message: "Nada a cobrar neste mês." };
  }

  // Gera cobrança Asaas pelo valor restante
  const asaasKey = getAsaasKey();
  let asaasPaymentId: string | null = null;
  let asaasBoletoUrl: string | null = null;
  let asaasBoletoCode: string | null = null;

  if (asaasKey && cycle.franchisee.cpfCnpj) {
    const BASE = asaasKey.startsWith("$aact_prod")
      ? "https://api.asaas.com/v3"
      : "https://sandbox.asaas.com/v3";

    let customerId: string | null = null;

    // Busca cliente pelo CPF/CNPJ
    const sr = await fetch(`${BASE}/customers?cpfCnpj=${encodeURIComponent(cycle.franchisee.cpfCnpj)}`,
      { headers: { access_token: asaasKey } });
    if (sr.ok) {
      const sd = await sr.json();
      if (sd.data?.length > 0) customerId = sd.data[0].id;
    }

    // Cria se não existe
    if (!customerId) {
      const cr = await fetch(`${BASE}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", access_token: asaasKey },
        body: JSON.stringify({
          name: cycle.franchisee.name,
          email: cycle.franchisee.email,
          cpfCnpj: cycle.franchisee.cpfCnpj,
        }),
      });
      if (cr.ok) customerId = (await cr.json()).id;
    }

    if (customerId) {
      // Vencimento: dia 5 do próximo mês
      const due = new Date(y, m, 5).toISOString().split("T")[0];

      const pr = await fetch(`${BASE}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", access_token: asaasKey },
        body: JSON.stringify({
          customer: customerId,
          billingType: "BOLETO",
          value: amountPending,
          dueDate: due,
          description: `FireHub ${yearMonth} — Taxa de plataforma (1% · mín R$50 · máx R$400)`,
          externalReference: `billing:${cycle.id}`,
        }),
      });

      if (pr.ok) {
        const pd = await pr.json();
        asaasPaymentId = pd.id;
        asaasBoletoUrl = pd.invoiceUrl || pd.bankSlipUrl || null;
        asaasBoletoCode = pd.barCode || null;
      }
    }
  }

  await prisma.franchiseeBillingCycle.update({
    where: { id: cycle.id },
    data: {
      totalSales,
      amountDue,
      amountPending,
      status: "CLOSED",
      closedAt: new Date(),
      asaasPaymentId,
      asaasBoletoUrl,
      asaasBoletoCode,
    },
  });

  return { charged: true, amountPending, asaasBoletoUrl, message: "Boleto gerado com valor pendente." };
}

/**
 * Retorna o ciclo atual do franqueado para exibir no painel.
 * Se não existe, retorna dados zerados (sem criar no banco).
 */
export async function getCurrentCycleView(franchiseeId: string) {
  const yearMonth = getCurrentYearMonth();

  const cycle = await prisma.franchiseeBillingCycle.findUnique({
    where: { franchiseeId_yearMonth: { franchiseeId, yearMonth } },
  });

  if (!cycle) {
    return { yearMonth, totalSales: 0, amountDue: 0, amountOffset: 0, amountPending: 0, status: "OPEN" };
  }

  return {
    yearMonth: cycle.yearMonth,
    totalSales: cycle.totalSales,
    amountDue: cycle.amountDue,
    amountOffset: cycle.amountOffset,
    amountPending: cycle.amountPending,
    status: cycle.status,
    asaasBoletoUrl: cycle.asaasBoletoUrl,
    asaasBoletoCode: cycle.asaasBoletoCode,
  };
}
