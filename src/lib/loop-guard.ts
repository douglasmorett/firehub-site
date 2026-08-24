/**
 * Anti-loop e convivência com atendente humano no chatbot de WhatsApp.
 *
 * Dois problemas moram aqui:
 *
 * 1. Loop bot-a-bot. Um robô do outro lado (InfinityPay, banco, marketplace)
 *    responde a tudo, para sempre. As travas que já existiam olhavam VELOCIDADE
 *    (cooldown de 3s) e ORIGEM (fromMe, grupos) — duas máquinas alternando a
 *    cada 8 segundos passam por todas e conversam sem fim, a uma chamada de IA
 *    por turno.
 *
 * 2. Robô falando por cima do dono da loja. Quando o lojista responde o cliente
 *    pelo próprio número conectado, o robô precisa perceber e calar.
 *
 * Duas decisões de projeto guiam o arquivo inteiro:
 *
 * - Todo limite é POR CONVERSA, nunca por loja. Teto por loja é recurso
 *   compartilhado: numa sexta cheia, uma conversa travada comeria a cota dos
 *   clientes reais. Por conversa, volume não importa — 500 clientes são 500
 *   orçamentos independentes.
 *
 * - Ao suspeitar, DEGRADAMOS a resposta em vez de calar. O cliente recebe uma
 *   frase fixa e cai no atendimento humano. Custo de IA vai a zero, ninguém
 *   fica sem resposta, e resposta enlatada não dá assunto para o outro bot — o
 *   loop morre sozinho.
 */

import { prisma } from "@/lib/prisma";

/** Turnos parados antes de degradar. Conversa real converge bem antes disso. */
const MAX_TURNS_WITHOUT_PROGRESS = 12;

/** Intervalos guardados para medir regularidade. */
const INTERVAL_WINDOW = 6;

/** Mínimo de intervalos para a variância significar alguma coisa. */
const MIN_INTERVALS_FOR_RHYTHM = 5;

/**
 * Coeficiente de variação abaixo disto = cadência de máquina.
 * Gente responde em 4s, 90s, 12s, 3min: CV quase sempre acima de 0,6.
 * Robô responde em 8s, 8s, 9s, 8s: CV perto de zero.
 */
const MAX_CV_FOR_HUMAN = 0.25;

/** Quantos hashes de mensagem recebida guardar, para detectar repetição. */
const HASH_WINDOW = 5;

/** Conversa parada por este tempo recomeça do zero. */
const CONVERSATION_RESET_MS = 6 * 60 * 60 * 1000;

/**
 * Silêncio do robô depois que o lojista responde pelo número conectado.
 * Passado esse tempo sem ele falar de novo, o robô volta a atender — senão um
 * atendimento largado no meio deixaria o cliente sem resposta nenhuma.
 */
export const HUMAN_TAKEOVER_SILENCE_MS = 5 * 60 * 1000;

/** Hashes de mensagens que o próprio robô enviou, para reconhecer o eco. */
const BOT_SENT_WINDOW = 10;

export type LoopDecision =
  | { action: "allow" }
  | { action: "ignore"; reason: string }
  | { action: "degrade"; reason: string; message: string };

export interface LoopGuardInput {
  userId: string;
  remoteJid: string;
  text: string;
  /** Nome verificado de conta empresarial, quando o WhatsApp informa. */
  verifiedBizName?: string | null;
  now: number;
}

/** Normaliza para comparar mensagens sem tropeçar em acento, caixa ou emoji. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hash barato e estável (djb2) para comparar mensagens sem guardar o texto. */
function hashText(text: string): string {
  const s = normalize(text);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * A conversa andou?
 *
 * Este é o ponto que faz o contador não atrapalhar cliente real. O gatilho não
 * é "muitos turnos" — é "muitos turnos SEM SAIR DO LUGAR". Cliente indeciso
 * montando um combo cita produto, quantidade, endereço, forma de pagamento: ele
 * produz progresso o tempo todo e nunca chega perto do limite, mesmo em 30
 * mensagens. Loop de robô fica estacionário.
 */
export function hasProgressSignal(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;

  // Quantidade seguida de item ("2 x salada", "3 refri")
  if (/\b\d+\s+[a-z]{2,}/.test(t)) return true;

  // Endereço
  if (/\b(rua|avenida|av|travessa|alameda|rodovia|estrada|bairro|numero|apto|apartamento|bloco|casa|cep|proximo|perto|referencia)\b/.test(t)) return true;

  // Pagamento e fechamento
  if (/\b(pix|cartao|credito|debito|dinheiro|troco|boleto|pagar|pagamento|entrega|entregar|retirada|retirar|delivery|taxa|total|valor|preco|custa|fechar|finalizar|confirmar|pedido)\b/.test(t)) return true;

  // Intenção explícita de compra
  if (/\b(quero|vou querer|me ve|manda|pode ser|aceito|adiciona|acrescenta|tira|sem|com)\b/.test(t)) return true;

  return false;
}

/** Coeficiente de variação (desvio padrão / média). */
function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return Infinity;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return Infinity;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function toNumberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : [];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export const DEGRADE_MESSAGE =
  "Vou chamar uma pessoa da nossa equipe para continuar com você por aqui. Um instante! 😊";

/**
 * Decide se vale gastar uma chamada de IA nesta mensagem.
 *
 * Chame ANTES de acionar o modelo. Já grava o estado atualizado da conversa.
 * Nunca lança: qualquer falha aqui libera a mensagem, porque errar para o lado
 * de gastar uma chamada é muito melhor do que deixar cliente sem resposta.
 */
export async function evaluateLoopGuard(input: LoopGuardInput): Promise<LoopDecision> {
  try {
    return await evaluate(input);
  } catch (err) {
    console.error("[LoopGuard] Falha ao avaliar conversa, liberando por segurança:", err);
    return { action: "allow" };
  }
}

async function evaluate(input: LoopGuardInput): Promise<LoopDecision> {
  const { userId, remoteJid, text, verifiedBizName, now } = input;

  // ── Sinal A: conta empresarial verificada ───────────────────────────────
  // Cliente de verdade não é conta empresarial verificada; robô institucional
  // é. Decide sozinho, sem precisar de segundo sinal.
  if (verifiedBizName && verifiedBizName.trim()) {
    const reason = `conta empresarial verificada (${verifiedBizName.trim()})`;
    await markDegraded(userId, remoteJid, reason, now);
    return { action: "ignore", reason };
  }

  const state = await prisma.chatbotConversationState.findUnique({
    where: { userId_remoteJid: { userId, remoteJid } },
  });

  // ── Atendente da loja assumiu ───────────────────────────────────────────
  const takeoverAt = state?.humanTakeoverAt ? state.humanTakeoverAt.getTime() : 0;
  if (takeoverAt && now - takeoverAt < HUMAN_TAKEOVER_SILENCE_MS) {
    return { action: "ignore", reason: "atendente da loja assumiu a conversa" };
  }

  // Já degradada: a conversa está com o atendimento humano, não gasta IA.
  if (state?.degradedAt) {
    return { action: "ignore", reason: state.degradedReason || "conversa degradada" };
  }

  const lastAt = state?.lastMessageAt ? state.lastMessageAt.getTime() : 0;
  const isStale = lastAt > 0 && now - lastAt > CONVERSATION_RESET_MS;

  let intervals = isStale ? [] : toNumberArray(state?.recentIntervals);
  let hashes = isStale ? [] : toStringArray(state?.recentHashes);
  let turnCount = isStale ? 0 : state?.turnCount ?? 0;
  let turnsWithoutProgress = isStale ? 0 : state?.turnsWithoutProgress ?? 0;

  if (lastAt > 0 && !isStale) {
    intervals = [...intervals, now - lastAt].slice(-INTERVAL_WINDOW);
  }

  const hash = hashText(text);
  const repeated = hashes.includes(hash);
  hashes = [...hashes, hash].slice(-HASH_WINDOW);

  turnCount += 1;
  turnsWithoutProgress = hasProgressSignal(text) ? 0 : turnsWithoutProgress + 1;

  // ── Sinal B: cadência regular demais ────────────────────────────────────
  const rhythmIsMechanical =
    intervals.length >= MIN_INTERVALS_FOR_RHYTHM &&
    coefficientOfVariation(intervals) < MAX_CV_FOR_HUMAN;

  // ── Sinal C: conversa que não sai do lugar ──────────────────────────────
  const stationary = turnsWithoutProgress >= MAX_TURNS_WITHOUT_PROGRESS;

  const signals: string[] = [];
  if (rhythmIsMechanical) signals.push("cadência regular de máquina");
  if (stationary) signals.push(`${turnsWithoutProgress} turnos sem progresso`);
  if (repeated) signals.push("mensagem repetida");

  // Dois sinais bastam. Um só pode ser coincidência — cliente repetindo a
  // pergunta, ou uma sequência de "oi?" sem nenhuma palavra de pedido.
  if (signals.length >= 2) {
    const reason = signals.join(" + ");
    await markDegraded(userId, remoteJid, reason, now);
    return { action: "degrade", reason, message: DEGRADE_MESSAGE };
  }

  await prisma.chatbotConversationState.upsert({
    where: { userId_remoteJid: { userId, remoteJid } },
    create: {
      userId,
      remoteJid,
      turnCount,
      turnsWithoutProgress,
      recentIntervals: intervals,
      recentHashes: hashes,
      lastMessageAt: new Date(now),
    },
    update: {
      turnCount,
      turnsWithoutProgress,
      recentIntervals: intervals,
      recentHashes: hashes,
      lastMessageAt: new Date(now),
    },
  });

  return { action: "allow" };
}

async function markDegraded(userId: string, remoteJid: string, reason: string, now: number) {
  await prisma.chatbotConversationState.upsert({
    where: { userId_remoteJid: { userId, remoteJid } },
    create: {
      userId,
      remoteJid,
      lastMessageAt: new Date(now),
      degradedAt: new Date(now),
      degradedReason: reason,
    },
    update: {
      lastMessageAt: new Date(now),
      degradedAt: new Date(now),
      degradedReason: reason,
    },
  });
}

/**
 * Registra o que o robô acabou de enviar.
 *
 * O WhatsApp devolve as mensagens do próprio número como `fromMe`, inclusive as
 * que o robô mandou. Guardar o hash é o que permite, depois, saber se um
 * `fromMe` foi o lojista digitando ou apenas o eco da nossa própria resposta.
 */
export async function registerBotReply(userId: string, remoteJid: string, text: string) {
  try {
    const state = await prisma.chatbotConversationState.findUnique({
      where: { userId_remoteJid: { userId, remoteJid } },
      select: { botSentHashes: true },
    });
    const hashes = [...toStringArray(state?.botSentHashes), hashText(text)].slice(-BOT_SENT_WINDOW);

    await prisma.chatbotConversationState.upsert({
      where: { userId_remoteJid: { userId, remoteJid } },
      create: { userId, remoteJid, botSentHashes: hashes },
      update: { botSentHashes: hashes },
    });
  } catch (err) {
    console.error("[LoopGuard] Falha ao registrar resposta do robô:", err);
  }
}

/**
 * Processa uma mensagem `fromMe` — saiu do número conectado da loja.
 *
 * Se bate com algo que o robô enviou, é o nosso próprio eco e não significa
 * nada. Se não bate, foi o lojista digitando: o robô se cala pelos próximos
 * HUMAN_TAKEOVER_SILENCE_MS para não responder por cima dele.
 *
 * Retorna true quando reconheceu um atendente humano.
 */
export async function handleOutgoingMessage(
  userId: string,
  remoteJid: string,
  text: string,
  now: number
): Promise<boolean> {
  try {
    const state = await prisma.chatbotConversationState.findUnique({
      where: { userId_remoteJid: { userId, remoteJid } },
      select: { botSentHashes: true },
    });

    const known = toStringArray(state?.botSentHashes);
    if (known.includes(hashText(text))) return false; // eco do próprio robô

    await prisma.chatbotConversationState.upsert({
      where: { userId_remoteJid: { userId, remoteJid } },
      create: { userId, remoteJid, humanTakeoverAt: new Date(now) },
      update: { humanTakeoverAt: new Date(now) },
    });
    return true;
  } catch (err) {
    console.error("[LoopGuard] Falha ao processar mensagem do lojista:", err);
    return false;
  }
}

/**
 * Libera a conversa quando o atendimento humano termina.
 * Sem isto, o cliente que caiu na trava ficaria sem robô para sempre.
 */
export async function clearLoopGuard(userId: string, remoteJid: string) {
  await prisma.chatbotConversationState
    .updateMany({
      where: { userId, remoteJid },
      data: {
        degradedAt: null,
        degradedReason: null,
        humanTakeoverAt: null,
        turnCount: 0,
        turnsWithoutProgress: 0,
        recentIntervals: [],
        recentHashes: [],
      },
    })
    .catch(() => {});
}
