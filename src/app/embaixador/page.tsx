import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import AmbassadorDashboard from "@/components/ambassador/AmbassadorDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do Embaixador - FireHub" };

export default async function EmbaixadorPage() {
  const session = await getServerSession(authOptions);
  
  // Apenas AMBASSADOR pode acessar
  if (!session?.user?.email || (session.user as any).role !== "AMBASSADOR") {
    return redirect("/login");
  }

  const ambassador = await prisma.ambassador.findUnique({
    where: { id: (session.user as any).id },
    include: {
      referredStores: {
        select: {
          id: true,
          storeName: true,
          storePhone: true,
          email: true,
          createdAt: true,
          trialEndsAt: true,
          slug: true,
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!ambassador) return redirect("/login");

  // Verificar status de cada loja
  const referralIds = ambassador.referredStores.map(r => r.id);
  
  // Pega o ultimo ciclo de faturamento fechado pra cada loja
  const lastBillings = await prisma.franchiseeBillingCycle.groupBy({
    by: ['franchiseeId'],
    _max: {
      closedAt: true
    },
    where: {
      franchiseeId: { in: referralIds },
      status: "CLOSED"
    }
  });

  const lastBillingsData = await prisma.franchiseeBillingCycle.findMany({
    where: {
      OR: lastBillings.map(b => ({
        franchiseeId: b.franchiseeId,
        closedAt: b._max.closedAt
      }))
    }
  });

  const billingStatusMap = new Map();
  lastBillingsData.forEach(b => {
    billingStatusMap.set(b.franchiseeId, b);
  });

  const now = new Date();
  
  // Calcular comissão (income) apenas para os ativos/pagos deste mês (simplificado)
  let currentMonthIncome = 0;

  const storesWithStatus = ambassador.referredStores.map(r => {
    let status: "TRIAL" | "ACTIVE" | "INACTIVE" = "INACTIVE";
    let isTrial = r.trialEndsAt ? new Date(r.trialEndsAt) > now : false;
    
    if (isTrial) {
      status = "TRIAL";
    } else {
      const billing = billingStatusMap.get(r.id);
      if (billing) {
        if (billing.amountPending <= 0) {
          status = "ACTIVE";
          // Se pagou, a comissão baseia-se no valor total faturado para aquela loja
          currentMonthIncome += (billing.totalValue * (ambassador.commissionPercent / 100));
        }
      } else {
        status = "INACTIVE";
      }
    }

    return {
      id: r.id,
      storeName: r.storeName,
      storePhone: r.storePhone,
      email: r.email,
      createdAt: r.createdAt.toISOString(),
      status
    };
  });

  return (
    <AmbassadorDashboard 
      ambassador={{
        id: ambassador.id,
        name: ambassador.name,
        code: ambassador.code,
        commissionPercent: ambassador.commissionPercent,
        active: ambassador.active
      }}
      stores={storesWithStatus}
      currentMonthIncome={currentMonthIncome}
    />
  );
}
