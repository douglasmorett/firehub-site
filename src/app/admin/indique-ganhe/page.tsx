import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import IndiqueEGanheClient from "@/components/admin/IndiqueEGanheClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub - Indique e Ganhe" };

export default async function IndiqueEGanhePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return redirect("/login");

  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      referrals: {
        select: {
          id: true,
          storeName: true,
          storePhone: true,
          createdAt: true,
          trialEndsAt: true,
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!dbUser) return redirect("/login");

  // A loja ativa tem billing pago, mas vamos simplificar a métrica pra essa view:
  // Se está em TRIAL (trialEndsAt > now), é TRIAL
  // Se não está em TRIAL e tem a última fatura fechada paga ou isenta, é ACTIVE
  // Para simplificar, vou buscar os billings fechados dos referidos
  const referralIds = dbUser.referrals.map(r => r.id);
  
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

  // Buscar os dados do ultimo billing pra saber se tá pago
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
  const referrals = dbUser.referrals.map(r => {
    let status: "TRIAL" | "ACTIVE" | "INACTIVE" = "INACTIVE";
    
    const isTrial = r.trialEndsAt ? new Date(r.trialEndsAt) > now : false;
    if (isTrial) {
      status = "TRIAL";
    } else {
      const billing = billingStatusMap.get(r.id);
      if (billing) {
        // Se pagou tudo (amountPending <= 0), tá ativo. Senão inativo.
        if (billing.amountPending <= 0) {
          status = "ACTIVE";
        }
      } else {
        // Se o trial expirou e nao tem fatura fechada ainda (pode estar no meio do mes)
        // Assume INACTIVE até pagar algo
        status = "INACTIVE";
      }
    }

    return {
      id: r.id,
      storeName: r.storeName,
      storePhone: r.storePhone,
      createdAt: r.createdAt.toISOString(),
      status
    };
  });

  return (
    <IndiqueEGanheClient 
      userId={dbUser.id}
      userSlug={dbUser.slug}
      asaasWalletId={dbUser.asaasWalletId}
      referrals={referrals}
    />
  );
}
