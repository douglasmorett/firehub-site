import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendEvolutionMessage } from '@/lib/whatsapp-evolution';
import { processChatbotAI } from '@/lib/chatbot-ai';

export const dynamic = 'force-dynamic';

// In-memory caches
interface CacheMsg {
  sender: string;
  text: string;
  timestamp: number;
}
const conversationCache = new Map<string, CacheMsg[]>();
const cooldownCache = new Map<string, number>();

function cleanCache() {
  const now = Date.now();
  for (const [jid, msgs] of conversationCache.entries()) {
    // Evict messages older than 30 minutes
    const validMsgs = msgs.filter(m => now - m.timestamp < 30 * 60 * 1000);
    if (validMsgs.length === 0) {
      conversationCache.delete(jid);
    } else {
      conversationCache.set(jid, validMsgs);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    cleanCache();

    const body = await req.json();
    const event = (body.event || body.type || "").toUpperCase();
    const instance = body.instance || body.instanceName;
    const time = new Date().toISOString();

    console.log(`[${time}] [WhatsApp Webhook] Evento recebido: "${event}" para instância "${instance}"`);

    // 1. Atualização de conexão (QR Code escaneado / conectado no celular)
    if ((event.includes("CONNECTION") || event.includes("STATE")) && instance) {
      const shortId = instance.replace(/^firehub_/, "");
      const user = await prisma.user.findFirst({
        where: { id: { endsWith: shortId } },
        select: { id: true, chatbotConfig: true },
      });

      if (user) {
        const config = (user.chatbotConfig as any) || {};
        const phone = body.data?.ownerJid?.split("@")[0] || body.data?.phone || "";
        const formattedPhone = phone ? `+55 ${phone.replace(/^55/, "")}` : "";

        await prisma.user.update({
          where: { id: user.id },
          data: {
            chatbotConfig: {
              ...config,
              connected: true,
              phone: formattedPhone || config.phone || "+55 (21) 99999-9999",
              connectedAt: new Date().toISOString(),
            },
          },
        });
        console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] ✅ Instância ${instance} conectada no celular!`);
      }
      return NextResponse.json({ status: "connected" });
    }

    // 2. Recebimento de mensagens (MESSAGES_UPSERT / MESSAGES.UPSERT)
    if ((event.includes("MESSAGE") || event.includes("UPSERT") || body.data?.message) && instance) {
      const data = body.data || body;
      const key = data.key || data.message?.key || {};
      const fromMe = key.fromMe;
      const remoteJid = key.remoteJid || data.from || "";

      // Anti-loop: ALWAYS ignore fromMe (mensagens do próprio bot)
      if (fromMe === true) {
        return NextResponse.json({ status: "ignored_from_me" });
      }

      // Ignore status broadcasts
      if (remoteJid.includes("@broadcast") || remoteJid.includes("status@broadcast")) {
        return NextResponse.json({ status: "ignored_broadcast" });
      }

      // Ignore groups
      if (remoteJid.endsWith("@g.us") || remoteJid.includes("@g.us")) {
        return NextResponse.json({ status: "ignored_group" });
      }

      // Suporte a Mensagens de Áudio (audioMessage / ptt)
      const audioObj = data.message?.audioMessage || data.message?.pttMessage || data.audio;
      let audioData: { base64: string; mimeType: string } | undefined = undefined;

      if (audioObj) {
        const base64Data = audioObj.base64 || audioObj.data || data.base64;
        const mimeType = audioObj.mimetype || audioObj.mimeType || "audio/ogg; codecs=opus";
        if (base64Data) {
          audioData = { base64: base64Data, mimeType };
        }
      }

      const textMessage =
        data.message?.conversation ||
        data.message?.extendedTextMessage?.text ||
        data.message?.imageMessage?.caption ||
        data.body ||
        data.text ||
        (audioData ? "[Mensagem de Áudio enviada pelo cliente]" : "");

      if (!textMessage.trim() && !audioData) {
        return NextResponse.json({ status: "empty_message" });
      }

      // Cooldown check (não responder se a última resposta foi há menos de 3 segundos)
      const now = Date.now();
      const lastResponse = cooldownCache.get(remoteJid) || 0;
      if (now - lastResponse < 3000) {
        console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Cooldown ativo para ${remoteJid}`);
        return NextResponse.json({ status: "ignored_cooldown" });
      }

      const shortId = instance.replace(/^firehub_/, "");
      let user = await prisma.user.findFirst({
        where: { id: { endsWith: shortId } },
        select: { id: true, chatbotConfig: true },
      });

      if (!user) {
        user = await prisma.user.findFirst({
          select: { id: true, chatbotConfig: true },
        });
      }

      if (!user) {
        console.warn(`[${new Date().toISOString()}] [WhatsApp Webhook] Usuário com id curto ${shortId} não encontrado.`);
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // Registrar / atualizar o contato do cliente automaticamente na base de dados
      const cleanPhone = (remoteJid || data.from || "").split("@")[0].replace(/\D/g, "");
      if (cleanPhone && cleanPhone.length >= 10 && !cleanPhone.startsWith("0800") && !cleanPhone.startsWith("550800")) {
        const pushName = data.pushName || data.name;
        const contactName = pushName && pushName.trim() ? pushName.trim() : `Cliente WhatsApp (${cleanPhone.slice(-4)})`;
        
        prisma.storeCustomer.upsert({
          where: { phone: cleanPhone },
          update: {
            updatedAt: new Date(),
            ...(pushName ? { name: pushName } : {}),
          },
          create: {
            phone: cleanPhone,
            name: contactName,
            password: "",
          },
        }).catch((err) => console.error("[WhatsApp Webhook] Erro ao registrar StoreCustomer:", err));
      }

      const chatbotConfig = (user.chatbotConfig as any) || {};
      if (chatbotConfig.active === false) {
        return NextResponse.json({ status: "chatbot_disabled" });
      }

      // Se o cliente já pediu atendente humano nesta conversa e a opção de pausar está ligada
      const pausedCacheKey = `paused_${user.id}_${remoteJid}`;
      if (cooldownCache.get(pausedCacheKey)) {
        console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Robô pausado para ${remoteJid} (atendente humano assumiu)`);
        return NextResponse.json({ status: "ignored_human_paused" });
      }

      const stopOnHuman = chatbotConfig.stopOnHumanRequest !== false;
      const lowerMsg = textMessage.toLowerCase();
      const isAskingHuman = /atendente|humano|falar com pessoa|falar com gente|suporte|atendimento humano|falar com atendente/i.test(lowerMsg);

      if (stopOnHuman && isAskingHuman) {
        const humanReply = "Entendido! Já avisei nossa equipe e um atendente humano vai te responder por aqui em instantes. Por favor, aguarde só um momento! 😊";
        const recipientTarget = remoteJid || data.from || "";
        await sendEvolutionMessage(user.id, recipientTarget, humanReply);
        
        // Marca a conversa como pausada por 12 horas para o robô não responder mais automaticamente
        cooldownCache.set(pausedCacheKey, Date.now() + 12 * 60 * 60 * 1000);

        // Registra na fila do balãozinho flutuante de atendimento humano
        if (!global.__humanSupportChats) {
          global.__humanSupportChats = new Map();
        }
        const key = `${user.id}_${remoteJid}`;
        const existing = global.__humanSupportChats.get(key);
        const cleanPhone = remoteJid.split("@")[0].replace(/\D/g, "");
        const formattedPhone = cleanPhone ? `+55 ${cleanPhone.replace(/^55/, "")}` : remoteJid;

        const newMsgList = existing ? existing.messages : [];
        newMsgList.push({ sender: "user", text: textMessage, timestamp: Date.now() });
        newMsgList.push({ sender: "bot", text: humanReply, timestamp: Date.now() });

        global.__humanSupportChats.set(key, {
          id: key,
          userId: user.id,
          jid: remoteJid,
          phone: formattedPhone,
          clientName: data.pushName || formattedPhone,
          status: "PENDING",
          unreadCount: (existing?.unreadCount || 0) + 1,
          lastMessage: textMessage,
          updatedAt: Date.now(),
          messages: newMsgList,
        });

        return NextResponse.json({ status: "paused_for_human" });
      }

      // Se a conversa já estiver pausada para atendimento humano e o cliente enviar novas mensagens
      const pausedKey = `${user.id}_${remoteJid}`;
      if (global.__humanSupportChats?.has(pausedKey)) {
        const chat = global.__humanSupportChats.get(pausedKey)!;
        if (chat.status !== "CLOSED") {
          chat.messages.push({ sender: "user", text: textMessage, timestamp: Date.now() });
          chat.lastMessage = textMessage;
          chat.updatedAt = Date.now();
          chat.unreadCount = (chat.unreadCount || 0) + 1;
          return NextResponse.json({ status: "appended_to_human_queue" });
        }
      }

      // Prepare and format history to pass to AI
      const history = conversationCache.get(remoteJid) || [];
      const aiHistory = history.map(msg => ({ sender: msg.sender, text: msg.text }));

      console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Processando IA para ${remoteJid} com ${aiHistory.length} mensagens no histórico...`);
      
      const aiResponse = await processChatbotAI(user.id, textMessage, aiHistory, remoteJid, audioData);
      
      if (aiResponse?.reply) {
        // Human typing delay (1000ms a 2500ms)
        const delay = Math.floor(Math.random() * (2500 - 1000 + 1)) + 1000;
        await new Promise(r => setTimeout(r, delay));

        const recipientTarget = remoteJid || data.from || "";
        await sendEvolutionMessage(user.id, recipientTarget, aiResponse.reply);
        
        console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] 🤖 Resposta enviada para ${recipientTarget}: "${aiResponse.reply}"`);
        
        // Update cache after response
        history.push({ sender: 'user', text: textMessage, timestamp: now });
        history.push({ sender: 'bot', text: aiResponse.reply, timestamp: Date.now() });
        
        // Keep only the last 15 messages
        const updatedHistory = history.slice(-15);
        
        conversationCache.set(remoteJid, updatedHistory);
        cooldownCache.set(remoteJid, Date.now());
      }
    }

    return NextResponse.json({ status: "success" });
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] [WhatsApp Webhook Error]`, err);
    return NextResponse.json({ error: err.message || "Webhook error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "WhatsApp Webhook Active" });
}
