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
  /** Quantas vezes a opção pode repetir. Nulo = até o teto do grupo. */
  maxPerItem?: number | null;
  menuProduct?: { name?: string | null; price?: number | null } | null;
};

export type GrupoDeCombo = {
  id?: string;
  title?: string | null;
  maxQty?: number | null;
  /** Mínimo de escolhas. Nulo = regra antiga: exige exatamente `maxQty`. */
  minQty?: number | null;
  /** Como cobrar várias escolhas: "SOMA" (padrão), "MAIOR" ou "MEDIA". */
  priceRule?: string | null;
  items?: ItemDeGrupo[] | null;
};

/**
 * COMO ESTA PERGUNTA COBRA VÁRIAS ESCOLHAS.
 *
 * "SOMA" é a regra de sempre e o padrão de tudo que já está gravado: bacon +
 * cheddar + ovo custam os três. É o que vale para adicional.
 *
 * Pizza não é assim. Meia calabresa e meia marguerita é UMA pizza, e cada casa
 * cobra de um jeito: a mais cara das duas metades ("MAIOR", o padrão do iFood)
 * ou a média delas ("MEDIA"). Nos dois casos o lojista cadastra o preço CHEIO
 * da pizza de cada sabor e o grupo inteiro vale UMA pizza — sem isso, a única
 * saída era cadastrar cada sabor pela metade do preço, que é o que a Pizzaria
 * do Digão fazia no InstaDelivery: 42 sabores para recalcular na mão a cada
 * reajuste, e o mesmo sabor com dois preços diferentes conforme a pergunta.
 */
export type RegraDePreco = "SOMA" | "MAIOR" | "MEDIA";

export function regraDoGrupo(grupo: GrupoDeCombo | null | undefined): RegraDePreco {
  const r = String(grupo?.priceRule || "").trim().toUpperCase();
  return r === "MAIOR" || r === "MEDIA" ? r : "SOMA";
}

/**
 * O que o GRUPO cobra, dadas as escolhas — já com a regra dele aplicada.
 *
 * `escolhas` são pares (preço cheio da opção, quantidade). A soma das
 * quantidades é quantas "fatias" o cliente marcou; em MAIOR e MEDIA elas
 * formam UMA pizza, então o grupo cobra o preço de uma só.
 */
function totalDoGrupo(regra: RegraDePreco, escolhas: { preco: number; qtd: number }[]): number {
  if (escolhas.length === 0) return 0;
  if (regra === "SOMA") {
    return arredondar(escolhas.reduce((s, e) => s + e.preco * e.qtd, 0));
  }
  const unidades = escolhas.reduce((s, e) => s + e.qtd, 0);
  if (unidades <= 0) return 0;
  if (regra === "MAIOR") return arredondar(Math.max(...escolhas.map((e) => e.preco)));
  // MEDIA: ponderada pela quantidade — dois pedaços do mesmo sabor pesam dois.
  return arredondar(escolhas.reduce((s, e) => s + e.preco * e.qtd, 0) / unidades);
}

/**
 * Quantas escolhas o grupo EXIGE. É o número que entra no "a partir de".
 *
 * Com `minQty` nulo vale a regra antiga (exatamente `maxQty`), que é o que os
 * combos gravados antes desta coluna esperam. Com `minQty` 0 o grupo é
 * opcional e não empurra nada para o preço mínimo.
 */
export function minimoExigidoDoGrupo(grupo: GrupoDeCombo): number {
  const max = Math.max(1, Number(grupo.maxQty) || 1);
  if (grupo.minQty === null || grupo.minQty === undefined) return max;
  const min = Number(grupo.minQty);
  if (!Number.isFinite(min) || min < 0) return max;
  return Math.min(min, max);
}

export type ProdutoComCombo = {
  price: number;
  isCombo?: boolean | null;
  comboGroups?: GrupoDeCombo[] | null;
  /**
   * Preço de tabela, quando o produto chega em PROMOÇÃO. Posto por
   * src/lib/preco-por-canal.ts, e só existe quando a promoção vale naquele
   * canal — `price` já é o promocional.
   */
  precoDe?: number | null;
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

  let total = 0;
  for (const a of adicionaisDetalhados(produto, escolhas)) total += a.precoUnitario * a.qtd;
  return arredondar(total);
  // (precoUnitario já vem repartido pela regra do grupo, então esta soma vale
  //  para SOMA, MAIOR e MEDIA sem saber qual é — ver adicionaisDetalhados.)
}

/**
 * Cada adicional escolhido, com o preço unitário que ELE custou neste pedido.
 *
 * É a mesma resolução que `somaDosAdicionais` faz para chegar ao total — e por
 * isso mora aqui, numa função só: a notinha precisa mostrar "+R$ 3,00" ao lado
 * da opção, e um segundo cálculo escrito em outro lugar é a receita para o
 * detalhe não bater com o total que já está certo.
 *
 * Dois mapas: o preciso, por (grupo, nome), e o de fallback por nome — usado
 * só quando a escolha veio sem grupo (formato do PDV).
 *
 * Casar por grupo é o que mantém o servidor igual ao ComboModal, que soma
 * `selections[group.id]`. Com um mapa só por nome, "Esfirra de Carne" grátis
 * num grupo e a R$ 3,98 em outro viravam o mesmo preço nos dois lugares — e a
 * conta do servidor passava a divergir da que o cliente viu na tela.
 */
export function adicionaisDetalhados(
  produto: ProdutoComCombo,
  escolhas: EscolhasDoCombo
): { grupoId?: string; nome: string; qtd: number; precoUnitario: number }[] {
  const grupos = produto?.comboGroups || [];
  if (grupos.length === 0) return [];

  const escolhido = normalizarEscolhas(escolhas);
  if (escolhido.length === 0) return [];

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

  // Preço CHEIO de cada escolha, antes da regra do grupo.
  const cheios = escolhido.map(({ grupoId, nome, qtd }) => {
    const doGrupo = grupoId ? porGrupoENome.get(`${grupoId}::${nome}`) : undefined;
    const add = doGrupo ?? porNome.get(nome) ?? 0;
    return { grupoId, nome, qtd, precoCheio: Number.isFinite(add) ? add : 0 };
  });

  // ── A REGRA DO GRUPO ────────────────────────────────────────────────────
  //
  // Em SOMA (todo grupo que já existe) nada muda: o preço cheio É o preço.
  //
  // Em MAIOR/MEDIA o grupo vale UMA pizza, então o valor do grupo é
  // REPARTIDO entre as escolhas — meia a meia fica com metade cada. Repartir,
  // em vez de zerar as outras, é o que mantém a promessa desta lib: o detalhe
  // impresso na comanda soma exatamente o total cobrado. A sobra de centavo
  // vai para a última linha, senão R$ 35,00 em três pedaços viraria R$ 34,99.
  const porGrupo = new Map<string, typeof cheios>();
  for (const c of cheios) {
    const k = c.grupoId ?? "\u0000sem-grupo";
    if (!porGrupo.has(k)) porGrupo.set(k, []);
    porGrupo.get(k)!.push(c);
  }

  const regraPorGrupo = new Map<string, RegraDePreco>();
  for (const g of grupos) if (g.id) regraPorGrupo.set(g.id, regraDoGrupo(g));

  const saida: { grupoId?: string; nome: string; qtd: number; precoUnitario: number; precoCheio: number }[] = [];
  for (const [k, lista] of porGrupo) {
    const regra = k === "\u0000sem-grupo" ? "SOMA" : (regraPorGrupo.get(k) ?? "SOMA");
    if (regra === "SOMA") {
      for (const c of lista) saida.push({ ...c, precoUnitario: c.precoCheio });
      continue;
    }
    const total = totalDoGrupo(regra, lista.map((c) => ({ preco: c.precoCheio, qtd: c.qtd })));
    const unidades = lista.reduce((s, c) => s + c.qtd, 0);
    let distribuido = 0;
    lista.forEach((c, i) => {
      const ultima = i === lista.length - 1;
      const valorDaLinha = ultima
        ? arredondar(total - distribuido)
        : arredondar((total * c.qtd) / unidades);
      distribuido = arredondar(distribuido + valorDaLinha);
      saida.push({ ...c, precoUnitario: c.qtd > 0 ? valorDaLinha / c.qtd : 0 });
    });
  }
  return saida;
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
 * Para cada grupo, assume que o cliente vai preencher o MÍNIMO EXIGIDO
 * escolhendo sempre a opção mais barata. Num grupo cujo item mais barato é
 * grátis (o caso das "3 Esfirras Doces", base R$ 16,90), a contribuição é zero
 * e o mínimo continua sendo o preço base. Já no "Nugget" (base R$ 0,00,
 * maxQty 1, opção mais barata +R$ 9,90), o mínimo é R$ 9,90 — que é o número
 * que o cliente precisa ver.
 *
 * Grupo opcional (`minQty` 0) não entra na conta: os adicionais de um pastel
 * não podem inflar o "a partir de" de um item que se vende sem nenhum deles.
 * Antes desta coluna todo grupo era tratado como obrigatório, então um pastel
 * com "Adicionais" anunciaria o preço com quatro adicionais embutidos.
 */
export function precoMinimoDoProduto(produto: ProdutoComCombo): number {
  const base = Number(produto.price) || 0;
  const grupos = produto.comboGroups || [];
  if (grupos.length === 0) return arredondar(base);

  let minimo = base;
  for (const g of grupos) {
    const itens = g.items || [];
    if (itens.length === 0) continue;
    const quantos = minimoExigidoDoGrupo(g);
    if (quantos <= 0) continue;
    const maisBarato = Math.min(...itens.map((i) => Number(i.additionalPrice) || 0));
    // Em MAIOR/MEDIA o grupo vale UMA pizza por mais sabores que ele exija:
    // duas metades do sabor mais barato custam o preço dele, não o dobro. Sem
    // esta linha o "a partir de" de uma pizza de 2 sabores sairia dobrado.
    minimo += regraDoGrupo(g) === "SOMA" ? maisBarato * quantos : maisBarato;
  }
  return arredondar(minimo);
}

/**
 * O MENOR preço que uma escolha válida pode dar — o PISO que o servidor
 * aplica quando a escolha chega vazia ou com nome que não casa.
 *
 * Não é o "a partir de". Aquele ignora a pergunta opcional, e está certo para
 * a vitrine; como piso, não. Pizza meio a meio montada com "a outra metade"
 * numa pergunta opcional cobra a média pela diferença: a Bjorn Ironside
 * (R$ 109,90) com meia Calabresa (R$ 65,90) é base 109,90 e acréscimo
 * −22,00 = R$ 87,90. O modal mostrava R$ 87,90 e o servidor, com o
 * "a partir de" como piso, lançava R$ 109,90 — no delivery e na mesa
 * (Ragnar, 25/09/2026). O balcão escapava porque confia no preço da tela.
 *
 * Então o piso soma, além do mínimo exigido, o DESCONTO mais fundo que as
 * perguntas permitem. Continua segurando o que ele existe para segurar: o
 * "Nugget" de base R$ 0,00 sem escolha não sai de graça, porque nenhuma opção
 * dele desconta.
 */
export function pisoDoPreco(produto: ProdutoComCombo): number {
  let piso = precoMinimoDoProduto(produto);
  for (const g of produto.comboGroups || []) {
    const itens = [...(g.items || [])].sort(
      (a, b) => (Number(a.additionalPrice) || 0) - (Number(b.additionalPrice) || 0)
    );
    const maisBarato = Number(itens[0]?.additionalPrice) || 0;
    if (itens.length === 0 || maisBarato >= 0) continue;
    const exigidos = minimoExigidoDoGrupo(g);

    // MAIOR/MEDIA valem UMA pizza: o desconto mais fundo é a opção mais
    // barata, e o "a partir de" já a contou quando o grupo é obrigatório.
    if (regraDoGrupo(g) !== "SOMA") {
      if (exigidos <= 0) piso += maisBarato;
      continue;
    }

    // SOMA: o "a partir de" já contou as escolhas exigidas; as vagas que
    // sobram até o teto do grupo entram só com opção que desconta.
    let vagas = Math.max(1, Number(g.maxQty) || 1) - exigidos;
    for (const i of itens) {
      const preco = Number(i.additionalPrice) || 0;
      if (preco >= 0 || vagas <= 0) break;
      const leva = Math.min(Number(i.maxPerItem) > 0 ? Number(i.maxPerItem) : vagas, vagas);
      piso += preco * leva;
      vagas -= leva;
    }
  }
  return arredondar(piso);
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

/**
 * O "de R$ X" RISCADO deste card, ou null quando não há promoção.
 *
 * Não basta mostrar `precoDe` cru: num combo o card anuncia o MÍNIMO (base +
 * a opção mais barata de cada pergunta obrigatória), e riscar o preço base ao
 * lado de um mínimo que inclui opções compararia dois números diferentes — a
 * loja pareceria estar dando um desconto que não existe, ou escondendo um que
 * existe. O desconto é o mesmo (`precoDe - price`), então o riscado é o mínimo
 * de antes da promoção.
 */
export function precoMinimoAntesDaPromocao(produto: ProdutoComCombo): number | null {
  const agora = Number(produto?.price) || 0;
  const de = Number(produto?.precoDe);
  if (!Number.isFinite(de) || de <= agora) return null;
  return arredondar(precoMinimoDoProduto(produto) + (de - agora));
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}
