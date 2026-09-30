/**
 * Quais avaliações o CLIENTE vê no cardápio — e contam na nota dele.
 *
 * Pedido do dono (29/09/2026), a partir da Ragnar: a loja escolhe a partir de
 * quantas estrelas a avaliação aparece no cardápio, "para ficar só com as
 * avaliações melhores". A que fica abaixo não some: continua no painel da
 * loja, que precisa dela para responder e para melhorar. Só não aparece nem
 * entra na média que o cliente lê.
 *
 * Um lugar só para a regra, porque dois leem as avaliações para o cliente: a
 * página do cardápio (loja/[slug]/page.tsx, média e comentários) e a rota
 * pública /api/store-reviews?slug=.
 */

/** O mínimo gravado, conferido: 2 a 5. Qualquer outra coisa (nulo, 1, lixo) = todas. */
export function minimoDeEstrelas(bruto: unknown): number | null {
  const n = Math.round(Number(bruto));
  return Number.isFinite(n) && n >= 2 && n <= 5 ? n : null;
}

/** O filtro do Prisma para as avaliações que o cardápio mostra. */
export function filtroDoCardapio(minimo: number | null): { rating?: { gte: number } } {
  return minimo ? { rating: { gte: minimo } } : {};
}

/** A avaliação entra no cardápio? */
export function entraNoCardapio(rating: number, minimo: number | null): boolean {
  return !minimo || rating >= minimo;
}

/** Média com uma casa e contagem — a mesma conta do painel. Sem avaliação, 5,0 (como sempre foi). */
export function notaDasAvaliacoes(avaliacoes: { rating: number }[]): { media: number; total: number } {
  const total = avaliacoes.length;
  if (total === 0) return { media: 5.0, total: 0 };
  const soma = avaliacoes.reduce((s, a) => s + (Number(a.rating) || 0), 0);
  return { media: Number((soma / total).toFixed(1)), total };
}
