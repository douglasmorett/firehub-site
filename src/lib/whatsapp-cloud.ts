/**
 * whatsapp-cloud.ts — WhatsApp Cloud API (Meta) Provider
 *
 * Provider oficial que substitui/complementa a Evolution API.
 * Usa a Graph API da Meta para enviar/receber mensagens.
 */

// v20.0 não consta mais entre as versões ativas da Graph API (hoje v21 a v26).
// Nenhuma loja usa este provider — conferido no banco em 28/08/2026: das 6 com
// chatbot configurado, 2 estão no gateway próprio e nenhuma na Cloud API — então
// ninguém sentiu. Fica na mesma versão do resto do que fala com a Meta para a
// porta não estar podre no dia em que alguém ligar.
const GRAPH_API_VERSION = "v25.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ── Enviar mensagem de texto ───────────────────────────────────────

export async function sendCloudApiMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  text: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Normalizar número (remover @s.whatsapp.net, manter só dígitos)
    const cleanNumber = to.replace(/@.*/, "").replace(/\D/g, "");

    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanNumber,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[CloudAPI] Send error:", data);
      return { success: false, error: data.error?.message || "Erro ao enviar" };
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (err: any) {
    console.error("[CloudAPI] Send exception:", err);
    return { success: false, error: err.message };
  }
}

// ── Enviar mídia (imagem com caption) ──────────────────────────────

export async function sendCloudApiMedia(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  mediaUrl: string,
  caption?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanNumber = to.replace(/@.*/, "").replace(/\D/g, "");

    const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanNumber,
        type: "image",
        image: {
          link: mediaUrl,
          ...(caption ? { caption } : {}),
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("[CloudAPI] Media send error:", data);
      return { success: false, error: data.error?.message || "Erro ao enviar mídia" };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[CloudAPI] Media send exception:", err);
    return { success: false, error: err.message };
  }
}

// ── Marcar mensagem como lida ──────────────────────────────────────

export async function markAsRead(
  phoneNumberId: string,
  accessToken: string,
  messageId: string
): Promise<void> {
  try {
    await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch (err) {
    console.error("[CloudAPI] Mark as read error:", err);
  }
}

// ── Download de mídia (áudio, imagem) ──────────────────────────────

export async function downloadCloudApiMedia(
  mediaId: string,
  accessToken: string
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // Step 1: Get media URL
    const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const metaData = await metaRes.json();

    if (!metaData.url) {
      console.error("[CloudAPI] No media URL found:", metaData);
      return null;
    }

    // Step 2: Download the actual media
    const mediaRes = await fetch(metaData.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mediaRes.ok) return null;

    const buffer = await mediaRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = metaData.mime_type || mediaRes.headers.get("content-type") || "application/octet-stream";

    return { base64, mimeType };
  } catch (err) {
    console.error("[CloudAPI] Download media error:", err);
    return null;
  }
}

// ── Parse webhook payload da Meta ──────────────────────────────────

export interface CloudApiMessage {
  messageId: string;
  from: string;         // Phone number (e.g. "5521999999999")
  timestamp: string;
  type: "text" | "image" | "audio" | "video" | "document" | "reaction" | "interactive" | "button" | "sticker";
  text?: string;
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  pushName?: string;
}

export interface CloudApiWebhookPayload {
  phoneNumberId: string;
  messages: CloudApiMessage[];
  statuses?: any[];
}

export function parseCloudApiWebhook(body: any): CloudApiWebhookPayload | null {
  try {
    const entry = body?.entry?.[0];
    if (!entry) return null;

    const change = entry.changes?.[0];
    if (!change || change.field !== "messages") return null;

    const value = change.value;
    if (!value) return null;

    const phoneNumberId = value.metadata?.phone_number_id;
    const contacts = value.contacts || [];
    const rawMessages = value.messages || [];
    const statuses = value.statuses || [];

    const messages: CloudApiMessage[] = rawMessages.map((msg: any) => {
      const contact = contacts.find((c: any) => c.wa_id === msg.from);
      const parsed: CloudApiMessage = {
        messageId: msg.id,
        from: msg.from,
        timestamp: msg.timestamp,
        type: msg.type,
        pushName: contact?.profile?.name || undefined,
      };

      switch (msg.type) {
        case "text":
          parsed.text = msg.text?.body;
          break;
        case "image":
          parsed.mediaId = msg.image?.id;
          parsed.mimeType = msg.image?.mime_type;
          parsed.caption = msg.image?.caption;
          break;
        case "audio":
          parsed.mediaId = msg.audio?.id;
          parsed.mimeType = msg.audio?.mime_type;
          break;
        case "video":
          parsed.mediaId = msg.video?.id;
          parsed.mimeType = msg.video?.mime_type;
          parsed.caption = msg.video?.caption;
          break;
        case "document":
          parsed.mediaId = msg.document?.id;
          parsed.mimeType = msg.document?.mime_type;
          parsed.caption = msg.document?.caption;
          break;
        case "interactive":
          parsed.text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title;
          break;
        case "button":
          parsed.text = msg.button?.text;
          break;
        case "sticker":
          parsed.mediaId = msg.sticker?.id;
          parsed.mimeType = msg.sticker?.mime_type;
          break;
      }

      return parsed;
    });

    return { phoneNumberId, messages, statuses };
  } catch (err) {
    console.error("[CloudAPI] Parse webhook error:", err);
    return null;
  }
}

// ── Verify webhook (GET request from Meta) ─────────────────────────

export function verifyCloudApiWebhook(
  searchParams: URLSearchParams,
  verifyToken: string
): { valid: boolean; challenge?: string } {
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return { valid: true, challenge };
  }
  return { valid: false };
}
