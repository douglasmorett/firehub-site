/**
 * Cartão de carimbos — a conta do cardápio, num lugar só.
 *
 * Até 16/10/2026 a conta morava só no navegador (components/customer/
 * CustomerStorePage.tsx), sobre a lista de "Meus pedidos" que o cardápio
 * carrega. A ficha do cliente no painel (aba Clientes) passou a mostrar o mesmo
 * cartão — pedido do Phabio, Pizzaria Lapastine — e o número dela só é o que o
 * cliente vê se a conta for a MESMA. Por isso a conta saiu para cá sem mudar:
 * o cardápio e a ficha chamam `contarCarimbos` sobre a mesma lista
 * (lib/pedidos-do-telefone.ts: os 10 últimos pedidos do telefone na loja).
 *
 * ── A regra de hoje, sem tirar nem pôr ───────────────────────────────────────
 *
 * - Ganha carimbo o pedido que não está "CANCELADO" e cujo total alcança o
 *   pedido mínimo.
 * - Carimbos no cartão = pedidos que ganharam % meta: o cartão cheio volta a
 *   zero e vira uma cartela completa.
 * - Os padrões são os `||` do cardápio: meta vazia vira 10, pedido mínimo vazio
 *   OU ZERO vira R$ 30, prêmio vazio ou zero vira R$ 25.
 * - O prêmio NÃO é aplicado pelo sistema em pedido nenhum: a loja dá à mão. É
 *   para isso que a ficha mostra as cartelas completas.
 *
 * ── O que a regra deixa passar (e não foi mudado aqui) ───────────────────────
 *
 * Só a grafia "CANCELADO" fica de fora: CANCELLED/CANCELED, RECUSADO, o
 * rascunho do robô e o pedido esperando pagamento ganham carimbo se o total
 * alcançar o mínimo. A régua da aba Clientes não conta nenhum desses. E a lista
 * é a de "Meus pedidos" — só os 10 últimos —, então quem passa de 10 pedidos
 * que contam vê o cartão andar errado. Em 16/10/2026 nenhuma das 4 lojas com
 * carimbos tinha cliente nessa situação (o maior tinha 5 pedidos).
 */

export type RegraDosCarimbos = {
  ativo: boolean;
  /** Carimbos para completar a cartela. */
  meta: number;
  /** Total mínimo do pedido (R$) para ganhar carimbo. */
  pedidoMinimo: number;
  premioTipo: "discount" | "product";
  /** Valor do desconto do prêmio (R$), quando o prêmio é desconto. */
  premioValor: number;
};

export function lerCarimbos(storeLoyalty: unknown): RegraDosCarimbos {
  const l = (storeLoyalty && typeof storeLoyalty === "object" ? storeLoyalty : {}) as Record<string, any>;
  const meta = Number(l.stampGoal || 10);
  return {
    ativo: Boolean(l.stampsActive),
    // A tela de configuração só oferece 5, 8, 10 ou 12; meta quebrada no banco
    // dividiria por zero (ou por NaN) e o cartão sairia "NaN / NaN".
    meta: Number.isInteger(meta) && meta >= 1 ? meta : 10,
    pedidoMinimo: Number(l.stampMinOrder || 30),
    premioTipo: l.stampRewardType === "product" ? "product" : "discount",
    premioValor: Number(l.stampRewardValue || 25),
  };
}

export type PedidoDoCarimbo = { status?: string | null; totalAmount?: number | string | null };

/** O pedido ganha carimbo? A conta que o cardápio sempre fez. */
export function ganhaCarimbo(p: PedidoDoCarimbo, regra: RegraDosCarimbos): boolean {
  return p.status !== "CANCELADO" && (Number(p.totalAmount) >= regra.pedidoMinimo || !regra.pedidoMinimo);
}

export type CartaoDeCarimbos = {
  /** Pedidos da lista que ganharam carimbo. */
  validos: number;
  /** Carimbos no cartão atual (o que o cardápio mostra: "3 / 10"). */
  noCartao: number;
  /** Quantos faltam para completar o cartão atual. */
  faltam: number;
  /** Cartelas completas: pedidos que ganharam ÷ meta, para baixo. */
  completas: number;
  /**
   * O último carimbo fechou uma cartela: o cartão está vazio e o próximo pedido
   * que contar abre o novo. Só com a lista inteira — ver `listaCortada`.
   */
  acabouDeCompletar: boolean;
};

/**
 * `listaCortada`: o cliente tem mais pedidos do que a lista trouxe (o cardápio
 * olha só os 10 mais recentes). A contagem não muda — é a de sempre —, mas aí
 * não dá para dizer que ele ACABOU de completar: com 12 pedidos que contam, os
 * 10 da lista dariam "cartela completa" para sempre, e o prêmio seria cobrado
 * de novo.
 */
export function contarCarimbos(
  regra: RegraDosCarimbos,
  pedidos: PedidoDoCarimbo[] | null | undefined,
  listaCortada = false,
): CartaoDeCarimbos {
  const validos = (pedidos || []).filter((p) => ganhaCarimbo(p, regra)).length;
  const noCartao = validos % regra.meta;
  return {
    validos,
    noCartao,
    faltam: Math.max(0, regra.meta - noCartao),
    completas: Math.floor(validos / regra.meta),
    acabouDeCompletar: !listaCortada && validos > 0 && noCartao === 0,
  };
}

const reais = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

/** O prêmio da cartela, para a loja ler na ficha. */
export function premioDosCarimbos(regra: RegraDosCarimbos): string {
  return regra.premioTipo === "product" ? "1 prêmio grátis" : `${reais(regra.premioValor)} de desconto`;
}

/** "a partir de R$ 43,00" — o pedido mínimo que conta. */
export function minimoDosCarimbos(regra: RegraDosCarimbos): string {
  return Number.isFinite(regra.pedidoMinimo) && regra.pedidoMinimo > 0 ? `pedido a partir de ${reais(regra.pedidoMinimo)}` : "qualquer pedido";
}
