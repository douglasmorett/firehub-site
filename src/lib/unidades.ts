/**
 * Conversão entre a unidade que vem escrita na nota fiscal e a unidade em que o
 * lojista cadastrou o insumo.
 *
 * O caso que motivou: o queijo está cadastrado em g e chegou uma nota de 5 kg.
 * Como a entrada somava o número cru da nota, o saldo de 5000 g virava 5005 em
 * vez de 10000, e a ficha técnica passava a dar baixa em cima de um saldo que
 * nunca existiu.
 */

type Familia = "massa" | "volume" | "contagem";

/** Sigla canônica -> família e fator para a unidade base da família (g, ml, un). */
const CANONICAS: Record<string, { familia: Familia; fator: number }> = {
  kg: { familia: "massa", fator: 1000 },
  g: { familia: "massa", fator: 1 },
  l: { familia: "volume", fator: 1000 },
  ml: { familia: "volume", fator: 1 },
  un: { familia: "contagem", fator: 1 },
};

/**
 * A nota é escrita por gente e lida por OCR, então a mesma unidade chega como
 * "KG", "Kg", "quilo", "UNID." ou "Pç". O que não estiver nesta lista (cx, fd,
 * pct, sc) continua como veio de propósito: assim quem chama percebe que não dá
 * para converter sozinho.
 *
 * "pc" ficou de fora justamente por isso: o prompt que lê a nota em
 * api/store/estoque/nfe-scan manda a IA tratar "pc" como pacote, então aceitar
 * "pc" como unidade somava 10 pacotes de pão como se fossem 10 pães — o mesmo
 * erro silencioso que esta lib existe para impedir. "peça" escrito por extenso
 * não tem essa ambiguidade e continua valendo.
 */
const APELIDOS: Record<string, string> = {
  kg: "kg", kgs: "kg", quilo: "kg", quilos: "kg", quilograma: "kg", quilogramas: "kg",
  kilo: "kg", kilos: "kg", kilograma: "kg", kilogramas: "kg",

  g: "g", gr: "g", grs: "g", gs: "g", grama: "g", gramas: "g",

  l: "l", lt: "l", lts: "l", litro: "l", litros: "l",

  ml: "ml", mls: "ml", mililitro: "ml", mililitros: "ml",

  un: "un", uns: "un", und: "un", unds: "un", unid: "un", unids: "un",
  unidade: "un", unidades: "un", peca: "un", pecas: "un",
};

export const UNIDADES_CANONICAS = Object.keys(CANONICAS);

/**
 * Devolve a sigla canônica ("kg", "g", "l", "ml", "un"). Unidade desconhecida
 * volta só limpa (minúscula, sem acento e sem pontuação), porque "cx" e "fd"
 * ainda servem para explicar o problema ao lojista. Vazio quando não sobrou
 * nada legível.
 */
export function normalizarUnidade(bruta: string | null | undefined): string {
  if (bruta === null || bruta === undefined) return "";
  const limpa = String(bruta)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
  if (!limpa) return "";
  return APELIDOS[limpa] || limpa;
}

/** Quanto vale 1 `de` medido em `para`. Null quando não existe relação conhecida. */
export function fatorDeConversao(
  de: string | null | undefined,
  para: string | null | undefined
): number | null {
  const origem = normalizarUnidade(de);
  const destino = normalizarUnidade(para);
  if (!origem || !destino) return null;
  if (origem === destino) return 1;

  const a = CANONICAS[origem];
  const b = CANONICAS[destino];
  if (!a || !b || a.familia !== b.familia) return null;

  return a.fator / b.fator;
}

/** Diz se dá para sair de uma unidade e chegar na outra sem chutar nada. */
export function saoConversiveis(
  de: string | null | undefined,
  para: string | null | undefined
): boolean {
  return fatorDeConversao(de, para) !== null;
}

/**
 * Converte a quantidade de uma unidade para outra. Devolve null quando as duas
 * não se falam (nota em "cx", insumo em "un"): só o lojista sabe quantas
 * unidades vêm na caixa, então quem chama precisa perguntar em vez de adivinhar.
 */
export function converter(
  quantidade: number,
  de: string | null | undefined,
  para: string | null | undefined
): number | null {
  if (!Number.isFinite(quantidade)) return null;

  const fator = fatorDeConversao(de, para);
  if (fator === null) return null;
  if (fator === 1) return quantidade;

  // O toFixed tira o lixo do ponto flutuante: 0,1 kg vezes 1000 dá
  // 100.00000000000001 e o saldo ficava com casas decimais que ninguém digitou.
  return Number((quantidade * fator).toFixed(6));
}
