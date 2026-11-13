/**
 * A ETIQUETA DA BALANÇA ETIQUETADORA (açougue, padaria, frios): um EAN-13 que
 * começa com "2" e traz o código do produto (PLU) e o PREÇO ou o PESO.
 *
 * Padrão Toledo/Filizola mais comum no Brasil, configurável na tela do módulo:
 *
 *     2  CCCCC  x  PPPPP  D        (código 5, valor 5 — padrão)
 *     2  CCCCC     PPPPPP D        (código 5, valor 6)
 *     2  CCCC   xx PPPPP  D        (código 4, valor 5)
 *
 * O código começa sempre logo depois do "2"; o valor termina sempre antes do
 * dígito verificador; o que sobra no meio (o "x", em geral 0 ou o dígito do
 * preço) é ignorado. Valor em centavos (preço) ou em gramas (peso).
 *
 * Puro: o caixa usa no navegador, o teste confere.
 */

export type FormatoDaEtiqueta = {
  /** Dígitos do código do produto (PLU) logo depois do "2". */
  codigoTamanho: 4 | 5 | 6;
  /** Dígitos do valor, colados no dígito verificador. */
  valorTamanho: 5 | 6;
  /** O valor é o preço total (centavos) ou o peso (gramas). */
  tipo: "preco" | "peso";
};

export const ETIQUETA_PADRAO: FormatoDaEtiqueta = { codigoTamanho: 5, valorTamanho: 5, tipo: "preco" };

export function lerFormatoDaEtiqueta(bruto: any): FormatoDaEtiqueta {
  const c = Number(bruto?.codigoTamanho);
  const v = Number(bruto?.valorTamanho);
  const codigoTamanho = c === 4 || c === 6 ? c : 5;
  return {
    codigoTamanho,
    // Código + valor cabem em 11 dígitos (13 − o "2" − o verificador).
    valorTamanho: v === 6 && codigoTamanho + 6 <= 11 ? 6 : 5,
    tipo: bruto?.tipo === "peso" ? "peso" : "preco",
  };
}

/** Dígito verificador do EAN-13 (dos 12 primeiros). */
export function digitoEan13(doze: string): number {
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

/** EAN-8, EAN-13 ou GTIN-14 com o dígito certo. */
export function eanValido(codigo: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(codigo)) return false;
  const corpo = codigo.slice(0, -1);
  let soma = 0;
  // Da direita para a esquerda: peso 3, 1, 3, 1…
  for (let i = corpo.length - 1, p = 3; i >= 0; i--, p = p === 3 ? 1 : 3) soma += Number(corpo[i]) * p;
  return (10 - (soma % 10)) % 10 === Number(codigo[codigo.length - 1]);
}

export type EtiquetaLida = { plu: string; precoCentavos: number | null; pesoGramas: number | null };

/**
 * Lê a etiqueta. Nulo = não é etiqueta de balança (não começa com 2, tamanho
 * errado ou dígito verificador que não bate — leitura falha do leitor).
 * `plu` sai sem zeros à esquerda ("00123" → "123"), como a balança mostra.
 */
export function lerEtiqueta(codigo: string, formato: FormatoDaEtiqueta = ETIQUETA_PADRAO): EtiquetaLida | null {
  const c = String(codigo || "").trim();
  if (!/^2\d{12}$/.test(c)) return null;
  if (digitoEan13(c.slice(0, 12)) !== Number(c[12])) return null;
  const plu = String(Number(c.slice(1, 1 + formato.codigoTamanho)));
  const valor = Number(c.slice(12 - formato.valorTamanho, 12));
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return formato.tipo === "preco" ? { plu, precoCentavos: valor, pesoGramas: null } : { plu, precoCentavos: null, pesoGramas: valor };
}

/** Monta uma etiqueta (para o teste e para o exemplo da tela). */
export function montarEtiqueta(plu: number, valor: number, formato: FormatoDaEtiqueta = ETIQUETA_PADRAO): string {
  const codigo = String(plu).padStart(formato.codigoTamanho, "0");
  const val = String(valor).padStart(formato.valorTamanho, "0");
  const meio = "0".repeat(11 - formato.codigoTamanho - formato.valorTamanho);
  const doze = `2${codigo}${meio}${val}`;
  return doze + digitoEan13(doze);
}
