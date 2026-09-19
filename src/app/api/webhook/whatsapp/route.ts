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
import { ehConversaDeCliente, tipoDoJid } from '@/lib/jid-de-cliente';
import { avisarDono, avisarAdminDoSistema, textoDeProblemaNoPedido } from '@/lib/alertas-do-dono';
import { mesmoTelefone } from '@/lib/telefone';
import { detectarPedidoDeAtendente, FRASE_DE_CHAMAR_ATENDENTE } from '@/lib/pedido-de-atendente';
import { pausarRobo, roboEstaPausado, retomarRobo } from '@/lib/pausa-do-robo';
import { registrarIncidenteDaIa, registrarSucessoDaIa } from '@/lib/saude-da-ia';
import {
  alertaDeIaForaDoArParaALoja,
  alertaDeIaForaDoArParaOAdmin,
  classificarFalhaDaIa,
  mensagemDeIaForaDoAr,
  mensagemDeIaForaDoArParaODono,
  mensagemDeInstabilidadePassageira,
  podeAlertarAgora,
  virouIncidente,
  type FalhaDaIa,
} from '@/lib/falha-da-ia';
import { comPrazo } from '@/lib/com-prazo';
import { carregarMemoriaDaConversa, guardarMemoriaDaConversa, limparMemoriasVencidas } from '@/lib/memoria-da-conversa-no-banco';

/**
 * O que o cliente lê quando a IA passa do prazo. NÃO é mensagem de erro: a
 * resposta continua sendo esperada e chega em seguida (lib/com-prazo.ts).
 */
const FRASE_DE_SO_UM_INSTANTE = "Só um instantinho que já te respondo 😊";
/**
 * Quanto esperar pela resposta DEPOIS do prazo antes de desistir. Os modelos têm
 * teto próprio (12 s + 7 s em texto); o que passa disso é busca de endereço no
 * mapa e gravação do pedido. Um minuto além do prazo já é patológico.
 */
const TETO_DA_RESPOSTA_TARDIA_MS = 60_000;

// Estado dos alertas de "IA fora do ar". Memória do processo de propósito: depois
// de um deploy o alerta pode repetir UMA vez, e no meio de um incidente isso é
// informação, não ruído (lib/falha-da-ia.ts).
const falhasDaIaPorLoja = new Map<string, number[]>();
const alertasDeIaEnviados = new Map<string, number>();
/** Conversa → quando o cliente leu o aviso de instabilidade. Não se repete em 2 h. */
const clientesAvisadosDaFalha = new Map<string, number>();
const DUAS_HORAS_MS = 2 * 60 * 60 * 1000;

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


export async function POST(req: NextRequest) {
  // ── REGRA CRÍTICA: SEMPRE retornar 200 para a Evolution API ──
  // Se retornarmos 500, a Evolution API pode desativar o webhook
  // e o bot para de receber mensagens completamente.
  try {
    cleanCache();
    // No máximo uma vez por hora, sem esperar: conversa de cliente não fica guardada.
    void limparMemoriasVencidas();

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

          // ── QUEM NUNCA CONECTOU NÃO TEM ROBÔ PARA CAIR ────────────────────
          //
          // Regra do dono (18/09/2026): "se nunca conectou não é pra avisar da
          // queda". O gateway mandava "close" a cada QR que ninguém leu — na
          // R&D Pizzaria foram 1.020 avisos em um dia, um a cada 3 minutos — e
          // cada um regravava o chatbotConfig INTEIRO da loja a partir de uma
          // leitura de instantes antes: além de inútil, podia atropelar o que
          // o lojista estivesse salvando na tela do robô naquele segundo. O
          // gateway deixou de mandar; esta guarda vale para gateway antigo.
          const jaConectou =
            config.jaConectouAlgumaVez === true || Boolean(config.connectedAt) || config.connected === true;
          if (!conectada && !jaConectou) {
            return NextResponse.json({ status: "ok", ignorado: "nunca-conectou" });
          }

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
    // Quem a atendente JÁ assumiu continua ACTIVE. Isto regravava "PENDING" a
    // cada mensagem do cliente — e é o status que decide, mais abaixo, se uma
    // conversa que entrou só pela queda da IA pode voltar para o robô: sem
    // preservar, o robô entraria no meio de um atendimento humano.
    status: existing?.status === "ACTIVE" ? "ACTIVE" : "PENDING",
    unreadCount: (existing?.unreadCount || 0) + 1,
    lastMessage: userText,
    updatedAt: Date.now(),
    messages,
    // Um motivo antigo não é apagado por uma entrada nova sem motivo: quem
    // entrou na fila reclamando de atraso continua sendo o caso urgente.
    motivo: motivo || (existing as any)?.motivo,
    // A conversa está aqui SÓ porque a IA caiu? Campo próprio, e não comparação
    // do texto do motivo: qualquer outro caminho de transferência (pediu
    // atendente, reclamação, anti-loop) o derruba, e aí a equipe segura a
    // conversa como sempre. Entrada nova nasce `true` só pelo motivo da queda.
    soPorIaForaDoAr:
      motivo === MOTIVO_IA_FORA_DO_AR
        ? (existing ? (existing as any).soPorIaForaDoAr === true : true)
        : motivo
          ? false
          : (existing as any)?.soPorIaForaDoAr === true,
  } as any);
}

const MOTIVO_IA_FORA_DO_AR = "IA fora do ar";

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

  // ── SÓ CONVERSA DE CLIENTE PASSA DAQUI ───────────────────────────────────
  //
  // Aqui havia uma lista de BLOQUEIO (barrava `@broadcast` e `@g.us`, deixava
  // passar o resto) e os Canais do WhatsApp, que nasceram depois, entraram como
  // se fossem cliente: 1.072 posts viraram chamada de IA em 14 dias na Brazza
  // Burguer. Agora é lista de PERMISSÃO e o padrão é recusar — a regra e o
  // porquê estão em lib/jid-de-cliente.ts, com teste.
  if (!ehConversaDeCliente(remoteJid)) {
    console.log(`[Webhook] Ignorado: ${tipoDoJid(remoteJid)} (${remoteJid})`);
    return;
  }

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
    // Precisa vir aqui por causa da escalação: o DONO pergunta "tem pedido
    // atrasado?" e a palavra bate no detector de reclamação. Sem saber quem é
    // ele, o robô calaria justamente para quem manda nele.
    notificationPhone: true,
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
  // Pedido de atendente NÃO passa pelo cooldown. Quem escreve "quero falar com
  // alguém" logo depois de uma resposta do robô está reagindo a ela — e era
  // descartado aqui em silêncio, sem fila e sem alerta, antes de qualquer
  // checagem (medido em 18/09/2026).
  if (now - lastResponse < 3000 && !detectarPedidoDeAtendente(textMessage).pediu) {
    // ⚠️ ESTE DESCARTE AINDA EXISTE, e é o próximo a sair: a mensagem some sem
    // fila, sem histórico e sem rastro. Quem escreve picado ("oi" / "quero 2
    // x-tudo" / "e uma coca") perde parte do que disse. O substituto já está
    // escrito e testado em lib/fila-da-conversa.ts: agrupa a rajada numa
    // mensagem só e atende uma conversa de cada vez, em vez de descartar.
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

  // ── O DONO NUNCA É ESCALADO ──────────────────────────────────────────────
  // Calculado aqui, antes de TODOS os detectores: o de reclamação já o poupava
  // ("tem pedido atrasado?" bate em "atrasado"), mas o de pedido de atendente
  // roda antes e não consultava — e o vocabulário dele é maior (gerente,
  // motoboy, atendente) e a trava agora é durável no banco.
  const ehODono = Boolean(
    (user as any).notificationPhone && mesmoTelefone((user as any).notificationPhone, cleanPhone)
  );

  // A conversa já é da equipe (pediu atendente, reclamou): o robô fica
  // quieto — mas a mensagem tem que CHEGAR à fila. Aqui havia um `return` seco:
  // a atendente via só a primeira mensagem no balãozinho, e tudo o que o cliente
  // escrevia depois era descartado sem ninguém ler.
  if (roboEstaPausado(user.id, remoteJid)) {
    enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, textMessage, "", Date.now());
    console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Robô pausado para ${remoteJid} (conversa com a equipe) — mensagem encaminhada à fila`);
    return;
  }

  // ── O CLIENTE PEDIU UMA PESSOA ───────────────────────────────────────────
  //
  // O detector era uma regex de uma linha (`atendente|humano|falar com pessoa|
  // falar com gente|suporte`): "quero falar com alguém", "me chama o
  // responsável", "não quero robô" e "falar com humado" iam para a IA, que
  // respondia status. A regra agora mora em lib/pedido-de-atendente.ts, com
  // teste — inclusive das frases que NÃO podem calar o robô ("tem alguém em
  // casa pra receber").
  //
  // O dono é avisado SEMPRE; o que a opção da loja decide é só se o robô sai
  // da conversa. Com a opção em NÃO, enfileirar calaria o robô do mesmo jeito
  // (a fila em PENDING faz o webhook retornar em silêncio), então ali o robô
  // segue atendendo e só o alerta sai.
  const stopOnHuman = chatbotConfig.stopOnHumanRequest !== false;
  // O dono falando com o próprio robô ("algum cliente pediu atendente hoje?",
  // "preciso falar com o motoboy do pedido 8") não é cliente pedindo pessoa.
  const pedidoDeAtendente = ehODono ? { pediu: false as const, gatilho: undefined } : detectarPedidoDeAtendente(textMessage);
  /** Um alerta por mensagem: três caminhos abaixo avisam o dono, e sem isto saíam dois pela mesma. */
  let donoJaAvisado = false;

  if (pedidoDeAtendente.pediu) {
    // Depois de um deploy a pausa em memória e a fila somem, mas a trava do
    // banco fica. Sem esta consulta, "cadê o atendente??" repetia "já avisei
    // nossa equipe" e mandava OUTRO alerta ao dono — a cada deploy (mesma
    // guarda do caminho de reclamação, logo abaixo).
    if (stopOnHuman && (await conversaEstaComHumano(user.id, remoteJid))) {
      pausarRobo(user.id, remoteJid);
      enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, textMessage, "", now, "Pediu atendente");
      return;
    }

    console.warn(
      `[${new Date().toISOString()}] [WhatsApp Webhook] 🙋 ${mascararTelefone(remoteJid)} pediu uma pessoa ` +
        `(gatilho: ${pedidoDeAtendente.gatilho}). ${stopOnHuman ? "Robô saindo da conversa." : "Loja optou por NÃO pausar: só o alerta sai."}`
    );

    // A fila do painel só existe para quem está com o painel aberto. Sem este
    // aviso, o cliente que pede atendente às 21h de uma terça não é atendido
    // por ninguém — nem pelo robô, que acabou de calar. No modo "não pausar" o
    // robô segue respondendo, então o alerta tem freio por conversa (30 min):
    // sem ele, cada "atendente??" do mesmo cliente viraria mais um alerta.
    if (stopOnHuman || podeAlertarAgora(alertasDeIaEnviados, `atendente:${user.id}_${remoteJid}`, now, 30 * 60 * 1000)) {
      avisarDono(
        user.id,
        "pedido_de_atendente",
        textoDeProblemaNoPedido({
          nomeDoCliente: data.pushName || cleanPhone,
          telefone: cleanPhone,
          motivo: stopOnHuman
            ? "pediu para falar com atendente"
            : "pediu para falar com atendente (o robô CONTINUA respondendo: a loja optou por não pausar)",
          mensagemDoCliente: textMessage,
        })
      ).catch(() => {});
    }
    donoJaAvisado = true;

    registrarTrace({
      instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
      estagio: "pediu-atendente", detalhe: pedidoDeAtendente.gatilho,
    });

    if (stopOnHuman) {
      // A pausa e a fila entram ANTES dos awaits. Uma mensagem anterior do mesmo
      // cliente pode estar com a IA neste instante; ela confere a pausa antes de
      // enviar (mais abaixo) — e só enxerga o que já foi gravado.
      pausarRobo(user.id, remoteJid);
      enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, textMessage, FRASE_DE_CHAMAR_ATENDENTE, now, "Pediu atendente");

      await replyToCustomer(user.id, remoteJid, FRASE_DE_CHAMAR_ATENDENTE, remoteJid || data.from || "").catch(() => {});

      // Duas travas, como no caminho de reclamação. Este caminho só gravava a
      // de memória: cada deploy devolvia o robô à conversa de quem estava
      // esperando uma pessoa — e houve noite com quinze deploys.
      await passarParaAtendimentoHumano(user.id, remoteJid, "pediu atendente", now);
      return;
    }
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
  // ── O DONO NUNCA É ESCALADO ──────────────────────────────────────────────
  // "Tem pedido atrasado?" é a pergunta gerencial mais óbvia que existe, e a
  // palavra "atrasado" bate no detector de reclamação. Sem esta exceção o robô
  // calaria justamente para quem manda nele — e ainda abriria um chamado de
  // atendimento humano contra o próprio dono da loja.
  // (`ehODono` é calculado mais acima, antes do detector de pedido de atendente.)
  const escalarPorProblema = chatbotConfig.escalateOnComplaint !== false && !ehODono;
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

      // A pausa em memória e a fila entram ANTES dos awaits: uma mensagem
      // anterior do mesmo cliente pode estar com a IA agora, e ela confere a
      // pausa antes de enviar — senão o cliente leria a resposta do robô logo
      // depois de "vou chamar uma pessoa".
      pausarRobo(user.id, remoteJid);
      enqueueHumanSupport(
        user.id, remoteJid, cleanPhone, data.pushName, textMessage, FRASE_DE_TRANSFERENCIA, now,
        problema.motivo === "cobranca_repetida" ? "Cobrou o pedido de novo" : "Reclamação"
      );

      await replyToCustomer(user.id, remoteJid, FRASE_DE_TRANSFERENCIA, remoteJid || data.from || "").catch(() => {});

      // Duas travas, de propósito. A do banco sobrevive ao restart do
      // container — sem ela, um deploy no meio do problema devolveria o robô à
      // conversa falando como se nada tivesse acontecido.
      await passarParaAtendimentoHumano(user.id, remoteJid, `problema no pedido: ${rotulo}`, now);

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
      retomarRobo(user.id, remoteJid);
      // Zera também o estado persistido, senão a conversa que caiu na trava
      // ficaria sem robô para sempre.
      await clearLoopGuard(user.id, remoteJid);
    } else if ((chat as any).soPorIaForaDoAr === true && chat.status === "PENDING") {
      // Está na fila SÓ porque a IA caiu, e ninguém da equipe assumiu: a mensagem
      // segue para a IA de novo. Se ela ainda estiver fora, o cliente (já avisado)
      // não lê nada repetido e a mensagem entra na fila, mais abaixo; se o crédito
      // tiver voltado, o robô responde NA HORA e a entrada sai da fila. Segurar
      // aqui era o que deixava a conversa muda muito depois de a IA voltar — o
      // `updatedAt` se renova a cada mensagem, e o prazo de 30 min nunca vencia.
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
    // Motivo explícito: além de dizer à atendente por que a conversa caiu aqui,
    // é o que derruba a marca "só por IA fora do ar" — conversa que o anti-loop
    // tirou do robô não volta para ele sozinha.
    enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, textMessage, guard.message, now, "Loop suspeito");
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
  let history = conversationCache.get(convKey) || [];
  // Memória vazia aqui é conversa nova — ou processo novo: deploy no FireHub é
  // a cada push, e cada um apagava o histórico de TODA conversa em andamento. O
  // que o robô guardou no banco volta para o cache (lib/memoria-da-conversa.ts).
  // Só consulta quando o cache está vazio, e nunca lança.
  if (history.length === 0) {
    const guardado = await carregarMemoriaDaConversa(user.id, remoteJid);
    if (guardado.length > 0) {
      history = guardado;
      conversationCache.set(convKey, history);
      console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] 🧠 Histórico de ${remoteJid} recuperado do banco (${guardado.length} mensagens).`);
    }
  }
  const aiHistory = history.map(msg => ({ sender: msg.sender, text: msg.text }));

  console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Processando IA para ${remoteJid} com ${aiHistory.length} mensagens no histórico...`);
  
  const customMenuUrl = ((user.chatbotConfig as any)?.externalMenuUrl || "").trim();
  const defaultStoreLink = user.slug ? `https://firehubfood.com.br/loja/${user.slug}` : "";
  const storeLink = customMenuUrl || defaultStoreLink;
  // Estouro do teto ou exceção aqui no webhook é falha da IA como outra qualquer:
  // sai com `falhaDaIa` para entrar na mesma conta de incidente (mais abaixo).
  const fallbackReply = mensagemDeInstabilidadePassageira({ linkDoCardapio: storeLink });


  // ── O QUE FAZER COM A RESPOSTA DA IA ──────────────────────────────────────
  //
  // Um caminho só, para a resposta que chegou no prazo e para a que chegou
  // DEPOIS dele (`tardia`). Enquanto foram dois, a tardia não tinha caminho
  // nenhum: era descartada — com o pedido já gravado e impresso na cozinha.
  const entregarRespostaDaIa = async (aiResponse: any, tardia: boolean): Promise<void> => {
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
      /** A mensagem vai para a fila da equipe, mas o cliente não recebe a mesma frase de novo. */
      let silenciarResposta = false;

      // ── IA FORA DO AR É INCIDENTE ───────────────────────────────────────────
      //
      // De 13 a 18/09/2026 o crédito do Gemini ficou esgotado e NINGUÉM soube:
      // o robô respondia frase fixa que parece atendimento. Agora a resposta traz
      // `falhaDaIa`, e aqui se decide o que fazer com ela (lib/falha-da-ia.ts):
      //   - falha que exige ação (crédito, chave), ou a terceira falha da loja em
      //     dez minutos, é INCIDENTE: o cliente lê a verdade uma vez, a conversa
      //     vai para uma pessoa, a loja é avisada para atender na mão e o
      //     administrador do FireHub é avisado quando a causa é do sistema;
      //   - um soluço isolado só pede para o cliente repetir.
      const falhaDaIa: FalhaDaIa | undefined = (aiResponse as any).falhaDaIa;
      const respostaDeFalha: "status" | "incidente" | "soluco" | undefined = (aiResponse as any).respostaDeFalha;
      const chaveDaConversa = `${user.id}_${remoteJid}`;
      /** O dono escrevendo ao próprio robô durante a queda: lê a verdade, sem fila e sem "já avisei a equipe". */
      let donoNaQueda = false;

      // A IA RESPONDEU: a conversa que estava na fila só por causa da queda sai
      // de lá. Sem isto ela ficaria PENDING no balãozinho como fantasma de um
      // cliente que o robô já voltou a atender.
      if (!falhaDaIa) {
        registrarSucessoDaIa(user.id);
        const naFila = global.__humanSupportChats?.get(chaveDaConversa);
        if (naFila && (naFila as any).soPorIaForaDoAr === true && naFila.status === "PENDING") {
          global.__humanSupportChats!.delete(chaveDaConversa);
        }
        clientesAvisadosDaFalha.delete(chaveDaConversa);
      }

      if (falhaDaIa) {
        const incidente = virouIncidente(falhasDaIaPorLoja, user.id, falhaDaIa, now);
        registrarTrace({
          instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
          estagio: incidente ? "ia-fora-do-ar" : "ia-falhou",
          detalhe: `${falhaDaIa.tipo}: ${falhaDaIa.resumo}`,
        });

        // A faixa do painel (AvisoIaForaDoAr) lê daqui. É o canal que NÃO depende de
        // "WhatsApp do Proprietário" — em 18/09/2026 a conta matriz e 3 das 5 lojas
        // com robô não tinham o número, e os alertas não tinham para onde ir.
        if (incidente) registrarIncidenteDaIa(user.id, falhaDaIa, now);

        if (incidente && ehODono) {
          // Quem escreveu foi o DONO (respondendo ao alerta, ou em modo gerencial).
          // "Já avisei a equipe e uma pessoa vai te responder" seria mentira para
          // ele — a equipe é ele —, e enfileirá-lo na própria loja geraria um
          // alerta dizendo que ele mesmo está esperando atendimento.
          donoNaQueda = true;
          replyText = mensagemDeIaForaDoArParaODono(falhaDaIa);
        } else if (incidente) {
          // O soluço que se repetiu deixa de ser "manda de novo": vira a verdade.
          // Resposta de STATUS verdadeiro (o cliente perguntou do pedido) fica.
          if (respostaDeFalha === "soluco") {
            replyText = mensagemDeIaForaDoAr({ linkDoCardapio: storeLink });
            callHuman = true;
          }
          // O aviso de instabilidade sai UMA vez por conversa a cada duas horas.
          // Cada mensagem seguinte tenta a IA de novo (um 429 é instantâneo): se
          // ainda estiver fora, o cliente não lê a mesma frase outra vez — que é
          // o defeito original com outro texto — e a mensagem só entra na fila.
          if (respostaDeFalha !== "status") {
            const avisadoEm = clientesAvisadosDaFalha.get(chaveDaConversa);
            if (avisadoEm !== undefined && now - avisadoEm < DUAS_HORAS_MS) {
              silenciarResposta = true;
              callHuman = true;
            } else {
              clientesAvisadosDaFalha.set(chaveDaConversa, now);
            }
          }
          if (podeAlertarAgora(alertasDeIaEnviados, `loja:${user.id}`, now, 30 * 60 * 1000)) {
            avisarDono(
              user.id,
              "ia_fora_do_ar",
              alertaDeIaForaDoArParaALoja({
                falha: falhaDaIa,
                nomeDoCliente: data.pushName || cleanPhone,
                telefone: cleanPhone,
                mensagemDoCliente: textMessage,
                // Quem perguntou do pedido recebeu o status e NÃO foi para a fila.
                transferido: respostaDeFalha !== "status",
              })
            ).catch(() => {});
          }
        }

        // O administrador do FireHub: a causa é do sistema (chave única). O freio é
        // gravado ANTES do envio — com ~30 lojas sentindo a queda ao mesmo tempo,
        // gravar só no sucesso deixaria todas passarem pela checagem antes do
        // primeiro envio terminar. Se o envio falhar, o freio é solto para a
        // próxima loja tentar.
        if (incidente && falhaDaIa.doSistema && podeAlertarAgora(alertasDeIaEnviados, "admin", now, 60 * 60 * 1000)) {
          avisarAdminDoSistema(
            user.id,
            alertaDeIaForaDoArParaOAdmin({
              falha: falhaDaIa,
              loja: (user as any).storeName || (user as any).name || user.id,
              quando: new Date(now).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
            })
          )
            .then((saiu) => { if (!saiu) alertasDeIaEnviados.delete("admin"); })
            .catch(() => { alertasDeIaEnviados.delete("admin"); });
        }
      }

      // A marca em qualquer grafia que o modelo invente ("[[CHAMAR_ATENDENTE: sim]]"),
      // e removida INTEIRA — com a checagem estrita de antes, a variação vazava o
      // colchete cru para o cliente e não chamava ninguém.
      if (/\[\[\s*CHAMAR_ATENDENTE/i.test(replyText)) {
        replyText = replyText.replace(/\[\[\s*CHAMAR_ATENDENTE[^\]]*\]\]/gi, "").trim();
        // A loja optou por NÃO pausar, e o dono já foi avisado pelo detector lá em
        // cima: a marca da IA (regra 6g do prompt) não tira o robô da conversa.
        const soAlerta = pedidoDeAtendente.pediu && !stopOnHuman;
        if (!soAlerta && !donoNaQueda) callHuman = true;
        if (!replyText) replyText = FRASE_DE_CHAMAR_ATENDENTE;
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

      // Pedido de atendente por ÁUDIO. Lá em cima o detector só enxerga o
      // texto-marcador da mensagem de voz, que é igual em todas — quem pedia uma
      // pessoa falando nunca era ouvido. A transcrição só existe depois da IA;
      // se ela não tiver chamado a equipe por conta própria, chama-se aqui.
      if (!callHuman && transcription && !ehODono) {
        const pedidoNoAudio = detectarPedidoDeAtendente(transcription);
        if (pedidoNoAudio.pediu) {
          avisarDono(
            user.id,
            "pedido_de_atendente",
            textoDeProblemaNoPedido({
              nomeDoCliente: data.pushName || cleanPhone,
              telefone: cleanPhone,
              motivo: "pediu para falar com atendente (por áudio)",
              mensagemDoCliente: transcription,
            })
          ).catch(() => {});
          donoJaAvisado = true;
          if (chatbotConfig.stopOnHumanRequest !== false) {
            replyText = FRASE_DE_CHAMAR_ATENDENTE;
            callHuman = true;
          }
        }
      }

      const recipientTarget = remoteJid || data.from || "";
    
      // O cliente enviou áudio, a IA escuta e entende, mas a resposta é enviada SEMPRE em texto.
      // Enquanto a IA pensava (3–5 s de leitura + a chamada), OUTRA mensagem do
      // mesmo cliente pode ter entregado a conversa à equipe — "oi" e, dois
      // segundos depois, "quero falar com um atendente". Sem esta conferência o
      // cliente leria a resposta do robô ao "oi" logo depois de "uma pessoa vai te
      // responder": o mesmo sintoma da Hakim, por outro caminho.
      if (roboEstaPausado(user.id, remoteJid)) {
        enqueueHumanSupport(user.id, remoteJid, cleanPhone, data.pushName, transcription || textMessage, "", now);
        console.log(`[${new Date().toISOString()}] [WhatsApp Webhook] Resposta da IA descartada: ${remoteJid} passou para a equipe enquanto ela era gerada.`);
        return;
      }

      const enviou = silenciarResposta ? true : await replyToCustomer(user.id, remoteJid, replyText, recipientTarget);
      if (!silenciarResposta) {
        registrarTrace({
          instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
          estagio: enviou ? "enviado" : "envio-falhou",
          detalhe: enviou
            ? (tardia ? "resposta tardia: saiu depois do \"só um instante\"" : undefined)
            : "gateway recusou o envio (sendText não retornou ok)",
        });
      }

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
      if (!silenciarResposta) trackWhatsAppMessage(user.id, "OUTBOUND", "SERVICE", { remoteJid: recipientTarget });

      console.log(
        silenciarResposta
          ? `[${new Date().toISOString()}] [WhatsApp Webhook] 🤫 IA fora do ar e ${recipientTarget} já foi avisado: mensagem só encaminhada à fila da equipe.`
          : `[${new Date().toISOString()}] [WhatsApp Webhook] 🤖 Resposta enviada para ${recipientTarget}: "${replyText}"`
      );

      if (callHuman) {
        // As mesmas duas travas dos outros caminhos de transferência. Este só
        // gravava a de memória e não avisava ninguém: quando era a IA que decidia
        // chamar a equipe, com o painel fechado a loja simplesmente não ficava
        // sabendo — e um deploy devolvia o robô à conversa.
        const motivoDaTransferencia = falhaDaIa ? MOTIVO_IA_FORA_DO_AR : "Robô chamou atendente";
        if (!falhaDaIa) {
          pausarRobo(user.id, remoteJid);
          await passarParaAtendimentoHumano(user.id, remoteJid, "robô chamou atendente", now);
        }
        // Com a IA FORA DO AR não há pausa nem trava no banco, de propósito: a
        // conversa é da equipe só ENQUANTO a IA estiver fora. Cada mensagem tenta
        // a IA de novo; quando o crédito voltar, o robô responde na hora e a
        // entrada sai da fila. Com a trava de 12 h, o cliente ficaria sem robô
        // muito depois de tudo normalizar.
        enqueueHumanSupport(
          user.id, remoteJid, cleanPhone, data.pushName, transcription || textMessage,
          silenciarResposta ? "" : replyText, now, motivoDaTransferencia
        );

        // Com a IA fora do ar TODA conversa cai aqui: o alerta é um só por loja a
        // cada meia hora (acima), não um por cliente. Nos outros casos, um alerta
        // por mensagem — `donoJaAvisado` diz se o detector ou o bloco do áudio já
        // mandaram. (Havia aqui um `!transcription` fazendo esse papel, e ele
        // calava o alerta justo quando a IA chamava a equipe a partir de um áudio.)
        if (!falhaDaIa && !donoJaAvisado) {
          avisarDono(
            user.id,
            "pedido_de_atendente",
            textoDeProblemaNoPedido({
              nomeDoCliente: data.pushName || cleanPhone,
              telefone: cleanPhone,
              motivo: "o robô transferiu a conversa para a equipe",
              mensagemDoCliente: transcription || textMessage,
            })
          ).catch(() => {});
        }
        console.log(`[WhatsApp Webhook] 🙋 Chat transferido para atendimento humano: ${motivoDaTransferencia} (${remoteJid})`);
      }
    
      // Update cache after response
      // Para áudio, guarda o que foi dito — não o texto-marcador, que é igual em
      // toda mensagem de voz e não carrega nada do pedido.
      //
      // O histórico é RELIDO do cache aqui, não reaproveitado do começo da função:
      // entre a leitura e este ponto passaram a espera da IA e, na resposta tardia,
      // possivelmente outra mensagem inteira do mesmo cliente. Gravar por cima com a
      // cópia antiga apagaria o que a outra mensagem acabou de guardar.
      const historicoAtual = conversationCache.get(convKey) || [];
      historicoAtual.push({ sender: 'user', text: transcription || textMessage, timestamp: now });
    
      // NÃO salvar mensagens de erro de sistema no histórico da IA,
      // senão na próxima iteração a IA começa a alucinar que está quebrada de propósito.
      if (!falhaDaIa && !replyText.includes("instabilidade técnica")) {
        historicoAtual.push({ sender: 'bot', text: replyText, timestamp: Date.now() });
      }
    
      // Keep only the last 15 messages
      const updatedHistory = historicoAtual.slice(-15);
    
      conversationCache.set(convKey, updatedHistory);
      cooldownCache.set(remoteJid, Date.now());
      // Cópia no banco, para o próximo deploy não levar a conversa junto. Sem
      // `await`: o cliente já foi respondido, e a função nunca lança.
      void guardarMemoriaDaConversa(user.id, remoteJid, updatedHistory);
    }
  };

  // ── CHAMADA DA IA COM PRAZO — SEM JOGAR FORA O QUE CHEGAR DEPOIS ──────────
  //
  // Se o Gemini travar, o webhook não pode ficar pendurado: a Evolution desiste
  // e para de entregar mensagens. Mas o prazo era um `Promise.race`, que só para
  // de ESCUTAR: a chamada seguia viva e podia gravar o pedido e mandar imprimir
  // segundos depois de o cliente ler "instabilidade, peça pelo cardápio". Ele
  // refazia pelo site — dois pedidos, e uma comanda que ninguém esperava.
  //
  // Agora (lib/com-prazo.ts): venceu o prazo, o cliente lê "só um instante" e o
  // webhook é liberado; a resposta que chegar depois passa por
  // `entregarRespostaDaIa` como qualquer outra. Se nada chegar até o teto, o
  // vigia fala pela IA — aí sim é falha, e entra na conta de incidente.
  let aiResponse: any = null;
  let estourouOPrazo = false;
  try {
    // Se for mensagem de usuário, aplicamos um delay de leitura para imitar humano
    if (remoteJid?.includes("@s.whatsapp.net")) {
      const readingDelay = audioData ? 1500 : Math.floor(Math.random() * (5000 - 3000 + 1)) + 3000;
      await new Promise(r => setTimeout(r, readingDelay));
    }

    const aiTimeout = audioData ? 45000 : 25000;
    const iaInicio = Date.now();
    /** Quem já falou por esta mensagem depois do prazo. Um só fala. */
    let desfecho: "aberto" | "respondida" | "desistiu" = "aberto";
    let vigia: ReturnType<typeof setTimeout> | undefined;
    const falhaComoResposta = (motivo: unknown) => ({
      reply: fallbackReply, falhaDaIa: classificarFalhaDaIa(motivo), respostaDeFalha: "soluco" as const,
    });

    const espera = await comPrazo(
      processChatbotAI(user.id, textMessage, aiHistory, remoteJid, audioData, data.pushName),
      aiTimeout,
      async (respostaTardia, atrasoMs) => {
        if (vigia) clearTimeout(vigia);
        const vigiaJaFalou = desfecho === "desistiu";
        desfecho = "respondida";
        const pedidoTardio = (respostaTardia as any)?.pedido;
        registrarTrace({
          instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
          estagio: "ia-tardia", ms: aiTimeout + atrasoMs,
          detalhe: `chegou ${Math.round(atrasoMs / 1000)}s depois do prazo${pedidoTardio?.ok ? " · COM PEDIDO GRAVADO" : ""}${vigiaJaFalou ? " · o vigia já tinha respondido" : ""}`,
        });
        // Depois que o vigia falou ("não consegui, manda de novo"), a resposta
        // tardia só interessa se MEXEU no pedido: aí o cliente precisa saber.
        if (vigiaJaFalou && !pedidoTardio?.ok) return;
        try {
          await entregarRespostaDaIa(respostaTardia?.reply ? respostaTardia : falhaComoResposta("resposta vazia"), true);
        } catch (e: any) {
          console.error(`[${new Date().toISOString()}] [WhatsApp Webhook] ❌ Erro ao entregar a resposta tardia para ${remoteJid}:`, e?.message || e);
        }
      },
      (erroTardio) => {
        if (vigia) clearTimeout(vigia);
        if (desfecho !== "aberto") return;
        desfecho = "respondida";
        console.error(`[${new Date().toISOString()}] [WhatsApp Webhook] ❌ A IA falhou depois do prazo para ${remoteJid}:`, (erroTardio as any)?.message || erroTardio);
        entregarRespostaDaIa(falhaComoResposta(erroTardio), true).catch(() => {});
      },
    );

    if (espera.noPrazo) {
      // Resposta sem texto (null, ou `{}` de um caminho novo) é falha como
      // outra qualquer. Sem esta rede o cliente ficaria sem resposta nenhuma:
      // `entregarRespostaDaIa` só age quando há `reply`.
      aiResponse = (espera.valor as any)?.reply ? espera.valor : falhaComoResposta("resposta vazia");
      desfecho = "respondida";
    } else {
      estourouOPrazo = true;
      vigia = setTimeout(() => {
        if (desfecho !== "aberto") return;
        desfecho = "desistiu";
        console.warn(`[${new Date().toISOString()}] [WhatsApp Webhook] ⏳ A IA não respondeu nem depois do prazo para ${remoteJid}. Enviando fallback.`);
        entregarRespostaDaIa(falhaComoResposta("timeout"), true).catch(() => {});
      }, TETO_DA_RESPOSTA_TARDIA_MS);
    }
    registrarTrace({
      instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
      estagio: espera.noPrazo ? "ia-chamada" : "ia-timeout",
      ms: Date.now() - iaInicio,
      detalhe: espera.noPrazo ? undefined : `passou de ${aiTimeout}ms — cliente avisado, resposta segue sendo esperada`,
    });
  } catch (aiErr: any) {
    console.error(`[${new Date().toISOString()}] [WhatsApp Webhook] ❌ Erro na IA para ${remoteJid}:`, aiErr?.message || aiErr);
    registrarTrace({
      instancia: instance, telefone: mascararTelefone(remoteJid), tipo: tipoTrace,
      estagio: "erro", detalhe: String(aiErr?.message || aiErr).slice(0, 200),
    });
    aiResponse = { reply: fallbackReply, falhaDaIa: classificarFalhaDaIa(aiErr), respostaDeFalha: "soluco" };
  }

  if (estourouOPrazo) {
    // "Só um instante" NÃO entra no histórico nem na conta de falhas: ainda não
    // se sabe se a IA falhou. Conversa que passou para a equipe nesse meio-tempo
    // não recebe nada do robô.
    if (!roboEstaPausado(user.id, remoteJid)) {
      await replyToCustomer(user.id, remoteJid, FRASE_DE_SO_UM_INSTANTE, remoteJid || data.from || "");
      trackWhatsAppMessage(user.id, "OUTBOUND", "SERVICE", { remoteJid: remoteJid || data.from || "" });
    }
    return;
  }

  await entregarRespostaDaIa(aiResponse, false);
}

export async function GET() {
  return NextResponse.json({ status: "WhatsApp Webhook Active" });
}
