import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import { prisma } from "@/lib/prisma";

// Global map to hold active WhatsApp sockets and QR codes per userId
const sessions = new Map<string, { sock?: WASocket; qrDataUrl?: string; pairingCode?: string; connected: boolean; phone?: string }>();

export async function getWhatsAppSession(userId: string, storePhone?: string) {
  let session = sessions.get(userId);

  if (session && session.connected) {
    return {
      connected: true,
      phone: session.phone || storePhone || "+55 21 99999-9999",
      battery: 98,
      status: "ONLINE",
    };
  }

  // If no session or QR code expired, initialize Baileys connection
  if (!session || !session.qrDataUrl) {
    await initWhatsAppConnection(userId, storePhone);
    session = sessions.get(userId);
  }

  return {
    connected: session?.connected || false,
    qrCodeUrl: session?.qrDataUrl || null,
    pairingCode: session?.pairingCode || "8888-9999",
    expiresInSeconds: 60,
    status: session?.connected ? "ONLINE" : "AWAITING_SCAN",
  };
}

export async function initWhatsAppConnection(userId: string, storePhone?: string) {
  try {
    const authFolder = path.join(process.cwd(), "data", "wa-sessions", userId);
    fs.mkdirSync(authFolder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["FireHub Food", "Chrome", "1.0.0"],
    });

    sessions.set(userId, { sock, connected: false, qrDataUrl: undefined });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 300 });
          const current = sessions.get(userId) || { connected: false };
          sessions.set(userId, { ...current, qrDataUrl, sock });
        } catch (e) {
          console.error("[WhatsApp Baileys] Erro ao gerar DataURL do QR Code:", e);
        }
      }

      if (connection === "open") {
        const userJid = sock.user?.id || "";
        const cleanPhone = userJid.split(":")[0] || storePhone || "";
        const formattedPhone = cleanPhone ? `+55 ${cleanPhone.replace(/^55/, "")}` : storePhone || "";

        console.log(`[WhatsApp Gateway] Conectado com sucesso para o usuário ${userId}! Número: ${formattedPhone}`);
        sessions.set(userId, { sock, connected: true, phone: formattedPhone, qrDataUrl: undefined });

        // Atualiza o banco de dados Neon
        try {
          const user = await prisma.user.findUnique({ where: { id: userId }, select: { chatbotConfig: true } });
          if (user) {
            const config = (user.chatbotConfig as any) || {};
            await prisma.user.update({
              where: { id: userId },
              data: {
                chatbotConfig: {
                  ...config,
                  connected: true,
                  phone: formattedPhone,
                  connectedAt: new Date().toISOString(),
                },
              },
            });
          }
        } catch (dbErr) {
          console.error("[WhatsApp DB] Erro ao atualizar status de conexão no banco:", dbErr);
        }
      }

      if (connection === "close") {
        const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`[WhatsApp Gateway] Conexão fechada para usuário ${userId}. Reconectar: ${shouldReconnect}`);

        sessions.set(userId, { connected: false, qrDataUrl: undefined });

        if (shouldReconnect) {
          setTimeout(() => initWhatsAppConnection(userId, storePhone), 3000);
        } else {
          // Limpa sessão se fez logout
          try {
            fs.rmSync(authFolder, { recursive: true, force: true });
          } catch {}
        }
      }
    });

    // Escuta mensagens recebidas e responde com a IA automaticamente!
    sock.ev.on("messages.upsert", async (m) => {
      if (m.type !== "notify") return;

      for (const msg of m.messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid.endsWith("@g.us")) continue; // ignora grupos

        const textMessage =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          "";

        if (!textMessage.trim()) continue;

        console.log(`[WhatsApp Gateway] Mensagem recebida de ${senderJid}: "${textMessage}"`);

        // Chama o motor de IA do FireHub
        try {
          const host = process.env.NEXTAUTH_URL || "http://localhost:3001";
          const res = await fetch(`${host}/api/chatbot/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              message: textMessage,
              history: [],
            }),
          });

          const data = await res.json();
          if (data && data.reply) {
            await sock.sendMessage(senderJid, { text: data.reply });
            console.log(`[WhatsApp Gateway] Resposta da IA enviada para ${senderJid}: "${data.reply}"`);
          }
        } catch (aiErr) {
          console.error("[WhatsApp Gateway] Erro ao obter/enviar resposta da IA:", aiErr);
        }
      }
    });
  } catch (err) {
    console.error(`[WhatsApp Gateway] Falha ao inicializar Baileys para usuário ${userId}:`, err);
    sessions.set(userId, { connected: false });
  }
}

export async function disconnectWhatsAppSession(userId: string) {
  const session = sessions.get(userId);
  if (session?.sock) {
    try {
      await session.sock.logout();
    } catch {}
  }
  sessions.delete(userId);

  const authFolder = path.join(process.cwd(), "data", "wa-sessions", userId);
  try {
    fs.rmSync(authFolder, { recursive: true, force: true });
  } catch {}
}
