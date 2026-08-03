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
  // Limpa conversas antigas (>30 min)
  for (const [jid, msgs] of conversationCache.entries()) {
    const validMsgs = msgs.filter(m => now - m.timestamp < 30 * 60 * 1000);
    if (validMsgs.length === 0) {
      conversationCache.delete(jid);
    } else {
      conversationCache.set(jid, validMsgs);
    }
  }
  // Limpa cooldowns expirados para evitar memory leak
  for (const [key, ts] of cooldownCache.entries()) {
    // Cooldowns normais: são timestamps do passado (ex: Date.now() do momento da resposta)
    // Cooldowns de pausa humana: são timestamps do futuro (ex: Date.now() + 12h)
    // Limpar entradas que são cooldowns normais com mais de 10 segundos
    // E entradas de pausa humana que já expiraram
    if (ts < now && now - ts > 10000) {
      cooldownCache.delete(key);
    } else if (ts > now && ts < now - 24 * 60 * 60 * 1000) {
      // Limpa pausas com mais de 24h (safety net)
      cooldownCache.delete(key);
    }
  }
}

/** Executa uma Promise com timeout. Se estourar, retorna null em vez de travar. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
}

export async function POST(req: NextRequest) {
  // ── REGRA CRÍTICA: SEMPRE retornar 200 para a Evolution API ──
  // Se retornarmos 500, a Evolution API pode desativar o webhook
  // e o bot para de receber mensagens completamente.
  try {
    cleanCache();

    const body = await req.json();
    const event = (body.event || body.type || "").toUpperCase();
    const instance = body.instance || body.instanceName;
    const time = new Date().toISOString();

    console.log(`[${time}] [WhatsApp Webhook] Evento recebido: "${event}" para instância "${instance}"`);

    // 1. Atualização de conexão (QR Code escaneado / conectado no celular)
    if ((event.includes("CONNECTION") || event.includes("STATE")) && instance) {
      try {
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
      } catch (connErr: any) {
        console.error(`[WhatsApp Webhook] Erro ao processar conexão:`, connErr?.message);
      }
      return NextResponse.json({ status: "connected" });
    }

    // 2. Recebimento de mensagens e chamadas (MESSAGES_UPSERT, CALL, etc.)
    if ((event.includes("MESSAGE") || event.includes("UPSERT") || event.includes("CALL") || body.data?.message || body.data?.call) && instance) {
      try {
        await handleIncomingMessage(body, instance);
      } catch (msgErr: any) {
        // Loga o erro mas NUNCA retorna 500 — o bot deve continuar funcionando
        console.error(`[${new Date().toISOString()}] [WhatsApp Webhook] ❌ Erro ao processar mensagem:`, msgErr?.message || msgErr);
      }
    }

    // SEMPRE retorna 200
    return NextResponse.json({ status: "success" });
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}] [WhatsApp Webhook Error]`, err);
    // MESMO em erro fatal, retorna 200 para a Evolution API não desativar o webhook
    return NextResponse.json({ status: "error_handled", error: err.message || "Webhook error" });
  }
}

/**
 * Processa uma mensagem recebida do cliente.
 * Isolada em função separada para que erros aqui NUNCA derrubem o webhook.
 */
async function handleIncomingMessage(body: any, instance: string) {
  const data = body.data || body;
  const key = data.key || data.message?.key || {};
  const fromMe = key.fromMe;

  // Extrai o remoteJid e telefone real (filtrando IDs internos @lid do WhatsApp)
  const getRealJid = (): string => {
    const candidates = [
      key.remoteJidAlt,
      data.key?.remoteJidAlt,
      data.senderAlt,
      data.sender,
      key.participant,
      data.participantAlt,
      key.remoteJid,
      data.from,
    ].filter(Boolean);

    const isCleanPhoneJid = (c: string) => {
      if (typeof c !== "string") return false;
      if (c.includes("@lid") || c.includes("@broadcast") || c.includes("@g.us")) return false;
      const digits = c.replace(/\D/g, "");
      // Telefone válido do WhatsApp Brasil tem entre 10 e 13 dígitos. LIDs possuem 14+ dígitos.
      return digits.length >= 10 && digits.length <= 13 && !digits.startsWith("22010");
    };

    const cleanCandidate = candidates.find(isCleanPhoneJid);
    if (cleanCandidate) return cleanCandidate;

    const whatsappNetCandidate = candidates.find(
      (c: string) => typeof c === "string" && c.includes("@s.whatsapp.net") && !c.includes("@lid")
    );
    if (whatsappNetCandidate) return whatsappNetCandidate;

    return key.remoteJid || data.from || "";
  };

  const remoteJid = getRealJid();

  // Anti-loop: ALWAYS ignore fromMe (mensagens do próprio bot)
  if (fromMe === true) return;

  // Ignore status broadcasts
  if (remoteJid.includes("@broadcast") || remoteJid.includes("status@broadcast")) return;

  // Ignore groups
  if (remoteJid.endsWith("@g.us") || remoteJid.includes("@g.us")) return;

  const shortId = instance.replace(/^firehub_/, "");
  let user = await prisma.user.findFirst({
    where: { id: { endsWith: shortId } },
    select: { id: true, ownerId: true, chatbotConfig: true, slug: true },
  });

  if (!user) {
    user = await prisma.user.findFirst({
      select: { id: true, ownerId: true, chatbotConfig: true, slug: true },
    });
  }

  if (!user) {
    console.warn(`[${new Date().toISOString()}] [WhatsApp Webhook] Usuário com id curto ${shortId} não encontrado.`);
    return;
  }

  // Suporte Avançado a Mensagens de Áudio e Voz (audioMessage / ptt / ephemeral / viewOnce)
  const isAudioMessage = Boolean(
    data.message?.audioMessage ||
    data.message?.pttMessage ||
    data.message?.ephemeralMessage?.message?.audioMessage ||
    data.message?.viewOnceMessage?.message?.audioMessage ||
    data.message?.viewOnceMessageV2?.message?.audioMessage ||
    data.audio ||
    data.messageType === "audio" ||
    data.messageType === "audioMessage" ||
    data.messageType === "pttMessage" ||
    data.type === "audio" ||
    data.type === "ptt"
  );

  const audioObj =
    data.message?.audioMessage ||
    data.message?.pttMessage ||
    data.message?.ephemeralMessage?.message?.audioMessage ||
    data.message?.viewOnceMessage?.message?.audioMessage ||
    data.message?.viewOnceMessageV2?.message?.audioMessage ||
    data.audio;

  let audioData: { base64: string; mimeType: string } | undefined = undefined;

  if (isAudioMessage || audioObj) {
    let base64Data = audioObj?.base64 || audioObj?.data || data.base64 || data.message?.base64;
    const rawMime = audioObj?.mimetype || audioObj?.mimeType || "audio/ogg";
    const mimeType = rawMime.split(";")[0].trim() || "audio/ogg";

    if (!base64Data && audioObj?.url) {
      try {
        const audioRes = await fetch(audioObj.url);
        if (audioRes.ok) {
          const buffer = await audioRes.arrayBuffer();
          base64Data = Buffer.from(buffer).toString("base64");
        }
      } catch (err) {
        console.error("[WhatsApp Webhook] Erro ao baixar áudio da URL:", err);
      }
    }

    if (!base64Data && key.id) {
      try {
        const { getEvolutionAudioBase64 } = await import("@/lib/whatsapp-evolution");
        base64Data = await getEvolutionAudioBase64(instance || user.id, key, data);
        if (!base64Data && user.id) {
          base64Data = await getEvolutionAudioBase64(user.id, key, data);
        }
        if (!base64Data && user.ownerId) {
          base64Data = await getEvolutionAudioBase64(user.ownerId, key, data);
        }
      } catch (err) {
        console.error("[WhatsApp Webhook] Erro ao buscar base64 do áudio via Evolution API:", err);
      }
    }

    if (base64Data) {
      audioData = { base64: base64Data, mimeType };
    }
  }

  const rawText =
    data.message?.conversation ||
    data.message?.extendedTextMessage?.text ||
    data.message?.imageMessage?.caption ||
    data.body ||
    data.text ||
    "";

  // Detecção de Ligação de Voz / Chamada Perdida
  const eventName = (body.event || body.type || "").toUpperCase();
  const isCallEvent =
    eventName.includes("CALL") ||
    eventName.includes("LIGAÇÃO") ||
    eventName.includes("LIGACAO") ||
    data.messageType === "call" ||
    data.type === "call" ||
    Boolean(data.message?.callLogMessage) ||
    Boolean(data.call) ||
    Boolean(data.callLog) ||
    Boolean(data.messageStubType && String(data.messageStubType).toUpperCase().includes("CALL")) ||
    (typeof rawText === "string" && /ligação de voz|ligacao de voz|chamada perdida|missed call|voice call/i.test(rawText));

  if (isCallEvent) {
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] 📞 Chamada de voz detectada de ${remoteJid}`);
    const cleanTarget = remoteJid.replace(/@.*$/, "");
    if (cleanTarget) {
      sendEvolutionMessage(
        instance || user.id,
        cleanTarget,
        "Desculpe, não conseguimos atender ligações por aqui! 😅 Como posso te ajudar?"
      ).catch(() => {});
    }
    return;
  }

  let textMessage = rawText;
  if (!textMessage.trim() && (isAudioMessage || audioObj)) {
    if (audioData?.base64) {
      textMessage = "O cliente enviou a mensagem de áudio em anexo. Por favor escute o áudio com atenção, entenda o pedido ou dúvida do cliente e responda no mesmo tom carinhoso e prestativo do cardápio.";
    } else {
      // Se não conseguiu baixar o áudio de jeito nenhum, envia uma resposta amigável de fallback pedindo para o cliente regravar ou digitar
      const cleanTarget = remoteJid.replace(/@.*$/, "");
      sendEvolutionMessage(
        instance || user.id,
        cleanTarget,
        "Ops, tentei ouvir o seu áudio mas deu uma instabilidade no sinal! 😅\n\nVocê pode me mandar em texto ou gravar um novo áudio para eu te ajudar?"
      ).catch(() => {});
      return;
    }
  }

  if (!textMessage.trim() && !audioData) return;

  // Cooldown check (não responder se a última resposta foi há menos de 3 segundos)
  const now = Date.now();
  const lastResponse = cooldownCache.get(remoteJid) || 0;
  if (now - lastResponse < 3000) {
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Cooldown ativo para ${remoteJid}`);
    return;
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
  if (chatbotConfig.active === false) return;

  // ── DETECT JOTAJA / IFOOD AUTOMATIC ORDER CONFIRMATION MESSAGE FROM CUSTOMER ──
  const isJotajaConfirmationMsg =
    (textMessage.includes("SEU PEDIDO:") || textMessage.includes("Acompanhe abaixo o pedido") || textMessage.includes("RESUMO DO PEDIDO") || textMessage.includes("Jotajá") || textMessage.includes("jotaja.com.br")) &&
    (textMessage.includes("Pedido nº:") || textMessage.includes("Realizado em:") || textMessage.includes("RESUMO DO PEDIDO") || textMessage.includes("ENDEREÇO DE ENTREGA"));

  if (isJotajaConfirmationMsg) {
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Mensagem de confirmação automática do Jotajá recebida de ${remoteJid}`);
    const cleanTarget = remoteJid.replace(/@.*$/, "");
    cooldownCache.set(remoteJid, Date.now());

    // Extrair o número do pedido para a resposta carinhosa e auto-resgate
    const orderNumMatch = textMessage.match(/Pedido\s*n[ºo]?:\s*#?(\d+)/i);
    const orderNum = orderNumMatch ? orderNumMatch[1] : "";

    // 🚀 AUTO-RESGATE EM TEMPO REAL: Garantir que se o evento do Jotajá não tiver sido polled, importa na hora!
    if (orderNum) {
      (async () => {
        try {
          const targetFranchiseeId = user.ownerId || user.id;
          const existing = await prisma.customerOrder.findFirst({
            where: {
              OR: [
                { openDeliveryOrderId: orderNum },
                { openDeliveryOrderId: { startsWith: `${orderNum}_` } },
                { openDeliveryReference: orderNum }
              ]
            }
          });

          if (!existing) {
            console.log(`[WhatsApp Webhook] Auto-resgatando pedido JotaJá #${orderNum}...`);
            const { jotajaFetch, jotajaMutate } = await import("@/lib/jotaja-api");
            const { processJotajaEvent } = await import("@/lib/processJotajaEvent");

            await processJotajaEvent(
              { orderId: orderNum, eventType: "CREATED", code: "PLC" },
              jotajaFetch,
              jotajaMutate,
              targetFranchiseeId
            );
          }
        } catch (rescueErr: any) {
          console.warn("[WhatsApp Webhook] Erro ao auto-resgatar pedido JotaJá:", rescueErr?.message);
        }
      })();
    }

    const thankMsg = orderNum
      ? `Recebemos a confirmação do seu pedido *#${orderNum}* pelo Jotajá! 📝\n\nMuito obrigado pela preferência! 🛵 Seu pedido já está em nosso sistema e está sendo preparado com todo carinho pela nossa equipe!\n\nSe precisar de qualquer dúvida ou alteração, pode falar por aqui! 😊`
      : `Recebemos a confirmação do seu pedido pelo Jotajá! 📝\n\nMuito obrigado pela preferência! 🛵 Seu pedido já está em nosso sistema e está sendo preparado com todo carinho pela nossa equipe!\n\nSe precisar de qualquer dúvida ou alteração, pode falar por aqui! 😊`;

    sendEvolutionMessage(instance || user.id, cleanTarget, thankMsg).catch(() => {});
    return;
  }

  // Se o cliente já pediu atendente humano nesta conversa e a opção de pausar está ligada
  const pausedCacheKey = `paused_${user.id}_${remoteJid}`;
  const pausedUntil = cooldownCache.get(pausedCacheKey);
  if (pausedUntil && Date.now() < pausedUntil) {
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Robô pausado para ${remoteJid} (atendente humano assumiu)`);
    return;
  } else if (pausedUntil) {
    cooldownCache.delete(pausedCacheKey);
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
    const humanKey = `${user.id}_${remoteJid}`;
    const existing = global.__humanSupportChats.get(humanKey);
    const formattedPhone = cleanPhone ? `+55 ${cleanPhone.replace(/^55/, "")}` : remoteJid;

    const newMsgList = existing ? existing.messages : [];
    newMsgList.push({ sender: "user", text: textMessage, timestamp: Date.now() });
    newMsgList.push({ sender: "bot", text: humanReply, timestamp: Date.now() });

    global.__humanSupportChats.set(humanKey, {
      id: humanKey,
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

    return;
  }

  // Se a conversa já estiver na fila de atendimento humano
  const pausedKey = `${user.id}_${remoteJid}`;
  if (global.__humanSupportChats?.has(pausedKey)) {
    const chat = global.__humanSupportChats.get(pausedKey)!;
    // Se passaram mais de 30 minutos sem atendimento humano, expira e faz o robô voltar a atender
    const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
    if (Date.now() - chat.updatedAt > INACTIVITY_TIMEOUT) {
      console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Atendimento humano expirou por inatividade para ${remoteJid}. Reativando robô.`);
      chat.status = "CLOSED";
      global.__humanSupportChats.delete(pausedKey);
      cooldownCache.delete(pausedCacheKey);
    } else if (chat.status !== "CLOSED") {
      chat.messages.push({ sender: "user", text: textMessage, timestamp: Date.now() });
      chat.lastMessage = textMessage;
      chat.updatedAt = Date.now();
      chat.unreadCount = (chat.unreadCount || 0) + 1;
      return;
    }
  }

  // Prepare and format history to pass to AI
  const history = conversationCache.get(remoteJid) || [];
  const aiHistory = history.map(msg => ({ sender: msg.sender, text: msg.text }));

  console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Processando IA para ${remoteJid} com ${aiHistory.length} mensagens no histórico...`);
  
  // ── Chamada da IA com TIMEOUT de 15 segundos ──
  // Se o Gemini travar, não podemos deixar o webhook pendurado — a Evolution API
  // desiste e para de enviar mensagens para o nosso endpoint.
  let aiResponse: { reply: string } | null = null;
  const defaultStoreLink = user.slug ? `https://firehubfood.com.br/loja/${user.slug}` : "https://firehubfood.com.br";
  const storeLink = (user.chatbotConfig as any)?.externalMenuUrl || defaultStoreLink;

  try {
    aiResponse = await withTimeout(
      processChatbotAI(user.id, textMessage, aiHistory, remoteJid, audioData, data.pushName),
      25000 // 25 segundos máximo
    );
  } catch (aiErr: any) {
    console.error(`[${new Date().toISOString()}] [WhatsApp Webhook] ❌ Erro na IA para ${remoteJid}:`, aiErr?.message || aiErr);
    aiResponse = { reply: `Oi! 😊 Te ajudo sim! Como posso te atender hoje? Se quiser conferir nosso cardápio completo e fazer seu pedido, acesse: ${storeLink}` };
  }

  if (!aiResponse) {
    console.warn(`[${new Date().toISOString()}] [WhatsApp Webhook] ⏳ Timeout de 15s para ${remoteJid}. Enviando fallback.`);
    aiResponse = { reply: `Oi! 😊 Te ajudo sim! Como posso te atender hoje? Se quiser conferir nosso cardápio completo e fazer seu pedido, acesse: ${storeLink}` };
  }
  
  if (aiResponse?.reply) {
    let replyText = aiResponse.reply;
    let callHuman = false;

    if (replyText.includes("[[CHAMAR_ATENDENTE: true]]") || replyText.includes("[[CHAMAR_ATENDENTE]]")) {
      callHuman = true;
      replyText = replyText.replace(/\[\[CHAMAR_ATENDENTE.*\]\]/g, "").trim();
    }

    // Human typing delay (1000ms a 2500ms)
    const delay = Math.floor(Math.random() * (2500 - 1000 + 1)) + 1000;
    await new Promise(r => setTimeout(r, delay));

    const recipientTarget = remoteJid || data.from || "";
    await sendEvolutionMessage(user.id, recipientTarget, replyText);
    
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] 🤖 Resposta enviada para ${recipientTarget}: "${replyText}"`);

    if (callHuman) {
      cooldownCache.set(pausedCacheKey, Date.now() + 12 * 60 * 60 * 1000);
      if (!global.__humanSupportChats) {
        global.__humanSupportChats = new Map();
      }
      const humanKey = `${user.id}_${remoteJid}`;
      const existing = global.__humanSupportChats.get(humanKey);
      const formattedPhone = cleanPhone ? `+55 ${cleanPhone.replace(/^55/, "")}` : remoteJid;

      const newMsgList = existing ? existing.messages : [];
      newMsgList.push({ sender: "user", text: textMessage, timestamp: now });
      newMsgList.push({ sender: "bot", text: replyText, timestamp: Date.now() });

      global.__humanSupportChats.set(humanKey, {
        id: humanKey,
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
      console.log(`[WhatsApp Webhook] 🙋 Chat transferido para atendimento humano por solicitação/cancelamento (${remoteJid})`);
    }
    
    // Update cache after response
    history.push({ sender: 'user', text: textMessage, timestamp: now });
    history.push({ sender: 'bot', text: replyText, timestamp: Date.now() });
    
    // Keep only the last 15 messages
    const updatedHistory = history.slice(-15);
    
    conversationCache.set(remoteJid, updatedHistory);
    cooldownCache.set(remoteJid, Date.now());
  }
}

export async function GET() {
  return NextResponse.json({ status: "WhatsApp Webhook Active" });
}
