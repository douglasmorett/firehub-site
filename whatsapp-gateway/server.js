const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const sessions = new Map();

process.on("uncaughtException", (err) => {
  console.warn("[WhatsApp Gateway] Aviso uncaughtException ignorado:", err.message || err);
});
process.on("unhandledRejection", (err) => {
  console.warn("[WhatsApp Gateway] Aviso unhandledRejection ignorado:", err.message || err);
});

async function getOrCreateSocket(instanceName) {
  let session = sessions.get(instanceName);
  if (session && session.sock && session.state === "open") {
    return session;
  }

  const authFolder = path.join(__dirname, "data", "sessions", instanceName);
  fs.mkdirSync(authFolder, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    browser: ["FireHub Food", "Chrome", "1.0.0"],
  });

  session = { sock, state: "connecting", qrBase64: null, phone: null };
  sessions.set(instanceName, session);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrBase64 = await QRCode.toDataURL(qr, { margin: 2, width: 300 });
        session.qrBase64 = qrBase64;
      } catch (err) {
        console.error("[WhatsApp Gateway] Erro ao converter QR Code:", err);
      }
    }

    if (connection === "open") {
      session.state = "open";
      session.qrBase64 = null;
      const userJid = sock.user?.id || "";
      const rawPhone = userJid.split(":")[0] || "";
      session.phone = rawPhone ? `+55 ${rawPhone.replace(/^55/, "")}` : "";

      console.log(`[WhatsApp Gateway] ✅ Instância ${instanceName} conectada! Número: ${session.phone}`);

      // Notifica o FireHub via Webhook
      try {
        const webhookUrl = process.env.FIREHUB_WEBHOOK_URL || "https://firehubfood.com.br/api/webhook/whatsapp";
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "CONNECTION_UPDATE",
            instance: instanceName,
            data: { state: "open", ownerJid: userJid },
          }),
        });
      } catch (err) {
        console.warn("[WhatsApp Gateway] Aviso ao notificar webhook de conexão:", err.message);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      session.state = "close";

      console.log(`[WhatsApp Gateway] Conexão encerrada para ${instanceName}. Reconectar: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(() => getOrCreateSocket(instanceName), 3000);
      } else {
        sessions.delete(instanceName);
        try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch {}
      }
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    if (m.type !== "notify") return;

    for (const msg of m.messages) {
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid || "";
      if (remoteJid.endsWith("@g.us")) continue;

      const textMessage =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      if (!textMessage.trim()) continue;

      console.log(`[WhatsApp Gateway] 💬 Mensagem recebida de ${remoteJid}: "${textMessage}"`);

      try {
        const webhookUrl = process.env.FIREHUB_WEBHOOK_URL || "https://firehubfood.com.br/api/webhook/whatsapp";
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "MESSAGES_UPSERT",
            instance: instanceName,
            data: {
              key: msg.key,
              message: msg.message,
            },
          }),
        });
      } catch (err) {
        console.error("[WhatsApp Gateway] Erro ao enviar mensagem para webhook FireHub:", err);
      }
    }
  });

  return session;
}

// 1. Estado da Conexão
app.get("/instance/connectionState/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);

  if (session && session.state === "open") {
    return res.json({ instance: { state: "open", ownerJid: session.phone } });
  }

  if (!session) {
    return res.status(404).json({ error: "Instance not found" });
  }

  return res.json({ instance: { state: session.state || "close" } });
});

// 2. Conectar e Obter QR Code Real
app.get("/instance/connect/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = await getOrCreateSocket(instanceName);

  if (session.state === "open") {
    return res.json({ instance: { state: "open" }, connected: true, phone: session.phone });
  }

  // Aguarda até 3 segundos se o QR Code ainda estiver sendo gerado
  let attempts = 0;
  while (!session.qrBase64 && attempts < 15) {
    await new Promise((r) => setTimeout(r, 200));
    attempts++;
  }

  if (session.qrBase64) {
    return res.json({
      code: session.qrBase64,
      base64: session.qrBase64,
      pairingCode: "8888-9999",
      status: 200,
    });
  }

  return res.status(500).json({ error: "Gerando QR Code..." });
});

// 3. Criar Instância
app.post("/instance/create", async (req, res) => {
  const { instanceName } = req.body;
  await getOrCreateSocket(instanceName || "default");
  return res.json({ instance: { instanceName, status: "created" } });
});

// 4. Enviar Mensagem de Texto
app.post("/message/sendText/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const { number, text } = req.body;

  let session = sessions.get(instanceName);
  if (!session || session.state !== "open") {
    for (const s of sessions.values()) {
      if (s.state === "open" && s.sock) {
        session = s;
        break;
      }
    }
  }

  if (!session || session.state !== "open" || !session.sock) {
    return res.status(400).json({ error: "Instância não conectada no celular" });
  }

  // Se o número já for um JID completo (@s.whatsapp.net ou @lid), envia diretamente para ele
  const cleanNum = String(number).trim();
  const jid = (cleanNum.includes("@s.whatsapp.net") || cleanNum.includes("@lid"))
    ? cleanNum
    : `${cleanNum.replace(/\D/g, "")}@s.whatsapp.net`;

  try {
    await session.sock.sendMessage(jid, { text });
    console.log(`[WhatsApp Gateway] 🚀 Mensagem enviada com sucesso para ${jid}: "${text.slice(0, 50)}..."`);
    return res.json({ status: "SENT", to: jid });
  } catch (err) {
    console.error(`[WhatsApp Gateway] ❌ Erro ao enviar mensagem para ${jid}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. Desconectar
app.delete("/instance/logout/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);
  if (session && session.sock) {
    try { await session.sock.logout(); } catch {}
  }
  sessions.delete(instanceName);
  const authFolder = path.join(__dirname, "data", "sessions", instanceName);
  try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch {}
  return res.json({ status: "logged_out" });
});

app.listen(PORT, () => {
  console.log(`[FireHub WhatsApp Gateway] 🚀 Servidor rodando na porta ${PORT}`);

  // Auto-reconectar instâncias com sessão salva
  const sessionsDir = path.join(__dirname, "data", "sessions");
  if (fs.existsSync(sessionsDir)) {
    const folders = fs.readdirSync(sessionsDir);
    for (const instanceName of folders) {
      if (fs.statSync(path.join(sessionsDir, instanceName)).isDirectory()) {
        console.log(`[WhatsApp Gateway] 🔄 Auto-iniciando conexão salva para: ${instanceName}`);
        getOrCreateSocket(instanceName).catch(() => {});
      }
    }
  }
});
