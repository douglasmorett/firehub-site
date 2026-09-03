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
 *
 * A OPÇÃO DO COMBO TAMBÉM TEM PREÇO POR CANAL
 *
 * Por muito tempo só o produto tinha. Isso deixava de fora justamente as lojas
 * que copiam a modelagem do iFood e do Anota AI: lá o pastel é um item de preço
 * base ZERO e quem carrega o preço é a opção de tamanho ("Baby 13cm = R$ 21,90").
 * Na Pastel da Paulista são 120 dos 142 itens assim — mexer no preço do produto
 * não mudava um centavo do que o cliente paga.
 *
 * Então o `additionalPrice` de cada opção também é resolvido aqui, pelas colunas
 * `additionalPriceSalao/Delivery/Totem`. Quem consome o cardápio continua vendo
 * um número só, e o cálculo de combo (src/lib/preco-combo.ts) segue igual: ele
 * soma `price` + `additionalPrice`, e ambos já chegam no preço do canal.
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

/** Só os campos de preço interessam — qualquer objeto de opção de combo serve. */
export type OpcaoComPrecos = {
  additionalPrice: number;
  additionalPriceSalao?: number | null;
  additionalPriceDelivery?: number | null;
  additionalPriceTotem?: number | null;
};

/**
 * O quanto esta opção soma NESTE canal.
 *
 * Mesma regra do produto, e pelo mesmo motivo: zero e negativo não contam como
 * preço cadastrado. A diferença é que aqui o zero é comum e legítimo no campo
 * base — opção de sabor que não cobra nada —, então o fallback é o
 * `additionalPrice`, que continua podendo ser zero à vontade.
 */
export function precoDaOpcao(opcao: OpcaoComPrecos, canal: CanalDePreco): number {
  const base = Number(opcao?.additionalPrice) || 0;

  const doCanal =
    canal === "salao" ? opcao?.additionalPriceSalao
      : canal === "delivery" ? opcao?.additionalPriceDelivery
        : opcao?.additionalPriceTotem;

  const n = Number(doCanal);
  return Number.isFinite(n) && n > 0 ? n : base;
}

/**
 * A opção com `additionalPrice` JÁ TROCADO, e sem as colunas por canal — para
 * não sobrar no payload duas versões do mesmo número, que é como alguém acaba
 * somando a errada.
 */
export function aplicarPrecoDaOpcao<T extends OpcaoComPrecos>(
  opcao: T,
  canal: CanalDePreco
): Omit<T, "additionalPriceSalao" | "additionalPriceDelivery" | "additionalPriceTotem"> & { additionalPrice: number } {
  const {
    additionalPriceSalao: _s, additionalPriceDelivery: _d, additionalPriceTotem: _t, ...resto
  } = opcao as any;
  return { ...resto, additionalPrice: precoDaOpcao(opcao, canal) };
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
 * O mesmo, para a lista inteira do cardápio — em DOIS níveis, que é o que faz
 * isto valer para qualquer modelagem de cardápio:
 *
 *   1. o `price` do produto e o das opções (produtos como quaisquer outros);
 *   2. o `additionalPrice` de cada vínculo opção↔combo, que é onde mora o preço
 *      nas lojas de cardápio no molde iFood/Anota AI.
 */
export function aplicarPrecoNoCardapio<T extends ProdutoComPrecos & { comboGroups?: any }>(
  produtos: T[],
  canal: CanalDePreco
): any[] {
  return (produtos || []).map((p) => aplicarPrecoDoCanalComCombo(p, canal));
}

/**
 * UM produto com TUDO resolvido para o canal: o `price` dele, o
 * `additionalPrice` de cada opção e o `price` do produto por trás da opção.
 *
 * É a função das rotas que GRAVAM pedido (delivery, totem, balcão). Elas
 * recalculam o preço no servidor — o carrinho manda o que foi escolhido, nunca
 * o valor — e precisam chegar exatamente ao número que a vitrine daquele canal
 * mostrou. Usar `aplicarPrecoDoCanal` sozinho ali cobraria o preço do canal só
 * na base do produto e o preço de tabela nas opções: no cardápio no molde
 * iFood/Anota AI, onde a base é R$ 0,00, seria cobrar o preço errado inteiro.
 */
export function aplicarPrecoDoCanalComCombo<T extends ProdutoComPrecos & { comboGroups?: any }>(
  produto: T,
  canal: CanalDePreco
): any {
  const comPreco: any = aplicarPrecoDoCanal(produto, canal);

  if (Array.isArray((produto as any).comboGroups)) {
    comPreco.comboGroups = (produto as any).comboGroups.map((g: any) => ({
      ...g,
      items: (g?.items || []).map((item: any) => ({
        ...aplicarPrecoDaOpcao(item, canal),
        menuProduct: item?.menuProduct
          ? aplicarPrecoDoCanal(item.menuProduct, canal)
          : item?.menuProduct,
      })),
    }));
  }

  return comPreco;
}
