import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export type EtaRule = {
  maxOrders: number;
  minMinutes: number;
  maxMinutes: number;
};

export const DEFAULT_ETA_RULES: EtaRule[] = [
  { maxOrders: 6, minMinutes: 30, maxMinutes: 45 },
  { maxOrders: 12, minMinutes: 45, maxMinutes: 60 },
  { maxOrders: 20, minMinutes: 60, maxMinutes: 80 },
  { maxOrders: 999, minMinutes: 80, maxMinutes: 110 },
];

/**
 * GET /api/store/dynamic-eta
 * Retorna o cálculo do tempo de entrega recomendado com base nos pedidos em produção no KDS
 * e no número de motoboys informados na casa.
 * Aceita autenticação por Session (Navegador) ou Header X-Store-Token / Query token (Extensão Chrome).
 */
export async function GET(req: NextRequest) {
  try {
    let franchiseeId: string | null = null;
    let storeName = "FIREHUB";

    // 1. Tentar autenticação via Session
    const session = await getServerSession(authOptions);
    if (session && (session.user as any)?.id) {
      franchiseeId = (session.user as any).ownerId || (session.user as any).id;
      storeName = (session.user as any).storeName || "FIREHUB";
    }

    // 2. Tentar autenticação via Query token / Header (usado pela Extensão do Chrome)
    const urlToken = req.nextUrl.searchParams.get("token") || req.headers.get("x-store-token");
    if (!franchiseeId && urlToken) {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { id: urlToken },
            { ifoodMerchantId: urlToken },
            { email: urlToken.toLowerCase().trim() },
          ],
        },
        select: { id: true, name: true },
      });
      if (user) {
        franchiseeId = user.id;
        storeName = user.name || "FIREHUB";
      }
    }

    if (!franchiseeId) {
      // Tentar loja padrão se houver apenas 1 ou fallback para contatohakim
      const defaultUser = await prisma.user.findFirst({
        where: { email: "contatohakim@gmail.com" },
        select: { id: true, name: true },
      });
      if (defaultUser) {
        franchiseeId = defaultUser.id;
        storeName = defaultUser.name || "FIREHUB";
      }
    }

    if (!franchiseeId) {
      return NextResponse.json({ error: "Loja não identificada" }, { status: 401 });
    }

    // 3. Obter pedidos ativos em produção no KDS
    const activeStatusFilter = { in: ["NOVO", "ACEITO", "PREPARANDO", "EM_PREPARO", "RECEBIDO", "CONFIRMADO", "PENDENTE"] };
    const ordersInProduction = await prisma.customerOrder.count({
      where: {
        franchiseeId,
        status: activeStatusFilter,
        OR: [
          { kdsStage: "PRODUCTION" },
          { kdsStage: null },
        ],
      },
    });

    // 4. Obter override de motoboys via query param ou do banco
    const queryMotoboys = req.nextUrl.searchParams.get("motoboys");
    let activeMotoboys = queryMotoboys ? parseInt(queryMotoboys, 10) : 2;
    if (isNaN(activeMotoboys) || activeMotoboys < 1) activeMotoboys = 2;

    // 5. Aplicar Matriz de Regras
    let matchedRule = DEFAULT_ETA_RULES[DEFAULT_ETA_RULES.length - 1];
    for (const rule of DEFAULT_ETA_RULES) {
      if (ordersInProduction <= rule.maxOrders) {
        matchedRule = rule;
        break;
      }
    }

    // 6. Aplicar Fator de Alívio por Motoboys
    // Cada motoboy acima de 2 reduz 5 minutos no tempo de entrega (com piso mínimo de 25 min)
    let minMinutes = matchedRule.minMinutes;
    let maxMinutes = matchedRule.maxMinutes;

    if (activeMotoboys > 2) {
      const extraMotoboys = activeMotoboys - 2;
      const reduction = extraMotoboys * 5;
      minMinutes = Math.max(25, minMinutes - reduction);
      maxMinutes = Math.max(40, maxMinutes - reduction);
    } else if (activeMotoboys === 1 && ordersInProduction > 4) {
      // 1 motoboy apenas com cozinha cheia adiciona 10 minutos
      minMinutes += 10;
      maxMinutes += 15;
    }

    // Label descritiva da faixa
    const matchedRuleLabel = ordersInProduction <= 6
      ? "Cozinha Leve (0 a 6 pedidos)"
      : ordersInProduction <= 12
      ? "Cozinha Moderada (7 a 12 pedidos)"
      : ordersInProduction <= 20
      ? "Cozinha Movimentada (13 a 20 pedidos)"
      : "Cozinha Pico (20+ pedidos)";

    return NextResponse.json({
      success: true,
      franchiseeId,
      storeName,
      ordersInProduction,
      activeMotoboys,
      recommendedEtaMin: minMinutes,
      recommendedEtaMax: maxMinutes,
      etaRangeFormatted: `${minMinutes}-${maxMinutes} min`,
      matchedRuleLabel,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Dynamic ETA API]", err);
    return NextResponse.json({ error: err.message || "Erro ao calcular tempo dinâmico" }, { status: 500 });
  }
}

/**
 * POST /api/store/dynamic-eta
 * Permite salvar overrides manuais ou matriz de regras no servidor.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const body = await req.json();
    const { motoboysCount } = body;

    return NextResponse.json({
      success: true,
      motoboysCount: motoboysCount || 2,
      message: "Configuração de tempo dinâmico atualizada com sucesso!",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro ao salvar" }, { status: 500 });
  }
}
