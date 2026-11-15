/**
 * GET /api/cron/robo-parado — uma vez por dia (scripts/cron-runner.js).
 * Desliga o robô da loja que está há 7 dias sem pedido, fora do teste
 * (regra e porquê em src/lib/robo-parado.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { SQL_DESLIGAR_ROBO, SQL_ROBOS_PARADOS } from "@/lib/robo-parado";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const lojas = await prisma.$queryRawUnsafe<{ id: string; storeName: string | null }[]>(SQL_ROBOS_PARADOS);
  for (const loja of lojas) {
    await prisma.$executeRawUnsafe(SQL_DESLIGAR_ROBO, loja.id);
    console.log(`[Robô parado] desligado: ${loja.storeName || loja.id} (7 dias sem pedido)`);
  }
  return NextResponse.json({ ok: true, desligados: lojas.map((l) => l.storeName || l.id) });
}
