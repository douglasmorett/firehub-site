import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorDashboard from "@/components/ambassador/AmbassadorDashboard";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import { calcMensalidade } from "@/lib/firehub-billing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do Embaixador - FireHub" };

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
        select: {
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
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!ambassador) {
    return <AmbassadorLoginForm />;
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Coleta dados de vendas de todas as lojas indicadas
  const storesData = await Promise.all(
    ambassador.referredStores.map(async (store) => {
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
      const ambassadorProfit = platformFee * (ambassador.commissionPercent / 100);

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

  // Totais consolidados da carteira
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
      currentMonthIncome={currentMonthIncome}
      totalPortfolioSales={totalPortfolioSales}
      totalPlatformFees={totalPlatformFees}
    />
  );
}
