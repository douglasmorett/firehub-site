import { NextRequest, NextResponse } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/cron/jotaja-poll
 * Vercel Cron Job — runs every minute to poll Jotajá (Open Delivery) events.
 * MULTI-TENANT: Itera sobre TODAS as lojas com jotajaConnected=true e faz
 * polling individual com as credenciais de cada uma.
 * Protected by CRON_SECRET.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // Verify cron secret (only if CRON_SECRET is configured)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV !== "development" && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startTime = Date.now();
  const log: string[] = [];

  try {
    // ── MULTI-TENANT: Buscar todas as lojas ativas com Jotajá ──────────
    const stores = await prisma.user.findMany({
      where: {
        jotajaConnected: true,
        NOT: [
          { jotajaClientId: null },
          { jotajaClientSecret: null },
          { email: { startsWith: "deleted_" } },
        ],
      },
      select: {
        id: true,
        email: true,
        storeName: true,
        ownerId: true,
        jotajaMerchantId: true,
      },
    });

    // Fallback: se nenhuma loja tem credenciais no banco, usar env vars
    // (compatibilidade com configuração atual onde credenciais estão no .env)
    const envClientId = process.env.JOTAJA_CLIENT_ID;
    const envClientSecret = process.env.JOTAJA_CLIENT_SECRET;

    if (stores.length === 0 && envClientId && envClientSecret) {
      // Buscar a primeira loja com jotajaConnected = true (sem credenciais no banco)
      const fallbackStore = await prisma.user.findFirst({
        where: { jotajaConnected: true, NOT: { email: { startsWith: "deleted_" } } },
        select: { id: true, email: true, storeName: true, ownerId: true, jotajaMerchantId: true },
      });
      if (fallbackStore) {
        stores.push(fallbackStore as any);
        log.push(`⚠️ Usando credenciais ENV para ${fallbackStore.storeName || fallbackStore.email} (sem clientId no banco)`);
      }
    }

    if (stores.length === 0) {
      log.push("ℹ️ Nenhuma loja com Jotajá ativo encontrada");
      return NextResponse.json({ ok: true, events: 0, log, durationMs: Date.now() - startTime });
    }

    log.push(`ℹ️ ${stores.length} loja(s) ativa(s) com Jotajá`);

    let totalCreated = 0, totalUpdated = 0, totalDisputes = 0, totalCancelled = 0;
    let totalEvents = 0, totalAcknowledged = 0;

    // ── Polling PER-STORE ──────────────────────────────────────────────
    for (const store of stores) {
      const storeId = store.ownerId || store.id;
      const storeName = store.storeName || store.email;

      try {
        const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");

        // Autenticar com as credenciais DESTA loja
        let res: Response;
        try {
          res = await jotajaFetch("/v1/events:polling", { method: "GET" }, storeId);
        } catch (err: any) {
          log.push(`❌ [${storeName}] Polling falhou: ${err.message}`);
          continue;
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          log.push(`❌ [${storeName}] events:polling: ${res.status} — ${errBody.slice(0, 200)}`);
          continue;
        }

        const eventsText = await res.text();
        const events = eventsText ? JSON.parse(eventsText) : [];

        if (!events || events.length === 0) {
          log.push(`✅ [${storeName}] 0 eventos`);
          continue;
        }

        totalEvents += events.length;
        log.push(`📥 [${storeName}] ${events.length} evento(s)`);

        // Process events for THIS store
        const processedEventIds: { id: string; orderId: string; eventType: string }[] = [];

        for (const event of events) {
          const result = await processJotajaEvent(event, 
            (path: string, opts?: RequestInit) => jotajaFetch(path, opts, storeId),
            (path: string, opts?: RequestInit) => jotajaMutate(path, opts, storeId),
            storeId
          );
          log.push(`  ${result.action === "error" ? "❌" : result.action === "created" ? "✅" : "🔄"} ${result.action} — ${result.orderId}${result.message ? ": " + result.message : ""}`);

          const eid = event.eventId || event.id;
          if (result.action !== "error" && eid) {
            processedEventIds.push({
              id: eid,
              orderId: event.orderId || "",
              eventType: event.eventType || event.fullCode || event.code || "",
            });
          }
          if (result.action === "created")   totalCreated++;
          if (result.action === "updated")   totalUpdated++;
          if (result.action === "dispute")   totalDisputes++;
          if (result.action === "cancelled") totalCancelled++;
        }

        // Acknowledge processed events for THIS store
        if (processedEventIds.length > 0) {
          try {
            const ackRes = await jotajaMutate("/v1/events/acknowledgment", {
              method: "POST",
              body: JSON.stringify(processedEventIds),
            }, storeId);
            if (ackRes.ok) {
              log.push(`✅ [${storeName}] ${processedEventIds.length} acknowledged`);
              totalAcknowledged += processedEventIds.length;
            } else {
              const ackBody = await ackRes.text().catch(() => "");
              log.push(`⚠️ [${storeName}] Acknowledge ${ackRes.status}: ${ackBody.slice(0, 200)}`);
            }
          } catch (ackErr: any) {
            log.push(`⚠️ [${storeName}] Acknowledge falhou: ${ackErr.message}`);
          }
        }
      } catch (storeErr: any) {
        log.push(`❌ [${storeName}] Erro geral: ${storeErr.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      stores: stores.length,
      events: totalEvents,
      created: totalCreated,
      updated: totalUpdated,
      disputes: totalDisputes,
      cancelled: totalCancelled,
      acknowledged: totalAcknowledged,
      durationMs: Date.now() - startTime,
      log,
    });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    console.error("[Jotajá Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
