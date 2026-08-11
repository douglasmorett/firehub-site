import { NextRequest, NextResponse } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/cron/jotaja-poll
 * Vercel Cron Job — runs every minute to poll Jotajá (Open Delivery) events.
 * Ensures orders are never missed, even when no dashboard is open.
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
    const { jotajaFetch, jotajaMutate, getJotajaMerchantId } = await import("@/lib/jotaja-api");
    const merchantId = getJotajaMerchantId();
    log.push(`ℹ️ Polling para MerchantId: ${merchantId}`);

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
    const processedEventIds: { id: string; orderId: string; eventType: string }[] = [];
    let created = 0, updated = 0, disputes = 0, cancelled = 0;

    for (const event of events) {
      const result = await processJotajaEvent(event, jotajaFetch, jotajaMutate);
      log.push(`  ${result.action === "error" ? "❌" : result.action === "created" ? "✅" : "🔄"} ${result.action} — ${result.orderId}${result.message ? ": " + result.message : ""}`);

      // Acknowledge ALL events (except errors) to clear the queue
      // Collect event data for acknowledgment (requires id + orderId + eventType)
      const eid = event.eventId || event.id;
      if (result.action !== "error" && eid) {
        processedEventIds.push({
          id: eid,
          orderId: event.orderId || "",
          eventType: event.eventType || event.fullCode || event.code || "",
        });
      }
      if (result.action === "created")   created++;
      if (result.action === "updated")   updated++;
      if (result.action === "dispute")   disputes++;
      if (result.action === "cancelled") cancelled++;
    }

    // Acknowledge processed events — format: [{id, orderId, eventType}]
    if (processedEventIds.length > 0) {
      try {
        const ackRes = await jotajaMutate("/v1/events/acknowledgment", {
          method: "POST",
          body: JSON.stringify(processedEventIds),
        });
        if (ackRes.ok) {
          log.push(`✅ ${processedEventIds.length} eventos acknowledged`);
        } else {
          const ackBody = await ackRes.text().catch(() => "");
          log.push(`⚠️ Acknowledge ${ackRes.status}: ${ackBody.slice(0, 200)}`);
        }
      } catch (ackErr: any) {
        log.push(`⚠️ Acknowledge falhou: ${ackErr.message}`);
      }
    }

    // ── RECONCILIAÇÃO PROATIVA: busca pedidos ativos no JotaJá que podem ter sido perdidos ──
    let reconciled = 0;
    try {
      const activeRes = await jotajaFetch("/v1/orders?status=CONFIRMED,PLACED,IN_PREPARATION,READY_TO_PICKUP,DISPATCHED").catch(() => null);
      if (activeRes && activeRes.ok) {
        const activeText = await activeRes.text().catch(() => "");
        const activeOrders = activeText ? JSON.parse(activeText) : [];
        const orderList = Array.isArray(activeOrders) ? activeOrders : (activeOrders.orders ?? activeOrders.data ?? []);

        for (const jjOrder of orderList) {
          const jjId = jjOrder.id || jjOrder.orderId;
          if (!jjId) continue;

          // Verifica se já existe localmente
          const existsLocally = await prisma.customerOrder.findFirst({
            where: {
              OR: [
                { openDeliveryOrderId: jjId },
                { openDeliveryOrderId: { startsWith: `${jjId}_` } },
                { openDeliveryReference: jjOrder.displayId || jjOrder.orderSeqNumber }
              ].filter(Boolean)
            } as any,
            select: { id: true },
          });

          if (!existsLocally) {
            // Pedido existe no JotaJá mas NÃO no banco local — IMPORTAR!
            log.push(`🛟 RECONCILIAÇÃO: Pedido ${jjId} encontrado no JotaJá mas ausente localmente — importando...`);
            const syntheticEvent = { orderId: jjId, eventType: "CREATED", code: "PLC" };
            const result = await processJotajaEvent(syntheticEvent, jotajaFetch, jotajaMutate);
            if (result.action === "created") {
              reconciled++;
              log.push(`  ✅ Pedido ${jjId} RECUPERADO com sucesso!`);
            } else {
              log.push(`  ⚠️ Pedido ${jjId}: ${result.action} — ${result.message}`);
            }
          }
        }
      } else if (activeRes) {
        log.push(`⚠️ Reconciliação: GET /v1/orders retornou ${activeRes.status}`);
      }
    } catch (reconcileErr: any) {
      log.push(`⚠️ Reconciliação falhou: ${reconcileErr.message}`);
    }

    return NextResponse.json({
      ok: true,
      events: events.length,
      created, updated, disputes, cancelled,
      acknowledged: processedEventIds.length,
      reconciled,
      durationMs: Date.now() - startTime,
      log,
    });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    console.error("[Jotajá Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
