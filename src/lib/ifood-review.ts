/**
 * /src/lib/ifood-review.ts
 *
 * Review API v2.0 — listar, abrir, responder e resumir as avaliações da loja.
 *
 * O que a homologação cobra (checklist de 17/10/2026 + critérios da doc):
 *   - lista com os campos obrigatórios (id, status, replies[], version,
 *     visibility), filtro por data e o teste de limite de página: pageSize 100
 *     tem que voltar 400 ("pageSize must be <= 50");
 *   - detalhe completo (replies[].from MERCHANT/CUSTOMER, questions) e um ID
 *     inexistente voltando 404;
 *   - responder 3 avaliações em NOT_REPLIED (201), tentar responder uma
 *     PUBLISHED (409/422) e mandar texto inválido (400: 10 a 300 caracteres);
 *   - link para a Política de Avaliações do iFood visível na tela.
 *
 * Por isso a tela NÃO barra o pageSize 100, a resposta a uma avaliação
 * PUBLISHED nem o texto curto antes de chamar a API: o analista quer ver a
 * recusa do iFood chegando e sendo tratada. A regra aparece como aviso, a
 * chamada sai mesmo assim e o erro volta com a mensagem do iFood.
 */
import { chamarComContexto } from "./ifood-http";
import type { ContextoIfood } from "./ifood-token";

const BASE = "/review/v2.0/merchants";

/** Política oficial (Comunidade iFood). */
export const LINK_POLITICA_AVALIACOES =
  "https://comunidade.ifood.com.br/t/conheca-nossa-politica-de-avaliacoes-de-pedidos/87541";

export const TEXTO_MIN = 10;
export const TEXTO_MAX = 300;

export type FiltroAvaliacoes = {
  page?: number;
  pageSize?: number;
  /** ISO, ex. 2026-10-01T00:00:00Z */
  dateFrom?: string | null;
  dateTo?: string | null;
  sort?: "ASC" | "DESC";
  sortBy?: "CREATED_AT" | "ORDER_DATE";
};

/** Monta a query; puro, para testar sem rede. */
export function queryDaLista(f: FiltroAvaliacoes): string {
  const q = new URLSearchParams();
  q.set("page", String(Math.max(1, Math.round(Number(f.page) || 1))));
  // Sem teto aqui de propósito — ver o cabeçalho.
  q.set("pageSize", String(Math.max(1, Math.round(Number(f.pageSize) || 10))));
  q.set("addCount", "true");
  if (f.dateFrom) q.set("dateFrom", new Date(f.dateFrom).toISOString().replace(/\.\d{3}Z$/, "Z"));
  if (f.dateTo) q.set("dateTo", new Date(f.dateTo).toISOString().replace(/\.\d{3}Z$/, "Z"));
  if (f.sort === "ASC" || f.sort === "DESC") q.set("sort", f.sort);
  if (f.sortBy === "CREATED_AT" || f.sortBy === "ORDER_DATE") q.set("sortBy", f.sortBy);
  return q.toString();
}

export function listarAvaliacoes(ctx: ContextoIfood, f: FiltroAvaliacoes) {
  return chamarComContexto(ctx, `${BASE}/${ctx.merchantId}/reviews?${queryDaLista(f)}`, { idempotente: true });
}

export function detalheDaAvaliacao(ctx: ContextoIfood, reviewId: string) {
  // O id vai na URL: só caracteres de uuid, para "ID inexistente" ser um 404
  // do iFood e não uma URL quebrada daqui.
  const id = String(reviewId ?? "").trim().replace(/[^0-9a-zA-Z-]/g, "");
  return chamarComContexto(ctx, `${BASE}/${ctx.merchantId}/reviews/${id || "-"}`, { idempotente: true });
}

export function responderAvaliacao(ctx: ContextoIfood, reviewId: string, texto: string) {
  const id = String(reviewId ?? "").trim().replace(/[^0-9a-zA-Z-]/g, "");
  return chamarComContexto(ctx, `${BASE}/${ctx.merchantId}/reviews/${id || "-"}/answers`, {
    method: "POST",
    body: JSON.stringify({ text: String(texto ?? "") }),
  });
}

export function resumoDasAvaliacoes(ctx: ContextoIfood) {
  return chamarComContexto(ctx, `${BASE}/${ctx.merchantId}/summary`, { idempotente: true });
}

/** O que a tela diz antes de mandar — aviso, não bloqueio. */
export function avisoDoTexto(texto: string): string | null {
  const n = String(texto ?? "").trim().length;
  if (n < TEXTO_MIN) return `A resposta tem ${n} caracteres; o iFood exige de ${TEXTO_MIN} a ${TEXTO_MAX}.`;
  if (n > TEXTO_MAX) return `A resposta tem ${n} caracteres; o iFood aceita no máximo ${TEXTO_MAX}.`;
  return null;
}

export const NOME_STATUS: Record<string, string> = {
  CREATED: "Recebida",
  NOT_REPLIED: "Aguardando resposta",
  REPLIED: "Respondida",
  PUBLISHED: "Publicada",
  INVALID: "Inválida",
  DISCARDED: "Descartada",
  UNKNOWN: "Desconhecido",
};
