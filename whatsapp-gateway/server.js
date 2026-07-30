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
const replyCooldowns = new Map();
const sessionLocks = new Map();
const reconnectCounters = new Map();

// Limpar sessões corrompidas ao iniciar
const CLEAN_ON_BOOT = process.env.CLEAN_SESSIONS === "true";
if (CLEAN_ON_BOOT) {
  const sessionsDir = path.join(__dirname, "data", "sessions");
  try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(sessionsDir, { recursive: true });
  console.log("[WhatsApp Gateway] 🗑️ Sessões limpas no boot (CLEAN_SESSIONS=true)");
}

// Monitoramento de memória - previne OOM
setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  if (heapMB > 350) {
    console.warn(`[WhatsApp Gateway] ⚠️ Memória alta: heap=${heapMB}MB rss=${rssMB}MB - forçando GC`);
    if (global.gc) { try { global.gc(); } catch(e) {} }
  }
}, 15000);

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

  // Prevent duplicate socket creation
  if (session && session.state === "connecting") {
    return session;
  }

  // Lock to prevent concurrent creation
  if (sessionLocks.get(instanceName)) {
    return sessions.get(instanceName) || { state: "connecting", qrBase64: null, phone: null };
  }
  sessionLocks.set(instanceName, true);

  // Clean up previous socket if exists
  if (session && session.sock) {
    try { session.sock.end(); } catch(e) {}
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
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
    cachedGroupMetadata: async () => undefined,
    fireInitQueries: false,
  });

  session = { sock, state: "connecting", qrBase64: null, phone: null };
  sessions.set(instanceName, session);
  sessionLocks.delete(instanceName);

  // Ignorar eventos pesados que consomem memória
  sock.ev.on("messaging-history.set", () => {
    // Ignora sync de histórico completamente
  });
  sock.ev.on("chats.upsert", () => {});
  sock.ev.on("chats.update", () => {});
  sock.ev.on("chats.delete", () => {});
  sock.ev.on("contacts.upsert", () => {});
  sock.ev.on("contacts.update", () => {});
  sock.ev.on("groups.upsert", () => {});
  sock.ev.on("groups.update", () => {});
  sock.ev.on("presence.update", () => {});
  sock.ev.on("blocklist.set", () => {});
  sock.ev.on("blocklist.update", () => {});

  // Forçar garbage collection periódico
  if (global.gc) {
    setInterval(() => { try { global.gc(); } catch(e) {} }, 30000);
  }
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
      reconnectCounters.set(instanceName, 0);
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
            data: { state: "open", ownerJid: userJid, phone: session.phone },
          }),
        });
      } catch (err) {
        console.warn("[WhatsApp Gateway] Aviso ao notificar webhook de conexão:", err.message);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const shouldReconnect = !isLoggedOut;
      session.state = "close";
      sessionLocks.delete(instanceName);

      const count = (reconnectCounters.get(instanceName) || 0) + 1;
      reconnectCounters.set(instanceName, count);

      console.log(`[WhatsApp Gateway] 🔄 Conexão encerrada para ${instanceName} (Status ${statusCode}). Reconectar: ${shouldReconnect} (tentativa #${count})`);

      if (shouldReconnect) {
        // Reconexão infinita com backoff de 3s até no máximo 30s
        const delay = Math.min(3000 * Math.min(count, 10), 30000);
        console.log(`[WhatsApp Gateway] ⏳ Agendando reconexão de ${instanceName} em ${delay / 1000}s...`);
        setTimeout(() => {
          getOrCreateSocket(instanceName).catch((err) => {
            console.error(`[WhatsApp Gateway] Erro ao tentar reconectar ${instanceName}:`, err.message);
          });
        }, delay);
      } else {
        console.log(`[WhatsApp Gateway] 🚪 Instância ${instanceName} desconectada pelo usuário (loggedOut). Limpando sessão...`);
        sessions.delete(instanceName);
        reconnectCounters.delete(instanceName);
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

      const now = Date.now();
      const lastReply = replyCooldowns.get(remoteJid) || 0;
      if (now - lastReply < 3000) {
        console.log(`[WhatsApp Gateway] ⏳ Ignorando mensagem de ${remoteJid} (cooldown)`);
        continue;
      }
      replyCooldowns.set(remoteJid, now);

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

app.get("/", (req, res) => {
  return res.json({ status: "ok", sessions: sessions.size, uptime: process.uptime() });
});

app.use((req, res, next) => {
  const expectedApiKey = process.env.API_KEY || "firehub_secret_key_2026";
  if (req.headers["apikey"] !== expectedApiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

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

  // Aguarda até 15 segundos se o QR Code ainda estiver sendo gerado
  let attempts = 0;
  while (!session.qrBase64 && session.state !== "open" && attempts < 75) {
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

// 3.5 Reset Instância (limpa sessão corrompida e força novo QR Code)
app.delete("/instance/reset/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);
  
  if (session && session.sock) {
    try { session.sock.end(); } catch(e) {}
  }
  
  sessions.delete(instanceName);
  sessionLocks.delete(instanceName);
  reconnectCounters.delete(instanceName);
  
  const authFolder = path.join(__dirname, "data", "sessions", instanceName);
  try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch {}
  
  console.log(`[WhatsApp Gateway] 🗑️ Reset completo da instância ${instanceName}`);
  return res.json({ success: true, message: `Instância ${instanceName} resetada` });
});

// 3.6 Limpar TODAS as sessões
app.delete("/instance/clean-all", async (req, res) => {
  for (const [name, session] of sessions) {
    if (session.sock) {
      try { session.sock.end(); } catch(e) {}
    }
  }
  
  sessions.clear();
  sessionLocks.clear();
  reconnectCounters.clear();
  
  const sessionsFolder = path.join(__dirname, "data", "sessions");
  try { fs.rmSync(sessionsFolder, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(sessionsFolder, { recursive: true });
  
  console.log("[WhatsApp Gateway] 🗑️ TODAS as sessões foram limpas");
  return res.json({ success: true, message: "Todas as sessões limpas" });
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

  // Auto-reconectar sessões salvas com delay (evita OOM no boot)
  const sessionsDir = path.join(__dirname, "data", "sessions");
  if (fs.existsSync(sessionsDir)) {
    const folders = fs.readdirSync(sessionsDir).filter(f => {
      try { return fs.statSync(path.join(sessionsDir, f)).isDirectory(); } catch { return false; }
    });
    
    if (folders.length > 0) {
      console.log(`[WhatsApp Gateway] 📋 ${folders.length} sessão(ões) salva(s). Reconectando em 10s...`);
      
      // Reconecta uma por vez com intervalo de 5s entre cada
      let i = 0;
      const reconnectNext = () => {
        if (i >= folders.length) return;
        const instanceName = folders[i++];
        console.log(`[WhatsApp Gateway] 🔄 Reconectando: ${instanceName} (${i}/${folders.length})`);
        getOrCreateSocket(instanceName).catch((err) => {
          console.warn(`[WhatsApp Gateway] ⚠️ Falha ao reconectar ${instanceName}:`, err.message);
        });
        if (i < folders.length) {
          setTimeout(reconnectNext, 5000);
        }
      };
      setTimeout(reconnectNext, 10000);
    }
  }
});
