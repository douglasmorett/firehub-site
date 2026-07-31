import { prisma } from "@/lib/prisma";

export async function getEvolutionQRCode(userId: string, storePhone?: string) {
  const instanceName = `firehub_${userId.slice(-10)}`;

  // Buscar configurações da loja para verificar se há URL/API Key customizadas da Evolution API
  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = process.env.EVOLUTION_API_KEY || "firehub_secret_key_2026";

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  const url = baseUrl;

  try {
    const defaultHeaders = {
      "apikey": apiKey,
      "Content-Type": "application/json",
      "Bypass-Tunnel-Remainder": "true",
      "User-Agent": "FireHub"
    };

    // 1. Verificar estado da instância
    const stateRes = await fetch(`${url}/instance/connectionState/${instanceName}`, {
      method: "GET",
      headers: defaultHeaders,
      signal: AbortSignal.timeout(10000),
    });

    if (stateRes.ok) {
      const stateData = await stateRes.json();
      if (stateData?.instance?.state === "open" || stateData?.state === "open") {
        const phone = stateData?.instance?.ownerJid?.split("@")[0] || storePhone || "+55 21 99999-9999";
        return {
          connected: true,
          phone: phone.startsWith("+") ? phone : `+55 ${phone.replace(/^55/, "")}`,
          battery: 99,
          status: "ONLINE",
        };
      }
    }

    // 2. Se não existir, tenta criar
    if (stateRes.status === 404) {
      await fetch(`${url}/instance/create`, {
        method: "POST",
        headers: defaultHeaders,
        body: JSON.stringify({
          instanceName,
          token: userId,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
          webhook: `${process.env.NEXTAUTH_URL || "https://firehubfood.com.br"}/api/webhook/whatsapp`,
          webhookByEvents: true,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        }),
        signal: AbortSignal.timeout(10000),
      });
    }

    // 3. Obter QR Code real
    const connectRes = await fetch(`${url}/instance/connect/${instanceName}`, {
      method: "GET",
      headers: defaultHeaders,
      signal: AbortSignal.timeout(10000),
    });

    if (connectRes.ok) {
      const connectData = await connectRes.json();

      if (connectData?.connected || connectData?.instance?.state === "open") {
        return {
          connected: true,
          phone: connectData.phone || storePhone || "+55 (21) 99999-9999",
          battery: 99,
          status: "ONLINE",
        };
      }

      const base64Qr = connectData?.code || connectData?.base64 || connectData?.qrcode?.base64;
      const pairingCode = connectData?.pairingCode || connectData?.code || `${userId.slice(-4)}-${Math.floor(1000 + Math.random() * 9000)}`;

      if (base64Qr) {
        const qrCodeUrl = base64Qr.startsWith("data:image") ? base64Qr : `data:image/png;base64,${base64Qr}`;
        return {
          connected: false,
          qrCodeUrl,
          pairingCode,
          expiresInSeconds: 45,
          status: "AWAITING_SCAN",
        };
      }
    }
  } catch (urlErr) {
    console.warn(`[WhatsApp Evolution] Tentativa de conexão em ${url} falhou:`, (urlErr as any).message);
  }

  // Se nenhuma instância online responder, lança erro para a interface informar o usuário
  throw new Error("Servidor de WhatsApp indisponível no momento. Certifique-se de que o Gateway está ativo.");
}

export async function sendEvolutionMessage(userId: string, toPhone: string, text: string) {
  const instanceName = `firehub_${userId.slice(-10)}`;
  const number = (toPhone.includes("@s.whatsapp.net") || toPhone.includes("@lid"))
    ? toPhone
    : (toPhone.replace(/\D/g, "").startsWith("55") ? toPhone.replace(/\D/g, "") : `55${toPhone.replace(/\D/g, "")}`);

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = process.env.EVOLUTION_API_KEY || "firehub_secret_key_2026";

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  try {
    const res = await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: {
        "apikey": apiKey,
        "Content-Type": "application/json",
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      body: JSON.stringify({
        number,
        text,
        options: {
          delay: 1200,
          presence: "composing",
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao enviar mensagem:", err);
    return false;
  }
}

export async function sendEvolutionMediaUrl(userId: string, toPhone: string, mediaUrl: string, caption?: string) {
  const instanceName = `firehub_${userId.slice(-10)}`;
  const number = (toPhone.includes("@s.whatsapp.net") || toPhone.includes("@lid"))
    ? toPhone
    : (toPhone.replace(/\D/g, "").startsWith("55") ? toPhone.replace(/\D/g, "") : `55${toPhone.replace(/\D/g, "")}`);

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = process.env.EVOLUTION_API_KEY || "firehub_secret_key_2026";

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  try {
    const res = await fetch(`${baseUrl}/message/sendMedia/${instanceName}`, {
      method: "POST",
      headers: {
        "apikey": apiKey,
        "Content-Type": "application/json",
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      body: JSON.stringify({
        number,
        mediatype: "image",
        media: mediaUrl,
        caption: caption || "",
        fileName: "promo.jpg",
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao enviar mídia:", err);
    return false;
  }
}

export async function disconnectEvolutionInstance(userId: string) {
  const instanceName = `firehub_${userId.slice(-10)}`;
  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = process.env.EVOLUTION_API_KEY || "firehub_secret_key_2026";

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  try {
    await fetch(`${baseUrl}/instance/logout/${instanceName}`, {
      method: "DELETE",
      headers: {
        "apikey": apiKey,
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao desconectar instância:", err);
  }
}

export async function getEvolutionAudioBase64(userId: string, messageKey: any, messageObj: any): Promise<string | null> {
  const instanceName = `firehub_${userId.slice(-10)}`;
  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = process.env.EVOLUTION_API_KEY || "firehub_secret_key_2026";

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  const headers = {
    "apikey": apiKey,
    "Content-Type": "application/json",
    "Bypass-Tunnel-Remainder": "true",
    "User-Agent": "FireHub"
  };

  // Tentativa 1: Enviar payload completo de mensagem
  try {
    const res = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: { key: messageKey, message: messageObj },
        convertToMp4: false,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = await res.json();
      let base64Str = data.base64 || data.data || data.response?.base64 || null;
      if (base64Str && base64Str.includes(";base64,")) {
        base64Str = base64Str.split(";base64,")[1];
      }
      if (base64Str) return base64Str;
    }
  } catch (err: any) {
    console.warn("[Evolution API Gateway] Tentativa 1 de áudio falhou:", err?.message);
  }

  // Tentativa 2: Enviar apenas key
  try {
    const res2 = await fetch(`${baseUrl}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: { key: messageKey },
        convertToMp4: false,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (res2.ok) {
      const data2 = await res2.json();
      let base64Str = data2.base64 || data2.data || data2.response?.base64 || null;
      if (base64Str && base64Str.includes(";base64,")) {
        base64Str = base64Str.split(";base64,")[1];
      }
      if (base64Str) return base64Str;
    }
  } catch (err: any) {
    console.warn("[Evolution API Gateway] Tentativa 2 de áudio falhou:", err?.message);
  }

  return null;
}
