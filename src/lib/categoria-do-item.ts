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
  for (const [nomeReal, categoria] of mapa) {
    if (nomeReal.length < PREFIXO_MINIMO || nomeReal.length >= chave.length) continue;
    if (!chave.startsWith(nomeReal + " ")) continue;
    if (!melhor || nomeReal.length > melhor.tamanho) melhor = { tamanho: nomeReal.length, categoria };
  }
  return melhor?.categoria ?? null;
}

export type MapaDeCategorias = Map<string, string>;

/**
 * O mapa nome → categoria dos produtos REAIS de uma loja. Espelho fica de fora
 * duas vezes: pela categoria de integração e pelo prefixo do id — porque o
 * espelho do 99Food tem categoria "99Food" mas o do Wabiz pode carregar o nome
 * do grupo, e só o prefixo denuncia esse.
 */
export function montarMapa(produtos: { id?: string | null; name?: string | null; category?: string | null }[]): MapaDeCategorias {
  const mapa: MapaDeCategorias = new Map();
  for (const p of produtos) {
    const id = String(p.id ?? "");
    if (PREFIXOS_DE_ESPELHO.some((pre) => id.startsWith(pre))) continue;
    if (ehCategoriaDeIntegracao(p.category)) continue;
    const categoria = String(p.category ?? "").trim();
    if (!categoria) continue;
    const chave = chaveDoNome(p.name);
    // O primeiro que aparecer vence: dois produtos reais com o mesmo nome em
    // categorias diferentes é ambiguidade da loja, não deste código.
    if (chave && !mapa.has(chave)) mapa.set(chave, categoria);
  }
  return mapa;
}

export type ItemComCategoria = {
  productName?: string | null;
  category?: string | null;
  menuProduct?: { id?: string | null; name?: string | null; category?: string | null } | null;
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
function ehItemDeEspelho(item: ItemComCategoria): boolean {
  const id = String(item?.menuProduct?.id ?? "");
  if (id && PREFIXOS_DE_ESPELHO.some((pre) => id.startsWith(pre))) return true;
  return ehCategoriaDeIntegracao(item?.menuProduct?.category ?? item?.category);
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
  // O nome do dia (productName) vem antes do nome do espelho: é o que o
  // parceiro mandou neste pedido, e é o que bate com o cadastro da loja.
  const nomes = [item?.productName, item?.menuProduct?.name];
  for (const n of nomes) {
    const chave = chaveDoNome(n);
    if (chave && mapa.has(chave)) return mapa.get(chave)!;
  }
  // Nome exato não existe: o real como início do nome do item.
  for (const n of nomes) {
    const chave = chaveDoNome(n);
    const categoria = chave ? porPrefixo(chave, mapa) : null;
    if (categoria) return categoria;
  }
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
      select: { id: true, name: true, category: true },
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
