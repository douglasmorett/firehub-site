/**
 * A conta dos cartões do relatório de vendas — o que entra e quanto soma —,
 * num lugar só para a tela e o teste fazerem a MESMA conta.
 *
 * ── A regra das opções (borda, adicional) ───────────────────────────────────
 *
 * A borda nunca é item do pedido: vem escolhida DENTRO da pizza
 * (lib/itens-do-relatorio.ts). Ela entra na conta só quando o lojista perguntou
 * por item — marcou categoria ou produto. Sem esses filtros o relatório é o de
 * sempre, cada item uma vez, e a borda de preço zero que vem por padrão não
 * incha o total de unidades.
 *
 * O DINHEIRO da opção já está no preço do item: "GRANDE (8 PEDAÇOS)" a
 * R$ 83,90 no iFood é Calabresa 69,90 + Borda Catupiry 14,00. Então o valor da
 * borda só soma quando o item que a carrega ficou FORA da conta. Marcar
 * "Pizzas" e "Bordas" juntas não conta os R$ 14 duas vezes.
 *
 * Pura e sem banco: roda no navegador.
 */

export type FiltroDeItens = {
  /** Produtos marcados; vazio = todos. */
  produtos: Set<string>;
  /** Categorias marcadas; vazio = todas. */
  categorias: Set<string>;
};

type OpcaoSomavel = {
  id: string | null;
  nome: string;
  categoria: string;
  quantidade: number;
  preco: number | null;
  custo?: number | null;
};

type ItemSomavel = {
  productId?: string | null;
  productCategory: string;
  quantity: number;
  price: number;
  productCost: number;
  opcoes?: OpcaoSomavel[];
};

export function perguntouPorItem(f: FiltroDeItens): boolean {
  return f.categorias.size > 0 || f.produtos.size > 0;
}

/** O item entra? Dentro de cada filtro as marcas são OU; entre filtros é E. */
export function itemEntra(item: ItemSomavel, f: FiltroDeItens): boolean {
  return (
    (f.produtos.size === 0 || f.produtos.has(String(item.productId))) &&
    (f.categorias.size === 0 || f.categorias.has(item.productCategory))
  );
}

/** As opções deste item que entram na conta, e quanto DINHEIRO cada uma soma. */
export function opcoesQueEntram<T extends OpcaoSomavel>(
  item: { opcoes?: T[] },
  f: FiltroDeItens,
  oItemEntrou: boolean,
): { opcao: T; valor: number }[] {
  if (!perguntouPorItem(f)) return [];
  const entram: { opcao: T; valor: number }[] = [];
  for (const op of item.opcoes || []) {
    if (f.produtos.size > 0 && !(op.id && f.produtos.has(op.id))) continue;
    if (f.categorias.size > 0 && !f.categorias.has(op.categoria)) continue;
    entram.push({ opcao: op, valor: !oItemEntrou && op.preco ? op.preco * op.quantidade : 0 });
  }
  return entram;
}

export type SomaDeVendas = {
  receita: number;
  cmv: number;
  unidades: number;
  /** Quantas das unidades vieram como opção dentro de outro produto. */
  unidadesDeOpcao: number;
  /** Pedidos com pelo menos um item ou opção que entrou. */
  pedidos: number;
};

export function somarVendas(pedidos: { id: string; items: ItemSomavel[] }[], f: FiltroDeItens): SomaDeVendas {
  let receita = 0, cmv = 0, unidades = 0, unidadesDeOpcao = 0;
  const comAlgo = new Set<string>();
  for (const o of pedidos) {
    for (const item of o.items) {
      const entrou = itemEntra(item, f);
      if (entrou) {
        receita += item.price * item.quantity;
        cmv += item.productCost * item.quantity;
        unidades += item.quantity;
        comAlgo.add(o.id);
      }
      for (const { opcao, valor } of opcoesQueEntram(item, f, entrou)) {
        receita += valor;
        cmv += (opcao.custo || 0) * opcao.quantidade;
        unidades += opcao.quantidade;
        unidadesDeOpcao += opcao.quantidade;
        comAlgo.add(o.id);
      }
    }
  }
  return { receita, cmv, unidades, unidadesDeOpcao, pedidos: comAlgo.size };
}
