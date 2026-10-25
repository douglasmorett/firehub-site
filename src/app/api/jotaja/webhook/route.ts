import { NextRequest, NextResponse, after } from "next/server";
import { processJotajaEvent } from "@/lib/processJotajaEvent";
import { avisarWebhookSemSegredo } from "@/lib/webhook-assinatura";
import { merchantDoEvento } from "@/lib/jotaja-loja";

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
  if (!secret) {
    // Antes era um "// Skip se não configurado" silencioso: sem a variável no
    // ambiente, TODA requisição passava e nada no log dizia isso. Recusar de
    // uma vez não dá: evento de pedido recusado é pedido que some da cozinha, e
    // no JotaJá some para sempre — a API não tem listagem para recuperar depois.
    //
    // Então a porta fecha sozinha no instante em que a variável existir. Até lá,
    // cada requisição não verificada deixa rastro.
    avisarWebhookSemSegredo("JotaJá", "JOTAJA_WEBHOOK_SECRET");
    return true;
  }

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
      // Cada evento vai para a loja que É o restaurante dele no JotaJá
      // (`storeId` do evento) e é processado com a credencial DESSA loja. Antes
      // a loja saía do 1º evento do lote, por um campo que a fila do JotaJá nem
      // manda (merchant.id), e sem loja a chamada caía na credencial de
      // reserva do servidor. Sem exatamente uma loja ligada com esse
      // restaurante, o evento não é processado (fica na fila do JotaJá).
      const lojaDoMerchant = new Map<string, string | null>();
      const porLoja = new Map<string, any[]>();
      for (const event of events) {
        const merchantId = merchantDoEvento(event);
        if (!merchantId) {
          console.warn(`[Jotajá Webhook] ⚠️ evento ${event?.eventId || event?.id || "?"} sem o restaurante (storeId) — não processado`);
          continue;
        }
        if (!lojaDoMerchant.has(merchantId)) {
          const lojas = await prisma.user.findMany({
            where: {
              jotajaMerchantId: merchantId,
              jotajaConnected: true,
              ownerId: null,
              NOT: { email: { startsWith: "deleted_" } },
            },
            select: { id: true },
            take: 2,
          });
          if (lojas.length !== 1) {
            console.warn(`[Jotajá Webhook] ⚠️ restaurante ${merchantId}: ${lojas.length === 0 ? "nenhuma loja com o JotaJá ligado" : "mais de uma loja com esse restaurante"} — não processado`);
          }
          lojaDoMerchant.set(merchantId, lojas.length === 1 ? lojas[0].id : null);
        }
        const lojaId = lojaDoMerchant.get(merchantId);
        if (!lojaId) continue;
        porLoja.set(lojaId, [...(porLoja.get(lojaId) ?? []), event]);
      }

      for (const [lojaId, eventosDaLoja] of porLoja) {
        const processedEvents: { id: string; orderId: string; eventType: string }[] = [];
        let created = 0, updated = 0, disputes = 0, cancelled = 0;

        for (const event of eventosDaLoja) {
          const result = await processJotajaEvent(
            event,
            (path: string, opts?: RequestInit) => jotajaFetch(path, opts, lojaId),
            (path: string, opts?: RequestInit) => jotajaMutate(path, opts, lojaId),
            lojaId,
            // Sem o segredo, nada foi verificado (com ele, assinatura errada já
            // levou 401): cancelamento, disputa e status só valem depois de o
            // GET do pedido confirmar (lib/evento-sem-assinatura.ts).
            { conferirNaApi: !process.env.JOTAJA_WEBHOOK_SECRET }
          );
          console.log(`[Jotajá Webhook] ${result.action} — ${result.orderId}${result.message ? ": " + result.message : ""}`);

          const eid = event.eventId || event.id;

          // Só ackar com o pedido confirmado no banco: o ACK apaga o evento do
          // feed em definitivo e o JotaJá não tem listagem para recuperá-lo.
          // "ignorado" = nunca entra nesta loja (lib/jotaja-loja.ts): sai sem entrar.
          let podeAckar = result.action !== "error";
          if (podeAckar && event.orderId && result.action !== "ignorado") {
            // O pedido tem que estar NESTA loja (o import manual grava o UUID na referência).
            const gravado = await prisma.customerOrder.findFirst({
              where: {
                franchiseeId: lojaId,
                OR: [
                  { openDeliveryOrderId: event.orderId },
                  { openDeliveryOrderId: { startsWith: `${event.orderId}_` } },
                  { openDeliveryReference: event.orderId },
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

        // Acknowledge — com a credencial da mesma loja
        if (processedEvents.length > 0) {
          try {
            await jotajaMutate("/v1/events/acknowledgment", {
              method: "POST",
              body: JSON.stringify(processedEvents),
            }, lojaId);
          } catch { /* não crítico */ }
        }

        console.log(`[Jotajá Webhook] loja ${lojaId}: ${created} criados, ${updated} atualizados, ${disputes} disputas, ${cancelled} cancelados`);
      }
    });

    return NextResponse.json({ ok: true, message: "Accepted for processing", events: events.length });
  } catch (err: any) {
    console.error("[Jotajá Webhook] Erro:", err);
    // Retorna 200 mesmo em erro para não fazer JotaJá desativar o webhook
    return NextResponse.json({ ok: false, error: err.message });
  }
}
