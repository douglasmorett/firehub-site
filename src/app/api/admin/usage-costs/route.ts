import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAllUsageSummaries } from '@/lib/usage-tracker';
import { rateioInfra, CUSTO_INFRA_MENSAL_BRL, SERVICOS_PAGOS } from '@/lib/custos-plataforma';

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

    // ── QUEM É LOJA, DE VERDADE ──────────────────────────────────────────────
    //
    // O filtro era `role != 'ADMIN'`, e isso varria a tabela User inteira: as
    // contas com role DELETED (o soft-delete de store/team), os STAFF (que são
    // funcionários de uma loja, não uma loja) e os funcionários vinculados por
    // ownerId. Cada uma dessas linhas ganhava R$ 29,90 de "custo" e entrava no
    // total da plataforma como prejuízo.
    const franchisees = await prisma.user.findMany({
      where: {
        role: 'FRANCHISEE',   // exclui ADMIN, DELETED e STAFF
        ownerId: null,        // exclui funcionário vinculado a uma loja
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

    // ── CARGA REAL DE CADA LOJA ──────────────────────────────────────────────
    //
    // Pedidos processados no mês é o que determina consumo de banco e servidor.
    // É por essa proporção que a infraestrutura é rateada — em vez do valor fixo
    // por cabeça, que cobrava o mesmo de quem fez 3.997 pedidos e de quem fez 1.
    const inicioMes = new Date(`${yearMonth}-01T00:00:00.000Z`);
    const fimMes = new Date(inicioMes);
    fimMes.setUTCMonth(fimMes.getUTCMonth() + 1);

    const pedidosPorLoja = await prisma.customerOrder.groupBy({
      by: ['franchiseeId'],
      _count: { id: true },
      where: { createdAt: { gte: inicioMes, lt: fimMes } },
    });
    const pedidosDe = new Map(
      pedidosPorLoja.map((p) => [p.franchiseeId, p._count.id])
    );
    const pedidosNoMes = pedidosPorLoja.reduce((s, p) => s + p._count.id, 0);

    let totalGlobalRevenue = 0;
    let totalGlobalCosts = 0;

    const lojistas = franchisees.map((franchisee) => {
      const usage = usageData.get(franchisee.id);
      const billing = billingByFranchisee.get(franchisee.id);

      const pedidos = pedidosDe.get(franchisee.id) || 0;
      // Loja sem pedido no mês não rateia infraestrutura: ela não consumiu
      // banco nem servidor. Antes recebia R$ 29,90 e aparecia dando prejuízo.
      const hosting = rateioInfra(pedidos, pedidosNoMes);

      const costs = {
        whatsapp: 0, // Baileys self-hosted — sem custo por conversa
        whatsappMessages: usage?.whatsapp.messages || 0,
        geminiChat: usage?.geminiChat.cost || 0,
        geminiTokens: usage?.geminiChat.tokens || 0,
        geminiCalls: usage?.geminiChat.calls || 0,
        geminiVision: usage?.geminiVision.cost || 0,
        geminiVisionCalls: usage?.geminiVision.calls || 0,
        hosting,
        orders: pedidos,
        total: (usage?.geminiChat.cost || 0) + (usage?.geminiVision.cost || 0) + hosting,
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
        // Sem pedido no mês a loja não gera custo nem receita. Marcar em vez de
        // esconder: é assim que se enxerga conta parada ocupando cadastro.
        ativa: pedidos > 0,
        orders: pedidos,
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
        // O que a plataforma paga de fato, para conferir contra o rateio acima.
        infraMensal: CUSTO_INFRA_MENSAL_BRL,
        pedidosNoMes,
        lojasAtivas: lojistas.filter((l) => l.ativa).length,
        lojasCadastradas: lojistas.length,
      },
      // A lista de serviços vai junto para o painel poder mostrar de onde sai
      // cada centavo do custo, em vez de um total sem origem.
      servicos: SERVICOS_PAGOS,
      lojistas,
    });
  } catch (error) {
    console.error('Erro ao buscar custos de uso:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
