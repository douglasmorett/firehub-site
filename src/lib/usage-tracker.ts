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

  // Gemini 2.5 Flash (R$ — cotação ~5.5)
  GEMINI_INPUT_PER_1M:  3.30,  // ~$0.60/1M input tokens
  GEMINI_OUTPUT_PER_1M: 13.20, // ~$2.40/1M output tokens
  GEMINI_VISION_CALL:   0.08,  // Custo médio por chamada vision

  // Storage (Vercel Blob)
  STORAGE_PER_GB_MONTH: 0.25,  // ~$0.046/GB
};

function getYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

export function trackGeminiUsage(
  franchiseeId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  metadata?: Record<string, any>
) {
  const inputCost = (inputTokens / 1_000_000) * PRICING.GEMINI_INPUT_PER_1M;
  const outputCost = (outputTokens / 1_000_000) * PRICING.GEMINI_OUTPUT_PER_1M;
  const totalCost = inputCost + outputCost;

  prisma.usageLog.create({
    data: {
      franchiseeId,
      category: "GEMINI_CHAT",
      subCategory: model,
      quantity: inputTokens + outputTokens,
      estimatedCost: Math.round(totalCost * 10000) / 10000, // 4 casas decimais
      metadata: { model, inputTokens, outputTokens, inputCost, outputCost, ...(metadata || {}) },
      yearMonth: getYearMonth(),
    },
  }).catch((err) => console.error("[UsageTracker] Gemini log error:", err));
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
