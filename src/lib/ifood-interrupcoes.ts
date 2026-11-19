/**
 * As pausas (interrupções) da loja no iFood — Merchant API. É o que o botão do
 * iFood no topo do painel faz (StoreTopNav, pelas rotas api/ifood/interruptions):
 * fechar = criar uma interrupção; abrir = apagar todas.
 *
 * Saiu das rotas para o Bill (lib/assessor/modulos/fiscal.ts) usar as MESMAS
 * chamadas sem a sessão do navegador: as rotas continuam só com o contexto do
 * iFood e a tradução da resposta.
 */
import { chamarComContexto } from "./ifood-http";
import type { ContextoIfood } from "./ifood-token";

const caminho = (merchantId: string) => `/merchant/v1.0/merchants/${merchantId}/interruptions`;

export function listarInterrupcoes(ctx: ContextoIfood) {
  return chamarComContexto(ctx, caminho(ctx.merchantId));
}

/** O iFood responde o array puro ou `{ interruptions }`. */
export function interrupcoesDaResposta(data: unknown): any[] {
  return Array.isArray(data) ? data : ((data as any)?.interruptions ?? []);
}

export function criarInterrupcao(ctx: ContextoIfood, p: { description?: string; start: string; end: string }) {
  return chamarComContexto(ctx, caminho(ctx.merchantId), {
    method: "POST",
    body: JSON.stringify({ description: p.description || "Pausa temporária", start: p.start, end: p.end }),
  });
}

export function removerInterrupcao(ctx: ContextoIfood, id: string) {
  return chamarComContexto(ctx, `${caminho(ctx.merchantId)}/${id}`, { method: "DELETE" });
}
