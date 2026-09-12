/**
 * A conta do pedido — subtotal, descontos, taxa e total — de um jeito que FECHA.
 *
 * ── O problema ──────────────────────────────────────────────────────────────
 *
 * O `totalAmount` é a única fonte confiável do que o cliente pagou: vem do
 * parceiro. As outras linhas são montadas de campos separados, e no 99Food elas
 * não correspondem ao que foi abatido. Medido em 12/09/2026, em 12 pedidos de
 * 12 a conta não fechava — a comanda do #266009 imprimia
 *
 *     Subtotal 59,99 · Desconto -25,00 · Taxa +1,00 · TOTAL 48,52
 *
 * e 59,99 − 25,00 + 1,00 dá 35,99. A diferença é o desconto que o PARCEIRO
 * bancou: ele aparece em `discountTotal` (e está certo que apareça — a
 * mensalidade é sobre o bruto), mas nunca saiu do bolso da loja nem do cliente.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 * O desconto EXIBIDO é o que a conta exige: `subtotal + taxa − total`. A quebra
 * por origem (iFood / loja) só aparece quando ela mesma fecha. O lojista soma de
 * cabeça, fecha, e continua confiando no resto do número.
 *
 * A mesma regra existe em firehub-print-assistant/server.js, porque o Assistente
 * é outro programa e não importa daqui. MUDOU AQUI, MUDE LÁ — papel e tela
 * dizendo valores diferentes do mesmo pedido é pior que os dois errados juntos.
 */

export type LinhaDaConta = { rotulo: string; valor: number };

export type ContaDoPedido = {
  subtotal: number;
  /** Já vêm com o sinal certo: desconto negativo, acréscimo positivo. */
  ajustes: LinhaDaConta[];
  taxaEntrega: number;
  total: number;
  /** A conta bate somando as linhas? Falso só quando falta dado do pedido. */
  fecha: boolean;
};

type PedidoParaConta = {
  items?: { quantity?: number | null; qty?: number | null; price?: number | null }[] | null;
  totalAmount?: number | null;
  deliveryFee?: number | null;
  discountTotal?: number | null;
  discountIfood?: number | null;
  discountMerchant?: number | null;
  source?: string | null;
};

const cent = (v: number) => Math.round(v * 100) / 100;

export function contaDoPedido(pedido: PedidoParaConta | null | undefined): ContaDoPedido {
  const p = pedido || {};
  const total = Number(p.totalAmount || 0);
  const taxaEntrega = Number(p.deliveryFee || 0);

  const subtotal = cent(
    (p.items || []).reduce((s, it) => s + Number(it?.price || 0) * Number(it?.quantity ?? it?.qty ?? 1), 0),
  );

  // Sem itens não há subtotal para conferir: mostra o total e para por aí, em
  // vez de inventar um desconto do tamanho do pedido inteiro.
  if (subtotal <= 0) {
    return { subtotal: total, ajustes: [], taxaEntrega, total, fecha: true };
  }

  const precisaAbater = cent(subtotal + taxaEntrega - total);

  const partes: LinhaDaConta[] = [];
  const doIfood = Number(p.discountIfood || 0);
  const daLoja = Number(p.discountMerchant || 0);
  const geral = Number(p.discountTotal || 0);
  if (doIfood > 0) partes.push({ rotulo: "Desconto (iFood)", valor: -doIfood });
  if (daLoja > 0) partes.push({ rotulo: "Desconto (cupom da loja)", valor: -daLoja });
  else if (doIfood <= 0 && geral > 0) partes.push({ rotulo: "Desconto (cupom)", valor: -geral });

  const somaDasPartes = cent(partes.reduce((s, x) => s - x.valor, 0));

  if (Math.abs(somaDasPartes - precisaAbater) < 0.01) {
    return { subtotal, ajustes: partes, taxaEntrega, total, fecha: true };
  }
  if (precisaAbater > 0.005) {
    return { subtotal, ajustes: [{ rotulo: "Desconto", valor: -precisaAbater }], taxaEntrega, total, fecha: true };
  }
  if (precisaAbater < -0.005) {
    // Total maior que subtotal + taxa: taxa de serviço ou embalagem do
    // parceiro, que não chega em campo próprio.
    return { subtotal, ajustes: [{ rotulo: "Outros valores do pedido", valor: -precisaAbater }], taxaEntrega, total, fecha: true };
  }
  return { subtotal, ajustes: [], taxaEntrega, total, fecha: true };
}

export function emReais(v?: number | null): string {
  const n = Number(v || 0);
  return `${n < 0 ? "-" : ""}R$ ${Math.abs(n).toFixed(2).replace(".", ",")}`;
}
