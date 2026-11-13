/**
 * AS CONTAS DO CAIXA DE MERCADO, em CENTAVOS inteiros — o navegador mostra e o
 * servidor confere com as mesmas funções (sem ponto flutuante: um centavo de
 * diferença é rejeição na NFC-e e furo no fechamento).
 *
 * - `lerEntrada`: o que o operador (ou o leitor) digitou no campo do código:
 *   "7891000100103" · "3*7891000100103" (3 unidades) · "0,452*123" (452 g de
 *   um produto por quilo, sem balança).
 * - `valorDoItem`: UN = quantidade × preço; KG = peso × preço do quilo,
 *   arredondado no centavo (a mesma regra de lib/balanca valorDoPeso).
 * - `conferirPagamentos`: Σ pagamentos − troco = total; troco só sai do
 *   dinheiro e não passa do dinheiro entregue.
 *
 * Puro.
 */

export type Unidade = "UN" | "KG";

export type EntradaLida = { quantidade: number | null; codigo: string };

export function lerEntrada(texto: string): EntradaLida | null {
  const t = String(texto || "").trim().replace(/\s+/g, "");
  if (!t) return null;
  const m = /^(\d+(?:[.,]\d{1,3})?)[*xX](.+)$/.exec(t);
  if (m) {
    const q = Number(m[1].replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) return null;
    return { quantidade: q, codigo: m[2] };
  }
  return { quantidade: null, codigo: t };
}

/** Peso em kg com até 3 casas (gramas). */
export const kg3 = (v: number) => Math.round(v * 1000) / 1000;

export function valorDoItem(unidade: Unidade, quantidade: number, precoCentavos: number): number {
  if (unidade === "KG") return Math.round(kg3(quantidade) * precoCentavos);
  return Math.round(quantidade) * precoCentavos;
}

/** Quantidade aceita para a unidade: UN inteira ≥ 1; KG de 0,001 a 999,999. */
export function problemaDaQuantidade(unidade: Unidade, quantidade: number): string | null {
  if (!Number.isFinite(quantidade) || quantidade <= 0) return "Quantidade inválida.";
  if (unidade === "UN" && !Number.isInteger(quantidade)) return "Este produto é vendido por unidade: a quantidade é um número inteiro.";
  if (unidade === "UN" && quantidade > 9999) return "Quantidade grande demais.";
  if (unidade === "KG" && (kg3(quantidade) < 0.001 || quantidade > 999.999)) return "Peso inválido.";
  return null;
}

export type ItemDaConta = { unidade: Unidade; quantidade: number; precoCentavos: number; totalCentavos?: number };

export function somarItens(itens: ItemDaConta[]): number {
  return itens.reduce((s, i) => s + (i.totalCentavos ?? valorDoItem(i.unidade, i.quantidade, i.precoCentavos)), 0);
}

export type FormaDoCaixa = "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "TEF" | "VALE";

export const FORMAS_DO_CAIXA: { forma: FormaDoCaixa; nome: string }[] = [
  { forma: "DINHEIRO", nome: "Dinheiro" },
  { forma: "PIX", nome: "Pix" },
  { forma: "TEF", nome: "Cartão no pinpad (TEF)" },
  { forma: "CREDITO", nome: "Crédito (maquininha)" },
  { forma: "DEBITO", nome: "Débito (maquininha)" },
  { forma: "VALE", nome: "Vale-alimentação" },
];

export type PagamentoDoCaixa = { forma: FormaDoCaixa; valorCentavos: number };

export type ConferenciaDosPagamentos =
  | { ok: true; trocoCentavos: number; tefCentavos: number }
  | { ok: false; erro: string };

/**
 * `pagamentos` traz o que o cliente ENTREGOU em cada forma (o dinheiro pode
 * passar do total: a diferença é o troco). Cartão, Pix e vale não dão troco.
 */
export function conferirPagamentos(totalCentavos: number, pagamentos: PagamentoDoCaixa[]): ConferenciaDosPagamentos {
  if (!Number.isInteger(totalCentavos) || totalCentavos <= 0) return { ok: false, erro: "A venda está sem valor." };
  if (!Array.isArray(pagamentos) || pagamentos.length === 0) return { ok: false, erro: "Escolha a forma de pagamento." };
  const formas = new Set(FORMAS_DO_CAIXA.map((f) => f.forma));
  for (const p of pagamentos) {
    if (!formas.has(p.forma)) return { ok: false, erro: "Forma de pagamento desconhecida." };
    if (!Number.isInteger(p.valorCentavos) || p.valorCentavos <= 0) return { ok: false, erro: "Valor do pagamento inválido." };
  }
  if (pagamentos.filter((p) => p.forma === "TEF").length > 1) return { ok: false, erro: "Só um pagamento no pinpad por venda." };
  const soma = pagamentos.reduce((s, p) => s + p.valorCentavos, 0);
  if (soma < totalCentavos) return { ok: false, erro: `Falta ${reais(totalCentavos - soma)}.` };
  const troco = soma - totalCentavos;
  const dinheiro = pagamentos.filter((p) => p.forma === "DINHEIRO").reduce((s, p) => s + p.valorCentavos, 0);
  if (troco > 0 && troco > dinheiro) return { ok: false, erro: "Cartão, Pix e vale não dão troco: o valor passou do total." };
  // O troco sai do dinheiro, então o dinheiro precisa cobrir o troco INTEIRO
  // e ainda deixar algo da venda nele (dinheiro só de troco não é pagamento).
  if (dinheiro > 0 && dinheiro - troco <= 0) return { ok: false, erro: "O dinheiro entregue só cobre o troco." };
  const tef = pagamentos.find((p) => p.forma === "TEF")?.valorCentavos ?? 0;
  return { ok: true, trocoCentavos: troco, tefCentavos: tef };
}

/** O que cada forma deixou na venda (o dinheiro já sem o troco). */
export function liquidoPorForma(pagamentos: PagamentoDoCaixa[], trocoCentavos: number): PagamentoDoCaixa[] {
  let troco = trocoCentavos;
  const juntos = new Map<FormaDoCaixa, number>();
  for (const p of pagamentos) juntos.set(p.forma, (juntos.get(p.forma) ?? 0) + p.valorCentavos);
  const saida: PagamentoDoCaixa[] = [];
  for (const [forma, valor] of juntos) {
    let v = valor;
    if (forma === "DINHEIRO" && troco > 0) { v -= troco; troco = 0; }
    if (v > 0) saida.push({ forma, valorCentavos: v });
  }
  return saida;
}

/** O texto que o pedido grava por forma — o que o fechamento de caixa entende. */
export function rotuloDaFormaNoPedido(forma: FormaDoCaixa, tipoDoCartaoTef?: "Crédito" | "Débito" | null): string {
  switch (forma) {
    case "DINHEIRO": return "Dinheiro";
    case "PIX": return "Pix";
    case "CREDITO": return "Cartão Crédito";
    case "DEBITO": return "Cartão Débito";
    case "VALE": return "Vale Alimentação";
    case "TEF": return tipoDoCartaoTef ? `Cartão ${tipoDoCartaoTef} (TEF)` : "Cartão (TEF)";
  }
}

export function reais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Soma por forma (para o fechamento do turno): { DINHEIRO: 1234, PIX: 500, ... }. */
export function somarPorForma(vendas: PagamentoDoCaixa[][]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const v of vendas) for (const p of v) r[p.forma] = (r[p.forma] ?? 0) + p.valorCentavos;
  return r;
}

/**
 * O esperado na gaveta: fundo + dinheiro das vendas + suprimentos − sangrias.
 * As outras formas: a soma das vendas.
 */
export function esperadoDoTurno(
  fundoCentavos: number,
  porForma: Record<string, number>,
  movimentos: { tipo: "SANGRIA" | "SUPRIMENTO"; valorCentavos: number }[],
): Record<string, number> {
  const mov = movimentos.reduce((s, m) => s + (m.tipo === "SUPRIMENTO" ? m.valorCentavos : -m.valorCentavos), 0);
  return { ...porForma, DINHEIRO: fundoCentavos + (porForma.DINHEIRO ?? 0) + mov };
}

/** Contado − esperado, só nas formas que o operador contou (em branco = não conferida). */
export function diferencaDoTurno(esperado: Record<string, number>, contado: Record<string, number | null | undefined>): number | null {
  let dif = 0;
  let algum = false;
  for (const [forma, valor] of Object.entries(contado)) {
    if (valor == null || !Number.isInteger(valor)) continue;
    algum = true;
    dif += valor - (esperado[forma] ?? 0);
  }
  return algum ? dif : null;
}
