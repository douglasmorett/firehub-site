/**
 * O desconto que o atendente dá na mão, no balcão ou na mesa.
 *
 * ── Por que porcentagem E valor ─────────────────────────────────────────────
 *
 * São as duas conversas que acontecem no balcão: "faz 10% pra mim" e "tira 5
 * reais". Obrigar a converter uma na outra na cabeça, com fila esperando, é
 * como erro de caixa nasce.
 *
 * ── Por que o MOTIVO ────────────────────────────────────────────────────────
 *
 * Desconto sem motivo é furo no caixa que ninguém sabe explicar no fim do mês.
 * Com motivo, o fechamento mostra "R$ 5,00 — pedido atrasado" e a conversa
 * acaba ali. O motivo vai para a observação do pedido, então sai impresso na
 * comanda e aparece no relatório sem coluna nova.
 */

export type TipoDeDesconto = "percent" | "valor";

export type DescontoManual = {
  tipo: TipoDeDesconto;
  /** Porcentagem (1 a 100) ou reais, conforme o tipo. */
  valor: number;
  /** Por que o desconto foi dado. */
  motivo?: string;
};

export const SEM_DESCONTO: DescontoManual = { tipo: "percent", valor: 0, motivo: "" };

/** Motivos prontos — o atendente escolhe em vez de digitar com fila na frente. */
export const MOTIVOS_COMUNS = [
  "Cliente fiel",
  "Pedido atrasado",
  "Erro no pedido",
  "Cortesia da casa",
  "Combinado com o dono",
];

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * Quanto o desconto vale em reais, sobre este subtotal.
 *
 * Nunca passa do subtotal: desconto maior que a conta viraria total negativo —
 * e total negativo entra no caixa como dinheiro que a loja deve ao cliente.
 */
export function valorDoDesconto(d: DescontoManual | null | undefined, subtotal: number): number {
  if (!d) return 0;
  const base = Number(subtotal) || 0;
  const v = Number(d.valor) || 0;
  if (!(v > 0) || !(base > 0)) return 0;
  const bruto = d.tipo === "percent" ? (base * Math.min(v, 100)) / 100 : v;
  return centavos(Math.min(bruto, base));
}

/**
 * O desconto como chegou no corpo de uma requisição — tipo, valor e motivo,
 * nunca um valor em reais pronto. Quem usa recalcula com `valorDoDesconto`
 * sobre o consumo que ELE mesmo apurou.
 */
export function descontoDoCorpo(bruto: unknown): DescontoManual | null {
  if (!bruto || typeof bruto !== "object") return null;
  const d = bruto as Record<string, unknown>;
  const valor = Number(d.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return {
    tipo: d.tipo === "valor" ? "valor" : "percent",
    valor,
    motivo: String(d.motivo || "").slice(0, 60),
  };
}

/** Como o desconto aparece escrito na comanda e no relatório. */
export function descreverDesconto(d: DescontoManual | null | undefined, subtotal: number): string {
  const reais = valorDoDesconto(d, subtotal);
  if (!reais || !d) return "";
  const quanto = d.tipo === "percent"
    ? `${Number(d.valor)}% (R$ ${reais.toFixed(2).replace(".", ",")})`
    : `R$ ${reais.toFixed(2).replace(".", ",")}`;
  const motivo = String(d.motivo || "").trim();
  return motivo ? `${quanto} — ${motivo}` : quanto;
}

/** O que impede este desconto de ser aplicado, em português para a tela. */
export function problemaDoDesconto(d: DescontoManual, subtotal: number): string {
  const v = Number(d.valor) || 0;
  if (!(v > 0)) return "Informe quanto é o desconto.";
  if (d.tipo === "percent" && v > 100) return "Desconto em porcentagem não passa de 100%.";
  if (d.tipo === "valor" && v > (Number(subtotal) || 0)) {
    return "O desconto é maior que o valor do pedido.";
  }
  return "";
}

/** A observação que o pedido leva, para sair impressa e ficar no histórico. */
export function notaDoDesconto(d: DescontoManual | null | undefined, subtotal: number): string {
  const texto = descreverDesconto(d, subtotal);
  return texto ? `[Desconto: ${texto}]` : "";
}
