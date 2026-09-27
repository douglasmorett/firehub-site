import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorDashboard from "@/components/ambassador/AmbassadorDashboard";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import { comissaoDasLojas, SELECT_DA_LOJA_NA_CARTEIRA } from "@/lib/comissao-da-carteira";

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
        select: SELECT_DA_LOJA_NA_CARTEIRA,
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
            select: SELECT_DA_LOJA_NA_CARTEIRA,
            orderBy: { createdAt: "desc" }
          }
        }
      }
    }
  });

  if (!ambassador) {
    return <AmbassadorLoginForm />;
  }

  // A conta mora em lib/comissao-da-carteira.ts — a mesma do vendedor.
  const calcularLojas = comissaoDasLojas;

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
    <>
    {ambassador.isVendedor && (
      <a
        href="/vendedor"
        style={{ display: "block", background: "#0B0B0C", color: "#fff", textAlign: "center", padding: "10px 16px", fontWeight: 700, fontSize: "0.88rem", textDecoration: "none", fontFamily: "Inter, sans-serif" }}
      >
        💼 Você também é vendedor — ver sua carteira de clientes →
      </a>
    )}
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
    </>
  );
}
