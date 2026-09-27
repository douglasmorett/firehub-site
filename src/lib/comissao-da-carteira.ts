/**
 * Quanto uma carteira de lojas rende de comissão NESTE MÊS.
 *
 * É a conta que o portal do embaixador sempre fez (e que o vendedor passou a
 * usar também): a comissão é um percentual da MENSALIDADE da FireHub, não das
 * vendas da loja. Loja em teste ou sem venda no mês não gera mensalidade, então
 * não gera comissão. Ciclo já pago no Asaas vale pelo valor cobrado.
 *
 * O dinheiro de verdade sai pelo split do Asaas no fechamento (lib/billing.ts);
 * este número é a previsão que o portal mostra.
 */
import { prisma } from "@/lib/prisma";
import { calcMensalidade } from "@/lib/firehub-billing";
import { getCurrentYearMonth, intervaloDoMes } from "@/lib/billing";

/** Campos da loja que a conta precisa. */
export const SELECT_DA_LOJA_NA_CARTEIRA = {
  id: true,
  name: true,
  storeName: true,
  storePhone: true,
  email: true,
  createdAt: true,
  trialEndsAt: true,
  slug: true,
  city: true,
  storeOpen: true,
  planPercent: true,
} as const;

type LojaDaCarteira = {
  id: string;
  name: string;
  storeName: string | null;
  storePhone: string | null;
  email: string;
  createdAt: Date;
  trialEndsAt: Date | null;
  slug: string | null;
  city: string | null;
  storeOpen: boolean;
};

/**
 * `percentual` pode ser um número (o mesmo para toda loja) ou uma função por
 * loja — o vendedor não leva nada da loja que ele mesmo indicou.
 */
export async function comissaoDasLojas<L extends LojaDaCarteira>(lojas: L[], percentual: number | ((loja: L) => number)) {
  const now = new Date();
  // Mês EM BRASÍLIA (o mesmo do fechamento de cobrança): com getMonth() do
  // container (UTC) as vendas das 21:00 às 24:00 do último dia caíam na
  // comissão do mês seguinte.
  const { monthStart: startOfMonth, monthEnd: endOfMonth } = intervaloDoMes(getCurrentYearMonth());

  return await Promise.all(
    lojas.map(async (store) => {
      // Vendas no mês atual
      const monthAgg = await prisma.customerOrder.aggregate({
        where: {
          franchiseeId: store.id,
          status: { not: "CANCELADO" },
          createdAt: { gte: startOfMonth, lt: endOfMonth },
        },
        _sum: { totalAmount: true },
        _count: true,
      });

      const monthSales = monthAgg._sum.totalAmount || 0;
      const monthOrdersCount = monthAgg._count || 0;

      // Status da Loja
      const isTrial = store.trialEndsAt ? new Date(store.trialEndsAt) > now : false;
      const trialDaysRemaining = isTrial && store.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(store.trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      let status: "TRIAL" | "ACTIVE" | "INACTIVE" = "INACTIVE";
      if (isTrial) {
        status = "TRIAL";
      } else if (monthSales > 0 || store.storeOpen) {
        status = "ACTIVE";
      } else {
        status = "INACTIVE";
      }

      // Verificação de ciclo pago no Asaas ou faturamento real
      const paidCycle = await prisma.franchiseeBillingCycle.findFirst({
        where: {
          franchiseeId: store.id,
          status: "PAID",
        },
        orderBy: { createdAt: "desc" },
      });

      // Cálculo da mensalidade real da plataforma:
      // Se a loja está em Teste (Trial) ou não movimentou faturamento, mensalidade e comissão são R$ 0,00.
      let platformFee = 0;
      let isPaidByAsaas = false;

      if (paidCycle) {
        isPaidByAsaas = true;
        platformFee = paidCycle.amountDue;
      } else if (!isTrial && monthSales > 0) {
        // Se a loja já saiu do teste e está faturando
        const { mensalidade } = calcMensalidade(monthSales, true);
        platformFee = mensalidade;
      }

      // Comissão real: só conta sobre mensalidade real gerada/paga
      const pct = typeof percentual === "function" ? percentual(store) : percentual;
      const ambassadorProfit = platformFee * (pct / 100);

      return {
        id: store.id,
        name: store.name,
        storeName: store.storeName || store.name || "Restaurante sem nome",
        storePhone: store.storePhone,
        email: store.email,
        slug: store.slug,
        city: store.city,
        createdAt: store.createdAt.toISOString(),
        trialEndsAt: store.trialEndsAt ? store.trialEndsAt.toISOString() : null,
        trialDaysRemaining,
        status,
        monthSales,
        monthOrdersCount,
        platformFee,
        ambassadorProfit,
        isPaidByAsaas,
      };
    })
  );
}
