/**
 * DESCONTO PARA QUEM PAGA PELO SITE (Pix ou cartão na conta Asaas da loja).
 *
 * A loja escolhe um % para cada forma em Minha Loja → Formas de Pagamento
 * (StoreSettingsForm). Fica em `paymentFees.descontoOnline = { pix, cartao }`:
 * uma chave própria, porque as outras chaves de `paymentFees` são as formas
 * (PIX, CREDITO...) e o painel procura a taxa da maquininha por elas.
 *
 * O cardápio (CustomerStorePage) e o servidor do pedido
 * (api/customer-order) usam ESTA conta. O Asaas cobra o `totalAmount`
 * gravado e a confirmação recusa pagamento que difere dele em mais de um
 * centavo: se o cliente visse um total e o servidor gravasse outro, o
 * pagamento não fecharia.
 *
 * Base: os itens depois do cupom e do prêmio da Trilha. A taxa de entrega
 * fica de fora — é do entregador, não da venda.
 */

export type FormaOnline = "pix" | "cartao";

export type DescontoOnline = { pix: number; cartao: number };

/** Teto do %: acima disso é erro de digitação (50 no lugar de 5,0). */
export const DESCONTO_ONLINE_MAXIMO = 30;

const percentual = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(DESCONTO_ONLINE_MAXIMO, Math.round(n * 100) / 100);
};

/** O que a loja gravou, já limpo (ausente, negativo ou texto = 0). */
export function descontoOnlineDaLoja(paymentFees: unknown): DescontoOnline {
  const d = (paymentFees as any)?.descontoOnline;
  return { pix: percentual(d?.pix), cartao: percentual(d?.cartao) };
}

/**
 * Qual forma pelo site o `paymentMethod` do cardápio é. "PIX_ENTREGA" NÃO é
 * pelo site (o cliente paga na chave da loja ao receber) e não leva desconto.
 */
export function formaOnlineDoMetodo(paymentMethod: unknown): FormaOnline | null {
  const pm = String(paymentMethod || "").toUpperCase().trim();
  if (pm === "PIX" || pm === "PIX_ONLINE") return "pix";
  if (pm === "CREDITO_ONLINE" || pm === "CARTAO_ONLINE") return "cartao";
  return null;
}

export const NOME_DA_FORMA_ONLINE: Record<FormaOnline, string> = {
  pix: "Pix pelo site",
  cartao: "Cartão pelo site",
};

/**
 * O desconto deste pedido, em reais (centavos arredondados), ou null.
 * `ligada` diz se a loja recebe essa forma pela conta Asaas dela: o Pix do
 * Mercado Pago antigo (hasOnlinePayment) também grava "PIX" e não leva.
 */
export function descontoDoPagamentoOnline(opts: {
  paymentFees: unknown;
  paymentMethod: unknown;
  ligada: { pix: boolean; cartao: boolean };
  base: number;
}): { forma: FormaOnline; percentual: number; valor: number; rotulo: string } | null {
  const forma = formaOnlineDoMetodo(opts.paymentMethod);
  if (!forma || !opts.ligada[forma]) return null;
  const pct = descontoOnlineDaLoja(opts.paymentFees)[forma];
  const base = Math.max(0, Number(opts.base) || 0);
  const valor = Math.round(base * pct) / 100;
  if (valor <= 0) return null;
  const pctTexto = String(pct).replace(".", ",");
  return { forma, percentual: pct, valor, rotulo: `Desconto ${NOME_DA_FORMA_ONLINE[forma]} (${pctTexto}%)` };
}
