/**
 * GET /api/health
 * Health check endpoint para monitoramento externo (UptimeRobot, Coolify, etc.)
 * Verifica: servidor, banco de dados e conectividade.
 * Retorna 200 se tudo ok, 503 se algo falhar.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};
  const start = Date.now();

  // 1. Database check
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, ms: Date.now() - dbStart };
  } catch (e: any) {
    checks.database = { ok: false, error: e.message?.substring(0, 100) };
  }

  // 2. Memory check
  const mem = process.memoryUsage();
  const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
  checks.memory = { ok: heapUsedMB < 512, ms: heapUsedMB }; // ms field reused for MB

  // 3. Uptime
  const uptimeSeconds = Math.round(process.uptime());

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      uptime: uptimeSeconds,
      memory: `${heapUsedMB}MB / ${heapTotalMB}MB`,
      checks,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - start,
    },
    { 
      status: allOk ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
