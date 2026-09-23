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
import { precoDaOpcao, type CanalDePreco, type OpcaoComPrecos } from "@/lib/preco-por-canal";

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
  /**
   * Preço por unidade. O que o CANAL mandou (iFood, Wabiz, 99 — zero é borda
   * grátis) ou, quando o pedido não guarda preço de opção (balcão, site, totem),
   * o da opção NO GRUPO DESTE PRODUTO no cadastro, no preço daquele canal.
   * null = não deu para saber.
   */
  preco: number | null;
  custo: number;
};

/**
 * Em que coluna de preço o pedido deste canal foi cobrado — a mesma divisão do
 * resto do sistema (lib/preco-por-canal.ts): balcão e mesa no salão, totem no
 * totem, e site, robô e o que vier de fora no delivery.
 */
function canalDePrecoDo(canal: string | null | undefined): CanalDePreco {
  const c = String(canal || "").toUpperCase();
  if (c === "PDV" || c === "MESA") return "salao";
  if (c === "TOTEM") return "totem";
  return "delivery";
}

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

export type MapasDaLoja = {
  categorias: MapaDeCategorias;
  complementos: MapaDeComplementos;
  /** produto → (opção → preços da opção no grupo DESTE produto). */
  precoNoCombo: Map<string, Map<string, OpcaoComPrecos>>;
  /**
   * Categorias que só guardam opção: TODO produto real delas é complemento
   * (Bordas, Adicionais, Sabores de Pizza). Um item de plataforma nunca herda
   * uma delas — ver `categoriaDoItem`.
   */
  soDeComplemento: Set<string>;
};

/**
 * Os mapas de cada loja, montados uma vez. Os produtos precisam vir com o que
 * `idsSoDeOpcaoDeCombo` lê — `apenasEmCombo`, os preços por canal e
 * `comboGroups.items.menuProductId` — e com os preços de cada opção no grupo
 * (`additionalPrice` e as colunas por canal).
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
    // O preço de cada opção dentro de cada produto. A mesma borda pode custar
    // diferente em duas pizzas, então a chave é o PAR produto × opção. Se o
    // produto tem a opção em dois grupos, vale o primeiro.
    const precoNoCombo = new Map<string, Map<string, OpcaoComPrecos>>();
    for (const p of prods) {
      const grupos = Array.isArray((p as any).comboGroups) ? (p as any).comboGroups : [];
      for (const g of grupos) {
        for (const it of g?.items || []) {
          if (!it?.menuProductId) continue;
          if (!precoNoCombo.has(p.id)) precoNoCombo.set(p.id, new Map());
          const doProduto = precoNoCombo.get(p.id)!;
          if (!doProduto.has(it.menuProductId)) doProduto.set(it.menuProductId, it);
        }
      }
    }
    // Categoria só de complemento: todos os produtos reais dela são opção.
    const reaisPorCategoria = new Map<string, { total: number; complementos: number }>();
    for (const p of prods) {
      const categoria = String(p.category || "").trim();
      if (!categoria || ehProdutoEspelho(p)) continue;
      const linha = reaisPorCategoria.get(categoria) || { total: 0, complementos: 0 };
      linha.total++;
      if (soOpcao.has(String(p.id))) linha.complementos++;
      reaisPorCategoria.set(categoria, linha);
    }
    const soDeComplemento = new Set(
      Array.from(reaisPorCategoria.entries()).filter(([, l]) => l.total > 0 && l.complementos === l.total).map(([c]) => c),
    );
    mapas.set(lojaId, {
      categorias: montarMapa(prods),
      complementos: montarMapaDeComplementos(
        prods
          .filter((p) => soOpcao.has(String(p.id)) && !ehProdutoEspelho(p) && String(p.category || "").trim())
          .map((p) => ({ id: p.id, nome: p.name, categoria: String(p.category).trim(), custo: Number(p.cost) || 0 })),
      ),
      precoNoCombo,
      soDeComplemento,
    });
  }
  const vazio: MapasDaLoja = {
    categorias: montarMapa([]), complementos: montarMapaDeComplementos([]), precoNoCombo: new Map(), soDeComplemento: new Set(),
  };
  return (lojaId) => mapas.get(String(lojaId || "")) || vazio;
}

type ItemDoPedido = {
  productName?: string | null;
  quantity: number;
  comboSelections?: unknown;
  menuProduct?: { id?: string | null; name?: string | null; category?: string | null; active?: boolean | null } | null;
};

/**
 * A categoria de verdade do item — "Outros" quando não deu para saber.
 *
 * ── O combo que virou "Adicional" ───────────────────────────────────────────
 *
 * A regra do KDS (lib/categoria-do-item.ts), quando o nome do item de
 * plataforma não casa com nada, decide pela OPÇÃO escolhida dentro dele. Na
 * cozinha é o certo: melhor a pizza aparecer na tela da pizza do que em
 * nenhuma. No relatório não: na Brazza Burguer, em 23/09/2026, quatro combos do
 * 99 ("Burguer + Batata P + Guaravita", R$ 62,88) caíram em "Adicionais" porque
 * a única opção que casou foi a batata carregada — e o filtro de Adicionais
 * somou R$ 319,84 de combo inteiro.
 *
 * Então, para o item de plataforma: vale o que o NOME decide; a opção só
 * decide quando aponta para uma categoria de produto de verdade (as esfihas de
 * um combo de esfihas), nunca para uma categoria que só guarda opção (Bordas,
 * Adicionais, Sabores). Aí é "Outros" — e as opções dele continuam contando na
 * categoria delas, pelo caminho das opções.
 */
export function categoriaDoItem(item: ItemDoPedido, mapas: MapasDaLoja): string {
  const comOpcoes = categoriaResolvida(
    { productName: item.productName, comboSelections: item.comboSelections, menuProduct: item.menuProduct },
    mapas.categorias,
  );
  if (!item.menuProduct || !ehProdutoEspelho(item.menuProduct)) return comOpcoes || SEM_CATEGORIA;
  const peloNome = categoriaResolvida(
    { productName: item.productName, comboSelections: null, menuProduct: item.menuProduct },
    mapas.categorias,
  );
  if (peloNome) return peloNome;
  if (comOpcoes && !mapas.soDeComplemento.has(comOpcoes)) return comOpcoes;
  return SEM_CATEGORIA;
}

/**
 * Os complementos escolhidos dentro do item (borda, adicional), já com
 * quantidade total e com o preço de cada um.
 *
 * ── De onde sai o preço ─────────────────────────────────────────────────────
 *
 * iFood, Wabiz e 99 mandam o preço de cada opção no pedido ("Massa
 * Tradicional + Borda Catupiry", R$ 14,00), e ele vale como veio — inclusive o
 * ZERO, que é a borda tradicional grátis. O balcão, o site e o totem não
 * guardam: o comboSelections do caixa é só `{name, quantity}`. Aí vale o preço
 * da opção no grupo DESTE produto no cadastro, pela coluna do canal. Conferido
 * nas 5 bordas do balcão da NIK em 23/09/2026: Calabresa meio a meio com Frango
 * Catupiry cobrada R$ 74,90 = (56,90 + 68,90) / 2 + 12,00 da Borda de Catupiry,
 * exatamente o +12 do cadastro.
 *
 * Opção que junta dois complementos ("Borda X + Bacon") traz UM preço para os
 * dois; dividir seria chute, então cada um vai pelo cadastro.
 */
export function opcoesDoItem(item: ItemDoPedido, mapas: MapasDaLoja, canal?: string | null): OpcaoDoRelatorio[] {
  const opcoes: OpcaoDoRelatorio[] = [];
  const canalDePreco = canalDePrecoDo(canal);
  const doProduto = item.menuProduct?.id ? mapas.precoNoCombo.get(item.menuProduct.id) : undefined;
  for (const op of parseComboSelections(item.comboSelections, item.quantity)) {
    const casados = complementosDaOpcao(op.name, mapas.complementos);
    for (const c of casados) {
      const doCanal = casados.length === 1 && typeof op.price === "number" && Number.isFinite(op.price) && op.price >= 0 ? op.price : null;
      const noCadastro = c.id ? doProduto?.get(c.id) : undefined;
      opcoes.push({
        id: c.id,
        nome: c.nome,
        categoria: c.categoria,
        quantidade: op.quantity,
        preco: doCanal ?? (noCadastro ? precoDaOpcao(noCadastro, canalDePreco) : null),
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
