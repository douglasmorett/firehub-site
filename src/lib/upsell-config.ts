/**
 * O UPSELL DA SACOLA: até 5 produtos do próprio cardápio que o site oferece
 * quando o cliente clica em "Continuar pedido" (pedido do Douglas, 14/11/2026).
 *
 * Não aparece a cada item adicionado — "fica aparecendo toda hora, é chato".
 * É uma janela só, na passagem da sacola para a finalização, uma vez por
 * compra, e só com o que ainda não está na sacola.
 *
 * Mora em `User.upsellConfig` (JSON), o padrão da casa para config de loja
 * (balcaoConfig, painelPedidosConfig): a coluna é garantida no boot por
 * lib/garantir-colunas.ts e a tela é /store/cardapio/upsell.
 *
 * ── O DESCONTO É CONFERIDO NO SERVIDOR ─────────────────────────────────────
 *
 * A linha da sacola leva `upsellDesconto` (o % que a janela mostrou). A rota
 * do pedido (api/customer-order) só aplica o desconto se o produto estiver na
 * oferta da loja NAQUELE momento, ligada, com o MESMO %. Senão recusa com a
 * frase de "a oferta mudou" — nunca cobra o preço do navegador, e nunca cobra
 * calado um valor diferente do que o cliente viu.
 *
 * O % vale sobre o preço BASE do produto no delivery (já com a promoção, se
 * houver). Opções e adicionais escolhidos no item saem pelo preço normal: é o
 * que o modal do produto mostra, com a base riscada.
 */

export const MAXIMO_DE_ITENS_NO_UPSELL = 5;
export const CHAMADA_PADRAO_DO_UPSELL = "Que tal levar também?";
/** Teto do desconto: oferta de upsell não é brinde. */
export const DESCONTO_MAXIMO_DO_UPSELL = 90;

export type ItemDoUpsell = {
  produtoId: string;
  /** % inteiro de 0 a 90. 0 = oferece sem desconto. */
  desconto: number;
};

export type UpsellConfig = {
  ativo: boolean;
  /** O título da janela. */
  chamada: string;
  itens: ItemDoUpsell[];
};

export const UPSELL_CONFIG_PADRAO: UpsellConfig = { ativo: false, chamada: CHAMADA_PADRAO_DO_UPSELL, itens: [] };

/**
 * Lê o que está gravado (ou o corpo do POST), venha como vier. Ilegível vira
 * desligado; % fora da faixa vira inteiro de 0 a 90; produto repetido e o que
 * passar de 5 saem.
 */
export function lerUpsellConfig(bruto: unknown): UpsellConfig {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { ...UPSELL_CONFIG_PADRAO, itens: [] };
  const o = bruto as Record<string, unknown>;
  const chamada = typeof o.chamada === "string" && o.chamada.trim() ? o.chamada.trim().slice(0, 80) : CHAMADA_PADRAO_DO_UPSELL;
  const itens: ItemDoUpsell[] = [];
  for (const i of Array.isArray(o.itens) ? o.itens : []) {
    const produtoId = typeof i?.produtoId === "string" ? i.produtoId.trim() : "";
    if (!produtoId || itens.some((x) => x.produtoId === produtoId)) continue;
    const pct = Math.round(Number(i?.desconto));
    itens.push({ produtoId, desconto: Number.isFinite(pct) ? Math.min(DESCONTO_MAXIMO_DO_UPSELL, Math.max(0, pct)) : 0 });
    if (itens.length === MAXIMO_DE_ITENS_NO_UPSELL) break;
  }
  return { ativo: o.ativo === true, chamada, itens };
}

/**
 * O preço com o desconto do upsell, arredondado ao centavo (meio centavo
 * sobe; o 1e-6 desfaz o 16,9149999… do ponto flutuante). A tela e o servidor
 * usam esta mesma conta.
 */
export function precoNoUpsell(preco: number, desconto: number): number {
  return Math.round((Number(preco) || 0) * (100 - (Number(desconto) || 0)) + 1e-6) / 100;
}

/**
 * O % que o servidor aceita para a linha marcada como upsell, ou null quando a
 * oferta não vale mais (desligada, produto fora da lista, % diferente).
 */
export function descontoAceitoNoUpsell(config: unknown, produtoId: string, descontoDoNavegador: unknown): number | null {
  const c = lerUpsellConfig(config);
  if (!c.ativo) return null;
  const item = c.itens.find((i) => i.produtoId === produtoId);
  if (!item) return null;
  if (Number(descontoDoNavegador) !== item.desconto) return null;
  return item.desconto;
}

/**
 * O preço unitário da linha marcada como upsell — o que a rota do pedido
 * grava —, ou null quando a oferta não vale (a rota recusa o pedido).
 * `precoUnitario` é o que o servidor já calculou do banco (base + opções);
 * sai dele só o desconto sobre a base.
 */
export function precoDaLinhaDoUpsell(
  precoUnitario: number,
  precoBase: number,
  config: unknown,
  produtoId: string,
  descontoDoNavegador: unknown,
): number | null {
  const pct = descontoAceitoNoUpsell(config, produtoId, descontoDoNavegador);
  if (pct === null) return null;
  const base = Number(precoBase) || 0;
  return Math.round((precoUnitario - (base - precoNoUpsell(base, pct))) * 100) / 100;
}
