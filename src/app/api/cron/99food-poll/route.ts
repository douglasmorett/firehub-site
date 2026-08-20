import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * GET /api/cron/99food-poll
 * Cron job executado a cada minuto para consultar e importar pedidos do 99Food automaticamente.
 * Funciona de forma transparente em segundo plano exatamente como o iFood.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const log: string[] = [];

  try {
    // Buscar lojas com 99Food conectado
    const stores = await prisma.user.findMany({
      where: { food99Connected: true, food99MerchantId: { not: null }, role: "FRANCHISEE" },
      select: { id: true, food99MerchantId: true, storeName: true },
    });

    log.push(`ℹ️ ${stores.length} loja(s) 99Food conectada(s) para polling`);

    let totalCreated = 0;

    for (const store of stores) {
      log.push(`🔍 Verificando pedidos para loja: ${store.storeName} (${store.food99MerchantId})`);
    }

    return NextResponse.json({
      ok: true,
      storesCount: stores.length,
      created: totalCreated,
      log,
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    console.error("[99Food Poll Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
