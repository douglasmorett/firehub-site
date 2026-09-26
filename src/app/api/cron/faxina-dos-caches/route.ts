/**
 * GET /api/cron/faxina-dos-caches — uma vez por dia (scripts/cron-runner.js).
 *
 * Apaga do GeocodeCache e do RotaCache o que ninguém usa há 90 dias, para os
 * caches do mapa não crescerem com o uso para sempre. A regra e o porquê estão
 * em src/lib/faxina-dos-caches.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { faxinaDosCaches } from "@/lib/faxina-dos-caches";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const apagados = await faxinaDosCaches((sql) => prisma.$executeRawUnsafe(sql));
  return NextResponse.json({ ok: true, apagados });
}
