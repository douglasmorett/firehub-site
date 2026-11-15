/**
 * GET /api/cron/robo-parado — de hora em hora (scripts/cron-runner.js).
 * Religa o robô que desligamos se a loja voltou a vender, e desliga o da loja
 * que está há 7 dias sem pedido, fora do teste (regra em src/lib/robo-parado.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { SQL_DESLIGAR_ROBO, SQL_RELIGAR_ROBO, SQL_ROBOS_PARADOS, SQL_ROBOS_QUE_VOLTARAM } from "@/lib/robo-parado";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const voltaram = await prisma.$queryRawUnsafe<{ id: string; storeName: string | null }[]>(SQL_ROBOS_QUE_VOLTARAM);
  for (const loja of voltaram) {
    await prisma.$executeRawUnsafe(SQL_RELIGAR_ROBO, loja.id);
    console.log(`[Robô parado] religado: ${loja.storeName || loja.id} (voltou a vender)`);
  }
  const lojas = await prisma.$queryRawUnsafe<{ id: string; storeName: string | null }[]>(SQL_ROBOS_PARADOS);
  for (const loja of lojas) {
    await prisma.$executeRawUnsafe(SQL_DESLIGAR_ROBO, loja.id);
    console.log(`[Robô parado] desligado: ${loja.storeName || loja.id} (7 dias sem pedido)`);
  }
  return NextResponse.json({
    ok: true,
    religados: voltaram.map((l) => l.storeName || l.id),
    desligados: lojas.map((l) => l.storeName || l.id),
  });
}
