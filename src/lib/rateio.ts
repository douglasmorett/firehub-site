/**
 * /src/lib/rateio.ts
 *
 * Dividir um valor em dinheiro entre partes, sem perder centavo.
 *
 * Peça própria porque duas coisas diferentes dependem dela e não podem
 * divergir: a abertura de combo na nota (lib/fiscal-itens) e o rateio de
 * desconto e taxa de entrega entre os itens (lib/fiscal-emissao). Se cada uma
 * tivesse a sua cópia, um ajuste numa e não na outra produziria uma nota que
 * não fecha — e "não fecha" na SEFAZ é rejeição, não aviso.
 */

/**
 * Divide `total` entre as partes na proporção de `pesos`.
 *
 * Trabalha em CENTAVOS INTEIROS de propósito. Rateio em ponto flutuante erra
 * um centavo no somatório com frequência, e um centavo na nota fiscal não é
 * arredondamento tolerado: é a regra W16/610 ("valor total difere do somatório
 * dos itens") e a nota volta rejeitada.
 *
 * A sobra (ou falta) da divisão vai para a MAIOR parte — um centavo a mais numa
 * linha de R$ 80 distorce menos que numa de R$ 2.
 */
export function ratearEmCentavos(total: number, pesos: number[]): number[] {
  if (pesos.length === 0) return [];

  const totalCentavos = Math.round(total * 100);
  const somaDosPesos = pesos.reduce((s, p) => s + p, 0);

  // Sem proporção utilizável (tudo zero), divide em partes iguais.
  const base =
    somaDosPesos > 0
      ? pesos.map((p) => Math.floor((totalCentavos * p) / somaDosPesos))
      : pesos.map(() => Math.floor(totalCentavos / pesos.length));

  const sobra = totalCentavos - base.reduce((s, c) => s + c, 0);
  if (sobra !== 0) {
    let maior = 0;
    for (let i = 1; i < base.length; i++) if (base[i] > base[maior]) maior = i;
    base[maior] += sobra;
  }
  return base.map((c) => c / 100);
}
