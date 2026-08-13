import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAllUsageSummaries } from '@/lib/usage-tracker';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== 'ADMIN') {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    let yearMonth = searchParams.get('yearMonth');

    if (!yearMonth) {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      yearMonth = `${now.getFullYear()}-${month}`;
    }

    const usageData = await getAllUsageSummaries(yearMonth);
    
    const billingData = await prisma.franchiseeBillingCycle.findMany({
      where: { yearMonth },
    });
    const billingByFranchisee = new Map(billingData.map(b => [b.franchiseeId, b]));

    const franchisees = await prisma.user.findMany({
      where: {
        role: { not: 'ADMIN' }
      },
      select: {
        id: true,
        storeName: true,
        email: true,
        city: true,
        storePhone: true,
        isFranqueadoHakim: true,
      }
    });

    let totalGlobalRevenue = 0;
    let totalGlobalCosts = 0;

    const lojistas = franchisees.map((franchisee) => {
      const usage = usageData.get(franchisee.id);
      const billing = billingByFranchisee.get(franchisee.id);

      const HOSTING_FIXED_COST = 29.90;

      const costs = {
        whatsapp: 0, // Removido API Oficial
        whatsappMessages: usage?.whatsapp.messages || 0,
        geminiChat: usage?.geminiChat.cost || 0,
        geminiTokens: usage?.geminiChat.tokens || 0,
        geminiCalls: usage?.geminiChat.calls || 0,
        geminiVision: usage?.geminiVision.cost || 0,
        geminiVisionCalls: usage?.geminiVision.calls || 0,
        hosting: HOSTING_FIXED_COST,
        total: (usage?.geminiChat.cost || 0) + (usage?.geminiVision.cost || 0) + HOSTING_FIXED_COST,
      };

      const amountPaid = (billing?.amountDue || 0) - (billing?.amountPending || 0);
      const revenue = {
        totalSales: billing?.totalSales || 0,
        amountDue: billing?.amountDue || 0,
        amountPaid: Math.max(0, amountPaid),
      };

      const profit = revenue.amountDue - costs.total;
      const margin = revenue.amountDue > 0 ? (profit / revenue.amountDue) * 100 : 0;

      totalGlobalRevenue += revenue.amountDue;
      totalGlobalCosts += costs.total;

      return {
        id: franchisee.id,
        storeName: franchisee.storeName || 'Sem nome',
        email: franchisee.email || '',
        city: franchisee.city || null,
        revenue,
        costs,
        profit,
        margin,
      };
    });

    lojistas.sort((a, b) => b.costs.total - a.costs.total);

    const totalProfit = totalGlobalRevenue - totalGlobalCosts;
    const avgMargin = totalGlobalRevenue > 0 ? (totalProfit / totalGlobalRevenue) * 100 : 0;

    return NextResponse.json({
      yearMonth,
      totals: {
        totalRevenue: totalGlobalRevenue,
        totalCosts: totalGlobalCosts,
        totalProfit,
        avgMargin,
      },
      lojistas,
    });
  } catch (error) {
    console.error('Erro ao buscar custos de uso:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
