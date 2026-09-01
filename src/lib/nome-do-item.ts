/**
 * src/lib/nome-do-item.ts
 *
 * Regra única de "qual é o nome deste item do pedido".
 *
 * Existem duas respostas possíveis e elas divergem com o tempo:
 *
 *   1. `productName` — o nome que a plataforma mandou NO DIA do pedido;
 *   2. `menuProduct.name` — o nome que o produto tem no cadastro AGORA.
 *
 * A comanda, o KDS e o painel liam a segunda. O resultado é que renomear um
 * item no iFood não mudava nada aqui: o pedido de hoje saía com o nome gravado
 * meses atrás, e um pedido antigo passava a mostrar um nome que não existia
 * quando ele foi feito. Ver o cabeçalho de src/lib/ifood-itens.ts.
 *
 * A primeira é a certa nos dois sentidos: mostra o que o cliente comprou e
 * acompanha sozinha qualquer edição feita na plataforma. `menuProduct.name`
 * fica de reserva para o pedido antigo, gravado antes de `productName` passar a
 * ser preenchido.
 *
 * Relatório é o outro caso: lá se agrupa por PRODUTO, e o nome do cadastro é o
 * que mantém a linha do relatório inteira em vez de rachar em duas quando o
 * produto muda de nome. Por isso relatórios não usam esta função.
 */

export function nomeDoItem(item: any, fallback = "Item"): string {
  if (!item) return fallback;
  // `name` vem antes de `menuProduct.name` porque quem passa um item já com
  // `name` (a fila de impressão, por exemplo) montou esse nome a partir do
  // payload da plataforma — era o que essas telas já liam primeiro.
  const nome = item.productName || item.name || item.menuProduct?.name || "";
  const limpo = String(nome).trim();
  return limpo || fallback;
}

/**
 * Nome para a comanda e o KDS.
 *
 * O JotaJá grava nome e opções numa string só ("Combo | 5x Esfirra | Fanta"),
 * porque lá o produto não tem opção separada. A comanda imprime as opções na
 * linha de baixo, então o cabeçalho fica só com o que vem antes do primeiro
 * " | " — senão o nome do item ocupa três linhas de papel.
 */
export function nomeDoItemParaComanda(item: any, fallback = "Item"): string {
  return nomeDoItem(item, fallback).split(" | ")[0].trim() || fallback;
}
