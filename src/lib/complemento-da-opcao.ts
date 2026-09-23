/**
 * A BORDA QUE VEM DENTRO DA PIZZA — qual complemento real uma opção do pedido é.
 *
 * ── O problema ──────────────────────────────────────────────────────────────
 *
 * Em 23/09/2026 a NIK Esfihas e Pizzas quis saber quantas bordas vendeu no
 * iFood e quantas no 99. Marcou a categoria "Bordas" no relatório e viu zero.
 * Não era filtro errado: em 60 dias, NENHUMA borda foi item de pedido. A borda
 * é sempre uma OPÇÃO escolhida dentro da pizza (`comboSelections`), e o
 * relatório só contava itens.
 *
 * E cada canal escreve a mesma borda de um jeito:
 *
 *   cadastro da loja     "Borda de Catupiry"                  (categoria Bordas)
 *   balcão / site        "Borda de Catupiry"
 *   iFood                "Massa Tradicional + Borda Catupiry"  (+R$ 14,00)
 *   Wabiz                "Borda Catupiry Original"             (+R$ 12,00)
 *
 * ── Como casa ───────────────────────────────────────────────────────────────
 *
 * Só COMPLEMENTO é candidato — o produto que existe para ser escolhido dentro
 * de outro (lib/cardapio-interno.ts, `idsSoDeOpcaoDeCombo`): borda, adicional,
 * sabor de meia pizza. A esfiha dentro do combo e a Coca do combo são produtos
 * vendáveis e continuam contando só pelo item, como sempre contaram.
 *
 * O nome da opção é partido no "+" (o iFood junta massa e borda numa opção só)
 * e cada pedaço tenta, nesta ordem:
 *
 *   1. o nome igual ao de um complemento (sem acento, caixa, pontuação);
 *   2. TODAS as palavras de um complemento de 2+ palavras dentro do pedaço —
 *      "Borda Catupiry Original" contém "borda" e "catupiry" de "Borda de
 *      Catupiry". Vence o de mais palavras; empate entre categorias diferentes
 *      não casa (melhor não contar do que contar na categoria errada);
 *   3. a PRIMEIRA palavra, quando todos os complementos de uma categoria
 *      começam com ela — "Borda Cream Cheese" cai em Bordas mesmo com o
 *      cadastro escrito "Borda de Cream Chesse". Conta na categoria, com o nome
 *      que o canal mandou.
 *
 * "Sem borda" não casa com nada: não tem as palavras de nenhuma borda e não
 * começa com "borda". É o comportamento certo.
 *
 * Só leitura, função pura, sem banco: o pedido gravado não muda.
 */

import { chaveDoNome } from "@/lib/categoria-do-item";

export type Complemento = {
  id: string;
  nome: string;
  categoria: string;
  custo: number;
};

export type MapaDeComplementos = {
  porNome: Map<string, Complemento>;
  comPalavras: { complemento: Complemento; palavras: string[] }[];
  /** Primeira palavra → a ÚNICA categoria cujos complementos todos começam com ela. */
  porPrimeiraPalavra: Map<string, string>;
};

/** Palavras que não distinguem uma borda da outra. "Sem" NÃO entra: "sem borda" é outra coisa. */
const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "com", "e", "a", "o", "em", "na", "no"]);

function palavrasDe(nome: unknown): string[] {
  return chaveDoNome(nome)
    .split(" ")
    .filter((p) => p && !PALAVRAS_VAZIAS.has(p));
}

/** "Massa Tradicional + Borda Catupiry" → ["Massa Tradicional", "Borda Catupiry"]; "1/2 X" → "X". */
function pedacosDaOpcao(nome: unknown): string[] {
  return String(nome ?? "")
    .split(/\s*[+|]\s*/)
    .map((p) => p.replace(/^\s*\d+\s*\/\s*\d+\s*/, "").trim())
    .filter(Boolean);
}

export function montarMapaDeComplementos(complementos: Complemento[]): MapaDeComplementos {
  const porNome = new Map<string, Complemento>();
  const comPalavras: MapaDeComplementos["comPalavras"] = [];
  const primeirasPorCategoria = new Map<string, Set<string>>();
  const contagemPorCategoria = new Map<string, number>();

  for (const c of complementos) {
    if (!c.categoria) continue;
    const chave = chaveDoNome(c.nome);
    if (chave && !porNome.has(chave)) porNome.set(chave, c);
    const palavras = palavrasDe(c.nome);
    if (palavras.length >= 2) comPalavras.push({ complemento: c, palavras });
    if (palavras.length > 0) {
      const set = primeirasPorCategoria.get(c.categoria) || new Set<string>();
      set.add(palavras[0]);
      primeirasPorCategoria.set(c.categoria, set);
      contagemPorCategoria.set(c.categoria, (contagemPorCategoria.get(c.categoria) || 0) + 1);
    }
  }

  // A primeira palavra só vale quando a categoria INTEIRA começa com ela
  // (todas as bordas começam com "borda"), com pelo menos dois complementos, e
  // quando nenhuma outra categoria reivindica a mesma palavra.
  const candidatas = new Map<string, string[]>();
  for (const [categoria, primeiras] of primeirasPorCategoria) {
    if (primeiras.size !== 1 || (contagemPorCategoria.get(categoria) || 0) < 2) continue;
    const palavra = Array.from(primeiras)[0];
    if (palavra.length < 4) continue;
    candidatas.set(palavra, [...(candidatas.get(palavra) || []), categoria]);
  }
  const porPrimeiraPalavra = new Map<string, string>();
  for (const [palavra, categorias] of candidatas) {
    if (categorias.length === 1) porPrimeiraPalavra.set(palavra, categorias[0]);
  }

  return { porNome, comPalavras, porPrimeiraPalavra };
}

export type ComplementoCasado = {
  /** O complemento do cadastro, ou null quando só a CATEGORIA foi reconhecida (regra 3). */
  id: string | null;
  nome: string;
  categoria: string;
  custo: number;
};

function casarPedaco(pedaco: string, mapa: MapaDeComplementos): ComplementoCasado | null {
  const exato = mapa.porNome.get(chaveDoNome(pedaco));
  if (exato) return { id: exato.id, nome: exato.nome, categoria: exato.categoria, custo: exato.custo };

  const palavras = palavrasDe(pedaco);
  if (palavras.length === 0) return null;
  const doPedaco = new Set(palavras);

  let melhores: Complemento[] = [];
  let tamanho = 0;
  for (const { complemento, palavras: dele } of mapa.comPalavras) {
    if (!dele.every((p) => doPedaco.has(p))) continue;
    if (dele.length > tamanho) { melhores = [complemento]; tamanho = dele.length; }
    else if (dele.length === tamanho) melhores.push(complemento);
  }
  if (melhores.length > 0) {
    const categorias = new Set(melhores.map((c) => c.categoria));
    if (categorias.size > 1) return null; // ambíguo entre categorias: não conta
    if (melhores.length === 1) {
      const c = melhores[0];
      return { id: c.id, nome: c.nome, categoria: c.categoria, custo: c.custo };
    }
    // Dois complementos da MESMA categoria empatados: a categoria é certa, o
    // produto não — conta na categoria com o nome que o canal mandou.
    return { id: null, nome: pedaco, categoria: melhores[0].categoria, custo: 0 };
  }

  const pelaPrimeira = mapa.porPrimeiraPalavra.get(palavras[0]);
  if (pelaPrimeira) return { id: null, nome: pedaco, categoria: pelaPrimeira, custo: 0 };
  return null;
}

/**
 * Os complementos que esta opção representa: nenhum (a opção é sabor de
 * esfiha, massa, bebida do combo…), um, ou mais de um ("Borda X + Adicional Y").
 */
export function complementosDaOpcao(nomeDaOpcao: unknown, mapa: MapaDeComplementos): ComplementoCasado[] {
  const casados: ComplementoCasado[] = [];
  for (const pedaco of pedacosDaOpcao(nomeDaOpcao)) {
    const c = casarPedaco(pedaco, mapa);
    if (c) casados.push(c);
  }
  return casados;
}
