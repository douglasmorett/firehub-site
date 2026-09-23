/**
 * usage-tracker.ts — Rastreamento de custos por lojista (FireHub)
 *
 * Registra custos de WhatsApp, Gemini AI, Vision e Storage por franchisee.
 * Todas as funções são fire-and-forget (não bloqueiam o fluxo principal).
 */
import { prisma } from "@/lib/prisma";

// ── Tabela de preços (R$) — atualizar conforme pricing da Meta/Google ──
const PRICING = {
  // WhatsApp Cloud API (por conversa, Brasil)
  WHATSAPP_SERVICE:   0.06,   // Conversa de serviço (cliente inicia)
  WHATSAPP_MARKETING: 0.45,   // Conversa de marketing (loja inicia)
  WHATSAPP_UTILITY:   0.08,   // Conversa de utilidade (notificação)
  WHATSAPP_FREE:      0.00,   // Primeiras 1000/mês grátis

  GEMINI_VISION_CALL:   0.08,  // Custo médio por chamada vision

  // Storage (Vercel Blob)
  STORAGE_PER_GB_MONTH: 0.25,  // ~$0.046/GB
};

function getYearMonth(): string {
  // Mês DE BRASÍLIA, o mesmo que fecha o ciclo em billing.ts. Com getMonth() do
  // container (UTC) o custo das 21:00 às 24:00 do último dia caía no mês
  // seguinte e sumia do ciclo fechado.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .format(new Date()).slice(0, 7);
}

// ── WhatsApp Message Tracking ──────────────────────────────────────

export function trackWhatsAppMessage(
  franchiseeId: string,
  direction: "INBOUND" | "OUTBOUND",
  conversationType: "SERVICE" | "MARKETING" | "UTILITY" = "SERVICE",
  metadata?: Record<string, any>
) {
  const costMap: Record<string, number> = {
    SERVICE: PRICING.WHATSAPP_SERVICE,
    MARKETING: PRICING.WHATSAPP_MARKETING,
    UTILITY: PRICING.WHATSAPP_UTILITY,
  };

  // Apenas mensagens outbound geram custo (a conversa é cobrada quando respondemos)
  const estimatedCost = direction === "OUTBOUND" ? costMap[conversationType] || 0 : 0;

  prisma.usageLog.create({
    data: {
      franchiseeId,
      category: "WHATSAPP_MSG",
      subCategory: conversationType,
      quantity: 1,
      estimatedCost,
      metadata: { direction, ...(metadata || {}) },
      yearMonth: getYearMonth(),
    },
  }).catch((err) => console.error("[UsageTracker] WhatsApp log error:", err));
}

// ── Gemini AI Token Tracking ───────────────────────────────────────
//
// Preço por modelo em US$ por 1 milhão de tokens (página oficial de preços em
// 23/09/2026), convertido na mesma cotação ~5.5 do resto do arquivo.
//
// A conta antiga cobrava tudo como Gemini 2.5 e não via duas coisas que pesam:
// - o "pensamento" (`thoughtsTokenCount`), cobrado pelo Google como SAÍDA, não
//   entrava em lugar nenhum — no robô é de 100 a 1.700 tokens por mensagem,
//   contra ~60 da resposta;
// - o pedaço do prompt que veio do cache (`cachedContentTokenCount`, que já está
//   DENTRO de `promptTokenCount`) custa 10% da entrada, e era cobrado cheio.
//
// ⚠️ O gemini-3.6-flash DOBRA em 01/01/2027 (1,50 / 7,50 / 0,15): atualizar aqui.
const COTACAO_DOLAR = 5.5;
const PRECO_GEMINI_USD: Record<string, { entrada: number; saida: number; cache: number }> = {
  "gemini-3.6-flash": { entrada: 0.75, saida: 3.75, cache: 0.075 },
  "gemini-2.5-flash": { entrada: 0.3, saida: 2.5, cache: 0.03 },
};

function precoDoModelo(model: string) {
  // "gemini-2.5-flash-mini" é o rótulo do prompt mínimo, que roda no 2.5.
  const chave = Object.keys(PRECO_GEMINI_USD).find((k) => model.startsWith(k));
  // Modelo desconhecido cobra como o mais caro da lista: melhor o painel
  // mostrar a mais do que esconder custo.
  return PRECO_GEMINI_USD[chave || "gemini-3.6-flash"];
}

export function trackGeminiUsage(
  franchiseeId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  metadata?: Record<string, any>,
  extra?: { thoughtsTokens?: number; cachedTokens?: number }
) {
  const preco = precoDoModelo(model);
  const thoughtsTokens = Math.max(0, Number(extra?.thoughtsTokens) || 0);
  const cachedTokens = Math.min(Math.max(0, Number(extra?.cachedTokens) || 0), inputTokens);
  const inputCost =
    (((inputTokens - cachedTokens) * preco.entrada + cachedTokens * preco.cache) / 1_000_000) * COTACAO_DOLAR;
  const outputCost = (((outputTokens + thoughtsTokens) * preco.saida) / 1_000_000) * COTACAO_DOLAR;
  const totalCost = inputCost + outputCost;

  prisma.usageLog.create({
    data: {
      franchiseeId,
      category: "GEMINI_CHAT",
      subCategory: model,
      quantity: inputTokens + outputTokens + thoughtsTokens,
      estimatedCost: Math.round(totalCost * 10000) / 10000, // 4 casas decimais
      metadata: { model, inputTokens, outputTokens, thoughtsTokens, cachedTokens, inputCost, outputCost, ...(metadata || {}) },
      yearMonth: getYearMonth(),
    },
  }).catch((err) => console.error("[UsageTracker] Gemini log error:", err));
}

// ── Preço que o robô DISSE x preço que existe ──────────────────────
//
// Não custa dinheiro: entra aqui porque `UsageLog` já é a tabela por lojista,
// com índice em (category, yearMonth) e `metadata` livre — dá para medir sem
// DDL e sem tabela nova. `estimatedCost` fica 0 de propósito: isto é
// telemetria de qualidade, e somá-la ao custo do mês mentiria na fatura.
//
// Existe porque a rede de segurança do FireHub cobre o pedido GRAVADO
// (syncAiOrderToDatabase recalcula tudo do banco) e não cobria NADA do que o
// robô diz em texto. O pastel de R$ 21,90 cotado a R$ 131,40 foi texto.

export type GravidadeDaDivergencia = "centavos" | "real" | "grave" | "impossivel";

export function trackDivergenciaDePreco(
  franchiseeId: string,
  gravidade: GravidadeDaDivergencia,
  detalhe: Record<string, any>
) {
  prisma.usageLog.create({
    data: {
      franchiseeId,
      category: "PRECO_DIVERGENTE",
      subCategory: gravidade,
      quantity: 1,
      estimatedCost: 0,
      metadata: detalhe,
      yearMonth: getYearMonth(),
    },
  }).catch((err) => console.error("[UsageTracker] Divergência de preço log error:", err));
}

// ── Gemini Vision Tracking (NF-e scan) ─────────────────────────────

export function trackVisionUsage(
  franchiseeId: string,
  metadata?: Record<string, any>
) {
  prisma.usageLog.create({
    data: {
      franchiseeId,
      category: "GEMINI_VISION",
      quantity: 1,
      estimatedCost: PRICING.GEMINI_VISION_CALL,
      metadata: metadata || {},
      yearMonth: getYearMonth(),
    },
  }).catch((err) => console.error("[UsageTracker] Vision log error:", err));
}

// ── Usage Summary (para dashboard admin) ───────────────────────────

export interface UsageSummary {
  whatsapp: { messages: number; cost: number };
  geminiChat: { tokens: number; cost: number; calls: number };
  geminiVision: { calls: number; cost: number };
  total: number;
}

export async function getUsageSummary(
  franchiseeId: string,
  yearMonth?: string
): Promise<UsageSummary> {
  const ym = yearMonth || getYearMonth();

  const logs = await prisma.usageLog.groupBy({
    by: ["category"],
    where: { franchiseeId, yearMonth: ym },
    _sum: { estimatedCost: true, quantity: true },
    _count: true,
  });

  const result: UsageSummary = {
    whatsapp: { messages: 0, cost: 0 },
    geminiChat: { tokens: 0, cost: 0, calls: 0 },
    geminiVision: { calls: 0, cost: 0 },
    total: 0,
  };

  for (const log of logs) {
    const cost = log._sum.estimatedCost || 0;
    const qty = log._sum.quantity || 0;

    switch (log.category) {
      case "WHATSAPP_MSG":
        result.whatsapp.messages = qty;
        result.whatsapp.cost = cost;
        break;
      case "GEMINI_CHAT":
        result.geminiChat.tokens = qty;
        result.geminiChat.cost = cost;
        result.geminiChat.calls = log._count;
        break;
      case "GEMINI_VISION":
        result.geminiVision.calls = qty;
        result.geminiVision.cost = cost;
        break;
    }
  }

  result.total = result.whatsapp.cost + result.geminiChat.cost + result.geminiVision.cost;
  return result;
}

// ── Bulk Summary (todos os lojistas de uma vez) ────────────────────

export async function getAllUsageSummaries(yearMonth?: string) {
  const ym = yearMonth || getYearMonth();

  const logs = await prisma.usageLog.groupBy({
    by: ["franchiseeId", "category"],
    where: { yearMonth: ym },
    _sum: { estimatedCost: true, quantity: true },
    _count: true,
  });

  const map = new Map<string, UsageSummary>();

  for (const log of logs) {
    if (!map.has(log.franchiseeId)) {
      map.set(log.franchiseeId, {
        whatsapp: { messages: 0, cost: 0 },
        geminiChat: { tokens: 0, cost: 0, calls: 0 },
        geminiVision: { calls: 0, cost: 0 },
        total: 0,
      });
    }
    const s = map.get(log.franchiseeId)!;
    const cost = log._sum.estimatedCost || 0;
    const qty = log._sum.quantity || 0;

    switch (log.category) {
      case "WHATSAPP_MSG":
        s.whatsapp.messages = qty;
        s.whatsapp.cost = cost;
        break;
      case "GEMINI_CHAT":
        s.geminiChat.tokens = qty;
        s.geminiChat.cost = cost;
        s.geminiChat.calls = log._count;
        break;
      case "GEMINI_VISION":
        s.geminiVision.calls = qty;
        s.geminiVision.cost = cost;
        break;
    }
  }

  // Calculate totals
  for (const [, s] of map) {
    s.total = s.whatsapp.cost + s.geminiChat.cost + s.geminiVision.cost;
  }

  return map;
}

export { PRICING };
