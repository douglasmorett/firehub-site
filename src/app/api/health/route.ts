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

  // ── O schema declara colunas que o banco tem? ────────────────────────────
  //
  // A pior falha deste projeto é muda: campo declarado no schema.prisma sem a
  // coluna correspondente no banco faz o Prisma montar SELECT com ela, e TODA
  // consulta àquela tabela passa a servir 500 — foi assim que /loja caiu duas
  // vezes. O boot cria as colunas (src/lib/garantir-colunas.ts), mas até agora
  // não havia como saber, de fora, se ele conseguiu.
  //
  // Fica FORA do `allOk` de propósito: devolver 503 aqui faria o Coolify e o
  // monitor externo tratarem como app fora do ar e reiniciarem o container em
  // laço, o que não conserta coluna nenhuma. Isto é diagnóstico, não semáforo.
  let esquema: { ok: boolean; faltando: string[]; erro?: string };
  try {
    const ESPERADAS: [string, string][] = [
      ["StockTransaction", "stockLotId"], ["StockTransaction", "franchiseeId"],
      ["StockTransaction", "userId"], ["StockTransaction", "sourceRef"],
      ["KitchenItem", "stockItemId"], ["KitchenItem", "labelSize"],
      ["User", "labelFieldsConfig"], ["StockItem", "active"],
      ["MenuProduct", "priceSalao"], ["MenuProduct", "priceDelivery"],
      ["ComboGroupItem", "additionalPriceSalao"], ["ComboGroupItem", "additionalPriceDelivery"],
    ];
    const cols = await prisma.$queryRaw<{ tabela: string; coluna: string }[]>`
      SELECT table_name AS tabela, column_name AS coluna FROM information_schema.columns
      WHERE table_schema = current_schema()
    `;
    const tem = new Set(cols.map((c) => `${c.tabela}.${c.coluna}`));
    const faltando = ESPERADAS.filter(([t, c]) => !tem.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);

    const tabelas = await prisma.$queryRaw<{ t: string }[]>`
      SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name IN ('StockLot', 'CashMovement')
    `;
    const temTabela = new Set(tabelas.map((r) => r.t));
    for (const t of ["StockLot", "CashMovement"]) if (!temTabela.has(t)) faltando.push(`tabela ${t}`);

    esquema = { ok: faltando.length === 0, faltando };
  } catch (e: any) {
    esquema = { ok: false, faltando: [], erro: String(e?.message || "").slice(0, 120) };
  }

  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      uptime: uptimeSeconds,
      memory: `${heapUsedMB}MB / ${heapTotalMB}MB`,
      esquema,
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
