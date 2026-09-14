/**
 * Entrega que ficou grátis — quanto era e por quê.
 *
 * ── Por que isto precisa existir ────────────────────────────────────────────
 *
 * Quando o frete é isentado, `deliveryFee` vai a zero e a informação some: a
 * nota mostrava Subtotal e Total sem nenhuma linha de entrega, como se a loja
 * não entregasse. O dono pediu o contrário — quer VER o valor da entrega e
 * quer ler por que ela não foi cobrada, para conferir com o motoboy e para
 * saber quanto a isenção custou.
 *
 * Guardado em `CustomerOrder.entregaGratis` como {valor, motivo}. É história do
 * pedido, não regra: o motivo é o que valia NAQUELE dia, e continua verdadeiro
 * depois que a loja muda o mínimo do frete grátis.
 */

export type EntregaGratis = {
  /** Quanto a entrega custaria — o número que a nota mostra. */
  valor: number;
  /** Por que não foi cobrada, em português para o cliente e para a loja. */
  motivo: string;
};

export function lerEntregaGratis(bruto: unknown): EntregaGratis | null {
  const e = bruto as any;
  if (!e || typeof e !== "object") return null;
  const valor = Number(e.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return { valor: Math.round(valor * 100) / 100, motivo: String(e.motivo || "Entrega grátis") };
}

const reais = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

/** Motivo pronto: o pedido passou do mínimo que a loja definiu. */
export function porValorMinimo(minimo: number): string {
  return `Pedido acima de ${reais(minimo)}`;
}

/**
 * A linha da nota: o valor cheio, riscado pela explicação.
 *
 * Ex.: "Taxa de entrega  R$ 8,00 — GRÁTIS (Pedido acima de R$ 60,00)"
 */
export function linhaDaEntregaGratis(e: EntregaGratis | null): string {
  if (!e) return "";
  return `${reais(e.valor)} — GRÁTIS (${e.motivo})`;
}
