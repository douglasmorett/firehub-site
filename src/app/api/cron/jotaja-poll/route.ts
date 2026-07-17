import { NextRequest, NextResponse } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";

/**
 * GET /api/cron/jotaja-poll
 * Vercel Cron Job — runs every minute to poll Jotajá (Open Delivery) events.
 * Ensures orders are never missed, even when no dashboard is open.
 * Protected by CRON_SECRET.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV !== "development") {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }


  const startTime = Date.now();
  const log: string[] = [];

  try {
    const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");
    const merchantId = process.env.JOTAJA_MERCHANT_ID;

    if (!merchantId) {
      log.push("❌ JOTAJA_MERCHANT_ID não configurado");
      return NextResponse.json({ ok: false, log });
    }

    // Poll events from Jotajá via Open Delivery
    let res: Response;
    try {
      res = await jotajaFetch("/v1/events:polling");
      log.push("✅ Polling realizado");
    } catch (err: any) {
      log.push(`❌ Polling falhou: ${err.message}`);
      return NextResponse.json({ ok: false, log });
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      log.push(`❌ events:polling falhou: ${res.status} ${res.statusText} — ${errBody.slice(0, 200)}`);
      return NextResponse.json({ ok: false, log });
    }

    const eventsText = await res.text();
    const events = eventsText ? JSON.parse(eventsText) : [];
    log.push(`📥 ${events.length} evento(s) recebido(s)`);

    if (!events || events.length === 0) {
      return NextResponse.json({ ok: true, events: 0, log, durationMs: Date.now() - startTime });
    }

    // Process events using shared lib
    const processedEvents: { id: string; orderId: string; eventType: string }[] = [];
    let created = 0, updated = 0, disputes = 0, cancelled = 0;

    for (const event of events) {
      const result = await processJotajaEvent(event, jotajaFetch, jotajaMutate);
      log.push(`  ${result.action === "error" ? "❌" : result.action === "created" ? "✅" : "🔄"} ${result.action} — ${result.orderId}${result.message ? ": " + result.message : ""}`);

      if (result.action !== "error" && result.action !== "skipped") {
        const eid = event.id || event.eventId;
        if (eid) {
          processedEvents.push({
            id: eid,
            orderId: event.orderId || "",
            eventType: event.fullCode || event.code || "",
          });
        }
        if (result.action === "created")   created++;
        if (result.action === "updated")   updated++;
        if (result.action === "dispute")   disputes++;
        if (result.action === "cancelled") cancelled++;
      }
    }

    // Acknowledge processed events
    if (processedEvents.length > 0) {
      try {
        await jotajaMutate("/v1/events/acknowledgment", {
          method: "POST",
          body: JSON.stringify(processedEvents),
        });
        log.push(`✅ ${processedEvents.length} eventos acknowledged`);
      } catch (ackErr: any) {
        log.push(`⚠️ Acknowledgment falhou: ${ackErr.message}`);
      }
    }

    return NextResponse.json({
      ok: true,
      events: events.length,
      created, updated, disputes, cancelled,
      acknowledged: processedEvents.length,
      durationMs: Date.now() - startTime,
      log,
    });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    console.error("[Jotajá Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
