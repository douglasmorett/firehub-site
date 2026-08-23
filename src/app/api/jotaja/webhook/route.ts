import { NextRequest, NextResponse, after } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";

/**
 * POST /api/jotaja/webhook
 * Webhook receiver for Jotajá Open Delivery events.
 * Alternative to cron polling — Jotajá pushes events directly here.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// HMAC signature validation com timing-safe compare
async function verifySignature(req: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.JOTAJA_WEBHOOK_SECRET;
  if (!secret) return true; // Skip se não configurado

  const signature = req.headers.get("x-signature") || req.headers.get("x-hub-signature-256") || "";
  if (!signature) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expectedBytes = new Uint8Array(sig);
    const expected = Array.from(expectedBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const received = signature.replace("sha256=", "");

    // Timing-safe compare — evita timing attacks
    if (expected.length !== received.length) return false;
    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(received, "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return require("crypto").timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const bodyText = await req.text();

  // Validate signature
  const isValid = await verifySignature(req, bodyText);
  if (!isValid) {
    console.warn("[Jotajá Webhook] Assinatura inválida");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");
    const { prisma } = await import("@/lib/prisma");
    const rawEvents = JSON.parse(bodyText);
    const events = Array.isArray(rawEvents) ? rawEvents : [rawEvents];

    after(async () => {
      // Resolver storeId a partir do payload — tenta encontrar a loja dona dos pedidos
      let resolvedStoreId: string | undefined;
      try {
        const firstEvent = events[0];
        const merchantId = firstEvent?.merchant?.id || firstEvent?.metadata?.merchantId;
        if (merchantId) {
          const store = await prisma.user.findFirst({
            where: {
              jotajaMerchantId: merchantId,
              jotajaConnected: true,
              NOT: { email: { startsWith: "deleted_" } },
            },
            select: { id: true, ownerId: true },
          });
          if (store) resolvedStoreId = store.ownerId || store.id;
        }
        if (!resolvedStoreId) {
          console.warn("[Jotajá Webhook] ⚠️ merchantId não encontrado no payload — processJotajaEvent resolverá via orderData.merchant.id");
        }
      } catch {}

      const processedEvents: { id: string; orderId: string; eventType: string }[] = [];
      let created = 0, updated = 0, disputes = 0, cancelled = 0;

      for (const event of events) {
        const result = await processJotajaEvent(
          event,
          (path: string, opts?: RequestInit) => jotajaFetch(path, opts, resolvedStoreId),
          (path: string, opts?: RequestInit) => jotajaMutate(path, opts, resolvedStoreId),
          resolvedStoreId
        );
        console.log(`[Jotajá Webhook] ${result.action} — ${result.orderId}${result.message ? ": " + result.message : ""}`);

        const eid = event.eventId || event.id;

        // Só ackar com o pedido confirmado no banco: o ACK apaga o evento do
        // feed em definitivo e o JotaJá não tem listagem para recuperá-lo.
        let podeAckar = result.action !== "error";
        if (podeAckar && event.orderId) {
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
            podeAckar = false;
            console.error(`[Jotajá Webhook] ⛔ SEM ACK ${event.orderId}: ${result.action} não gravou pedido (${result.message || "-"})`);
          }
        }

        if (podeAckar && eid) {
          processedEvents.push({
            id: eid,
            orderId: event.orderId || "",
            eventType: event.eventType || event.fullCode || event.code || "",
          });
        }
        if (result.action === "created")  created++;
        if (result.action === "updated")  updated++;
        if (result.action === "dispute")  disputes++;
        if (result.action === "cancelled") cancelled++;
      }

      // Acknowledge
      if (processedEvents.length > 0) {
        try {
          await jotajaMutate("/v1/events/acknowledgment", {
            method: "POST",
            body: JSON.stringify(processedEvents),
          }, resolvedStoreId);
        } catch { /* não crítico */ }
      }

      console.log(`[Jotajá Webhook] ${created} criados, ${updated} atualizados, ${disputes} disputas, ${cancelled} cancelados`);
    });

    return NextResponse.json({ ok: true, message: "Accepted for processing", events: events.length });
  } catch (err: any) {
    console.error("[Jotajá Webhook] Erro:", err);
    // Retorna 200 mesmo em erro para não fazer JotaJá desativar o webhook
    return NextResponse.json({ ok: false, error: err.message });
  }
}
