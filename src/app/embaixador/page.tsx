import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorDashboard from "@/components/ambassador/AmbassadorDashboard";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import { calcMensalidade } from "@/lib/firehub-billing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do Embaixador - FireHub" };

/** Campos da loja que o portal precisa para calcular comissão. */
const SELECT_DA_LOJA = {
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

export default async function EmbaixadorPage() {
  const session = await getServerSession(authOptions);

  // Se não estiver autenticado ou não for AMBASSADOR, exibe tela de login do embaixador
  if (!session?.user?.email || (session.user as any).role !== "AMBASSADOR") {
    return <AmbassadorLoginForm />;
  }

  const sessionUser = session.user as any;

  // Busca o embaixador por ID ou e-mail de forma resiliente
  const ambassador = await prisma.ambassador.findFirst({
    where: {
      OR: [
        ...(sessionUser.id ? [{ id: sessionUser.id }] : []),
        ...(sessionUser.email ? [{ email: { equals: sessionUser.email, mode: "insensitive" as const } }] : [])
      ]
    },
    include: {
      referredStores: {
        select: SELECT_DA_LOJA,
        orderBy: { createdAt: "desc" }
      },
      // Rede de nível 2: os embaixadores que ELE trouxe. As lojas deles pagam
      // `level2Percent` para este embaixador aqui. Para por aqui — não existe
      // terceiro nível, então não há include aninhado.
      subAmbassadors: {
        where: { active: true },
        select: {
          id: true,
          name: true,
          code: true,
          referredStores: {
            select: SELECT_DA_LOJA,
            orderBy: { createdAt: "desc" }
          }
        }
      }
    }
  });

  if (!ambassador) {
    return <AmbassadorLoginForm />;
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Coleta dados de vendas de um conjunto de lojas, aplicando o percentual que
  // vale para elas: `commissionPercent` nas lojas próprias (nível 1) e
  // `level2Percent` nas lojas dos embaixadores que ele trouxe (nível 2).
  const calcularLojas = async (lojas: typeof ambassador.referredStores, percentual: number) => await Promise.all(
    lojas.map(async (store) => {
      // Vendas no mês atual
      const monthAgg = await prisma.customerOrder.aggregate({
        where: {
          franchiseeId: store.id,
          status: { not: "CANCELADO" },
          createdAt: { gte: startOfMonth, lt: endOfMonth }
        },
        _sum: { totalAmount: true },
        _count: true
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
          status: "PAID"
        },
        orderBy: { createdAt: "desc" }
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

      // Comissão real do embaixador: só conta sobre mensalidade real gerada/paga
      const ambassadorProfit = platformFee * (percentual / 100);

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
        isPaidByAsaas
      };
    })
  );

  const storesData = await calcularLojas(ambassador.referredStores, ambassador.commissionPercent);

  // Nível 2: as lojas de cada embaixador da rede, valendo `level2Percent`.
  const nivel2Percent = ambassador.level2Percent ?? 3;
  const rede = await Promise.all(
    ambassador.subAmbassadors.map(async (sub) => {
      const lojas = await calcularLojas(sub.referredStores, nivel2Percent);
      return {
        id: sub.id,
        name: sub.name,
        code: sub.code,
        storesCount: lojas.length,
        activeStores: lojas.filter((l) => l.status === "ACTIVE").length,
        monthSales: lojas.reduce((acc, l) => acc + l.monthSales, 0),
        monthIncome: lojas.reduce((acc, l) => acc + l.ambassadorProfit, 0),
      };
    })
  );

  // Totais consolidados da carteira
  const networkIncome = rede.reduce((acc, r) => acc + r.monthIncome, 0);
  const currentMonthIncome = storesData.reduce((acc, s) => acc + s.ambassadorProfit, 0);
  const totalPortfolioSales = storesData.reduce((acc, s) => acc + s.monthSales, 0);
  const totalPlatformFees = storesData.reduce((acc, s) => acc + s.platformFee, 0);

  return (
    <AmbassadorDashboard
      ambassador={{
        id: ambassador.id,
        name: ambassador.name,
        email: ambassador.email,
        phone: ambassador.phone,
        code: ambassador.code,
        commissionPercent: ambassador.commissionPercent,
        asaasWalletId: ambassador.asaasWalletId,
        active: ambassador.active
      }}
      stores={storesData}
      network={{
        level2Percent: nivel2Percent,
        ambassadors: rede,
        monthIncome: networkIncome,
        storesCount: rede.reduce((acc, r) => acc + r.storesCount, 0),
      }}
      currentMonthIncome={currentMonthIncome}
      totalPortfolioSales={totalPortfolioSales}
      totalPlatformFees={totalPlatformFees}
    />
  );
}
