import { prisma } from "@/lib/prisma";
import { segredoObrigatorio } from "./segredos";

export async function getEvolutionQRCode(userId: string, storePhone?: string) {
  const instanceName = `firehub_${userId.slice(-10)}`;

  // Buscar configurações da loja para verificar se há URL/API Key customizadas da Evolution API
  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

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

export async function sendEvolutionMessage(userIdOrInstance: string, toPhone: string, text: string) {
  const isInstanceName = userIdOrInstance.startsWith("firehub_");
  const instanceName = isInstanceName ? userIdOrInstance : `firehub_${userIdOrInstance.slice(-10)}`;
  const number = (toPhone.includes("@s.whatsapp.net") || toPhone.includes("@lid"))
    ? toPhone
    : (toPhone.replace(/\D/g, "").startsWith("55") ? toPhone.replace(/\D/g, "") : `55${toPhone.replace(/\D/g, "")}`);

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const shortId = instanceName.replace(/^firehub_/, "");
    const user = await prisma.user.findFirst({
      where: isInstanceName ? { id: { endsWith: shortId } } : { id: userIdOrInstance },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  try {
    const typingDelay = Math.min(Math.max(text.length * 40, 1500), 8000);

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
          delay: typingDelay,
          presence: "composing",
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao enviar mensagem:", err);
    return false;
  }
}

export async function sendEvolutionMediaUrl(userIdOrInstance: string, toPhone: string, mediaUrl: string, caption?: string) {
  const isInstanceName = userIdOrInstance.startsWith("firehub_");
  const instanceName = isInstanceName ? userIdOrInstance : `firehub_${userIdOrInstance.slice(-10)}`;
  const number = (toPhone.includes("@s.whatsapp.net") || toPhone.includes("@lid"))
    ? toPhone
    : (toPhone.replace(/\D/g, "").startsWith("55") ? toPhone.replace(/\D/g, "") : `55${toPhone.replace(/\D/g, "")}`);

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const shortId = instanceName.replace(/^firehub_/, "");
    const user = await prisma.user.findFirst({
      where: isInstanceName ? { id: { endsWith: shortId } } : { id: userIdOrInstance },
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
        mediaMessage: {
          mediatype: "image",
          caption: caption || "",
          media: mediaUrl,
        },
        options: { delay: 1200, presence: "composing" },
      }),
      signal: AbortSignal.timeout(12000),
    });
    return res.ok;
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao enviar mídia:", err);
    return false;
  }
}

export async function sendEvolutionAudioBase64(userIdOrInstance: string, toPhone: string, base64Audio: string) {
  const isInstanceName = userIdOrInstance.startsWith("firehub_");
  const instanceName = isInstanceName ? userIdOrInstance : `firehub_${userIdOrInstance.slice(-10)}`;
  const number = (toPhone.includes("@s.whatsapp.net") || toPhone.includes("@lid"))
    ? toPhone
    : (toPhone.replace(/\D/g, "").startsWith("55") ? toPhone.replace(/\D/g, "") : `55${toPhone.replace(/\D/g, "")}`);

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const shortId = instanceName.replace(/^firehub_/, "");
    const user = await prisma.user.findFirst({
      where: isInstanceName ? { id: { endsWith: shortId } } : { id: userIdOrInstance },
      select: { chatbotConfig: true },
    });
    const config = (user?.chatbotConfig as any) || {};
    if (config.evolutionUrl) baseUrl = config.evolutionUrl.replace(/\/$/, "");
    if (config.evolutionApiKey) apiKey = config.evolutionApiKey;
  } catch {}

  // Aprox 1MB = 1 minuto. Base64 de áudio curto. Delay mínimo 3s, máximo 15s.
  const baseDelay = Math.min(Math.max(Math.floor(base64Audio.length / 5000), 3000), 15000);

  try {
    const res = await fetch(`${baseUrl}/message/sendWhatsAppAudio/${instanceName}`, {
      method: "POST",
      headers: {
        "apikey": apiKey,
        "Content-Type": "application/json",
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      body: JSON.stringify({
        number,
        audio: base64Audio.startsWith("data:") ? base64Audio : `data:audio/mp3;base64,${base64Audio}`,
        delay: baseDelay,
        encoding: true,
        options: {
          presence: "recording"
        }
      }),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok;
  } catch (err) {
    console.error("[Evolution API Gateway] Erro ao enviar áudio:", err);
    return false;
  }
}

export async function disconnectEvolutionInstance(userId: string) {
  const instanceName = `firehub_${userId.slice(-10)}`;
  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

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

export async function getEvolutionAudioBase64(userIdOrInstance: string, messageKey: any, messageObj: any): Promise<string | null> {
  // Resolve o nome exato da instância
  let instanceName = userIdOrInstance;
  if (userIdOrInstance && userIdOrInstance.length >= 20 && !userIdOrInstance.startsWith("firehub_")) {
    instanceName = `firehub_${userIdOrInstance.slice(-10)}`;
  }

  let baseUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway-production.up.railway.app").replace(/\/$/, "");
  let apiKey = segredoObrigatorio("EVOLUTION_API_KEY");

  try {
    const shortId = instanceName.replace(/^firehub_/, "");
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: userIdOrInstance },
          { id: { endsWith: shortId } },
          { chatbotConfig: { path: ['instanceName'], equals: instanceName } }
        ]
      },
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

  const endpoints = [
    `${baseUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
    `${baseUrl}/message/getBase64FromMediaMessage/${instanceName}`
  ];

  const payloads = [
    // Payload padrão Evolution API v2 com key e message aninhados
    {
      message: {
        key: {
          id: messageKey?.id,
          remoteJid: messageKey?.remoteJid,
          fromMe: messageKey?.fromMe || false,
        },
        message: messageObj?.message || messageObj,
      },
      convertToMp4: false,
    },
    // Payload com key direto
    {
      message: {
        key: messageKey,
      },
      convertToMp4: false,
    },
    // Payload com messageObj puro
    {
      message: messageObj,
      convertToMp4: false,
    },
    // Payload simplificado apenas com key.id
    {
      message: {
        key: { id: messageKey?.id },
      },
      convertToMp4: false,
    }
  ];

  for (const ep of endpoints) {
    for (const body of payloads) {
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });

        if (res.ok) {
          const data = await res.json();
          let base64Str = data.base64 || data.data || data.response?.base64 || data.media?.base64 || data.mediaBase64 || null;
          if (base64Str && typeof base64Str === "string") {
            if (base64Str.includes(";base64,")) {
              base64Str = base64Str.split(";base64,")[1];
            }
            base64Str = base64Str.trim();
            if (base64Str.length > 50) {
              return base64Str;
            }
          }
        }
      } catch (err: any) {
        // tenta o próximo endpoint/payload
      }
    }
  }

  return null;
}
