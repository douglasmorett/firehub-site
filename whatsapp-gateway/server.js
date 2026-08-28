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
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const sessions = new Map();
const replyCooldowns = new Map();
const sessionLocks = new Map();
const reconnectCounters = new Map();

// ── A CURA DO "AGUARDANDO MENSAGEM" ─────────────────────────────────────────
//
// Quando o aparelho do destinatário não consegue decifrar uma mensagem (sessão
// de criptografia dessincronizada), o WhatsApp mostra "Aguardando mensagem.
// Essa ação pode levar alguns instantes." e pede a RETRANSMISSÃO ao remetente.
// O Baileys atende esse pedido chamando `getMessage(key)` para reenviar o
// conteúdo com uma sessão nova. O socket daqui respondia `undefined` — ou
// seja: a retransmissão NUNCA acontecia e a mensagem ficava presa PARA SEMPRE.
// Era exatamente o que o dono e os motoboys viam nas conversas em que o robô
// só envia (aviso de pedido, rota): sessão apodrecia e nada mais chegava.
//
// Este cache guarda as últimas mensagens ENVIADAS para o retry funcionar.
// Pequeno de propósito (o processo vive brigando com o teto de memória): o
// pedido de retransmissão chega segundos após o envio, não horas.
const mensagensEnviadas = new Map();
const TETO_DO_CACHE_DE_ENVIO = 500;

function lembrarEnviada(resultado) {
  const id = resultado?.key?.id;
  if (!id || !resultado?.message) return;
  mensagensEnviadas.set(id, resultado.message);
  if (mensagensEnviadas.size > TETO_DO_CACHE_DE_ENVIO) {
    // Map preserva ordem de inserção: o primeiro é o mais antigo.
    const maisAntigo = mensagensEnviadas.keys().next().value;
    mensagensEnviadas.delete(maisAntigo);
  }
}

// ── AUTOCURA DA SESSÃO PODRE ────────────────────────────────────────────────
//
// O cache acima faz a retransmissão ACONTECER. Ele não resolve o caso em que a
// sessão de criptografia com aquele contato está corrompida: aí o reenvio sai
// cifrado com as MESMAS chaves quebradas e o destinatário continua sem decifrar.
// O WhatsApp pede de novo, o Baileys reenvia de novo, e cada tentativa vira um
// novo balão "Aguardando mensagem" na conversa — foi o que o dono viu (09:53,
// 10:05, 10:12: os intervalos crescentes são o backoff do próprio WhatsApp,
// não o robô disparando sozinho).
//
// A cura de verdade é jogar a sessão fora. Apagando o arquivo `session-<num>`,
// o Baileys busca prekeys novas e negocia uma sessão do zero no próximo envio —
// sem QR, sem reiniciar a instância, sem afetar as outras conversas.
//
// O gatilho é preciso: o Baileys só chama `getMessage` quando chega um pedido
// de retransmissão, e só chega pedido de retransmissão quando o aparelho do
// destinatário FALHOU em decifrar. Então cada chamada é prova de falha.
// A primeira é tratada como soluço normal (o reenvio simples costuma bastar);
// a partir da segunda, a sessão é considerada podre e recriada.
const pedidosDeRetransmissao = new Map();
const RETRANSMISSOES_ATE_RECRIAR = 2;
const JANELA_DE_RETRANSMISSAO_MS = 10 * 60 * 1000;

function pastaDaSessao(instanceName) {
  return path.join(__dirname, "data", "sessions", instanceName);
}

/**
 * Apaga os arquivos de sessão Signal de UM contato (todos os aparelhos dele).
 * O Baileys grava como "session-<numero>.<device>.json".
 * Não mexe em creds.json nem nas chaves da própria instância.
 */
function apagarSessaoDoContato(instanceName, jid) {
  const numero = String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  if (!numero) return 0;
  let apagados = 0;
  try {
    for (const arquivo of fs.readdirSync(pastaDaSessao(instanceName))) {
      if (arquivo.startsWith("session-") && arquivo.includes(numero)) {
        fs.rmSync(path.join(pastaDaSessao(instanceName), arquivo), { force: true });
        apagados++;
      }
    }
  } catch (err) {
    console.warn(`[WhatsApp Gateway] Aviso ao apagar sessão de ${jid}:`, err.message);
  }
  return apagados;
}

// ── LID → TELEFONE ──────────────────────────────────────────────────────────
//
// O WhatsApp está migrando os contatos para LID (um id interno, "220104...@lid")
// no lugar do JID de telefone. Mensagem cifrada para o endereço @lid chega no
// aparelho e NÃO decifra: vira "Aguardando mensagem" para sempre. E não adianta
// renegociar a sessão — a autocura acima descartava, o envio seguinte falhava
// igual, e o ciclo recomeçava (foi exatamente o que apareceu no log:
// retransmissão 1 → 2 → descartada → 1 → 2 → descartada).
//
// A cura é endereçar pelo TELEFONE. O Baileys mantém o mapa LID↔telefone das
// conversas que já viu; a chamada é opcional porque a API mudou de lugar entre
// versões — se não existir, devolvemos o JID original e nada piora.
// Mapa LID→telefone que NÓS montamos, porque o Baileys desta versão não expõe
// nenhum. Ele se enche sozinho: todo envio para um telefone pergunta ao
// WhatsApp qual é o LID daquele número e guarda o caminho de volta. Como o
// robô manda confirmação de pedido, rota de motoboy e aviso para o dono, os
// contatos que importam entram no mapa pelo uso normal.
const lidParaTelefone = new Map();
const TETO_DO_MAPA_DE_LID = 5000;

function lembrarLid(lid, telefoneJid) {
  if (!lid || !telefoneJid) return;
  lidParaTelefone.set(String(lid), String(telefoneJid));
  if (lidParaTelefone.size > TETO_DO_MAPA_DE_LID) {
    lidParaTelefone.delete(lidParaTelefone.keys().next().value);
  }
}

/** Pergunta ao WhatsApp o LID de um telefone e guarda o caminho de volta. */
async function aprenderLidDoTelefone(sock, telefoneJid) {
  const numero = String(telefoneJid || "").split("@")[0].replace(/\D/g, "");
  if (!numero) return;
  try {
    const [info] = (await sock.onWhatsApp(numero)) || [];
    if (info?.lid) lembrarLid(info.lid, `${numero}@s.whatsapp.net`);
  } catch (err) {
    console.warn(`[WhatsApp Gateway] Aviso ao consultar LID de ${numero}:`, err.message);
  }
}

async function resolverParaTelefone(sock, jid) {
  const texto = String(jid || "");
  if (!texto.endsWith("@lid")) return texto;

  const aprendido = lidParaTelefone.get(texto);
  if (aprendido) {
    console.log(`[WhatsApp Gateway] 🔗 LID ${texto} → ${aprendido} (mapa próprio)`);
    return aprendido;
  }

  try {
    const mapa = sock?.signalRepository?.lidMapping;
    const candidatos = [
      mapa?.getPNForLID?.bind(mapa),
      mapa?.getPNFromLID?.bind(mapa),
    ].filter(Boolean);

    for (const resolver of candidatos) {
      const pn = await resolver(texto);
      const achado = String(pn || "");
      if (achado.includes("@s.whatsapp.net")) {
        console.log(`[WhatsApp Gateway] 🔗 LID ${texto} resolvido para ${achado}`);
        return achado;
      }
      if (/^\d{10,15}$/.test(achado)) {
        const comSufixo = `${achado}@s.whatsapp.net`;
        console.log(`[WhatsApp Gateway] 🔗 LID ${texto} resolvido para ${comSufixo}`);
        return comSufixo;
      }
    }
  } catch (err) {
    console.warn(`[WhatsApp Gateway] Aviso ao resolver LID ${texto}:`, err.message);
  }

  console.warn(`[WhatsApp Gateway] ⚠️ LID ${texto} sem telefone conhecido; enviando para o próprio LID (pode não decifrar).`);
  return texto;
}

function registrarPedidoDeRetransmissao(instanceName, key) {
  const jid = key?.remoteJid;
  if (!jid || String(jid).endsWith("@g.us")) return;

  const agora = Date.now();
  const anterior = pedidosDeRetransmissao.get(jid);
  const dentroDaJanela = anterior && agora - anterior.ultimoEm < JANELA_DE_RETRANSMISSAO_MS;
  const vezes = dentroDaJanela ? anterior.vezes + 1 : 1;
  pedidosDeRetransmissao.set(jid, { vezes, ultimoEm: agora });

  console.warn(`[WhatsApp Gateway] 🔁 ${jid} não conseguiu decifrar; retransmissão nº ${vezes}`);

  if (vezes < RETRANSMISSOES_ATE_RECRIAR) return;

  // Espera o reenvio em curso terminar antes de puxar o tapete da sessão.
  setTimeout(() => {
    const apagados = apagarSessaoDoContato(instanceName, jid);
    pedidosDeRetransmissao.delete(jid);
    console.warn(`[WhatsApp Gateway] 🧹 Sessão de ${jid} descartada (${apagados} arquivo(s)); o próximo envio negocia do zero`);
  }, 5000);

  // Trava de memória: o Map só cresce com contato problemático, mas não fica solto.
  if (pedidosDeRetransmissao.size > 200) {
    pedidosDeRetransmissao.delete(pedidosDeRetransmissao.keys().next().value);
  }
}

// Limpar sessões corrompidas ao iniciar
const CLEAN_ON_BOOT = process.env.CLEAN_SESSIONS === "true";
if (CLEAN_ON_BOOT) {
  const sessionsDir = path.join(__dirname, "data", "sessions");
  try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(sessionsDir, { recursive: true });
  console.log("[WhatsApp Gateway] 🗑️ Sessões limpas no boot (CLEAN_SESSIONS=true)");
}

// Monitoramento de memória - previne OOM + limpeza de cooldowns + auto-restart
setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  if (heapMB > 420) {
    // Memória crítica: forçar restart gracioso (Railway ALWAYS policy reinicia)
    console.error(`[WhatsApp Gateway] 🔴 Memória CRÍTICA: heap=${heapMB}MB. Reiniciando processo...`);
    process.exit(1);
  }
  if (heapMB > 350) {
    console.warn(`[WhatsApp Gateway] ⚠️ Memória alta: heap=${heapMB}MB rss=${rssMB}MB - forçando GC`);
    if (global.gc) { try { global.gc(); } catch(e) {} }
  }
  // Fix 2: Limpar replyCooldowns antigos para evitar memory leak
  const now = Date.now();
  for (const [key, ts] of replyCooldowns.entries()) {
    if (now - ts > 10000) replyCooldowns.delete(key);
  }
  // Limpar sessionLocks órfãos
  for (const [key] of sessionLocks.entries()) {
    if (!sessions.has(key)) sessionLocks.delete(key);
  }
}, 15000);

// Self-ping: mantém o processo ativo a cada 4 min (evita sleep em qualquer hosting)
setInterval(() => {
  const url = `http://localhost:${PORT}/`;
  fetch(url).catch(() => {});
  console.log(`[WhatsApp Gateway] 💓 Self-ping (uptime: ${Math.round(process.uptime())}s, sessões: ${sessions.size})`);
}, 4 * 60 * 1000);

// Fix 1: GC periódico global (único, nunca duplica em reconexões)
if (global.gc) {
  setInterval(() => { try { global.gc(); } catch(e) {} }, 30000);
}

// Fix 3: Auto-health-check - reconecta sessões mortas a cada 5 minutos
// Garante que o bot continue ativo na madrugada mesmo sem tráfego externo
setInterval(() => {
  for (const [name, session] of sessions.entries()) {
    if (session.state !== "open" && session.state !== "connecting") {
      console.log(`[WhatsApp Gateway] 🩺 Health-check: sessão "${name}" está ${session.state}. Reconectando...`);
      getOrCreateSocket(name).catch((err) => {
        console.warn(`[WhatsApp Gateway] ⚠️ Health-check reconexão falhou para ${name}:`, err.message);
      });
    }
  }
  // Também reconectar sessões salvas em disco que não estão no Map
  const sessionsDir = path.join(__dirname, "data", "sessions");
  if (fs.existsSync(sessionsDir)) {
    try {
      const folders = fs.readdirSync(sessionsDir).filter(f => {
        try { return fs.statSync(path.join(sessionsDir, f)).isDirectory(); } catch { return false; }
      });
      for (const folder of folders) {
        if (!sessions.has(folder)) {
          console.log(`[WhatsApp Gateway] 🩺 Health-check: sessão salva "${folder}" não está no Map. Reconectando...`);
          getOrCreateSocket(folder).catch((err) => {
            console.warn(`[WhatsApp Gateway] ⚠️ Health-check reconexão falhou para ${folder}:`, err.message);
          });
        }
      }
    } catch (e) {}
  }
}, 5 * 60 * 1000);

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
    // NUNCA voltar para `async () => undefined`: sem isto, o pedido de
    // retransmissão do WhatsApp fica sem resposta e o destinatário vê
    // "Aguardando mensagem" para sempre. Ver o cache no topo do arquivo.
    getMessage: async (key) => {
      // Ser chamado aqui É a prova de que o destinatário não decifrou.
      registrarPedidoDeRetransmissao(instanceName, key);
      return mensagensEnviadas.get(key?.id) || undefined;
    },
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

  // Fix 1: GC periódico agora é global (não duplica em reconexões)
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

      const isAudio = Boolean(
        msg.message.audioMessage ||
        msg.message.pttMessage ||
        msg.message.ephemeralMessage?.message?.audioMessage ||
        msg.message.viewOnceMessage?.message?.audioMessage ||
        msg.message.viewOnceMessageV2?.message?.audioMessage
      );

      const textMessage =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        (isAudio ? "O cliente enviou a mensagem de áudio em anexo." : "");

      if (!textMessage.trim() && !isAudio) continue;

      // O cooldown existe para não disparar a IA em rajada. Mensagem que SAI do
      // número da loja não chama IA nenhuma — ela é o sinal de que o lojista
      // assumiu a conversa. Se ela caísse no cooldown (o dono respondendo 2s
      // depois do cliente, que é o caso comum), o FireHub nunca ficaria sabendo
      // e o robô continuaria falando por cima dele.
      const isFromMe = Boolean(msg.key?.fromMe);

      const now = Date.now();
      if (!isFromMe) {
        const lastReply = replyCooldowns.get(remoteJid) || 0;
        if (now - lastReply < 3000) {
          console.log(`[WhatsApp Gateway] ⏳ Ignorando mensagem de ${remoteJid} (cooldown)`);
          continue;
        }
        replyCooldowns.set(remoteJid, now);
      }

      let payloadMessage = JSON.parse(JSON.stringify(msg.message));

      if (isAudio) {
        try {
          console.log(`[WhatsApp Gateway] 🎙️ Baixando áudio de ${remoteJid}...`);
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          const base64Str = buffer.toString("base64");
          if (!payloadMessage.audioMessage) payloadMessage.audioMessage = {};
          payloadMessage.audioMessage.base64 = base64Str;
          payloadMessage.audioMessage.mimetype = "audio/ogg";
          console.log(`[WhatsApp Gateway] ✅ Áudio de ${remoteJid} baixado com sucesso (${base64Str.length} chars)`);
        } catch (audioErr) {
          console.error(`[WhatsApp Gateway] ❌ Erro ao baixar áudio de ${remoteJid}:`, audioErr?.message || audioErr);
        }
      }

      console.log(`[WhatsApp Gateway] 💬 Mensagem recebida de ${remoteJid}: "${textMessage}" (isAudio: ${isAudio})`);

      // Conversa endereçada por LID: descobrir o telefone AQUI e mandar junto.
      // O FireHub já procura `senderAlt` entre os candidatos e pontua telefone
      // brasileiro acima de tudo — preenchendo este campo, a resposta passa a
      // sair para o telefone em vez do @lid, que é o que não decifra.
      let senderAlt = "";
      if (String(remoteJid).endsWith("@lid")) {
        const telefoneReal = await resolverParaTelefone(sock, remoteJid);
        if (telefoneReal !== remoteJid) senderAlt = telefoneReal;
        // O que o Baileys entregou nesta mensagem, para não ficar no escuro
        // caso o mapa não tenha o contato.
        console.log(`[WhatsApp Gateway] 🪪 LID recebido. key=${JSON.stringify(msg.key)} senderAlt="${senderAlt}"`);
      }

      try {
        const webhookUrl = process.env.FIREHUB_WEBHOOK_URL || "https://firehubfood.com.br/api/webhook/whatsapp";
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "MESSAGES_UPSERT",
            instance: instanceName,
            data: {
              key: msg.key,
              message: payloadMessage,
              sender: remoteJid,
              senderAlt,
              pushName: msg.pushName || "",
              // Conta empresarial verificada. Cliente de verdade nunca tem esse
              // campo; robô institucional (InfinityPay, banco, marketplace) tem.
              // É o sinal mais barato para o FireHub não entrar em conversa de
              // robô com robô.
              verifiedBizName: msg.verifiedBizName || "",
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

/**
 * Health.
 *
 * `sessions` contava o tamanho do Map — ou seja, quantos sockets EXISTEM, não
 * quantos estão conectados. Uma loja presa em "connecting" há 26 tentativas
 * (sem credencial, gerando QR que ninguém lê) entrava na conta igual a uma loja
 * saudável. Foi assim que o painel disse "5 sessões" com 3 lojas mudas — e o
 * robô "parou de responder" sem nenhum alarme tocar em lugar nenhum.
 *
 * Agora o número que importa é `conectadas`, e `precisamDeQR` lista nome por
 * nome quem está fora. `status` só é "ok" quando não há ninguém caído.
 */
app.get("/", (req, res) => {
  const porEstado = { open: [], connecting: [], outros: [] };
  for (const [nome, s] of sessions.entries()) {
    if (s.state === "open") porEstado.open.push(nome);
    else if (s.state === "connecting") porEstado.connecting.push(nome);
    else porEstado.outros.push(`${nome}:${s.state}`);
  }
  const foraDoAr = [...porEstado.connecting, ...porEstado.outros];
  return res.json({
    status: foraDoAr.length === 0 ? "ok" : "degradado",
    conectadas: porEstado.open.length,
    totalDeInstancias: sessions.size,
    precisamDeQR: foraDoAr,
    lojasConectadas: porEstado.open,
    uptime: process.uptime(),
  });
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

  // Aguarda até 4 segundos se o QR Code ainda estiver sendo gerado
  let attempts = 0;
  while (!session.qrBase64 && session.state !== "open" && attempts < 20) {
    await new Promise((r) => setTimeout(r, 200));
    attempts++;
  }

  if (session.qrBase64) {
    // NÃO devolver `pairingCode` aqui. Havia um "8888-9999" fixo, que o painel
    // exibia como se fosse um código real de "conectar com número de telefone":
    // o lojista digitava, não funcionava nunca, e desistia achando que o
    // sistema estava quebrado. Código de pareamento de verdade só existe sob
    // demanda, no endpoint abaixo, porque a Meta o emite amarrado ao número.
    return res.json({
      code: session.qrBase64,
      base64: session.qrBase64,
      status: 200,
    });
  }

  return res.status(500).json({ error: "Gerando QR Code..." });
});

/**
 * GET /instance/pairing-code/:instanceName?number=5522999999999
 *
 * O caminho SEM câmera: em vez de apontar o celular para o QR na tela, o
 * lojista digita um código de 8 caracteres em
 * WhatsApp → Aparelhos conectados → Conectar com número de telefone.
 *
 * É o que resolve loja remota, onde ninguém está na frente do computador com o
 * telefone na mão — dá para passar o código por ligação ou mensagem.
 *
 * O número tem que ser o MESMO que vai ser conectado, com DDI (55) e DDD.
 */
app.get("/instance/pairing-code/:instanceName", async (req, res) => {
  const numero = String(req.query.number || "").replace(/\D/g, "");
  if (numero.length < 12) {
    return res.status(400).json({ error: "Informe ?number=55DDNUMERO (com 55 e DDD)" });
  }

  const session = await getOrCreateSocket(req.params.instanceName);
  if (session.state === "open") {
    return res.json({ jaConectada: true, phone: session.phone });
  }

  try {
    if (session.sock?.authState?.creds?.registered) {
      return res.status(409).json({ error: "Instância já registrada; reinicie antes de parear de novo" });
    }
    const pairingCode = await session.sock.requestPairingCode(numero);
    console.log(`[WhatsApp Gateway] 🔑 Código de pareamento gerado para ${req.params.instanceName} (${numero})`);
    return res.json({ pairingCode, number: numero });
  } catch (err) {
    console.error(`[WhatsApp Gateway] ❌ Falha ao gerar código de pareamento:`, err?.message || err);
    return res.status(500).json({ error: err?.message || "Falha ao gerar código" });
  }
});

// 3. Criar Instância
app.post("/instance/create", async (req, res) => {
  const { instanceName } = req.body;
  await getOrCreateSocket(instanceName || "default");
  return res.json({ instance: { instanceName, status: "created" } });
});

// 3.4 Restart: derruba e recria a conexão SEM apagar a autenticação.
//
// É o que o botão "Reparar conexão do WhatsApp" do FireHub chama quando as
// mensagens ficam em "Aguardando mensagem": força o Baileys a renegociar as
// sessões de criptografia, mantendo o pareamento — NÃO pede QR de novo.
// Aceita PUT e POST porque a Evolution API oficial mudou o verbo entre
// versões e o FireHub tenta os dois.
async function reiniciarInstancia(req, res) {
  const { instanceName } = req.params;
  const session = sessions.get(instanceName);
  const authFolder = path.join(__dirname, "data", "sessions", instanceName);

  if (!session && !fs.existsSync(authFolder)) {
    return res.status(404).json({ error: "Instance not found" });
  }

  if (session && session.sock) {
    try { session.sock.end(); } catch (e) {}
  }
  sessions.delete(instanceName);
  sessionLocks.delete(instanceName);
  reconnectCounters.delete(instanceName);

  console.log(`[WhatsApp Gateway] 🔄 Restart solicitado para ${instanceName} (autenticação preservada)`);
  try {
    await getOrCreateSocket(instanceName);
    return res.json({ success: true, message: `Instância ${instanceName} reconectando` });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Falha ao reconectar" });
  }
}
app.put("/instance/restart/:instanceName", reiniciarInstancia);
app.post("/instance/restart/:instanceName", reiniciarInstancia);

/**
 * GET /instance/quem-e/:instanceName?number=5522999999999
 *
 * Pergunta ao WhatsApp o que ele sabe sobre um número — inclusive o LID dele —
 * e já grava o caminho de volta no mapa. Serve para diagnosticar conversa presa
 * em "Aguardando mensagem" e para ensinar um contato ao gateway sem esperar que
 * o robô mande alguma coisa para ele.
 */
app.get("/instance/quem-e/:instanceName", async (req, res) => {
  const numero = String(req.query.number || "").replace(/\D/g, "");
  if (!numero) return res.status(400).json({ error: "Informe ?number=55DDNUMERO" });

  const session = sessions.get(req.params.instanceName);
  if (!session || session.state !== "open" || !session.sock) {
    return res.status(400).json({ error: "Instância não conectada" });
  }

  try {
    const resultado = (await session.sock.onWhatsApp(numero)) || [];
    const info = resultado[0] || null;
    if (info?.lid) lembrarLid(info.lid, `${numero}@s.whatsapp.net`);
    return res.json({ numero, info, mapaTem: lidParaTelefone.size });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Falha na consulta" });
  }
});

/**
 * POST /instance/limpar-sessao-do-contato/:instanceName  { "number": "5522..." }
 *
 * Cura manual do "Aguardando mensagem" numa conversa específica. Descarta só a
 * sessão de criptografia DAQUELE contato — o próximo envio negocia chaves novas.
 * Não desconecta a loja, não pede QR, não toca nas outras conversas.
 *
 * A autocura (ver o topo do arquivo) faz isso sozinha quando o WhatsApp pede
 * retransmissão duas vezes; este endpoint é para quando se quer forçar na hora.
 */
app.post("/instance/limpar-sessao-do-contato/:instanceName", (req, res) => {
  const numero = String(req.body?.number || "").replace(/\D/g, "");
  if (!numero) return res.status(400).json({ error: "Informe 'number'" });

  // "todas" cura o mesmo contato em todas as lojas de uma vez — é o caso comum
  // de quem fala com várias (o dono, um motoboy) e não sabe nome de instância.
  const alvos = req.params.instanceName === "todas"
    ? fs.readdirSync(path.join(__dirname, "data", "sessions"), { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name)
    : [req.params.instanceName];

  const jid = `${numero}@s.whatsapp.net`;
  const porInstancia = {};
  for (const instancia of alvos) porInstancia[instancia] = apagarSessaoDoContato(instancia, jid);
  pedidosDeRetransmissao.delete(jid);

  const total = Object.values(porInstancia).reduce((a, b) => a + b, 0);
  console.log(`[WhatsApp Gateway] 🧹 Sessão de ${jid} limpa manualmente (${total} arquivo(s) em ${alvos.length} instância(s))`);
  return res.json({ success: true, jid, arquivosApagados: total, porInstancia });
});

/**
 * POST /instance/renegociar-todas-as-conversas/:instanceName
 *
 * Mutirão: descarta a sessão de criptografia de TODOS os contatos da loja
 * (ou de todas, com "todas"). Existe porque a podridão não estava num contato
 * só — pegou o dono, motoboys e parte dos clientes, e curar um a um exigiria
 * saber de antemão quem está quebrado, que é justamente o que não dá para ver.
 *
 * É seguro: apaga SÓ os arquivos `session-*`. As credenciais da loja
 * (`creds.json`), as nossas prekeys e as chaves de grupo continuam onde estão —
 * ninguém desconecta e ninguém lê QR. O custo é uma busca de prekeys a mais no
 * próximo envio de cada conversa, diluída no ritmo normal de uso.
 */
app.post("/instance/renegociar-todas-as-conversas/:instanceName", (req, res) => {
  const raiz = path.join(__dirname, "data", "sessions");
  const alvos = req.params.instanceName === "todas"
    ? fs.readdirSync(raiz, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    : [req.params.instanceName];

  const porInstancia = {};
  for (const instancia of alvos) {
    let apagados = 0;
    try {
      for (const arquivo of fs.readdirSync(path.join(raiz, instancia))) {
        // SÓ "session-". "pre-key-", "sender-key-", "app-state-" e "creds.json"
        // são nossos e apagá-los derrubaria a loja.
        if (!arquivo.startsWith("session-")) continue;
        fs.rmSync(path.join(raiz, instancia, arquivo), { force: true });
        apagados++;
      }
    } catch (err) {
      console.warn(`[WhatsApp Gateway] Aviso ao renegociar ${instancia}:`, err.message);
    }
    porInstancia[instancia] = apagados;
  }

  pedidosDeRetransmissao.clear();
  const total = Object.values(porInstancia).reduce((a, b) => a + b, 0);
  console.log(`[WhatsApp Gateway] 🧹 Mutirão: ${total} sessão(ões) descartada(s) em ${alvos.length} instância(s); tudo renegocia no próximo envio`);
  return res.json({ success: true, sessoesDescartadas: total, porInstancia });
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
    for (const [outroNome, s] of sessions.entries()) {
      if (s.state === "open" && s.sock) {
        // ⚠️ VISIBILIDADE: este fallback envia pelo número de OUTRA loja.
        // O cliente recebe a mensagem de um restaurante que não é o dele.
        // Mantido por ora para não derrubar envio de loja com nome de
        // instância dessincronizado — mas cada uso fica GRITADO no log
        // para ser investigado.
        console.error(`[WhatsApp Gateway] ⚠️ FALLBACK DE INSTÂNCIA: "${instanceName}" não está conectada; enviando pela sessão "${outroNome}". O destinatário recebe de OUTRO número!`);
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
  const jidBruto = (cleanNum.includes("@s.whatsapp.net") || cleanNum.includes("@lid"))
    ? cleanNum
    : `${cleanNum.replace(/\D/g, "")}@s.whatsapp.net`;
  // Endereço @lid não decifra no aparelho do destinatário — sempre tentar o
  // telefone antes de enviar. Ver resolverParaTelefone no topo do arquivo.
  const jid = await resolverParaTelefone(session.sock, jidBruto);
  // Enviar para um telefone é a oportunidade de aprender o LID dele. Não trava
  // o envio: se a consulta falhar, a mensagem sai do mesmo jeito.
  if (jid.endsWith("@s.whatsapp.net")) aprenderLidDoTelefone(session.sock, jid).catch(() => {});

  try {
    const enviada = await session.sock.sendMessage(jid, { text });
    lembrarEnviada(enviada);
    console.log(`[WhatsApp Gateway] 🚀 Mensagem enviada com sucesso para ${jid}: "${text.slice(0, 50)}..."`);
    return res.json({ status: "SENT", to: jid });
  } catch (err) {
    console.error(`[WhatsApp Gateway] ❌ Erro ao enviar mensagem para ${jid}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

// 4.1 Enviar Mídia (Imagem com legenda)
app.post("/message/sendMedia/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const { number, mediaMessage, mediaUrl: directMediaUrl, caption: directCaption } = req.body || {};

  let session = sessions.get(instanceName);
  if (!session || session.state !== "open") {
    for (const [outroNome, s] of sessions.entries()) {
      if (s.state === "open" && s.sock) {
        console.error(`[WhatsApp Gateway] ⚠️ FALLBACK DE INSTÂNCIA (mídia): "${instanceName}" não está conectada; enviando pela sessão "${outroNome}". O destinatário recebe de OUTRO número!`);
        session = s;
        break;
      }
    }
  }

  if (!session || session.state !== "open" || !session.sock) {
    return res.status(400).json({ error: "Instância não conectada no celular" });
  }

  const cleanNum = String(number || "").trim();
  const jidBrutoMidia = (cleanNum.includes("@s.whatsapp.net") || cleanNum.includes("@lid"))
    ? cleanNum
    : `${cleanNum.replace(/\D/g, "")}@s.whatsapp.net`;
  // Mesma regra do texto: mídia para @lid também não decifra.
  const jid = await resolverParaTelefone(session.sock, jidBrutoMidia);

  const mediaUrl = mediaMessage?.media || mediaMessage?.url || directMediaUrl;
  const caption = mediaMessage?.caption || directCaption || "";

  if (!mediaUrl) {
    return res.status(400).json({ error: "URL da mídia é obrigatória" });
  }

  // PDF enviado como "image" chega quebrado no aparelho: documento vai como
  // documento, com nome de arquivo — é o que o FireHub manda em mediatype.
  const ehDocumento = (mediaMessage?.mediatype || "").toLowerCase() === "document";

  try {
    const enviada = await session.sock.sendMessage(jid, ehDocumento
      ? {
          document: { url: mediaUrl },
          mimetype: /\.pdf(\?|$)/i.test(mediaUrl) ? "application/pdf" : undefined,
          fileName: mediaMessage?.fileName || "arquivo.pdf",
          caption: caption || undefined,
        }
      : {
          image: { url: mediaUrl },
          caption: caption || undefined,
        });
    lembrarEnviada(enviada);
    console.log(`[WhatsApp Gateway] 📸 Mídia (${ehDocumento ? "documento" : "imagem"}) enviada com sucesso para ${jid}: "${mediaUrl}"`);
    return res.json({ status: "SENT", to: jid });
  } catch (err) {
    console.error(`[WhatsApp Gateway] ❌ Erro ao enviar mídia para ${jid}:`, err);
    try {
      if (caption) {
        await session.sock.sendMessage(jid, { text: caption });
      }
    } catch {}
    return res.status(500).json({ error: err.message });
  }
});

// 4.5 Obter Base64 de Mídia / Áudio via API REST
app.post("/chat/getBase64FromMediaMessage/:instanceName", async (req, res) => {
  const { instanceName } = req.params;
  const { message } = req.body || {};

  try {
    let session = sessions.get(instanceName);
    if (!session || session.state !== "open") {
      for (const s of sessions.values()) {
        if (s.state === "open" && s.sock) {
          session = s;
          break;
        }
      }
    }

    if (!session || !session.sock) {
      return res.status(400).json({ error: "Sessão não conectada" });
    }

    const msgObj = message?.key ? message : { key: message?.key || {}, message: message?.message || message };
    const buffer = await downloadMediaMessage(msgObj, "buffer", {});
    const base64Str = buffer.toString("base64");
    return res.json({ base64: base64Str, status: "SUCCESS" });
  } catch (err) {
    console.error("[WhatsApp Gateway] Erro no endpoint getBase64FromMediaMessage:", err);
    return res.status(500).json({ error: err.message || "Falha ao baixar mídia" });
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
