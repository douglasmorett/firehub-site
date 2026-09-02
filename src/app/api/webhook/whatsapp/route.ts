import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { registrarEstadoDoRobo } from '@/lib/whatsapp-estado';
import { sendEvolutionMessage } from '@/lib/whatsapp-evolution';
import { processChatbotAI } from '@/lib/chatbot-ai';
import { trackWhatsAppMessage } from '@/lib/usage-tracker';
import { registrarTrace, mascararTelefone } from '@/lib/webhook-trace';
import {
  evaluateLoopGuard,
  handleOutgoingMessage,
  registerBotReply,
  clearLoopGuard,
  passarParaAtendimentoHumano,
  conversaEstaComHumano,
} from '@/lib/loop-guard';
import { detectarProblemaNoPedido, FRASE_DE_TRANSFERENCIA } from '@/lib/problema-no-pedido';
import { numeroEstaNaListaDeIgnorados } from '@/lib/numeros-ignorados';
import { avisarDono, textoDeProblemaNoPedido } from '@/lib/alertas-do-dono';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Evita timeout silencioso do Vercel (504) se a IA ou download demorar

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

    // ── 1. MUDANÇA DE CONEXÃO — NOS DOIS SENTIDOS ────────────────────────────
    //
    // Este bloco gravava `connected: true` SEMPRE, qualquer que fosse o estado
    // que viesse no corpo — e nunca gravava false. Somado ao gateway, que só
    // avisava quando a sessão ABRIA, ninguém no sistema inteiro tinha como
    // desmarcar uma loja caída: a bandeira ficava verde para sempre.
    //
    // Era a reclamação do dono, literal: "não ficar marcando como conectado sem
    // estar". A faixa de "religue seu robô" (AvisoRoboDesconectado, montada no
    // layout de /store) depende de `desconectadoDesde`, que só é carimbado
    // quando alguém registra a queda. Ninguém registrava.
    //
    // Agora o estado do corpo é respeitado e a gravação passa por
    // `registrarEstadoDoRobo` — a mesma peça que a tela do Chatbot e a faixa
    // usam. Uma fonte de verdade só, para as três não divergirem de novo.
    if ((event.includes("CONNECTION") || event.includes("STATE")) && instance) {
      try {
        const shortId = instance.replace(/^firehub_/, "");
        const user = await prisma.user.findFirst({
          where: { id: { endsWith: shortId } },
          select: { id: true, chatbotConfig: true, storePhone: true },
        });

        if (user) {
          const config = (user.chatbotConfig as any) || {};
          const estadoBruto = String(
            body.data?.state || body.data?.status || body.data?.connection || ""
          ).toLowerCase();
          // Sem estado no corpo, o evento só existe porque algo aconteceu com a
          // conexão; o gateway antigo mandava isso apenas ao abrir.
          const conectada = estadoBruto ? estadoBruto === "open" : true;

          // O `:15` no fim do JID é o id do APARELHO, não parte do telefone —
          // vazava para o cadastro e quebrava qualquer comparação de número.
          const phone = String(body.data?.ownerJid || body.data?.phone || "")
            .split("@")[0].split(":")[0].replace(/\D/g, "");
          const formattedPhone = phone ? `+55 ${phone.replace(/^55/, "")}` : null;

          await registrarEstadoDoRobo(user.id, config, conectada, formattedPhone, user.storePhone);

          console.log(
            `[${new Date().toISOString()}] [WhatsApp Webhook] ${conectada ? "✅" : "⚠️"} Instância ${instance} ${conectada ? "CONECTADA" : `DESCONECTADA (estado "${estadoBruto || "?"}")`}.`
          );
        }
      } catch (connErr: any) {
        console.error(`[WhatsApp Webhook] Erro ao processar conexão:`, connErr?.message);
      }
      return NextResponse.json({ status: "ok" });
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
 * Envia uma mensagem ao cliente E registra que foi o robô quem falou.
 *
 * Os dois passos precisam andar juntos, sempre. O WhatsApp devolve tudo que sai
 * do número como `fromMe`, e o que distingue o eco do robô do lojista digitando
 * é justamente esse registro. Uma mensagem enviada sem registrar volta como
 * "humano assumiu" e cala o robô por 5 minutos — foi o que aconteceu com o
 * aviso de falha de áudio: o cliente recebia "não consegui ouvir", mandava
 * outro áudio, e aí não recebia mais nada.
 *
 * Por isso o envio passou a ser só por aqui: um ponto de envio novo não tem
 * como esquecer de registrar.
 */
async function replyToCustomer(userId: string, remoteJid: string, text: string, target?: string) {
  // Registrar ANTES de enviar. O eco volta pelo WhatsApp em milissegundos e
  // pode chegar antes de uma gravação feita depois do envio — e aí o robô se
  // cala por causa da própria mensagem. Registrar cedo demais não custa nada:
  // se o envio falhar, sobra um hash que nunca aparece.
  await registerBotReply(userId, remoteJid, text);
  return sendEvolutionMessage(userId, target || remoteJid, text);
}

/**
 * Coloca a conversa na fila do balãozinho de atendimento humano.
 *
 * A montagem era a mesma em dois pontos e agora em três; ficar copiando o
 * formato do registro é como uma das cópias acaba divergindo em silêncio.
 */
function enqueueHumanSupport(
  userId: string,
  remoteJid: string,
  cleanPhone: string,
  pushName: string | undefined,
  userText: string,
  botText: string,
  now: number,
  /**
   * Por que esta conversa caiu na fila. O widget usa para separar quem está com
   * problema de quem só pediu atendente: numa fila de dez, saber onde entrar
   * primeiro é a diferença entre atender e apagar incêndio.
   */
  motivo?: string
) {
  if (!global.__humanSupportChats) {
    global.__humanSupportChats = new Map();
  }
  const humanKey = `${userId}_${remoteJid}`;
  const existing = global.__humanSupportChats.get(humanKey);
  const formattedPhone = cleanPhone ? `+55 ${cleanPhone.replace(/^55/, "")}` : remoteJid;

  const messages = existing ? existing.messages : [];
  messages.push({ sender: "user", text: userText, timestamp: now });
  // Sem texto do robô não se inventa uma fala dele: quando a conversa já está
  // com a equipe, o robô não respondeu nada — e um balão vazio no histórico
  // faria a atendente achar que ele falou algo que ela não consegue ler.
  if (botText) messages.push({ sender: "bot", text: botText, timestamp: Date.now() });

  global.__humanSupportChats.set(humanKey, {
    id: humanKey,
    userId,
    jid: remoteJid,
    phone: formattedPhone,
    clientName: pushName || formattedPhone,
    status: "PENDING",
    unreadCount: (existing?.unreadCount || 0) + 1,
    lastMessage: userText,
    updatedAt: Date.now(),
    messages,
    // Um motivo antigo não é apagado por uma entrada nova sem motivo: quem
    // entrou na fila reclamando de atraso continua sendo o caso urgente.
    motivo: motivo || (existing as any)?.motivo,
  } as any);
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

    // ── QUAL DESSES É O TELEFONE DE VERDADE ──────────────────────────────────
    //
    // O filtro anterior só recusava LID quando a string trazia "@lid" — e os
    // campos `sender`/`participant` chegam como número PURO. Um LID (o id
    // interno que o WhatsApp usa para o contato) tem 15-16 dígitos e passava
    // na régua "entre 10 e 15": foi assim que o pedido saiu com o telefone
    // "+143181391917166", que não existe. O motoboy liga e não é ninguém.
    //
    // Agora os candidatos são PONTUADOS em vez de aceitos por ordem: telefone
    // brasileiro bem formado ganha de tudo, e número comprido demais para ser
    // telefone é descartado.
    const pontuar = (c: string): number => {
      if (typeof c !== "string") return -1;
      if (c.includes("@lid") || c.includes("@broadcast") || c.includes("@g.us")) return -1;
      const digits = c.replace(/\D/g, "");
      if (!digits || digits.startsWith("22010")) return -1;

      const temSufixoDeContato = c.includes("@s.whatsapp.net") || c.includes("@c.us");
      // Brasil: 55 + DDD(2) + 8 ou 9 dígitos = 12 ou 13. É o caso da quase
      // totalidade dos clientes e o formato que o resto do sistema espera.
      const ehBrasileiro = digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
      // Acima de 13 dígitos sem ser um JID de contato é, na prática, LID.
      const compridoDemais = digits.length > 13;

      if (ehBrasileiro) return temSufixoDeContato ? 100 : 90;
      if (compridoDemais) return temSufixoDeContato ? 20 : -1;
      if (digits.length >= 10 && digits.length <= 13) return temSufixoDeContato ? 70 : 60;
      return -1;
    };

    const ranqueados = candidates
      .map((c: string) => ({ c, nota: pontuar(c) }))
      .filter((x) => x.nota > 0)
      .sort((a, b) => b.nota - a.nota);

    if (ranqueados.length > 0) return ranqueados[0].c;

    const whatsappNetCandidate = candidates.find(
      (c: string) => typeof c === "string" && c.includes("@s.whatsapp.net") && !c.includes("@lid")
    );
    if (whatsappNetCandidate) return whatsappNetCandidate;

    return key.remoteJid || data.from || "";
  };

  const remoteJid = getRealJid();

  // Ignore status broadcasts
  if (remoteJid.includes("@broadcast") || remoteJid.includes("status@broadcast")) return;

  // Ignore groups
  if (remoteJid.endsWith("@g.us") || remoteJid.includes("@g.us")) return;

  const shortId = instance.replace(/^firehub_/, "");
  
  // Busca multi-tenant genérica: encontra a loja pelo ID ou pelo nome da instância configurada
  // ── VINCULO INSTANCIA -> LOJA (isolamento entre lojas) ────────────────────
  // O telefone que leu o QR pertence a UMA loja. A fonte de verdade e o
  // chatbotConfig.instanceName, gravado no momento da conexao.
  //
  // O que havia antes, e por que era perigoso:
  //   OR: [ { id: shortId }, { id: { endsWith: shortId } }, { id: instance },
  //         { chatbotConfig: { path:['instanceName'], equals: instance } } ]
  //   num findFirst SEM orderBy.
  // 1) `endsWith` casa por SUFIXO: os ids sao cuid, e um instanceName curto
  //    casava com o id de outra loja.
  // 2) OR nao tem precedencia no SQL — findFirst devolve QUALQUER linha que
  //    satisfaca alguma condicao, entao a "prioridade" pretendida nao existia.
  // Resultado possivel: o robo da loja A respondendo com os dados da loja B.
  //
  // Agora e cascata explicita, e ambiguidade RECUSA em vez de adivinhar.
  const selecaoLoja = {
    id: true, ownerId: true, chatbotConfig: true, slug: true,
    email: true, isFranqueadoHakim: true,
  } as const;

  // 1) Vinculo real do QR: instanceName exato.
  let candidatos = await prisma.user.findMany({
    where: { chatbotConfig: { path: ['instanceName'], equals: instance } },
    select: selecaoLoja,
    take: 2,
  });

  // 2) Legado: instancia derivada do proprio id da loja, sempre EXATO.
  if (candidatos.length === 0) {
    candidatos = await prisma.user.findMany({
      where: { OR: [{ id: shortId }, { id: instance }] },
      select: selecaoLoja,
      take: 2,
    });
  }

  // 3) Legado real: o nome da instancia e SEMPRE `firehub_<10 ultimos do id>`
  //    (src/lib/whatsapp-evolution.ts), e o id completo e um cuid — nunca igual
  //    ao sufixo. Ou seja, o passo 2 acima jamais casa, e toda loja conectada
  //    antes de existir o campo instanceName ficava sem robo: era o caso da
  //    Brasa Burguer (`firehub_04z3ss479k` para o id `cmt1hle8y0001ia04z3ss479k`),
  //    cujo webhook caia em "nao pertence a nenhuma loja cadastrada".
  //    Reconectar nao resolvia: a rota de QR nao grava instanceName, e o nome
  //    gerado seria o mesmo.
  //    Aqui o sufixo so estreita a busca — a decisao vem da RECONSTRUCAO exata
  //    do nome a partir do id encontrado. Ambiguidade continua recusando.
  if (candidatos.length === 0 && shortId.length >= 8) {
    const porSufixo = await prisma.user.findMany({
      where: { id: { endsWith: shortId } },
      select: selecaoLoja,
      take: 5,
    });
    candidatos = porSufixo.filter(u => `firehub_${u.id.slice(-10)}` === instance).slice(0, 2);
  }

  if (candidatos.length > 1) {
    console.error(
      `[WhatsApp Webhook] Instância "${instance}" casa com ${candidatos.length} lojas ` +
      `(${candidatos.map((c) => c.email).join(", ")}). Recusando para não responder pela loja errada.`
    );
    return;
  }

  const user = candidatos[0] || null;

  if (!user) {
    console.warn(`[${new Date().toISOString()}] [WhatsApp Webhook] Instância "${instance}" não pertence a nenhuma loja cadastrada.`);
    registrarTrace({ instancia: instance, telefone: mascararTelefone(remoteJid), tipo: "texto", estagio: "loja-nao-encontrada" });
    return;
  }

  // ── Mensagem que SAIU do número conectado ───────────────────────────────
  // Antes isso era descartado logo no começo, junto com o `fromMe`. Mas fromMe
  // tem dois significados bem diferentes: pode ser o eco da resposta que o
  // próprio robô mandou, ou o lojista digitando para o cliente. No segundo caso
  // o robô precisa se calar, senão os dois respondem juntos e embola.
  //
  // Fica depois da cascata acima de propósito: sem saber de QUAL loja é a
  // conversa, não dá para registrar o silêncio no lugar certo.
  if (fromMe === true) {
    const ownText = String(
      data.message?.conversation ||
      data.message?.extendedTextMessage?.text ||
      data.message?.imageMessage?.caption ||
      data.body ||
      data.text ||
      ""
    );
    if (!ownText.trim()) return;

    const tookOver = await handleOutgoingMessage(user.id, remoteJid, ownText, Date.now());
    if (tookOver) {
      console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] 🧑‍💼 Atendente da loja assumiu ${remoteJid}. Robô em silêncio.`);
    }
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
        // Uma tentativa, não três. As outras duas repetiam a mesma busca com
        // outro identificador da mesma loja — e a função já resolve o nome da
        // instância internamente, então as três caíam no mesmo lugar. O que
        // elas produziam era só espera: com 8 tentativas de 10s cada dentro da
        // função, as três chamadas somavam até quatro minutos antes de avisar
        // o cliente que o áudio não foi ouvido.
        const { getEvolutionAudioBase64 } = await import("@/lib/whatsapp-evolution");
        base64Data = await getEvolutionAudioBase64(instance || user.id, key, data);
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
      replyToCustomer(
        user.id,
        remoteJid,
        "Desculpe, não conseguimos atender ligações por aqui! 😅 Como posso te ajudar?",
        cleanTarget
      ).catch(() => {});
    }
    return;
  }

  // Rótulo do rastro: separar áudio de texto é o que torna o diagnóstico útil,
  // já que "não respondeu" tem causas diferentes nos dois casos.
  const tipoTrace: "texto" | "audio" = (isAudioMessage || audioObj) ? "audio" : "texto";

  let textMessage = rawText;
  if (isAudioMessage || audioObj) {
    registrarTrace({
      instancia: instance,
      telefone: mascararTelefone(remoteJid),
      tipo: "audio",
      estagio: audioData?.base64 ? "audio-ok" : "audio-sem-bytes",
      audioChars: audioData?.base64?.length || 0,
      detalhe: audioData?.base64 ? undefined : "gateway não mandou bytes e o download pela Evolution também falhou",
    });
    if (audioData?.base64) {
      textMessage = (rawText ? rawText + "\n\n" : "") + "O cliente enviou a mensagem de áudio em anexo. Por favor escute o áudio com atenção, entenda o pedido ou dúvida do cliente e responda no mesmo tom carinhoso e prestativo do cardápio.";
    } else {
      // Se não conseguiu baixar o áudio de jeito nenhum, envia uma resposta amigável de fallback pedindo para o cliente regravar ou digitar
      await replyToCustomer(
        user.id,
        remoteJid,
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
  if (chatbotConfig.active === false) {
    registrarTrace({ instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace, estagio: "robo-desativado" });
    return;
  }

  // ── NÚMEROS QUE O ROBÔ NÃO ATENDE ────────────────────────────────────────
  // Motoboy, cozinha, fornecedor, o contador: gente que fala com a loja o dia
  // inteiro e não quer cardápio nem "posso anotar seu pedido?". O robô
  // respondendo a esses números é ruído para os dois lados — e, no caso do
  // motoboy em rota, atrapalha no pior momento.
  if (numeroEstaNaListaDeIgnorados(cleanPhone, chatbotConfig.numerosIgnorados)) {
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] 🔕 ${mascararTelefone(remoteJid)} está na lista de números que o robô não responde.`);
    registrarTrace({ instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace, estagio: "numero-ignorado" });
    return;
  }

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

    await replyToCustomer(user.id, remoteJid, thankMsg).catch(() => {});
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
    await replyToCustomer(user.id, remoteJid, humanReply, recipientTarget);

    // Marca a conversa como pausada por 12 horas para o robô não responder mais automaticamente
    cooldownCache.set(pausedCacheKey, Date.now() + 12 * 60 * 60 * 1000);

    // Registra na fila do balãozinho flutuante de atendimento humano
    enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, textMessage, humanReply, Date.now(), "Pediu atendente");

    // A fila do painel só existe para quem está com o painel aberto. Sem este
    // aviso, o cliente que pede atendente às 21h de uma terça não é atendido
    // por ninguém — nem pelo robô, que acabou de calar.
    avisarDono(
      user.id,
      "pedido_de_atendente",
      textoDeProblemaNoPedido({
        nomeDoCliente: data.pushName || cleanPhone,
        telefone: cleanPhone,
        motivo: "pediu para falar com atendente",
        mensagemDoCliente: textMessage,
      })
    ).catch(() => {});

    return;
  }

  // ── PROBLEMA NO PEDIDO: O ROBÔ SAI E CHAMA GENTE ─────────────────────────
  //
  // Reclamação não é dúvida. Em 01/09/2026 uma cliente esperou 1h40 e o robô
  // respondeu quatro vezes, cada vez com mais confiança, até inventar uma
  // ligação que nunca fez: "consegui falar com ele, já tá na sua rua". Ele não
  // liga para motoboy e não sabe onde ninguém está.
  //
  // Nenhum ajuste de prompt conserta isso com segurança, porque o problema não
  // é o texto — é a atribuição: quem tem que responder atraso é quem pode
  // resolver atraso. Então o robô diz uma frase honesta e sai de cena.
  const escalarPorProblema = chatbotConfig.escalateOnComplaint !== false;
  if (escalarPorProblema) {
    const historicoAtual = conversationCache.get(user.id + "_" + remoteJid) || [];
    const problema = detectarProblemaNoPedido(textMessage, historicoAtual, now);

    // Já entregue à equipe: só atualiza a fila. Repetir "vou chamar alguém" a
    // cada nova mensagem de quem está bravo é piorar o atendimento, e o alerta
    // ao dono viraria enxurrada.
    if (problema.escalar && (await conversaEstaComHumano(user.id, remoteJid))) {
      enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, textMessage, "", now);
      return;
    }

    if (problema.escalar) {
      const rotulo =
        problema.motivo === "cobranca_repetida"
          ? "cobrou o pedido mais de uma vez"
          : "reclamação sobre o pedido";

      console.warn(
        `[${new Date().toISOString()}] [WhatsApp Webhook] 🆘 ${mascararTelefone(remoteJid)}: ${rotulo} ` +
          `(gatilho: "${problema.gatilho}"). Robô saindo da conversa.`
      );

      await replyToCustomer(user.id, remoteJid, FRASE_DE_TRANSFERENCIA, remoteJid || data.from || "").catch(() => {});

      // Duas travas, de propósito. A do banco sobrevive ao restart do
      // container — sem ela, um deploy no meio do problema devolveria o robô à
      // conversa falando como se nada tivesse acontecido.
      await passarParaAtendimentoHumano(user.id, remoteJid, `problema no pedido: ${rotulo}`, now);
      cooldownCache.set(pausedCacheKey, Date.now() + 12 * 60 * 60 * 1000);

      enqueueHumanSupport(
        user.id, remoteJid, cleanPhone, data.pushName, textMessage, FRASE_DE_TRANSFERENCIA, now,
        problema.motivo === "cobranca_repetida" ? "Cobrou o pedido de novo" : "Reclamação"
      );

      avisarDono(
        user.id,
        "problema_no_pedido",
        textoDeProblemaNoPedido({
          nomeDoCliente: data.pushName || cleanPhone,
          telefone: cleanPhone,
          motivo: rotulo,
          mensagemDoCliente: textMessage,
        })
      ).catch(() => {});

      registrarTrace({
        instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
        estagio: "problema-no-pedido", detalhe: `${problema.motivo}: ${problema.gatilho}`,
      });

      return;
    }
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
      // Zera também o estado persistido, senão a conversa que caiu na trava
      // ficaria sem robô para sempre.
      await clearLoopGuard(user.id, remoteJid);
    } else if (chat.status !== "CLOSED") {
      chat.messages.push({ sender: "user", text: textMessage, timestamp: Date.now() });
      chat.lastMessage = textMessage;
      chat.updatedAt = Date.now();
      chat.unreadCount = (chat.unreadCount || 0) + 1;
      return;
    }
  }

  // ── Última porteira antes de gastar uma chamada de IA ───────────────────
  // Decide por conversa, nunca por loja: movimento alto numa sexta não faz
  // ninguém bater em limite, porque cada cliente tem o próprio contador.
  const guard = await evaluateLoopGuard({
    userId: user.id,
    remoteJid,
    text: textMessage,
    verifiedBizName: data.verifiedBizName || data.message?.verifiedBizName,
    isAudio: Boolean(audioData?.base64),
    now,
  });

  if (guard.action === "ignore") {
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] 🔇 Sem resposta para ${remoteJid}: ${guard.reason}`);
    registrarTrace({
      instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
      estagio: "guard-ignorou", detalhe: guard.reason,
    });
    return;
  }

  if (guard.action === "degrade") {
    // Não silenciamos: mandamos UMA frase fixa e passamos para o humano. O
    // cliente nunca fica sem resposta, e frase enlatada não dá assunto para o
    // robô do outro lado — o loop morre aqui.
    console.warn(`[${new Date().toISOString()}] [WhatsApp Webhook] 🔁 Loop suspeito em ${remoteJid} (${guard.reason}). Passando para atendimento humano.`);
    const target = remoteJid || data.from || "";
    await replyToCustomer(user.id, remoteJid, guard.message, target).catch(() => {});
    enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, textMessage, guard.message, now);
    registrarTrace({
      instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
      estagio: "guard-degradou", detalhe: guard.reason,
    });
    return;
  }

  // Prepare and format history to pass to AI
  // ISOLAMENTO ENTRE LOJAS: a chave do historico inclui a LOJA.
  // Antes era so o remoteJid (telefone). Como o Map e global ao processo, um
  // cliente que falava com a loja A e depois com a loja B fazia o robo da B
  // receber as ultimas mensagens trocadas com a A — produtos, precos, endereco
  // — e continuar a conversa como se fossem dele.
  const convKey = user.id + "_" + remoteJid;
  const history = conversationCache.get(convKey) || [];
  const aiHistory = history.map(msg => ({ sender: msg.sender, text: msg.text }));

  console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Processando IA para ${remoteJid} com ${aiHistory.length} mensagens no histórico...`);
  
  // ── Chamada da IA com TIMEOUT de 15 segundos ──
  // Se o Gemini travar, não podemos deixar o webhook pendurado — a Evolution API
  // desiste e para de enviar mensagens para o nosso endpoint.
  const customMenuUrl = ((user.chatbotConfig as any)?.externalMenuUrl || "").trim();
  const defaultStoreLink = user.slug ? `https://firehubfood.com.br/loja/${user.slug}` : "";
  const storeLink = customMenuUrl || defaultStoreLink;
  const fallbackReply = storeLink
    ? `Olá! 😊 No momento estou com uma instabilidade técnica por aqui. Por favor, faça seu pedido direto pelo nosso cardápio: ${storeLink}`
    : `Olá! 😊 No momento estou com uma instabilidade técnica por aqui. Por favor, tente novamente em instantes!`;

  let aiResponse: any = null;
  try {
    // Se for mensagem de usuário, aplicamos um delay de leitura para imitar humano
    if (remoteJid?.includes("@s.whatsapp.net")) {
      const readingDelay = audioData ? 1500 : Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
      await new Promise(r => setTimeout(r, readingDelay));
    }

    const aiTimeout = audioData ? 45000 : 25000;
    const iaInicio = Date.now();
    aiResponse = await withTimeout(
      processChatbotAI(user.id, textMessage, aiHistory, remoteJid, audioData, data.pushName),
      aiTimeout
    );
    registrarTrace({
      instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
      estagio: aiResponse ? "ia-chamada" : "ia-timeout",
      ms: Date.now() - iaInicio,
      detalhe: aiResponse ? undefined : `estourou o limite de ${aiTimeout}ms`,
    });
  } catch (aiErr: any) {
    console.error(`[${new Date().toISOString()}] [WhatsApp Webhook] ❌ Erro na IA para ${remoteJid}:`, aiErr?.message || aiErr);
    registrarTrace({
      instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
      estagio: "erro", detalhe: String(aiErr?.message || aiErr).slice(0, 200),
    });
    aiResponse = { reply: fallbackReply };
  }

  if (!aiResponse) {
    console.warn(`[${new Date().toISOString()}] [WhatsApp Webhook] ⏳ Timeout na IA para ${remoteJid}. Enviando fallback.`);
    aiResponse = { reply: fallbackReply };
  }
  
  // ── ONDE O PEDIDO FOI PARAR ───────────────────────────────────────────────
  // Registrado no rastro para que "a IA confirmou mas a cozinha não recebeu"
  // seja visível em /api/chatbot/diagnostico, sem depender de log cru.
  const destinoDoPedido = (aiResponse as any)?.pedido;
  if (destinoDoPedido) {
    if (destinoDoPedido.ok) {
      registrarTrace({
        instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
        estagio: "pedido-gravado",
        detalhe: `nº ${destinoDoPedido.numero ?? "—"} · ${destinoDoPedido.itens} item(ns)${destinoDoPedido.finalizado ? " · FINALIZADO" : " · rascunho"}`,
      });
    } else {
      registrarTrace({
        instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
        estagio: "pedido-nao-gravado", detalhe: destinoDoPedido.motivo,
      });
    }
  }

  if (aiResponse?.reply) {
    let replyText = aiResponse.reply;
    let callHuman = false;

    if (replyText.includes("[[CHAMAR_ATENDENTE: true]]") || replyText.includes("[[CHAMAR_ATENDENTE]]")) {
      callHuman = true;
      replyText = replyText.replace(/\[\[CHAMAR_ATENDENTE.*\]\]/g, "").trim();
    }

    // O cliente recusou o site e quer ver o cardápio aqui mesmo: a IA marca a
    // resposta e nós mandamos o arquivo que o lojista subiu. A marca sai do
    // texto antes de qualquer coisa — cliente nenhum pode ver "[[...]]".
    let enviarCardapio = false;
    // Tolera variação do modelo ("[[ENVIAR_CARDAPIO: agora]]"): qualquer coisa
    // que comece com a marca conta — e sai INTEIRA do texto, senão o cliente
    // recebe o colchete cru.
    if (/\[\[ENVIAR_CARDAPIO/i.test(replyText)) {
      enviarCardapio = true;
      replyText = replyText.replace(/\[\[ENVIAR_CARDAPIO[^\]]*\]\]/gi, "").trim();
      if (!replyText) replyText = "Claro! Segue nosso cardápio 😊";
    }

    // O que o cliente falou no áudio, para o histórico.
    //
    // O áudio vai para o modelo uma vez só, na mensagem em que chega. O que
    // sobrava no histórico era o texto-marcador ("o cliente enviou um áudio"),
    // igual em todas as mensagens de voz — então quem pedia "dois x-tudo" por
    // áudio e depois mandava "e uma coca" via o pedido evaporar. Guardar a
    // transcrição é o que dá memória à conversa falada.
    let transcription = "";
    const transcriptionMatch = replyText.match(/\[\[TRANSCRICAO:\s*([\s\S]*?)\]\]/i);
    if (transcriptionMatch) {
      transcription = transcriptionMatch[1].trim();
      replyText = replyText.replace(/\[\[TRANSCRICAO:[\s\S]*?\]\]/gi, "").trim();
    }

    const recipientTarget = remoteJid || data.from || "";
    
    // O cliente enviou áudio, a IA escuta e entende, mas a resposta é enviada SEMPRE em texto.
    const enviou = await replyToCustomer(user.id, remoteJid, replyText, recipientTarget);
    registrarTrace({
      instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
      estagio: enviou ? "enviado" : "envio-falhou",
      detalhe: enviou ? undefined : "gateway recusou o envio (sendText não retornou ok)",
    });

    // O arquivo vai DEPOIS do texto, nunca como legenda: no WhatsApp a legenda
    // de mídia fica escondida atrás do "ver mais" e o cliente não lê. Se o envio
    // falhar, não deixamos a conversa no vácuo — a IA já prometeu o cardápio,
    // então cai para o link, que sempre funciona.
    if (enviarCardapio) {
      const cfgArquivo = (user.chatbotConfig as any) || {};
      const arquivo = String(cfgArquivo.menuFileUrl || "").trim();
      if (arquivo) {
        const ehPdf = /\.pdf(\?|$)/i.test(arquivo) || String(cfgArquivo.menuFileType || "").includes("pdf");
        const { sendEvolutionMediaUrl } = await import("@/lib/whatsapp-evolution");
        const urlAbsoluta = arquivo.startsWith("http")
          ? arquivo
          : `https://firehubfood.com.br${arquivo.startsWith("/") ? "" : "/"}${arquivo}`;
        const foi = await sendEvolutionMediaUrl(
          user.id, recipientTarget, urlAbsoluta, "",
          ehPdf ? "document" : "image",
          ehPdf ? "cardapio.pdf" : undefined,
        );
        if (!foi) {
          console.warn("[WhatsApp Webhook] 📄 Falha ao enviar cardápio em arquivo; caindo para o link.");
          const linkLoja = user.slug ? `https://firehubfood.com.br/loja/${user.slug}` : "";
          if (linkLoja) {
            await replyToCustomer(user.id, remoteJid, `Nosso cardápio completo tá aqui: ${linkLoja}`, recipientTarget);
          }
        } else {
          trackWhatsAppMessage(user.id, "OUTBOUND", "SERVICE", { remoteJid: recipientTarget });
        }
      }
    }

    // Track WhatsApp usage (fire-and-forget)
    trackWhatsAppMessage(user.id, "INBOUND", "SERVICE", { remoteJid: recipientTarget });
    trackWhatsAppMessage(user.id, "OUTBOUND", "SERVICE", { remoteJid: recipientTarget });
    
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] 🤖 Resposta enviada para ${recipientTarget}: "${replyText}"`);

    if (callHuman) {
      cooldownCache.set(pausedCacheKey, Date.now() + 12 * 60 * 60 * 1000);
      enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, textMessage, replyText, now);
      console.log(`[WhatsApp Webhook] 🙋 Chat transferido para atendimento humano por solicitação/cancelamento (${remoteJid})`);
    }
    
    // Update cache after response
    // Para áudio, guarda o que foi dito — não o texto-marcador, que é igual em
    // toda mensagem de voz e não carrega nada do pedido.
    history.push({ sender: 'user', text: transcription || textMessage, timestamp: now });
    
    // NÃO salvar mensagens de erro de sistema no histórico da IA,
    // senão na próxima iteração a IA começa a alucinar que está quebrada de propósito.
    if (!replyText.includes("instabilidade técnica")) {
      history.push({ sender: 'bot', text: replyText, timestamp: Date.now() });
    }
    
    // Keep only the last 15 messages
    const updatedHistory = history.slice(-15);
    
    conversationCache.set(convKey, updatedHistory);
    cooldownCache.set(remoteJid, Date.now());
  }
}

export async function GET() {
  return NextResponse.json({ status: "WhatsApp Webhook Active" });
}
