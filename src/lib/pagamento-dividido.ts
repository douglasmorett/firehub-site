/**
 * PAGAMENTO DIVIDIDO: metade no débito, metade no crédito.
 *
 * ── Por que isto virou regra única ─────────────────────────────────────────
 *
 * A divisão já existia em dois lugares e faltava no terceiro, que é onde ela
 * mais importa:
 *
 *   • o BALCÃO (api/store/orders/presencial) grava as partes desde sempre;
 *   • o FECHAMENTO DE CAIXA (api/cash-session) já lê as partes e manda cada
 *     uma para a sua linha da conferência;
 *   • a TROCA DE PAGAMENTO do painel não só não dividia como APAGAVA as
 *     partes de um pedido que já vinha dividido do balcão.
 *
 * E é justamente na troca que a divisão acontece na vida real: o cliente diz
 * "dinheiro" ao pedir, chega no caixa e paga metade no débito e metade no
 * crédito. Sem poder registrar as duas, o operador escolhia uma — e o
 * fechamento cobrava da gaveta um valor que passou na maquininha, ou o
 * contrário. Diferença que aparece todo dia e nunca se explica é diferença que
 * o lojista aprende a ignorar (queixa do dono, 20/09/2026).
 *
 * ── A regra que não pode divergir ──────────────────────────────────────────
 *
 * As partes TÊM que fechar com o total do pedido. Gravar partes que não somam
 * é criar uma diferença de caixa que ninguém vai achar depois — e a conta é
 * feita em CENTAVOS, nunca somando float com float, pelo mesmo motivo da mesa
 * (lib/pagamentos-da-mesa.ts): três partes de R$ 33,33 num pedido de R$ 99,99
 * fecham em centavos e não fecham em float.
 */

import { FORMAS_DE_PAGAMENTO_NA_ENTREGA } from "@/lib/pagamento-na-entrega";

export type ParteDoPagamento = { method: string; amount: number };

/** Tolerância de 2 centavos: é a mesma do balcão, para arredondamento de rateio. */
export const TOLERANCIA_CENTAVOS = 2;

const emCentavos = (v: unknown) => Math.round((Number(v) || 0) * 100);
const emReais = (c: number) => Math.round(c) / 100;
const dinheiro = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * Lê o que veio do navegador. Aceita `method`/`amount` (o formato gravado) e
 * `metodo`/`valor` (como as telas nomeiam), porque os dois já circulam.
 */
export function lerPartes(bruto: unknown): ParteDoPagamento[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((p: any) => ({
      method: String(p?.method ?? p?.metodo ?? "").trim(),
      amount: emReais(emCentavos(p?.amount ?? p?.valor)),
    }))
    .filter((p) => p.method && p.amount > 0);
}

export function somarPartes(partes: ParteDoPagamento[]): number {
  return emReais(partes.reduce((s, p) => s + emCentavos(p.amount), 0));
}

/** "Dividido: Pix R$ 20,00 + Dinheiro R$ 15,00" — o texto que a comanda mostra. */
export function resumoDividido(partes: ParteDoPagamento[]): string {
  return "Dividido: " + partes.map((p) => `${p.method} ${dinheiro(p.amount)}`).join(" + ");
}

export type ResultadoDaDivisao =
  | { ok: true; partes: ParteDoPagamento[]; resumo: string; total: number }
  | { ok: false; erro: string };

/**
 * A divisão está boa para gravar?
 *
 * Duas partes no mínimo (uma parte só é pagamento simples, e gravar `partes`
 * com um item faria o painel mostrar "Dividido:" sem divisão nenhuma), formas
 * conhecidas, e a soma fechando com o total.
 */
export function validarDivisao(bruto: unknown, total: number): ResultadoDaDivisao {
  const partes = lerPartes(bruto);
  if (partes.length < 2) {
    return { ok: false, erro: "Para dividir o pagamento, informe pelo menos duas formas com valor." };
  }
  const desconhecida = partes.find(
    (p) => !(FORMAS_DE_PAGAMENTO_NA_ENTREGA as readonly string[]).includes(p.method)
  );
  if (desconhecida) {
    return { ok: false, erro: `Forma de pagamento inválida: "${desconhecida.method}".` };
  }
  const soma = somarPartes(partes);
  if (Math.abs(emCentavos(soma) - emCentavos(total)) > TOLERANCIA_CENTAVOS) {
    return {
      ok: false,
      erro: `A soma das formas (${dinheiro(soma)}) não bate com o total do pedido (${dinheiro(Number(total) || 0)}).`,
    };
  }
  return { ok: true, partes, resumo: resumoDividido(partes), total: soma };
}

/**
 * Quanto ainda falta distribuir — o número que a tela mostra enquanto a pessoa
 * digita, e que é o que torna a divisão fácil: ela nunca precisa fazer a conta
 * de cabeça. Positivo = falta; negativo = passou.
 */
export function quantoFalta(partes: ParteDoPagamento[], total: number): number {
  return emReais(emCentavos(total) - emCentavos(somarPartes(partes)));
}
