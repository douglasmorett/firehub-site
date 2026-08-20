import { NextRequest, NextResponse } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";

/**
 * GET /api/cron/jotaja-poll
 * Cron Job — runs every minute to poll Jotajá (Open Delivery) events.
 * MULTI-TENANT: Itera sobre TODAS as lojas com jotajaConnected=true e faz
 * polling individual com as credenciais de cada uma.
 * Protected by CRON_SECRET (bypass para chamadas internas do cron-runner).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const MAX_SAFE_MS = 50_000; // leave 5s buffer for cleanup
  const hasTimeLeft = () => Date.now() - startTime < MAX_SAFE_MS;
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

    // Fallback: se nenhuma loja tem credenciais no banco, usar env vars do Hakim
    const envClientId = process.env.JOTAJA_CLIENT_ID;
    const envClientSecret = process.env.JOTAJA_CLIENT_SECRET;
    const envMerchantId = process.env.JOTAJA_MERCHANT_ID || "14800";

    if (stores.length === 0 && envClientId && envClientSecret) {
      // Buscar explicitamente a loja do Hakim
      const fallbackStore = await prisma.user.findFirst({
        where: {
          OR: [
            { email: "contatohakim@gmail.com" },
            { jotajaMerchantId: envMerchantId }
          ],
          NOT: { email: { startsWith: "deleted_" } }
        },
        select: { id: true, email: true, storeName: true, ownerId: true, jotajaMerchantId: true },
      });
      if (fallbackStore) {
        stores.push(fallbackStore as any);
        log.push(`⚠️ Usando credenciais ENV para ${fallbackStore.storeName || fallbackStore.email}`);
      }
    }

    if (stores.length === 0) {
      log.push("ℹ️ Nenhuma loja com Jotajá ativo encontrada");
      return NextResponse.json({ ok: true, events: 0, log, durationMs: Date.now() - startTime });
    }

    log.push(`ℹ️ ${stores.length} loja(s) ativa(s) com Jotajá`);

    let totalCreated = 0, totalUpdated = 0, totalDisputes = 0, totalCancelled = 0;
    let totalEvents = 0, totalAcknowledged = 0, reconciled = 0;

    // ── Polling PARALELO PER-STORE ───────────────────────────────────
    const CHUNK_SIZE = 5;
    for (let i = 0; i < stores.length; i += CHUNK_SIZE) {
      if (!hasTimeLeft()) {
        log.push(`⏱️ Timeout guard — ${stores.length - i} loja(s) restantes serão processadas no próximo ciclo`);
        break;
      }
      const chunk = stores.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(chunk.map(async (store) => {
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
            return;
          }

          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            log.push(`❌ [${storeName}] events:polling: ${res.status} — ${errBody.slice(0, 200)}`);
            return;
          }

          const eventsText = await res.text();
          let events: any[] = [];
          try {
            events = eventsText ? JSON.parse(eventsText) : [];
            if (!Array.isArray(events)) events = [events];
          } catch (parseErr) {
            log.push(`❌ [${storeName}] Resposta inválida (não é JSON): ${eventsText.slice(0, 100)}`);
            return;
          }

          if (!events || events.length === 0) {
            log.push(`✅ [${storeName}] 0 eventos`);
          } else {
            totalEvents += events.length;
            log.push(`📥 [${storeName}] ${events.length} evento(s)`);

            // Process events for THIS store — acknowledge IMMEDIATELY per-event
            for (const event of events) {
              if (!hasTimeLeft()) {
                log.push(`⏱️ [${storeName}] Timeout guard — parando processamento (${events.length - events.indexOf(event)} eventos restantes)`);
                break;
              }

              const result = await processJotajaEvent(event, 
                (path: string, opts?: RequestInit) => jotajaFetch(path, opts, storeId),
                (path: string, opts?: RequestInit) => jotajaMutate(path, opts, storeId),
                storeId
              );
              log.push(`  ${result.action === "error" ? "❌" : result.action === "created" ? "✅" : "🔄"} ${result.action} — ${result.orderId}${result.message ? ": " + result.message : ""}`);

              // Acknowledge IMEDIATAMENTE após sucesso — impede acúmulo de eventos
              const eid = event.eventId || event.id;
              if (result.action !== "error" && eid) {
                try {
                  await jotajaMutate("/v1/events/acknowledgment", {
                    method: "POST",
                    body: JSON.stringify([{
                      id: eid,
                      orderId: event.orderId || "",
                      eventType: event.eventType || event.fullCode || event.code || "",
                    }]),
                  }, storeId);
                  totalAcknowledged++;
                } catch {}
              }
              if (result.action === "created")   totalCreated++;
              if (result.action === "updated")   totalUpdated++;
              if (result.action === "dispute")   totalDisputes++;
              if (result.action === "cancelled") totalCancelled++;
            }

            // ── RECONCILIAÇÃO PROATIVA PER-STORE ──────────────────────────
            if (hasTimeLeft()) {
              try {
                const activeRes = await jotajaFetch("/v1/orders?status=CONFIRMED,PLACED,IN_PREPARATION,READY_TO_PICKUP,DISPATCHED", {}, storeId);
                if (activeRes.ok) {
                  const activeText = await activeRes.text().catch(() => "");
                  const activeOrders = activeText ? JSON.parse(activeText) : [];
                  const orderList = Array.isArray(activeOrders) ? activeOrders : (activeOrders.orders ?? activeOrders.data ?? []);

                  for (const jjOrder of orderList) {
                    if (!hasTimeLeft()) break;
                    const jjId = jjOrder.id || jjOrder.orderId;
                    if (!jjId) continue;

                    const existsLocally = await prisma.customerOrder.findFirst({
                      where: {
                        OR: [
                          { openDeliveryOrderId: jjId },
                          { openDeliveryOrderId: { startsWith: `${jjId}_` } },
                          (jjOrder.displayId || jjOrder.orderSeqNumber)
                            ? { openDeliveryReference: jjOrder.displayId || jjOrder.orderSeqNumber, franchiseeId: storeId }
                            : undefined,
                        ].filter(Boolean)
                      } as any,
                      select: { id: true },
                    });

                    if (!existsLocally) {
                      log.push(`🛟 [${storeName}] RECONCILIAÇÃO: Pedido ${jjId} ausente — importando...`);
                      const syntheticEvent = { orderId: jjId, eventType: "CREATED", code: "PLC" };
                      const result = await processJotajaEvent(
                        syntheticEvent,
                        (path: string, opts?: RequestInit) => jotajaFetch(path, opts, storeId),
                        (path: string, opts?: RequestInit) => jotajaMutate(path, opts, storeId),
                        storeId
                      );
                      if (result.action === "created") {
                        reconciled++;
                        log.push(`  ✅ [${storeName}] Pedido ${jjId} RECUPERADO!`);
                      } else {
                        log.push(`  ⚠️ [${storeName}] Pedido ${jjId}: ${result.action} — ${result.message}`);
                      }
                    }
                  }
                } else {
                  log.push(`⚠️ [${storeName}] Reconciliação: GET /v1/orders retornou ${activeRes.status}`);
                }
              } catch (reconcileErr: any) {
                log.push(`⚠️ [${storeName}] Reconciliação falhou: ${reconcileErr.message}`);
              }
            }
          }
        } catch (storeErr: any) {
          log.push(`❌ [${storeName}] Erro geral: ${storeErr.message}`);
        }
      }));
      // Collect results from settled promises
      for (const result of results) {
        if (result.status === 'rejected') {
          log.push(`❌ Erro assíncrono em loja: ${result.reason?.message}`);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      events: totalEvents,
      created: totalCreated,
      updated: totalUpdated,
      disputes: totalDisputes,
      cancelled: totalCancelled,
      acknowledged: totalAcknowledged,
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
