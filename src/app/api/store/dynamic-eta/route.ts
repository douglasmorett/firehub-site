import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/store/dynamic-eta
 * Implementa rigorosamente a tabela oficial "Planilha prazos de entrega Hakim":
 *  - 1 Motoboy: 38m (até 2 ped), 58m (até 3 ped), 78m (até 4 ped), > 4 ped ➔ Fechar 40m
 *  - 2 Motoboys: 38m (até 4 ped), 58m (até 6 ped), 78m (até 8 ped), > 8 ped ➔ Fechar 40m
 *  - 3 Motoboys: 38m (até 6 ped), 58m (até 9 ped), 78m (até 12 ped), > 12 ped ➔ Fechar 40m
 *  - 4 Motoboys: 38m (até 8 ped), 58m (até 12 ped), 78m (até 16 ped), > 16 ped ➔ Fechar 40m
 *  - 5 Motoboys: 38m (até 10 ped), 58m (até 15 ped), 78m (até 20 ped), > 20 ped ➔ Fechar 40m
 *  - 6 Motoboys: 38m (até 12 ped), 58m (até 18 ped), 78m (até 24 ped), > 24 ped ➔ Fechar 40m
 * Formula Geral para M motoboys:
 *  - Até 2*M ped: 38 min
 *  - Até 3*M ped: 58 min
 *  - Até 4*M ped: 78 min
 *  - Acima de 4*M ped: ALERTA DE CRÍTICO ➔ Fechar a loja por 40 min!
 */
export async function GET(req: NextRequest) {
  try {
    let franchiseeId: string | null = null;
    let storeName = "FIREHUB";

    const session = await getServerSession(authOptions);
    if (session && (session.user as any)?.id) {
      franchiseeId = (session.user as any).ownerId || (session.user as any).id;
      storeName = (session.user as any).storeName || "FIREHUB";
    }

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

    const mode = req.nextUrl.searchParams.get("mode") || "auto";

    // ── MODO MANUAL (Override direto) ──
    if (mode === "manual") {
      const manualOrders = parseInt(req.nextUrl.searchParams.get("orders") || "10", 10);
      const manualMinutes = parseInt(req.nextUrl.searchParams.get("minutes") || "58", 10);

      return NextResponse.json({
        success: true,
        mode: "manual",
        franchiseeId,
        storeName,
        ordersInProduction: manualOrders,
        activeMotoboys: null,
        recommendedMinutes: manualMinutes,
        etaRangeFormatted: `${manualMinutes} min`,
        shouldPauseStore: false,
        pauseMinutes: 0,
        matchedRuleLabel: `Modo Manual (${manualOrders} ped. ➔ ${manualMinutes} min)`,
        updatedAt: new Date().toISOString(),
      });
    }

    // ── MODO AUTOMÁTICO (Tabela Oficial Hakim) ──
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

    const queryMotoboys = req.nextUrl.searchParams.get("motoboys");
    let activeMotoboys = queryMotoboys ? parseInt(queryMotoboys, 10) : 2;
    if (isNaN(activeMotoboys) || activeMotoboys < 1) activeMotoboys = 1;

    // Cálculo exato pela fórmula da Planilha Hakim:
    // Limite 38m = 2 * motoboys
    // Limite 58m = 3 * motoboys
    // Limite 78m = 4 * motoboys
    // Estourou (> 4 * motoboys) ➔ Fechar loja por 40 min

    const max38 = 2 * activeMotoboys;
    const max58 = 3 * activeMotoboys;
    const max78 = 4 * activeMotoboys;

    let recommendedMinutes = 38;
    let etaRangeFormatted = "38 min";
    let shouldPauseStore = false;
    let pauseMinutes = 0;
    let matchedRuleLabel = "";

    if (ordersInProduction <= max38) {
      recommendedMinutes = 38;
      etaRangeFormatted = "38 min";
      matchedRuleLabel = `Até ${max38} ped. (38 min)`;
    } else if (ordersInProduction <= max58) {
      recommendedMinutes = 58;
      etaRangeFormatted = "58 min";
      matchedRuleLabel = `Até ${max58} ped. (58 min)`;
    } else if (ordersInProduction <= max78) {
      recommendedMinutes = 78;
      etaRangeFormatted = "78 min";
      matchedRuleLabel = `Até ${max78} ped. (78 min)`;
    } else {
      // ESTOURO DE CAPACIDADE ➔ FECHAR LOJA POR 40 MIN!
      recommendedMinutes = 78;
      shouldPauseStore = true;
      pauseMinutes = 40;
      etaRangeFormatted = "⚠️ PAUSAR LOJA (40 MIN)";
      matchedRuleLabel = `🚨 Estourou (${ordersInProduction} > ${max78} ped.) ➔ Pausar 40m`;
    }

    return NextResponse.json({
      success: true,
      mode: "auto",
      franchiseeId,
      storeName,
      ordersInProduction,
      activeMotoboys,
      recommendedMinutes,
      etaRangeFormatted,
      shouldPauseStore,
      pauseMinutes,
      matchedRuleLabel,
      limits: { max38, max58, max78 },
      updatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[Dynamic ETA API]", err);
    return NextResponse.json({ error: err.message || "Erro ao calcular tempo dinâmico" }, { status: 500 });
  }
}
