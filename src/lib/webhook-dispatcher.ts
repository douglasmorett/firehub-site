import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export interface OutboundWebhookEvent {
  event: "order.created" | "order.status_updated" | "order.canceled" | "menu.updated";
  timestamp: string;
  franchiseeId: string;
  data: any;
}

/**
 * Assina um payload JSON usando HMAC-SHA256 para o parceiro verificar a autenticidade do FireHub
 */
export function signWebhookPayload(payloadStr: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");
}

/**
 * Dispara webhooks de saída assíncronos para todas as aplicações parceiras cadastradas
 */
export async function dispatchOutboundWebhook(
  franchiseeId: string,
  event: OutboundWebhookEvent["event"],
  data: any
): Promise<void> {
  try {
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: {
        franchiseeId,
        active: true,
      },
    });

    if (!subscriptions || subscriptions.length === 0) return;

    const payloadObj: OutboundWebhookEvent = {
      event,
      timestamp: new Date().toISOString(),
      franchiseeId,
      data,
    };

    const payloadStr = JSON.stringify(payloadObj);

    for (const sub of subscriptions) {
      const allowedEvents = Array.isArray(sub.events) ? sub.events.map(String) : [];
      if (!allowedEvents.includes("*") && !allowedEvents.includes(event)) {
        continue;
      }

      const signature = signWebhookPayload(payloadStr, sub.secret);

      // Disparo assíncrono com timeout de 5 segundos
      fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FireHub-Event": event,
          "X-FireHub-Signature": signature,
          "User-Agent": "FireHub-Webhook-Dispatcher/1.0",
        },
        body: payloadStr,
        signal: AbortSignal.timeout(5000),
      }).catch((err) => {
        console.warn(`[Outbound Webhook] Falha ao enviar evento ${event} para ${sub.url}:`, err?.message || err);
      });
    }
  } catch (err) {
    console.error("[Outbound Webhook] Erro ao buscar assinaturas de webhook:", err);
  }
}
