/**
 * A categoria REAL de um item que veio de plataforma (iFood, 99Food, Brendi…).
 *
 * ── O problema ──────────────────────────────────────────────────────────────
 *
 * O item de um pedido do iFood aponta para um produto ESPELHO (`ifood-<id>`),
 * criado na hora do primeiro pedido com `category: "iFood"`. Isso é correto
 * para o cardápio interno — o espelho não é cardápio e é escondido por isso —
 * mas é veneno para tudo que separa por categoria: a tela de pizza do KDS
 * filtra por "Pizzas Tradicionais", o item chega como "iFood", não casa, some.
 *
 * Aconteceu na NIK Esfihas e Pizzas em 16/09/2026, no segundo dia de uso: os
 * 54 espelhos de iFood da loja tinham categoria "iFood". Na tela "produção
 * pizza", filtrada por categoria, NENHUM pedido de iFood aparecia — nem
 * pizza nem esfiha —, e a tela "produção esfirra", aberta sem filtro, mostrava
 * tudo, pizza inclusive. A loja leu como "pizza não sai no KDS", "a tela de
 * finalização não mostra pizza" e "o iFood demora para entrar" — três queixas,
 * uma causa. O filtro da tela até tinha uma exceção para "item sem categoria
 * (pedidos iFood)", mas "iFood" É uma categoria, então ela nunca disparava.
 *
 * ── A solução ───────────────────────────────────────────────────────────────
 *
 * A loja quase sempre tem o produto de verdade cadastrado, com a categoria
 * certa — o cardápio dela foi importado do próprio iFood. Então o item do
 * espelho é casado pelo NOME com o produto real da mesma loja, e herda a
 * categoria dele. Na NIK, 43 dos 54 espelhos casam assim (esfihas, bebidas,
 * combos de esfiha).
 *
 * Quem não casa — os combos promocionais do iFood, cujo nome vem enfeitado
 * ("PIZZA TRADICIONAL + GUARANÁ MINEIRO 1,5L 2 SABORES (8 PEDAÇOS)") — fica
 * SEM categoria, que é o estado que a tela do KDS já trata como "aparece em
 * toda tela filtrada". Aparecer a mais é o custo certo: item invisível na
 * cozinha é pedido que não sai.
 *
 * Só o nome; nunca o preço, nunca o id. O item continua apontando para o
 * espelho — isto é leitura, e o pedido gravado não muda.
 */

import { prisma } from "@/lib/prisma";
import { CATEGORIAS_DE_INTEGRACAO, PREFIXOS_DE_ESPELHO } from "@/lib/cardapio-interno";

/**
 * As categorias que marcam espelho de plataforma. A lista do cardápio interno
 * mais as duas que ele ainda não conhece (Brendi e Wabiz criam espelho com o
 * próprio nome como categoria).
 */
const DE_INTEGRACAO = new Set([...CATEGORIAS_DE_INTEGRACAO, "BRENDI", "WABIZ"].map((c) => c.toUpperCase()));

export function ehCategoriaDeIntegracao(categoria: unknown): boolean {
  const c = String(categoria ?? "").trim().toUpperCase();
  return c !== "" && DE_INTEGRACAO.has(c);
}

/**
 * "Esfiha Carne e Bacon" ≡ "ESFIHA CARNE E BACON" ≡ "esfiha  carne-e-bacon".
 *
 * O PREÇO sai do nome antes de comparar. O iFood põe o valor no nome da
 * promoção ("6 Esfihas Tradicionais + Guaraná Mineiro 1,5l por R$59,90") e
 * ele muda a cada campanha: na NIK o cadastro dizia "por R$49,90" e o pedido
 * chegava "por R$59,90" — mesmo produto, e não casava por três dígitos.
 */
export function chaveDoNome(nome: unknown): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bpor\s*r\$?\s*[\d.,]+/g, " ")
    .replace(/r\$\s*[\d.,]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Prefixo mais curto que aceito casar: abaixo disso é palavra solta, não nome. */
const PREFIXO_MINIMO = 15;

/**
 * A categoria do produto real cujo nome é o INÍCIO do nome do item.
 *
 * O iFood enfeita o nome da promoção com o que o cliente escolheu: o cadastro
 * diz "Pizza Tradicional + Guaraná Mineiro 1,5L" e o pedido chega "PIZZA
 * TRADICIONAL + GUARANÁ MINEIRO 1,5L 2 SABORES (8 PEDAÇOS)". Vale o real mais
 * LONGO que for prefixo de palavra inteira do item — o mais específico — e só
 * a partir de 15 caracteres, para "esfiha" sozinho não puxar categoria.
 */
function porPrefixo(chave: string, mapa: MapaDeCategorias): string | null {
  let melhor: { tamanho: number; categoria: string } | null = null;
  for (const [nomeReal, categoria] of mapa.porNome) {
    if (nomeReal.length < PREFIXO_MINIMO || nomeReal.length >= chave.length) continue;
    if (!chave.startsWith(nomeReal + " ")) continue;
    if (!melhor || nomeReal.length > melhor.tamanho) melhor = { tamanho: nomeReal.length, categoria };
  }
  return melhor?.categoria ?? null;
}

/**
 * O cardápio REAL da loja, dos dois jeitos que esta lib precisa consultar:
 *
 *   porNome    — nome normalizado → categoria. Só o PRIMEIRO produto de cada
 *                nome entra (dois produtos reais com o mesmo nome em
 *                categorias diferentes é ambiguidade da loja, não daqui).
 *   categorias — TODAS as categorias do cardápio, normalizadas.
 *
 * Os dois existem porque não dá para derivar um do outro. `porNome.values()`
 * traz só a categoria do primeiro produto de cada nome — e foi exatamente
 * assim que o pedido #3 da NIK se perdeu: a categoria dele existe no cardápio
 * (no produto "Pizza Tradicional + Guaraná Mineiro 1,5L"), mas outro produto
 * de mesmo nome entrou antes no mapa e essa categoria nunca apareceu nos
 * valores. Perguntar "esta categoria é da loja?" para `values()` respondia
 * não, e a categoria certa era jogada fora.
 */
export type MapaDeCategorias = {
  porNome: Map<string, string>;
  categorias: Set<string>;
};

/**
 * O cardápio real de uma loja. Espelho fica de fora duas vezes: pela categoria
 * de integração e pelo prefixo do id — porque o espelho do 99Food tem
 * categoria "99Food" mas o do Wabiz pode carregar o nome do grupo, e só o
 * prefixo denuncia esse.
 */
export function montarMapa(
  produtos: { id?: string | null; name?: string | null; category?: string | null; active?: boolean | null }[],
): MapaDeCategorias {
  const porNome = new Map<string, string>();
  const categorias = new Set<string>();
  for (const p of produtos) {
    const id = String(p.id ?? "");
    // O prefixo condena o espelho que NINGUÉM ADOTOU — `active` false. Produto
    // ativo com id de espelho não é espelho: é o cardápio da loja, importado
    // com ids que nasceram de um pedido (Pastelaria da Paulista, ver
    // lib/cardapio-interno.ts). Sem esta ressalva, numa loja assim o mapa sai
    // VAZIO: nenhuma categoria é reconhecida como da loja, nenhum nome casa, e
    // todo item de plataforma vira "sem categoria" — a cozinha inteira volta a
    // ver tudo em todas as telas.
    if (p.active !== true && PREFIXOS_DE_ESPELHO.some((pre) => id.startsWith(pre))) continue;
    if (ehCategoriaDeIntegracao(p.category)) continue;
    const categoria = String(p.category ?? "").trim();
    if (!categoria) continue;
    categorias.add(categoria.toLowerCase());
    const chave = chaveDoNome(p.name);
    if (chave && !porNome.has(chave)) porNome.set(chave, categoria);
  }
  return { porNome, categorias };
}

export type ItemComCategoria = {
  productName?: string | null;
  category?: string | null;
  /** O que o cliente escolheu dentro do combo — ver `porOpcaoDoCombo`. */
  comboSelections?: unknown;
  // `active` é o que separa o espelho que ninguém adotou do cardápio que
  // nasceu de um espelho (ver ehItemDeEspelho).
  menuProduct?: { id?: string | null; active?: boolean | null; name?: string | null; category?: string | null } | null;
};

/**
 * Este item aponta para um ESPELHO de plataforma?
 *
 * Duas provas, e a do id é a que importa: o espelho do iFood e do 99Food se
 * denuncia pela categoria ("iFood", "99Food"), mas o da Wabiz carrega o NOME
 * DO GRUPO dela como categoria — "Esfihas", "Bebidas", "Sachês" — que é texto
 * comum e não denuncia nada. Só o prefixo do id (`wabiz-`) denuncia esse.
 *
 * `montarMapa` já sabia disso desde o começo; `categoriaResolvida` não, e era
 * exatamente aí que a NIK perdia pedido (ver o comentário da função abaixo).
 */
/** Esta categoria é uma categoria DE VERDADE desta loja? */
function ehCategoriaDaLoja(categoria: string, mapa: MapaDeCategorias): boolean {
  return mapa.categorias.has(categoria.toLowerCase().trim());
}

function ehItemDeEspelho(item: ItemComCategoria): boolean {
  const id = String(item?.menuProduct?.id ?? "");
  // A MESMA ressalva de `montarMapa` e de lib/cardapio-interno.ts: o id diz
  // como o registro NASCEU, não o que ele é hoje, e o cardápio importado
  // reaproveita ids `ifood-`. Só o produto ATIVO escapa do prefixo — quem não
  // trouxer `active` no select segue tratado como espelho, que é o lado que
  // não perde pedido.
  if (id && item?.menuProduct?.active !== true && PREFIXOS_DE_ESPELHO.some((pre) => id.startsWith(pre))) return true;
  return ehCategoriaDeIntegracao(item?.menuProduct?.category ?? item?.category);
}

/**
 * Os pedaços de um nome composto, sem a fração.
 *
 * "1/2 Costela com Catupiry + 1/2 Frango Catupiry" → ["Costela com Catupiry",
 * "Frango Catupiry"]. É como a Wabiz escreve meia a meia, e como o iFood
 * escreve promoção ("Pizza + Guaraná").
 *
 * A fração sai de onde estiver, não só do começo: desde 24/09/2026 a Wabiz
 * chega "Pizza 1/2 Calabresa + 1/2 Muçarela" (lib/wabiz-traducao.ts,
 * ehPizzaSemTipoNoNome), e o primeiro pedaço é "Pizza Calabresa".
 */
function pedacosDoNome(nome: unknown): string[] {
  return String(nome ?? "")
    .split(/\s*[+|]\s*/)
    .map((p) => p.replace(/(^|\s)\d+\s*\/\s*\d+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * A categoria de uma pizza que o parceiro mandou só com o SABOR.
 *
 * ── O item que nenhuma regra acima alcança ──────────────────────────────────
 *
 * A Wabiz manda "1/2 Costela com Catupiry + 1/2 Frango Catupiry" e guarda as
 * metades DENTRO do nome — não há `comboSelections` para ler. O cardápio da
 * loja, por sua vez, chama o produto de "Pizza Costela com Catupiry": o tipo
 * vem na frente do sabor. Então nada casa, e o item cai em curinga — aparece
 * em toda tela, que foi a queixa da pizza na tela das esfihas.
 *
 * O tipo que falta está na CATEGORIA DO ESPELHO, que é o nome do grupo no
 * cardápio do parceiro: "Pizzas Grande" → "pizza". Com ele na frente, o sabor
 * vira o nome que a loja cadastrou e o casamento acontece.
 *
 * Só a primeira palavra do grupo, no singular, e só como PREFIXO de um nome
 * que já tem que casar inteiro. É estreito de propósito: casar "Costela com
 * Catupiry" por semelhança acharia a ESFIHA de costela e mandaria a pizza para
 * a tela das esfihas — o erro que esta função existe para evitar.
 */
function porTipoDoGrupo(item: ItemComCategoria, mapa: MapaDeCategorias): string | null {
  const grupo = String(item?.menuProduct?.category ?? "").trim();
  if (!grupo || ehCategoriaDeIntegracao(grupo)) return null;
  const tipo = chaveDoNome(grupo).split(" ")[0]?.replace(/s$/, "");
  if (!tipo || tipo.length < 4) return null;

  const votos = new Map<string, number>();
  const ordem: string[] = [];
  for (const pedaco of pedacosDoNome(item?.productName ?? item?.menuProduct?.name)) {
    // O pedaço que já traz o tipo ("Pizza Calabresa") não ganha outro na frente.
    const doPedaco = chaveDoNome(pedaco);
    const chave = doPedaco.startsWith(`${tipo} `) ? doPedaco : chaveDoNome(`${tipo} ${pedaco}`);
    const categoria = chave ? mapa.porNome.get(chave) : undefined;
    if (!categoria) continue;
    if (!votos.has(categoria)) ordem.push(categoria);
    votos.set(categoria, (votos.get(categoria) ?? 0) + 1);
  }
  if (votos.size === 0) return null;
  let melhor = ordem[0];
  for (const c of ordem) if ((votos.get(c) ?? 0) > (votos.get(melhor) ?? 0)) melhor = c;
  return melhor;
}

/**
 * A categoria pelo que o cliente ESCOLHEU dentro do combo.
 *
 * ── A pizza que apareceu na tela das esfihas ────────────────────────────────
 *
 * O nome do combo do iFood não é nome de produto: "GRANDE 2 SABORES (8
 * PEDAÇOS)". Não casa com nada do cardápio, e o item caía em "" — que aparece
 * em TODA tela. Na NIK, 22/09/2026 19:11, era uma pizza na tela "Produção
 * Esfiha", filtrada só por esfiha. Sem categoria não é neutro: é curinga.
 *
 * Mas as opções dizem exatamente o que é: "1/2 Moda do Chefe", "1/2
 * Portuguesa" — e esses são produtos REAIS da loja, com categoria de verdade.
 *
 * VENCE A MAIS FREQUENTE. Uma pizza meio a meio traz também a borda e a massa,
 * e "Borda Tradicional" casaria com a categoria "Bordas": ficar com a primeira
 * opção que casa mandaria a pizza para a tela das bordas. Duas metades contra
 * uma borda resolvem isso sozinhas.
 *
 * A fração sai do nome antes de comparar ("1/2 Moda do Chefe" → "Moda do
 * Chefe"): é como o parceiro escreve meia pizza, e o cadastro não tem isso.
 */
function porOpcaoDoCombo(item: ItemComCategoria, mapa: MapaDeCategorias): string | null {
  const bruto = item?.comboSelections;
  if (!bruto) return null;
  let selecoes: unknown;
  try {
    selecoes = typeof bruto === "string" ? JSON.parse(bruto) : bruto;
  } catch {
    return null;
  }
  if (!Array.isArray(selecoes)) return null;

  const votos = new Map<string, number>();
  const ordem: string[] = [];
  for (const s of selecoes) {
    const nomeBruto = String((s as any)?.name ?? (s as any)?.nome ?? "").replace(/^\s*\d+\s*\/\s*\d+\s*/, "");
    const chave = chaveDoNome(nomeBruto);
    if (!chave) continue;
    const categoria = mapa.porNome.get(chave) ?? porPrefixo(chave, mapa);
    if (!categoria) continue;
    if (!votos.has(categoria)) ordem.push(categoria);
    votos.set(categoria, (votos.get(categoria) ?? 0) + 1);
  }
  if (votos.size === 0) return null;
  // Empate fica com a que apareceu primeiro — a ordem das opções é a ordem em
  // que o cliente montou o item, e o principal vem antes do adicional.
  let melhor = ordem[0];
  for (const categoria of ordem) {
    if ((votos.get(categoria) ?? 0) > (votos.get(melhor) ?? 0)) melhor = categoria;
  }
  return melhor;
}

/**
 * A categoria que este item deve ter para quem separa por categoria.
 *
 *   - item de produto real → a categoria dele, intocada;
 *   - item de espelho com nome casado → a categoria do produto real;
 *   - item de espelho sem casamento → "" (sem categoria: aparece em toda tela).
 *
 * ── PEDIDO DA WABIZ QUE NÃO CHEGOU NA COZINHA ─────────────────────────────
 *
 * NIK Esfihas, pedido #2 da Wabiz em 22/09/2026 (ref 3672): três esfihas,
 * gravadas, impressas — e invisíveis nas duas telas do KDS. O espelho da Wabiz
 * nasce com `category` = o nome do grupo DELA ("Esfihas"), e a NIK filtra as
 * telas por "Esfihas Tradicionais", "Esfihas Doces", "Esfihas Especiais".
 * "Esfihas" não casa com nenhuma, e a tela esconde pedido sem item seu.
 *
 * A regra de cima só reescrevia quando a categoria ERA de integração, então
 * "Esfihas" passava batido e ia inteira para o filtro. Agora quem decide é o
 * id do espelho: `wabiz-...` é espelho, venha a categoria que vier, e o nome
 * ("Esfiha Calabresa") acha a categoria real da loja. Sem casar ninguém,
 * devolve "" — que aparece em TODA tela. Comida parada é mais cara que
 * carimbo adiantado.
 */
export function categoriaResolvida(item: ItemComCategoria, mapa: MapaDeCategorias): string {
  const atual = String(item?.menuProduct?.category ?? item?.category ?? "").trim();
  if (!ehItemDeEspelho(item)) return atual;

  // ── A CATEGORIA DO ESPELHO VALE QUANDO ELA É DA LOJA ────────────────────
  //
  // O grupo da Wabiz às vezes se chama exatamente como uma categoria do
  // cardápio, porque a loja batizou os dois igual. Aí ela manda: foi a loja
  // que escolheu, e nenhum casamento por nome sabe mais do que isso.
  //
  // Medido nos dois pedidos da NIK, e é o que separa um do outro:
  //   #3  "Pizza Tradicional + Guaraná... (Segunda a Quinta)" → 1 produto real
  //       tem essa categoria. É da loja: fica. (Casar por nome levaria "Bauru"
  //       para "Sabores de Pizza", que NÃO está no filtro da tela de pizza —
  //       o pedido sumiria, que é o oposto do que esta correção quer.)
  //   #2  "Esfihas" → NENHUM produto real tem essa categoria. É nome de grupo
  //       da Wabiz: cai fora, e o nome acha "Esfihas Tradicionais".
  //
  // Espelho de iFood/99Food nunca entra aqui: a categoria dele é o nome da
  // plataforma, que `ehCategoriaDeIntegracao` barra.
  if (atual && !ehCategoriaDeIntegracao(atual) && ehCategoriaDaLoja(atual, mapa)) return atual;
  // O nome do dia (productName) vem antes do nome do espelho: é o que o
  // parceiro mandou neste pedido, e é o que bate com o cadastro da loja.
  const nomes = [item?.productName, item?.menuProduct?.name];
  for (const n of nomes) {
    const chave = chaveDoNome(n);
    if (chave && mapa.porNome.has(chave)) return mapa.porNome.get(chave)!;
  }
  // Nome exato não existe: o real como início do nome do item.
  for (const n of nomes) {
    const chave = chaveDoNome(n);
    const categoria = chave ? porPrefixo(chave, mapa) : null;
    if (categoria) return categoria;
  }
  // O nome do combo não diz nada ("GRANDE 2 SABORES"), mas o que foi escolhido
  // dentro dele diz. É a última chance antes do curinga.
  const pelaOpcao = porOpcaoDoCombo(item, mapa);
  if (pelaOpcao) return pelaOpcao;
  // Nem opção o item tem: o sabor está no próprio nome e o tipo, na categoria
  // do grupo do parceiro. É a última tentativa antes do curinga.
  const peloTipo = porTipoDoGrupo(item, mapa);
  if (peloTipo) return peloTipo;
  return "";
}

/**
 * Reescreve, em memória, a categoria dos itens de espelho de uma lista de
 * pedidos — um mapa por loja, montado uma vez por chamada.
 *
 * É leitura para a TELA: o banco não é tocado.
 */
export async function resolverCategoriasDosPedidos<
  T extends { franchiseeId?: string | null; items?: ItemComCategoria[] | null },
>(pedidos: T[]): Promise<T[]> {
  // `ehItemDeEspelho` e não `ehCategoriaDeIntegracao`: o espelho da Wabiz traz
  // o nome do grupo dela como categoria, e por esta porta o pedido inteiro
  // saía sem ser resolvido — era o que sumia da cozinha da NIK.
  const precisa = pedidos.filter((p) => (p.items || []).some(ehItemDeEspelho));
  if (precisa.length === 0) return pedidos;

  const lojas = Array.from(new Set(precisa.map((p) => p.franchiseeId).filter(Boolean))) as string[];
  const mapas = new Map<string, MapaDeCategorias>();
  for (const lojaId of lojas) {
    const produtos = await prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId },
      select: { id: true, name: true, category: true, active: true },
    });
    mapas.set(lojaId, montarMapa(produtos));
  }

  return pedidos.map((p) => {
    const mapa = p.franchiseeId ? mapas.get(p.franchiseeId) : undefined;
    if (!mapa) return p;
    return {
      ...p,
      items: (p.items || []).map((i) => {
        if (!ehItemDeEspelho(i)) return i;
        const categoria = categoriaResolvida(i, mapa);
        return { ...i, menuProduct: { ...(i.menuProduct || {}), category: categoria } };
      }),
    };
  });
}
