/**
 * /src/lib/preco-por-canal.ts
 *
 * Regra única de "quanto este produto custa NESTE canal".
 *
 * A loja cobra diferente conforme onde o pedido nasce: um pastel no balcão pode
 * custar menos do que o mesmo pastel no delivery, porque no delivery entra a
 * comissão da plataforma. Antes havia um preço só, e a saída era cadastrar o
 * produto duas vezes — que é como se perde a conta do estoque e do que vende.
 *
 * COMO O PREÇO É ESCOLHIDO
 *
 * Cada canal tem sua coluna, e todas são NULÁVEIS. Vazia = usa o `price` normal.
 * Uma loja que nunca preencher nada continua com um preço só para tudo, que é o
 * comportamento de sempre — ninguém precisa fazer nada para continuar como está.
 *
 * ONDE ISSO É APLICADO, e por quê aqui e não em cada tela
 *
 * O preço é resolvido NA ORIGEM: cada endpoint de cardápio devolve, em `price`,
 * o preço daquele canal. Assim o carrinho, o total, a comanda impressa, o KDS e
 * o pedido gravado usam todos o mesmo número, sem ninguém precisar lembrar de
 * somar diferente. Também é o que faz o cálculo de combo (src/lib/preco-combo.ts)
 * funcionar sem alteração nenhuma: ele soma `price` + adicionais, e o `price` que
 * chega até ele já é o do canal.
 *
 * A EXCEÇÃO é a tela de CADASTRO de produtos, que precisa dos preços crus para
 * a loja poder editá-los. Ela não passa por aqui.
 */

/** Os canais que podem ter preço próprio. */
export type CanalDePreco = "salao" | "delivery" | "totem";

/** Só os campos de preço interessam — qualquer objeto de produto serve. */
export type ProdutoComPrecos = {
  price: number;
  priceSalao?: number | null;
  priceDelivery?: number | null;
  priceTotem?: number | null;
};

/**
 * O preço deste produto neste canal.
 *
 * Zero e negativo NÃO contam como preço cadastrado: um campo apagado pela metade
 * viraria produto de graça no cardápio, e o único jeito de vender algo por zero
 * de propósito continua sendo o `price` normal — que é onde alguém repara.
 */
export function precoDoCanal(produto: ProdutoComPrecos, canal: CanalDePreco): number {
  const base = Number(produto?.price) || 0;

  const doCanal =
    canal === "salao" ? produto?.priceSalao
      : canal === "delivery" ? produto?.priceDelivery
        : produto?.priceTotem;

  const n = Number(doCanal);
  return Number.isFinite(n) && n > 0 ? n : base;
}

/**
 * Devolve o produto com `price` JÁ TROCADO pelo preço do canal.
 *
 * É esta a forma usada nos endpoints: quem consome o cardápio nunca precisa
 * saber que existe preço por canal — recebe `price` e pronto. As colunas
 * específicas saem do objeto para não sobrar no payload duas versões do mesmo
 * número, que é como alguém acaba somando a errada.
 */
export function aplicarPrecoDoCanal<T extends ProdutoComPrecos>(
  produto: T,
  canal: CanalDePreco
): Omit<T, "priceSalao" | "priceDelivery" | "priceTotem"> & { price: number } {
  const { priceSalao: _s, priceDelivery: _d, priceTotem: _t, ...resto } = produto as any;
  return { ...resto, price: precoDoCanal(produto, canal) };
}

/**
 * O mesmo, para a lista inteira do cardápio — inclusive as opções dentro dos
 * combos, que são produtos como quaisquer outros e também podem ter preço por
 * canal. O `additionalPrice` do ComboGroupItem NÃO muda: ele é o quanto AQUELA
 * opção soma DENTRO daquele combo, uma decisão de montagem do combo e não um
 * preço de tabela.
 */
export function aplicarPrecoNoCardapio<T extends ProdutoComPrecos & { comboGroups?: any }>(
  produtos: T[],
  canal: CanalDePreco
): any[] {
  return (produtos || []).map((p) => {
    const comPreco: any = aplicarPrecoDoCanal(p, canal);

    if (Array.isArray((p as any).comboGroups)) {
      comPreco.comboGroups = (p as any).comboGroups.map((g: any) => ({
        ...g,
        items: (g?.items || []).map((item: any) => ({
          ...item,
          menuProduct: item?.menuProduct
            ? aplicarPrecoDoCanal(item.menuProduct, canal)
            : item?.menuProduct,
        })),
      }));
    }

    return comPreco;
  });
}
