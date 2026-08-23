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

    // MULTI-TENANT: Cada loja DEVE ter suas próprias credenciais no banco.
    // SEM fallback ENV — impede que lojas novas herdem credenciais do Hakim.

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

              // ── ACK só com o pedido confirmado no banco ────────────────────
              // O ACK apaga o evento do feed PARA SEMPRE, e o JotaJá não tem
              // endpoint de listagem (GET /v1/orders responde 404 "Cannot GET"),
              // então um ACK indevido é perda definitiva do pedido. Antes bastava
              // action !== "error": "skipped" também ackava, mesmo sem gravar nada.
              // Agora: se o evento diz respeito a um pedido, ele precisa existir.
              const eid = event.eventId || event.id;
              const podeAckar = await (async () => {
                if (result.action === "error") return false;
                if (!event.orderId) return true; // evento sem pedido (keepalive) — nada a conferir
                const gravado = await prisma.customerOrder.findFirst({
                  where: {
                    OR: [
                      { openDeliveryOrderId: event.orderId },
                      { openDeliveryOrderId: { startsWith: `${event.orderId}_` } },
                    ],
                  } as any,
                  select: { id: true },
                });
                if (!gravado) {
                  log.push(`  ⛔ [${storeName}] SEM ACK — ${result.action} não deixou pedido no banco (${event.orderId}); evento fica na fila para a próxima tentativa`);
                  console.error(`[Jotajá Cron] ⛔ SEM ACK ${event.orderId}: ${result.action} sem gravar (${result.message || "-"})`);
                  // Avisa no WhatsApp em vez de deixar a falha só no log do container.
                  import("@/lib/server-monitor")
                    .then(m => m.alertarFalhaDeIntegracao("JotaJá", storeName, `${result.action}: ${result.message || "pedido não gravado"}`))
                    .catch(() => {});
                  return false;
                }
                return true;
              })();

              if (podeAckar && eid) {
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
                } catch (ackErr: any) {
                  log.push(`  ⚠️ [${storeName}] ACK falhou para ${eid}: ${ackErr?.message}`);
                }
              }
              if (result.action === "created")   totalCreated++;
              if (result.action === "updated")   totalUpdated++;
              if (result.action === "dispute")   totalDisputes++;
              if (result.action === "cancelled") totalCancelled++;
            }

          }

          // ── RECONCILIAÇÃO PROATIVA PER-STORE ────────────────────────────
          // ⚠️ ESTAVA DENTRO DO `else` DO "0 eventos": a única rede de segurança
          // do sistema só rodava quando JÁ havia evento na fila — nunca no caso
          // em que ela seria necessária (pedido existe no JotaJá e o feed não o
          // entregou). Agora roda sempre, fora do if/else.
          //
          // ⚠️ 2: em 23/08/2026 foi verificado contra a API real que
          // `GET /v1/orders` NÃO EXISTE no JotaJá — responde 404 "Cannot GET
          // /openDelivery/v1/orders". O padrão Open Delivery não define
          // listagem: só events:polling, acknowledgment e /v1/orders/{uuid}.
          // Ou seja, esta reconciliação nunca recuperou nada. O código fica
          // pronto para quando o JotaJá expuser listagem, mas o log agora diz
          // claramente que o endpoint não existe, em vez de um "⚠️ retornou 404"
          // silencioso que ninguém lia. Enquanto isso, a rede de segurança real
          // é o ACK condicionado à gravação, logo acima.
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
                } else if (activeRes.status === 404) {
                  log.push(`ℹ️ [${storeName}] Reconciliação indisponível: o JotaJá não expõe GET /v1/orders (404). Sem listagem, um pedido que o feed não entregar só é recuperável pelo painel do JotaJá.`);
                } else {
                  log.push(`⚠️ [${storeName}] Reconciliação: GET /v1/orders retornou ${activeRes.status}`);
                }
              } catch (reconcileErr: any) {
                log.push(`⚠️ [${storeName}] Reconciliação falhou: ${reconcileErr.message}`);
              }
          }
        } catch (storeErr: any) {
          log.push(`❌ [${storeName}] Erro geral: ${storeErr.message}`);
          console.error(`[Jotajá Cron] ❌ [${storeName}] Erro geral:`, storeErr?.message);
        }
      }));
      // Collect results from settled promises
      for (const result of results) {
        if (result.status === 'rejected') {
          log.push(`❌ Erro assíncrono em loja: ${result.reason?.message}`);
        }
      }
    }

    // ── O cron precisa FALAR ───────────────────────────────────────────────
    // Este log[] só existia no corpo da resposta, e o cron-runner descarta o
    // corpo quando o status é 2xx (scripts/cron-runner.js). Resultado: meses de
    // "jotaja-poll ok (200)" no log do container sem uma linha sobre pedido
    // nenhum — inclusive quando um pedido se perdia. Agora vai para o stdout.
    const houveFalha = log.some(l => l.startsWith("❌") || l.includes("⛔"));
    if (totalEvents > 0 || houveFalha) {
      for (const linha of log) {
        if (linha.startsWith("❌") || linha.includes("⛔")) console.error(`[Jotajá Cron] ${linha}`);
        else console.log(`[Jotajá Cron] ${linha}`);
      }
    }
    if (totalCreated > 0 || totalUpdated > 0 || reconciled > 0) {
      console.log(`[Jotajá Cron] 📊 ${totalCreated} criados, ${totalUpdated} atualizados, ${totalCancelled} cancelados, ${totalAcknowledged} ackados, ${reconciled} reconciliados em ${Date.now() - startTime}ms`);
    }

    return NextResponse.json({
      ok: !houveFalha,
      events: totalEvents,
      created: totalCreated,
      updated: totalUpdated,
      disputes: totalDisputes,
      cancelled: totalCancelled,
      acknowledged: totalAcknowledged,
      reconciled,
      durationMs: Date.now() - startTime,
      log,
      // 207 faz o cron-runner imprimir o corpo (ele só silencia em 2xx puro),
      // então uma loja falhando vira linha visível no log do container.
    }, { status: houveFalha ? 207 : 200 });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    console.error("[Jotajá Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
