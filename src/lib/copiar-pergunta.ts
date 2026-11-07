/**
 * USAR UMA PERGUNTA EM OUTROS PRODUTOS.
 *
 * Pedido de lojista (Gil e Bruno, out/2026): "copiar uma pergunta de um
 * produto para os outros produtos da categoria". Cada pergunta (ComboGroup)
 * pertence a um produto só, e até aqui o único jeito de levá-la adiante era o
 * "Duplicar" — que serve para produto NOVO. Com 20 pastéis e um "Adicionais"
 * igual em todos, a loja montava a mesma pergunta 20 vezes.
 *
 * A opção é um MenuProduct compartilhado: copiar a pergunta é criar outro
 * ComboGroup apontando para os MESMOS produtos de opção, com os mesmos preços.
 * Nenhum produto novo nasce, e pausar o "Catupiry" continua pausando em todas.
 * Nada muda no formato — vitrine, pedido, robô, totem, PDV e impressão leem o
 * grupo copiado como qualquer outro.
 *
 * Arquivo puro (sem banco): a tela e a rota api/admin/menu-products/copiar-pergunta
 * usam as mesmas regras, e scripts/teste-copiar-pergunta.ts as confere.
 */
import { itemFixoDoGrupo } from "./combo-e-pergunta";
import { ehPerguntaDeMeio } from "./meio-a-meio";
import { ehPerguntaDeBorda, ehPerguntaDeSabores } from "./pizza-por-tamanho";
import { ehProdutoDeIntegracao, idsSoDeOpcaoDeCombo } from "./cardapio-interno";

export type OpcaoDaPergunta = {
  menuProductId?: string | null;
  menuProduct?: { id?: string | null; name?: string | null; active?: boolean | null } | null;
  additionalPrice?: number | null;
  additionalPriceSalao?: number | null;
  additionalPriceDelivery?: number | null;
  additionalPriceTotem?: number | null;
  promoAdditionalPrice?: number | null;
  maxPerItem?: number | null;
  optionNote?: string | null;
  precoPorEscolha?: unknown;
  sortOrder?: number | null;
};

export type PerguntaParaCopiar = {
  id?: string;
  title?: string | null;
  maxQty?: number | null;
  minQty?: number | null;
  priceRule?: string | null;
  sortOrder?: number | null;
  items?: OpcaoDaPergunta[] | null;
};

export type ProdutoParaCopiar = {
  id: string;
  name?: string | null;
  category?: string | null;
  franchiseeId?: string | null;
  isCombo?: boolean | null;
  apenasEmCombo?: boolean | null;
  active?: boolean | null;
  comboGroups?: PerguntaParaCopiar[] | null;
};

/** "  Adicionais " e "adicionais" são a mesma pergunta; acento e espaço não contam. */
export function tituloNormalizado(titulo: unknown): string {
  return String(titulo ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** O produto já tem uma pergunta com este título? */
export function jaTemAPergunta(produto: ProdutoParaCopiar, titulo: unknown): boolean {
  const alvo = tituloNormalizado(titulo);
  return !!alvo && (produto.comboGroups || []).some((g) => tituloNormalizado(g.title) === alvo);
}

/**
 * Por que esta pergunta NÃO pode ir para outro produto (ou null, se pode).
 *
 * As três travas são perguntas que outra parte do sistema monta sozinha, e
 * uma cópia delas ou não faria sentido ou seria desfeita/confundida depois:
 *   - o item fixo do combo ("4× X-Salada") é o que AQUELE combo leva, não uma
 *     escolha — em outro produto viraria "leva 4 X-Salada" sem ninguém pedir;
 *   - o "Meio a meio?" é refeito para cada pizza com o preço da diferença
 *     dela (lib/meio-a-meio.ts, refazerMeiasDaLoja) — copiado, levaria a conta
 *     de outra pizza;
 *   - sabores e borda são do passo a passo da pizza (lib/pizza-por-tamanho.ts):
 *     ele apaga e regrava essas perguntas a cada salvamento, e um produto
 *     qualquer com "Escolha o sabor" passaria a ser lido como tamanho de pizza.
 */
export function motivoParaNaoCopiar(grupo: PerguntaParaCopiar, produtoOrigem?: ProdutoParaCopiar | null): string | null {
  if (produtoOrigem?.isCombo && itemFixoDoGrupo(grupo)) {
    return "É o item que este combo sempre leva, não uma pergunta. Para outro combo, adicione o item em “O que o combo leva”.";
  }
  if (ehPerguntaDeMeio(grupo.title)) {
    return "O meio a meio é montado sozinho em cada pizza, com o preço da diferença dela. Ligue o meio a meio no cadastro da pizza.";
  }
  if (ehPerguntaDeSabores(grupo) || ehPerguntaDeBorda(grupo)) {
    return "Sabores e borda são do cadastro de pizza (🍕): ele mesmo monta essas perguntas em cada tamanho.";
  }
  if (!(grupo.items || []).length) return "A pergunta não tem nenhuma opção.";
  return null;
}

export type DestinoDaPergunta<T extends ProdutoParaCopiar> = {
  produto: T;
  /** Já tem uma pergunta de mesmo título: o lojista escolhe pular ou substituir. */
  jaTem: boolean;
};

export type DestinosDaPergunta<T extends ProdutoParaCopiar> = {
  mesmaCategoria: DestinoDaPergunta<T>[];
  outras: DestinoDaPergunta<T>[];
  bloqueados: { produto: T; motivo: string }[];
};

/**
 * Para quais produtos a pergunta pode ir, separados como a tela mostra.
 *
 * Fica de fora, sem nem aparecer: a própria origem e produto de OUTRA loja
 * (o ADMIN em "todas as lojas" recebe o cardápio de todas). Aparece como
 * bloqueado: opção de combo (o "Catupiry" não ganha pergunta — ele é a
 * resposta de uma) e o espelho das integrações. `produtos` é o cardápio
 * INTEIRO da loja: quem é opção de combo só se descobre olhando os outros.
 */
export function destinosDaPergunta<T extends ProdutoParaCopiar>(
  produtos: T[],
  origem: ProdutoParaCopiar,
  grupo: PerguntaParaCopiar
): DestinosDaPergunta<T> {
  const soOpcao = idsSoDeOpcaoDeCombo(produtos);
  const categoria = tituloNormalizado(origem.category);
  const saida: DestinosDaPergunta<T> = { mesmaCategoria: [], outras: [], bloqueados: [] };
  for (const p of produtos) {
    if (!p?.id || p.id === origem.id) continue;
    if ((p.franchiseeId ?? null) !== (origem.franchiseeId ?? null)) continue;
    if (p.apenasEmCombo === true || soOpcao.has(String(p.id))) {
      saida.bloqueados.push({ produto: p, motivo: "É opção de combo" });
      continue;
    }
    if (ehProdutoDeIntegracao(p.category, p.id, p.active)) {
      saida.bloqueados.push({ produto: p, motivo: "Produto de integração" });
      continue;
    }
    const destino = { produto: p, jaTem: jaTemAPergunta(p, grupo.title) };
    if (tituloNormalizado(p.category) === categoria) saida.mesmaCategoria.push(destino);
    else saida.outras.push(destino);
  }
  return saida;
}

export type CopiaDaPergunta = {
  title: string;
  maxQty: number;
  minQty: number | null;
  priceRule: string | null;
  items: {
    menuProductId: string;
    additionalPrice: number;
    additionalPriceSalao: number | null;
    additionalPriceDelivery: number | null;
    additionalPriceTotem: number | null;
    promoAdditionalPrice: number | null;
    maxPerItem: number | null;
    optionNote: string | null;
    sortOrder: number;
  }[];
};

/**
 * A pergunta como ela vai para o outro produto: título, regra e as MESMAS
 * opções com os mesmos preços (inclusive por canal e promoção), na ordem em
 * que o lojista arrumou.
 *
 * `precoPorEscolha` NÃO vem: é a tabela do meio a meio por tamanho, calculada
 * para a pizza de origem (lib/meio-a-meio.ts). Em outro produto ela cobraria a
 * diferença de outra pizza.
 */
export function copiaDoGrupo(grupo: PerguntaParaCopiar): CopiaDaPergunta {
  const numeroOuNulo = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const itens = [...(grupo.items || [])]
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (Number(a.it.sortOrder) || 0) - (Number(b.it.sortOrder) || 0) || a.i - b.i)
    .map(({ it }) => it)
    .filter((it) => !!String(it.menuProduct?.id || it.menuProductId || ""));
  return {
    title: String(grupo.title ?? ""),
    maxQty: Number(grupo.maxQty) > 0 ? Number(grupo.maxQty) : 1,
    // Nulo tem significado (= exige exatamente maxQty, a regra antiga) e é
    // copiado como nulo — virar 0 deixaria a cópia opcional.
    minQty: numeroOuNulo(grupo.minQty),
    priceRule: grupo.priceRule ?? null,
    items: itens.map((it, k) => ({
      menuProductId: String(it.menuProduct?.id || it.menuProductId),
      additionalPrice: Number(it.additionalPrice) || 0,
      additionalPriceSalao: numeroOuNulo(it.additionalPriceSalao),
      additionalPriceDelivery: numeroOuNulo(it.additionalPriceDelivery),
      additionalPriceTotem: numeroOuNulo(it.additionalPriceTotem),
      promoAdditionalPrice: numeroOuNulo(it.promoAdditionalPrice),
      maxPerItem: numeroOuNulo(it.maxPerItem),
      optionNote: it.optionNote ?? null,
      sortOrder: k,
    })),
  };
}

export type SeJaTiver = "pular" | "substituir";
export type PosicaoDaCopia = "fim" | "inicio";

/** Pergunta que o destino já tem, como a rota a lê do banco. */
export type PerguntaDoDestino = { id: string; title?: string | null; sortOrder?: number | null; fixo?: boolean };

export type PlanoNoDestino =
  | { pular: true }
  | {
      pular: false;
      /** Perguntas de mesmo título que saem ("substituir"). */
      apagar: string[];
      /** sortOrder da pergunta copiada. */
      sortOrder: number;
      /** Perguntas que descem uma casa para abrir espaço ("no começo"). */
      deslocar: { id: string; sortOrder: number }[];
    };

/**
 * O que fazer em UM produto de destino: pular, onde entrar, o que apagar e o
 * que descer. A rota só executa o plano, numa transação por produto.
 *
 * "No começo" entra antes da primeira PERGUNTA, não antes dos itens fixos do
 * combo: o cadastro mostra o que o combo leva antes das escolhas, e é nessa
 * ordem que a vitrine pergunta.
 */
export function planoNoDestino(
  existentes: PerguntaDoDestino[],
  titulo: unknown,
  seJaTiver: SeJaTiver,
  posicao: PosicaoDaCopia
): PlanoNoDestino {
  const alvo = tituloNormalizado(titulo);
  const iguais = existentes.filter((g) => tituloNormalizado(g.title) === alvo);
  if (iguais.length > 0 && seJaTiver === "pular") return { pular: true };
  const apagar = seJaTiver === "substituir" ? iguais.map((g) => g.id) : [];
  const ficam = existentes
    .filter((g) => !apagar.includes(g.id))
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (Number(a.g.sortOrder) || 0) - (Number(b.g.sortOrder) || 0) || a.i - b.i)
    .map(({ g }) => g);

  if (posicao === "fim") {
    const maior = ficam.reduce((m, g) => Math.max(m, Number(g.sortOrder) || 0), -1);
    return { pular: false, apagar, sortOrder: maior + 1, deslocar: [] };
  }

  // Renumera tudo 0..n com a cópia no lugar: sortOrder repetido não segura a
  // ordem (no empate o banco decide), então a fila inteira é regravada.
  const fixos = ficam.filter((g) => g.fixo);
  const perguntas = ficam.filter((g) => !g.fixo);
  const ordem = [...fixos.map((g) => g.id), null, ...perguntas.map((g) => g.id)];
  const atual = new Map(ficam.map((g) => [g.id, Number(g.sortOrder) || 0]));
  const deslocar: { id: string; sortOrder: number }[] = [];
  let sortOrder = 0;
  ordem.forEach((id, idx) => {
    if (id === null) { sortOrder = idx; return; }
    if (atual.get(id) !== idx) deslocar.push({ id, sortOrder: idx });
  });
  return { pular: false, apagar, sortOrder, deslocar };
}
