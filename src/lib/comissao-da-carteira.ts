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

/** A cobrança em aberto de uma loja (ciclo fechado com saldo), para o portal. */
export type CobrancaDaLoja = {
  /** Mês do ciclo mais recente em aberto ("2026-08"). */
  yearMonth: string;
  /** Soma do que está em aberto, em todos os ciclos fechados. */
  pendente: number;
  ciclos: number;
  vencimento: string | null;
  vencida: boolean;
  diasDeAtraso: number;
  boletoUrl: string | null;
};

/**
 * INADIMPLÊNCIA das lojas de uma carteira: ciclo fechado com `amountPending`
 * — vencido ou a vencer. É o que o embaixador/vendedor precisa para mandar a
 * mensagem certa para a loja (pedido do dono, 27/09/2026). Loja sem cobrança
 * em aberto não entra no mapa.
 */
export async function cobrancasDasLojas(ids: string[]): Promise<Map<string, CobrancaDaLoja>> {
  const saida = new Map<string, CobrancaDaLoja>();
  if (ids.length === 0) return saida;
  const ciclos = await prisma.franchiseeBillingCycle.findMany({
    where: { franchiseeId: { in: ids }, status: "CLOSED", amountPending: { gt: 0 } },
    orderBy: { yearMonth: "desc" },
    select: { franchiseeId: true, yearMonth: true, amountPending: true, dueDate: true, asaasBoletoUrl: true },
  });
  const agora = Date.now();
  for (const c of ciclos) {
    const ja = saida.get(c.franchiseeId);
    if (ja) {
      ja.pendente += c.amountPending;
      ja.ciclos += 1;
      continue;
    }
    const venc = c.dueDate ? c.dueDate.getTime() : null;
    const vencida = venc !== null && venc < agora;
    saida.set(c.franchiseeId, {
      yearMonth: c.yearMonth,
      pendente: c.amountPending,
      ciclos: 1,
      vencimento: c.dueDate ? c.dueDate.toISOString() : null,
      vencida,
      diasDeAtraso: vencida && venc !== null ? Math.floor((agora - venc) / 86_400_000) : 0,
      boletoUrl: c.asaasBoletoUrl || null,
    });
  }
  return saida;
}

/** "2026-09" menos N meses. */
function mesesAtras(yearMonth: string, n: number): string {
  const [a, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * MÉDIA MENSAL do que a carteira rendeu de verdade nos últimos meses: só
 * ciclos PAGOS (é o que o split do Asaas repassou), mês a mês, dividido pelo
 * número de meses — mês sem nada conta zero. Cada carteira traz o percentual
 * dela (número, ou função por loja: o vendedor não leva os 3% da loja que ele
 * mesmo indicou). A mesma loja pode estar em duas carteiras: soma.
 */
export async function mediaMensalDaComissao(
  carteiras: { ids: string[]; percentual: number | ((lojaId: string) => number) }[],
  meses = 3
): Promise<{ media: number; porMes: { yearMonth: string; valor: number }[] }> {
  const atual = getCurrentYearMonth();
  const yms = Array.from({ length: meses }, (_, i) => mesesAtras(atual, i + 1));
  const ids = Array.from(new Set(carteiras.flatMap((c) => c.ids)));
  const porMes = yms.map((yearMonth) => ({ yearMonth, valor: 0 }));
  if (ids.length > 0) {
    const ciclos = await prisma.franchiseeBillingCycle.findMany({
      where: { franchiseeId: { in: ids }, yearMonth: { in: yms }, status: "PAID" },
      select: { franchiseeId: true, yearMonth: true, amountDue: true },
    });
    const pctDe = (lojaId: string) =>
      carteiras.reduce((s, c) => {
        if (!c.ids.includes(lojaId)) return s;
        return s + (typeof c.percentual === "function" ? c.percentual(lojaId) : c.percentual);
      }, 0);
    for (const c of ciclos) {
      const mes = porMes.find((m) => m.yearMonth === c.yearMonth);
      if (mes) mes.valor += (c.amountDue * pctDe(c.franchiseeId)) / 100;
    }
  }
  const soma = porMes.reduce((s, m) => s + m.valor, 0);
  return { media: meses > 0 ? soma / meses : 0, porMes: porMes.reverse() };
}

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
