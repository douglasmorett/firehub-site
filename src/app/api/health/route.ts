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
      // O carimbo de complemento. Sem ele na lista, o monitor dizia `esquema: ok`
      // enquanto a coluna que decide o que aparece no cardapio podia nao existir —
      // e a regra cairia calada na heuristica, em todas as telas de venda.
      ["MenuProduct", "apenasEmCombo"],
      ["ComboGroupItem", "additionalPriceSalao"], ["ComboGroupItem", "additionalPriceDelivery"],
      // ── As 39 colunas garantidas por garantirColunasDoSchema() ──
      //
      // Esta lista existia com 12 pares e dizia `esquema: ok` enquanto faltava
      // coluna que derruba cardápio e pedido: ela só olhava para o que alguém
      // tinha lembrado de escrever aqui. Um buraco que o próprio monitor não vê
      // é pior que buraco nenhum, porque compra confiança que não existe.
      //
      // Quem mexer no schema.prisma acrescenta o par AQUI e a instrução em
      // src/lib/garantir-colunas.ts, no MESMO commit.
      ["User", "gaMeasurementId"], ["User", "gaApiSecret"],
      ["User", "gtmContainerId"], ["User", "etaConfig"],
      ["User", "onboardingData"], ["User", "metaIaSemanaReferencia"],
      ["User", "metaIaGeracoesUsadas"], ["User", "showAddressOnMenu"],
      ["CustomerOrder", "gaClientId"], ["CustomerOrder", "gaSessionId"],
      ["CustomerOrder", "acceptedAt"], ["CustomerOrder", "readyAt"],
      ["CustomerOrder", "dispatchedAt"], ["CustomerOrder", "deliveredAt"],
      ["CustomerOrder", "ifoodDropCodeAt"], ["CustomerOrder", "ifoodDropCodeRequired"],
      ["CustomerOrder", "posOrderId"], ["CustomerOrder", "posTerminalId"],
      ["CustomerOrder", "posStatus"], ["CustomerOrder", "posDadosTransacao"],
      ["CustomerOrder", "posTentativas"], ["CustomerOrder", "tableSessionId"],
      ["CustomerOrderItem", "notes"], ["CustomerOrderItem", "tableGuestId"],
      ["MenuProduct", "sortOrder"], ["ComboGroup", "minQty"],
      ["ComboGroupItem", "maxPerItem"], ["ComboGroupItem", "optionNote"],
      ["StoreCustomer", "birthDate"], ["TotemLicense", "posTerminalId"],
      ["Ambassador", "parentAmbassadorId"], ["Ambassador", "linkedUserId"],
      ["Ambassador", "level2Percent"],
      ["TableSession", "waiterId"], ["TableSession", "waiterTip"],
      ["TableSession", "waiterCommission"],
      ["PosTerminal", "deviceToken"], ["PosTerminal", "lastSeenAt"],
      ["PosTerminal", "appVersion"],
    ];
    const cols = await prisma.$queryRaw<{ tabela: string; coluna: string }[]>`
      SELECT table_name AS tabela, column_name AS coluna FROM information_schema.columns
      WHERE table_schema = current_schema()
    `;
    const tem = new Set(cols.map((c) => `${c.tabela}.${c.coluna}`));
    const faltando = ESPERADAS.filter(([t, c]) => !tem.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);

    // Tabelas inteiras que podem faltar. A lista da consulta e a da
    // conferencia eram duas — mexer numa e esquecer a outra passava batido.
    // Agora e uma so, e a consulta traz tudo para o Set filtrar aqui.
    const TABELAS_ESPERADAS = [
      "StockLot", "CashMovement",
      // Nasceram entre 15/08 e 03/09/2026 e nao tem CREATE TABLE em lugar
      // nenhum: se faltarem, quem conserta e gente rodando o push, nao o boot.
      "Table", "TableSession", "TableGuest", "Waiter",
      "PosTerminal", "DailyOrderCounter", "ChatbotConversationState",
    ];
    const tabelas = await prisma.$queryRaw<{ t: string }[]>`
      SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = current_schema()
    `;
    const temTabela = new Set(tabelas.map((r) => r.t));
    for (const t of TABELAS_ESPERADAS) if (!temTabela.has(t)) faltando.push(`tabela ${t}`);

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
