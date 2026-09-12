/**
 * Quanto de desconto o MARKETPLACE bancou neste pedido.
 *
 * ── Por que a pergunta existe ───────────────────────────────────────────────
 *
 * No fechamento do caixa, cupom bancado pela plataforma não entra na gaveta: o
 * dinheiro nunca passou pela loja. O iFood já tinha isso resolvido — ele manda
 * `discountIfood` num campo próprio e o caixa o separa numa linha informativa.
 *
 * O 99Food não manda campo equivalente. O que ele manda é a lista de promoções,
 * e dentro de cada uma o `shop_subside_price`: quanto daquele desconto saiu do
 * bolso da LOJA. O resto é dinheiro do 99Food.
 *
 * Exemplo real do pedido #266009 (12/09/2026), em centavos:
 *
 *   promo 2  → desconto 900   loja bancou 900   → 99Food bancou 0
 *   promo 3  → desconto 1000  loja bancou 1000  → 99Food bancou 0
 *   promo 11 → desconto 500   loja bancou 0     → 99Food bancou 500
 *   promo 12 → desconto 100   loja bancou 0     → 99Food bancou 100
 *
 * Total do desconto R$ 25,00, dos quais R$ 6,00 são do 99Food.
 *
 * O dado já está gravado em `discountDetails.promocoes` desde que a integração
 * existe — só nunca tinha sido lido.
 */

type PromocaoDo99 = { promo_discount?: unknown; shop_subside_price?: unknown };

type PedidoComDesconto = {
  source?: string | null;
  discountIfood?: number | null;
  discountDetails?: unknown;
};

const centavos = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A parte do desconto que o 99Food pagou. Zero quando não é pedido deles. */
export function cupomBancadoPelo99(pedido: PedidoComDesconto | null | undefined): number {
  const d = pedido?.discountDetails as { promocoes?: unknown } | null | undefined;
  const lista = Array.isArray(d?.promocoes) ? (d!.promocoes as PromocaoDo99[]) : [];
  if (lista.length === 0) return 0;
  let bancadoPelo99 = 0;
  for (const p of lista) {
    const total = centavos(p?.promo_discount);
    const daLoja = centavos(p?.shop_subside_price);
    // Nunca negativo: promoção em que a loja bancou MAIS que o desconto não faz
    // sentido, mas se vier assim não vira crédito do 99Food.
    bancadoPelo99 += Math.max(0, total - daLoja);
  }
  return Math.round(bancadoPelo99) / 100;
}

/**
 * O cupom do marketplace neste pedido, seja qual for o canal.
 *
 * iFood pelo campo próprio, 99Food pela conta das promoções. Um lugar só, para
 * o caixa e o relatório não divergirem no dia em que entrar o terceiro canal.
 */
export function cupomDoMarketplace(pedido: PedidoComDesconto | null | undefined): {
  ifood: number;
  food99: number;
  total: number;
} {
  const ifood = Math.max(0, Number(pedido?.discountIfood || 0));
  const food99 = cupomBancadoPelo99(pedido);
  return { ifood, food99, total: Math.round((ifood + food99) * 100) / 100 };
}

/** É pedido do 99Food? Mesma leitura do resto do sistema. */
export function ehDo99Food(pedido: { source?: string | null; openDeliveryChannel?: string | null } | null | undefined): boolean {
  const src = String(pedido?.source || "").toUpperCase();
  const canal = String(pedido?.openDeliveryChannel || "").toUpperCase();
  return src === "99FOOD" || canal === "99FOOD" || (src === "OPEN_DELIVERY" && canal.includes("99"));
}
