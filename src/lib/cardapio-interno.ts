/**
 * /src/lib/cardapio-interno.ts
 *
 * Regra única de "o que é o cardápio PRÓPRIO da loja".
 *
 * A loja tem dois tipos de produto no mesmo banco:
 *
 *   1. o cardápio dela, cadastrado no painel;
 *   2. o espelho do catálogo das integrações (iFood, JotaJá), que entra pela
 *      sincronização só para o pedido de fora conseguir casar item com preço.
 *
 * O espelho não pode aparecer para quem atende: o balconista não vende pelo
 * iFood, o garçom não lança pelo iFood, e o cliente no totem muito menos. Ele
 * existe só para o pedido que chega pronto da plataforma.
 *
 * Por que virou arquivo: a exclusão estava escrita à mão dentro de
 * `api/admin/menu-products/route.ts` comparando com `["IFOOD", "JOTAJA", ...]`
 * em CAIXA ALTA — e a categoria gravada pela sincronização é `"iFood"`. O `in`
 * do Prisma no PostgreSQL diferencia maiúscula de minúscula, então o filtro
 * passava direto: dos 94 produtos ativos da Hakim Centro, os 94 chegavam ao PDV,
 * 36 deles espelho do iFood. O atendente rolava a lista passando por duplicata.
 *
 * Com uma função só, o dia que entrar outra integração é uma linha aqui.
 */

/**
 * Categorias que a sincronização usa para o espelho das plataformas.
 * Comparadas SEM diferenciar maiúscula de minúscula — foi exatamente essa
 * diferença que fez o filtro antigo não filtrar nada.
 */
export const CATEGORIAS_DE_INTEGRACAO = ["IFOOD", "JOTAJA", "JOTAJÁ", "ONLINE", "99FOOD"];

/**
 * Trecho de `where` do Prisma que remove o espelho das integrações.
 * Use em todo canal interno: PDV, mesa, totem, KDS.
 */
export const SEM_PRODUTO_DE_INTEGRACAO = {
  NOT: {
    category: { in: CATEGORIAS_DE_INTEGRACAO, mode: "insensitive" as const },
  },
};

/** Versão para filtrar em memória, quando os produtos já vieram do banco. */
export function ehProdutoDeIntegracao(categoria: string | null | undefined): boolean {
  if (!categoria) return false;
  return CATEGORIAS_DE_INTEGRACAO.includes(categoria.trim().toUpperCase());
}

/**
 * Dia da semana em São Paulo, no formato que `availableDays` grava.
 *
 * `new Date().getDay()` responde pelo fuso do servidor, que roda em UTC. Depois
 * das 21h de Brasília o servidor já virou o dia: a promoção de sexta sumia do
 * cardápio às 21h de quinta e continuava no ar até as 21h de sexta.
 */
export function diaDaSemanaEmSaoPaulo(ref: Date = new Date()): string {
  const sigla = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(ref);

  const mapa: Record<string, string> = {
    Sun: "DOM", Mon: "SEG", Tue: "TER", Wed: "QUA", Thu: "QUI", Fri: "SEX", Sat: "SAB",
  };
  return mapa[sigla] ?? "DOM";
}

/**
 * O produto está disponível hoje?
 *
 * `availableDays` é um JSON com as siglas dos dias. Ausente, vazio ou ilegível
 * significa "todo dia" — nunca esconder produto por causa de campo mal gravado.
 */
export function disponivelHoje(availableDays: unknown, hoje = diaDaSemanaEmSaoPaulo()): boolean {
  if (!availableDays) return true;
  try {
    const dias = typeof availableDays === "string" ? JSON.parse(availableDays) : availableDays;
    if (!Array.isArray(dias) || dias.length === 0) return true;
    return dias.includes(hoje);
  } catch {
    return true;
  }
}
