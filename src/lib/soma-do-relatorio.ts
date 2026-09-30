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

// ── ITENS VENDIDOS: CATEGORIA → PRODUTO → ESCOLHAS ───────────────────────────
//
// O relatório que a NIK usava na Saipos e pediu aqui (24/09/2026): abrir a
// categoria, abrir o produto e ver o que foi escolhido dentro dele —
// "PIZZA GRANDE (8 PEDAÇOS)": 12 Calabresa, 7 Portuguesa, 5 Borda Catupiry.
//
// O ranking de produtos põe o sabor numa linha própria, com R$ 0,00, porque o
// dinheiro está na pizza. Isso é certo na conta e confunde na leitura — o
// Danilo perguntou por que a Portuguesa estava zerada. Aqui o sabor aparece
// DENTRO da pizza que o carregou, e o valor fica só no produto.
//
// O filtro de categoria e de produto vale para o ITEM, como nos cartões: marcar
// "Pizzas" abre as pizzas com tudo o que foi escolhido nelas.

type ItemComEscolhas = ItemSomavel & { productName?: string | null; escolhas?: [string, number][] };

export type EscolhaVendida = { nome: string; quantidade: number };
export type ProdutoVendido = { id: string; nome: string; quantidade: number; valor: number; escolhas: EscolhaVendida[] };
export type CategoriaVendida = { categoria: string; quantidade: number; valor: number; produtos: ProdutoVendido[] };

export function itensVendidosPorCategoria(
  pedidos: { items: ItemComEscolhas[] }[],
  f: FiltroDeItens,
): { categorias: CategoriaVendida[]; quantidade: number; valor: number } {
  const porCategoria = new Map<string, Map<string, { id: string; nome: string; quantidade: number; valor: number; escolhas: Map<string, number> }>>();
  let quantidade = 0, valor = 0;
  for (const o of pedidos) {
    for (const item of o.items) {
      if (!itemEntra(item, f)) continue;
      const categoria = item.productCategory || "Outros";
      // Pelo NOME dentro da categoria, não pelo id: o mesmo "Combo 1" chega do
      // iFood, da Wabiz e do balcão com três ids, e para o dono é um produto só
      // (NIK, 23/09/2026: "Combo 1" 14 u. e "Combo 1" 8 u. na mesma categoria).
      const chave = String(item.productName || item.productId || "?").toLowerCase().replace(/\s+/g, " ").trim();
      if (!porCategoria.has(categoria)) porCategoria.set(categoria, new Map());
      const produtos = porCategoria.get(categoria)!;
      if (!produtos.has(chave)) {
        produtos.set(chave, { id: chave, nome: item.productName || "Produto Removido", quantidade: 0, valor: 0, escolhas: new Map() });
      }
      const p = produtos.get(chave)!;
      p.quantidade += item.quantity;
      p.valor += item.price * item.quantity;
      quantidade += item.quantity;
      valor += item.price * item.quantity;
      for (const [nome, qtd] of item.escolhas || []) p.escolhas.set(nome, (p.escolhas.get(nome) || 0) + qtd);
    }
  }
  const porQuantidade = <T extends { quantidade: number; valor?: number }>(a: T, b: T) =>
    b.quantidade - a.quantidade || (b.valor || 0) - (a.valor || 0);
  const categorias: CategoriaVendida[] = Array.from(porCategoria.entries()).map(([categoria, produtos]) => {
    const lista: ProdutoVendido[] = Array.from(produtos.values()).map((p) => ({
      id: p.id, nome: p.nome, quantidade: p.quantidade, valor: p.valor,
      escolhas: Array.from(p.escolhas.entries())
        .map(([nome, q]) => ({ nome, quantidade: q }))
        .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR")),
    })).sort(porQuantidade);
    return {
      categoria,
      quantidade: lista.reduce((s, p) => s + p.quantidade, 0),
      valor: lista.reduce((s, p) => s + p.valor, 0),
      produtos: lista,
    };
  }).sort(porQuantidade);
  return { categorias, quantidade, valor };
}
