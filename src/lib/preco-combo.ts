/**
 * /src/lib/preco-combo.ts
 *
 * FONTE ÚNICA do preço de um produto com opções (combo).
 *
 * Antes, três lugares calculavam o mesmo preço de jeitos diferentes — e os três
 * discordavam entre si. Com o "Nugget" da Hakim (preço base R$ 0,00, cujo valor
 * inteiro está nas opções 6/15/40 unidades):
 *
 *   card do cardápio  →  R$ 0,00   (mostrava `product.price` cru)
 *   dentro do modal   →  R$ 29,70  (para 6 Nuggets, que custam R$ 9,90)
 *   gravado no pedido →  R$ 0,00   (o servidor somava só a base)
 *
 * O R$ 29,70 vinha de dupla contagem: o modal calculava o "mínimo" somando
 * `additionalPrice + preço do produto-opção` (R$ 9,90 + R$ 9,90 = R$ 19,80),
 * usava isso como base porque o produto custa 0, e ainda somava o
 * `additionalPrice` da escolha por cima.
 *
 * A regra é uma só, e está aqui:
 *
 *   preço = preço base do produto + Σ (quantidade escolhida × additionalPrice)
 *
 * O preço do produto-opção NÃO entra: ele é o valor de vender aquele item
 * avulso no cardápio. Dentro do combo, o que vale é o `additionalPrice`.
 */

export type ItemDeGrupo = {
  additionalPrice?: number | null;
  menuProduct?: { name?: string | null; price?: number | null } | null;
};

export type GrupoDeCombo = {
  id?: string;
  title?: string | null;
  maxQty?: number | null;
  items?: ItemDeGrupo[] | null;
};

export type ProdutoComCombo = {
  price: number;
  isCombo?: boolean | null;
  comboGroups?: GrupoDeCombo[] | null;
};

/**
 * Escolhas do cliente. Dois formatos circulam no sistema:
 *   cardápio → { [grupoId]: { [nomeDoItem]: quantidade } }
 *   PDV      → [{ name, quantity }]
 * Ambos são aceitos.
 */
export type EscolhasDoCombo =
  | Record<string, Record<string, number>>
  | { name?: string; quantity?: number }[]
  | null
  | undefined;

/**
 * Normaliza os dois formatos numa lista de (grupo, nome, quantidade).
 *
 * O `grupoId` é PRESERVADO quando existe. Sem ele, o mesmo nome em dois grupos
 * com adicionais diferentes viraria uma ambiguidade que só se resolve chutando
 * — e o chute cobra diferente do que o modal mostrou ao cliente. Num combo com
 * "Esfirra de Carne" grátis no grupo do sabor incluso e a R$ 3,98 no grupo da
 * segunda esfirra, o modal cobra R$ 20,88 e o chute cobraria R$ 24,86.
 */
function normalizarEscolhas(escolhas: EscolhasDoCombo): { grupoId?: string; nome: string; qtd: number }[] {
  if (!escolhas) return [];

  let bruto: any = escolhas;
  if (typeof bruto === "string") {
    try {
      bruto = JSON.parse(bruto);
    } catch {
      return [];
    }
  }

  // Formato do PDV: lista sem grupo. Cai no casamento por nome.
  if (Array.isArray(bruto)) {
    return bruto
      .map((i: any) => ({ nome: String(i?.name ?? ""), qtd: Number(i?.quantity ?? 0) }))
      .filter((i) => i.nome && i.qtd > 0);
  }

  // Formato do cardápio: { grupoId: { nome: qtd } }. O grupo vem de graça.
  if (typeof bruto === "object") {
    const saida: { grupoId?: string; nome: string; qtd: number }[] = [];
    for (const [grupoId, grupo] of Object.entries(bruto as Record<string, any>)) {
      if (!grupo || typeof grupo !== "object") continue;
      for (const [nome, qtd] of Object.entries(grupo as Record<string, any>)) {
        const n = Number(qtd);
        if (nome && n > 0) saida.push({ grupoId, nome, qtd: n });
      }
    }
    return saida;
  }

  return [];
}

/** Soma dos adicionais efetivamente escolhidos pelo cliente. */
export function somaDosAdicionais(
  produto: ProdutoComCombo,
  escolhas: EscolhasDoCombo
): number {
  const grupos = produto.comboGroups || [];
  if (grupos.length === 0) return 0;

  const escolhido = normalizarEscolhas(escolhas);
  if (escolhido.length === 0) return 0;

  // Dois mapas: o preciso, por (grupo, nome), e o de fallback por nome — usado
  // só quando a escolha veio sem grupo (formato do PDV).
  //
  // Casar por grupo é o que mantém o servidor igual ao ComboModal, que soma
  // `selections[group.id]`. Com um mapa só por nome, "Esfirra de Carne" grátis
  // num grupo e a R$ 3,98 em outro viravam o mesmo preço nos dois lugares — e a
  // conta do servidor passava a divergir da que o cliente viu na tela.
  const porGrupoENome = new Map<string, number>();
  const porNome = new Map<string, number>();
  for (const g of grupos) {
    for (const item of g.items || []) {
      const nome = item?.menuProduct?.name;
      if (!nome) continue;
      const add = Number(item.additionalPrice) || 0;
      if (g.id) porGrupoENome.set(`${g.id}::${nome}`, add);
      // No fallback por nome, o MENOR: sem saber de qual grupo veio a escolha,
      // cobrar o maior seria cobrar do cliente por uma opção que ele pode não
      // ter escolhido.
      porNome.set(nome, Math.min(porNome.get(nome) ?? Infinity, add));
    }
  }

  let total = 0;
  for (const { grupoId, nome, qtd } of escolhido) {
    const doGrupo = grupoId ? porGrupoENome.get(`${grupoId}::${nome}`) : undefined;
    const add = doGrupo ?? porNome.get(nome) ?? 0;
    total += (Number.isFinite(add) ? add : 0) * qtd;
  }
  return arredondar(total);
}

/** Preço unitário final: base + adicionais escolhidos. É o valor a cobrar. */
export function precoUnitarioDoItem(
  produto: ProdutoComCombo,
  escolhas: EscolhasDoCombo
): number {
  return arredondar((Number(produto.price) || 0) + somaDosAdicionais(produto, escolhas));
}

/**
 * Menor preço possível do produto — o "a partir de" do cardápio.
 *
 * Para cada grupo, assume que o cliente vai preencher `maxQty` itens escolhendo
 * sempre o mais barato. Num grupo cujo item mais barato é grátis (o caso das
 * "3 Esfirras Doces", base R$ 16,90), a contribuição é zero e o mínimo continua
 * sendo o preço base. Já no "Nugget" (base R$ 0,00, maxQty 1, opção mais barata
 * +R$ 9,90), o mínimo é R$ 9,90 — que é o número que o cliente precisa ver.
 */
export function precoMinimoDoProduto(produto: ProdutoComCombo): number {
  const base = Number(produto.price) || 0;
  const grupos = produto.comboGroups || [];
  if (grupos.length === 0) return arredondar(base);

  let minimo = base;
  for (const g of grupos) {
    const itens = g.items || [];
    if (itens.length === 0) continue;
    const maisBarato = Math.min(...itens.map((i) => Number(i.additionalPrice) || 0));
    const quantos = Math.max(1, Number(g.maxQty) || 1);
    minimo += maisBarato * quantos;
  }
  return arredondar(minimo);
}

/**
 * O preço varia conforme a escolha? Só nesse caso a tela mostra "a partir de".
 * Combo de preço fechado (o "Monte seu Combo (10 itens variados)", R$ 46,90,
 * onde nenhuma opção custa a mais) continua exibindo o preço direto.
 */
export function precoVariaPorEscolha(produto: ProdutoComCombo): boolean {
  for (const g of produto.comboGroups || []) {
    for (const item of g.items || []) {
      if ((Number(item.additionalPrice) || 0) > 0) return true;
    }
  }
  return false;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
