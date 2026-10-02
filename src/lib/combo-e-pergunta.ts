/**
 * PERGUNTA É UMA COISA, COMBO É OUTRA.
 *
 * Até 02/10/2026 o cadastro só mostrava as perguntas em "Novo Combo": para
 * dar sabor ao pastel, tamanho ao refrigerante ou ponto à carne, a loja tinha
 * que cadastrar o item como combo. Resultado: 776 dos 995 "combos" do banco
 * eram X-Bacon, pizza, jarra de suco — com o selo 📦 COMBO na vitrine, na aba
 * "Combos" do balcão e na lista de combos do robô.
 *
 * Douglas: "pergunta é uma coisa, combo é outra. Eu posso criar um item e ter
 * dois sabores dele, como a bebida de tamanhos diferentes, e não ser combo.
 * No combo você tem que selecionar os itens já lançados e formar um com ele,
 * até para quando pausar oferecer pausar os itens dentro daquele combo."
 *
 * Então:
 *   - PERGUNTA (`comboGroups`) existe em qualquer produto. Quem decide abrir
 *     a tela de escolhas é ter pergunta, não `isCombo`.
 *   - COMBO (`isCombo`) é o que junta itens do cardápio. O item que o combo
 *     sempre leva ("4 X-Salada") é uma pergunta FIXA: uma opção só, mínimo =
 *     máximo. O ComboModal já a preenche sozinho (`preenchimentoForcado`), a
 *     escolha casa pelo nome com o produto de verdade e sai na impressora da
 *     categoria dele (lib/categoria-do-item.ts) — sem formato novo de pedido.
 *   - Pausar o item avulso oferece pausar os combos que DEPENDEM dele, e
 *     reativar oferece reativar os que voltam a fechar.
 */
import { perguntaTravadaPelaPausa, produtoTravadoPelaPausa, type PerguntaComEstado } from "./opcao-pausada";
import { minimoExigidoDoGrupo, type GrupoDeCombo } from "./preco-combo";

type OpcaoDoGrupo = {
  maxPerItem?: number | null;
  menuProductId?: string | null;
  menuProduct?: { id?: string | null; name?: string | null; active?: boolean | null; apenasEmCombo?: boolean | null } | null;
};

export type GrupoDoProduto = {
  id?: string;
  title?: string | null;
  maxQty?: number | null;
  minQty?: number | null;
  items?: OpcaoDoGrupo[] | null;
};

export type ProdutoDoCardapio = {
  id: string;
  name?: string | null;
  isCombo?: boolean | null;
  active?: boolean | null;
  comboGroups?: GrupoDoProduto[] | null;
};

const idDaOpcao = (o: OpcaoDoGrupo | null | undefined) => String(o?.menuProduct?.id || o?.menuProductId || "");

/** Tem pergunta? É isto — e não `isCombo` — que abre a tela de escolhas. */
export function temPerguntas(produto: { comboGroups?: unknown[] | null } | null | undefined): boolean {
  return Array.isArray(produto?.comboGroups) && produto!.comboGroups!.length > 0;
}

/**
 * O item que o combo SEMPRE leva: uma opção só, mínimo = máximo, e o teto da
 * opção não segura a quantidade. É a forma que o cadastro grava "4× X-Salada"
 * e a que o ComboModal já preenche sozinho.
 */
export function itemFixoDoGrupo(grupo: GrupoDoProduto | null | undefined): { id: string; nome: string; qtd: number } | null {
  const itens = grupo?.items || [];
  if (itens.length !== 1) return null;
  const max = Math.max(1, Number(grupo?.maxQty) || 1);
  if (minimoExigidoDoGrupo(grupo as GrupoDeCombo) !== max) return null;
  const teto = Number(itens[0]?.maxPerItem);
  if (Number.isFinite(teto) && teto > 0 && teto < max) return null;
  const id = idDaOpcao(itens[0]);
  if (!id) return null;
  return { id, nome: String(itens[0]?.menuProduct?.name || "").trim(), qtd: max };
}

/** Pergunta do combo com o item marcado como pausado (ou ativo). */
function comItem(grupo: GrupoDoProduto, itemId: string, ativo: boolean): PerguntaComEstado {
  return {
    ...grupo,
    items: (grupo.items || []).map((o) =>
      idDaOpcao(o) === itemId ? { ...o, menuProduct: { ...(o.menuProduct || {}), active: ativo } } : o
    ),
  };
}

function usaOItem(combo: ProdutoDoCardapio, itemId: string): boolean {
  return (combo.comboGroups || []).some((g) => (g.items || []).some((o) => idDaOpcao(o) === itemId));
}

/**
 * O combo DEPENDE do item quando, com o item pausado, alguma pergunta
 * obrigatória deixa de fechar: o item fixo ("4× X-Salada") ou a última opção
 * ativa de uma escolha obrigatória. Item que é uma opção entre várias só sai
 * da escolha — o combo continua à venda.
 */
export function comboDependeDoItem(combo: ProdutoDoCardapio, itemId: string): boolean {
  if (!itemId || combo.id === itemId) return false;
  return (combo.comboGroups || []).some((g) =>
    (g.items || []).some((o) => idDaOpcao(o) === itemId) && perguntaTravadaPelaPausa(comItem(g, itemId, false))
  );
}

/** Combos à venda que param de fechar se o item for pausado. */
export function combosQueDependemDoItem<T extends ProdutoDoCardapio>(itemId: string, produtos: T[]): T[] {
  return produtos.filter((p) => p.isCombo && p.active !== false && comboDependeDoItem(p, itemId));
}

/** Combos à venda que usam o item como UMA das opções (só sai da escolha). */
export function combosOndeOItemEOpcao<T extends ProdutoDoCardapio>(itemId: string, produtos: T[]): T[] {
  return produtos.filter((p) => p.isCombo && p.active !== false && usaOItem(p, itemId) && !comboDependeDoItem(p, itemId));
}

/**
 * Combos pausados que usam o item e voltam a fechar com ele ativo — os que
 * a loja provavelmente pausou junto. Combo que continua travado por OUTRO
 * item pausado fica de fora: reativá-lo seria vender o que não tem.
 */
export function combosParaReativar<T extends ProdutoDoCardapio>(itemId: string, produtos: T[]): T[] {
  return produtos.filter((p) => {
    if (!p.isCombo || p.active !== false || !usaOItem(p, itemId)) return false;
    const comOItemAtivo = { comboGroups: (p.comboGroups || []).map((g) => comItem(g, itemId, true)) };
    return produtoTravadoPelaPausa(comOItemAtivo) === null;
  });
}

/**
 * Parece combo pelo nome ou pela categoria? Serve para separar, no que já
 * estava gravado, o combo de verdade do item que só foi marcado para ter
 * pergunta (scripts/combo-so-o-que-e-combo.mjs) e para os copiadores de
 * cardápio. "Promoção" e "oferta" sozinhas NÃO contam: prato com desconto
 * não é combo.
 */
export function pareceCombo(nome: string | null | undefined, categoria?: string | null): boolean {
  // "Kit Kat" é chocolate, não kit.
  const n = String(nome || "").replace(/kit\s*kat/gi, "");
  const c = String(categoria || "").replace(/kit\s*kat/gi, "");
  if (/\bcombos?\b|\bkits?\b|\+|\bcasal\b|\bfam[ií]lia\b|\bsolteir|\bbalde\b|\btrio\b|\b(leve|compre)\s*\d/i.test(n)) return true;
  // "2 PIZZAS 35CM / 1 COCA 2L": comida e bebida separadas por barra.
  if (/\//.test(n) && /\b(coca|refri|refrigerante|guaran[aá]|suco|bebida)/i.test(n)) return true;
  return /\bcombos?\b|\bkits?\b/i.test(c);
}
