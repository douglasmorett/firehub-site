/**
 * O item do pedido como o RELATÓRIO de vendas precisa dele: com a categoria de
 * verdade e com os complementos escolhidos dentro dele.
 *
 * ── Dois defeitos que a NIK bateu juntos (23/09/2026) ───────────────────────
 *
 * A NIK Esfihas e Pizzas quis saber quantas bordas vendeu no iFood e no 99.
 *
 * 1. O item do iFood/99 aponta para o produto ESPELHO, de categoria "iFood" /
 *    "99Food". O filtro de categoria oferecia "iFood" como se fosse categoria,
 *    e a pizza do iFood nunca entrava em "Pizzas". Aqui o item herda a
 *    categoria do produto real — a MESMA regra do KDS (lib/categoria-do-item.ts).
 *    A plataforma ganhou filtro próprio no relatório.
 *
 * 2. A borda nunca é item: é opção escolhida DENTRO da pizza. Em 60 dias a NIK
 *    teve zero linhas de borda e 120 bordas dentro de pizzas. Então cada item
 *    leva os COMPLEMENTOS reconhecidos nas opções (lib/complemento-da-opcao.ts),
 *    e o relatório conta a borda quando a categoria dela é marcada. O que não é
 *    complemento — a esfiha e a Coca dentro do combo — continua contando só
 *    pelo item, como sempre.
 *
 * Um mapa por loja: o ADMIN vê todas, e a borda de uma não casa com a de outra.
 * Só servidor (o mapa de categorias vem de uma lib que conhece o banco).
 */

import { categoriaResolvida, ehCategoriaDeIntegracao, montarMapa, type MapaDeCategorias } from "@/lib/categoria-do-item";
import { idsSoDeOpcaoDeCombo, PREFIXOS_DE_ESPELHO } from "@/lib/cardapio-interno";
import { parseComboSelections } from "@/lib/parse-combo";
import { complementosDaOpcao, montarMapaDeComplementos, type MapaDeComplementos } from "@/lib/complemento-da-opcao";

/** O rótulo de quem ficou sem categoria — o mesmo que o relatório já usava. */
export const SEM_CATEGORIA = "Outros";

/** Um complemento escolhido dentro de um item, como o relatório o soma. */
export type OpcaoDoRelatorio = {
  /** O complemento do cadastro, ou null quando só a categoria foi reconhecida. */
  id: string | null;
  nome: string;
  categoria: string;
  /** Já multiplicada pela quantidade do item: 2 pizzas com borda = 2 bordas. */
  quantidade: number;
  /** Preço por unidade quando o canal informa (iFood, Wabiz); null no balcão. */
  preco: number | null;
  custo: number;
};

type ProdutoDoCadastro = {
  id: string;
  franchiseeId?: string | null;
  name: string;
  category?: string | null;
  cost?: number | null;
  active?: boolean | null;
  [k: string]: unknown;
};

/**
 * A mesma prova de espelho de lib/categoria-do-item.ts: o prefixo do id só
 * condena o produto INATIVO — o cardápio importado reaproveita ids `ifood-` —,
 * e a categoria de plataforma condena sempre.
 */
export function ehProdutoEspelho(p: { id?: string | null; active?: boolean | null; category?: string | null }): boolean {
  return (
    (p.active !== true && PREFIXOS_DE_ESPELHO.some((pre) => String(p.id || "").startsWith(pre))) ||
    ehCategoriaDeIntegracao(p.category)
  );
}

export type MapasDaLoja = { categorias: MapaDeCategorias; complementos: MapaDeComplementos };

/**
 * Os mapas de cada loja, montados uma vez. Os produtos precisam vir com o que
 * `idsSoDeOpcaoDeCombo` lê: `apenasEmCombo`, os preços por canal e
 * `comboGroups.items.menuProductId`.
 */
export function montarMapasDoRelatorio(produtos: ProdutoDoCadastro[]): (lojaId: string | null | undefined) => MapasDaLoja {
  const porLoja = new Map<string, ProdutoDoCadastro[]>();
  for (const p of produtos) {
    const lojaId = String(p.franchiseeId || "");
    if (!porLoja.has(lojaId)) porLoja.set(lojaId, []);
    porLoja.get(lojaId)!.push(p);
  }
  const mapas = new Map<string, MapasDaLoja>();
  for (const [lojaId, prods] of porLoja) {
    const soOpcao = idsSoDeOpcaoDeCombo(prods);
    mapas.set(lojaId, {
      categorias: montarMapa(prods),
      complementos: montarMapaDeComplementos(
        prods
          .filter((p) => soOpcao.has(String(p.id)) && !ehProdutoEspelho(p) && String(p.category || "").trim())
          .map((p) => ({ id: p.id, nome: p.name, categoria: String(p.category).trim(), custo: Number(p.cost) || 0 })),
      ),
    });
  }
  const vazio: MapasDaLoja = { categorias: montarMapa([]), complementos: montarMapaDeComplementos([]) };
  return (lojaId) => mapas.get(String(lojaId || "")) || vazio;
}

type ItemDoPedido = {
  productName?: string | null;
  quantity: number;
  comboSelections?: unknown;
  menuProduct?: { id?: string | null; name?: string | null; category?: string | null; active?: boolean | null } | null;
};

/** A categoria de verdade do item — "Outros" quando não deu para saber. */
export function categoriaDoItem(item: ItemDoPedido, mapas: MapasDaLoja): string {
  const categoria = categoriaResolvida(
    { productName: item.productName, comboSelections: item.comboSelections, menuProduct: item.menuProduct },
    mapas.categorias,
  );
  return categoria || SEM_CATEGORIA;
}

/** Os complementos escolhidos dentro do item (borda, adicional), já com quantidade total. */
export function opcoesDoItem(item: ItemDoPedido, mapas: MapasDaLoja): OpcaoDoRelatorio[] {
  const opcoes: OpcaoDoRelatorio[] = [];
  for (const op of parseComboSelections(item.comboSelections, item.quantity)) {
    const casados = complementosDaOpcao(op.name, mapas.complementos);
    for (const c of casados) {
      opcoes.push({
        id: c.id,
        nome: c.nome,
        categoria: c.categoria,
        quantidade: op.quantity,
        // O preço só vale quando a opção é UM complemento: "Borda X + Bacon"
        // traz um preço para as duas coisas, e dividir seria chute.
        preco: casados.length === 1 && typeof op.price === "number" && op.price > 0 ? op.price : null,
        custo: c.custo,
      });
    }
  }
  return opcoes;
}

/**
 * A categoria da LINHA do produto no ranking. O espelho leva a do produto
 * real, pelo nome; sem isto a linha dele dizia "iFood" e sumia de todo filtro
 * de categoria.
 */
export function categoriaDoProduto(p: ProdutoDoCadastro, mapas: MapasDaLoja): { categoria: string; espelho: boolean } {
  const espelho = ehProdutoEspelho(p);
  const categoria = espelho
    ? categoriaResolvida({ productName: p.name, menuProduct: p }, mapas.categorias)
    : String(p.category || "").trim();
  return { categoria: categoria || SEM_CATEGORIA, espelho };
}

/**
 * As categorias do FILTRO: as do cardápio de verdade. Sem "iFood" e "99Food",
 * que são plataforma, e sem o nome de grupo que o espelho da Wabiz carrega
 * ("Esfihas", "Pizzas Grande"). "Outros" só entra se houver o que mostrar
 * nela — item de plataforma que não casou com o cardápio.
 */
export function categoriasDoFiltro(
  produtos: { category: string; espelho: boolean }[],
  itens: { productCategory: string }[],
): string[] {
  const categorias = Array.from(new Set(produtos.filter((p) => !p.espelho).map((p) => p.category)))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const temSemCategoria =
    produtos.some((p) => p.category === SEM_CATEGORIA) || itens.some((i) => i.productCategory === SEM_CATEGORIA);
  if (temSemCategoria && !categorias.includes(SEM_CATEGORIA)) categorias.push(SEM_CATEGORIA);
  return categorias;
}
