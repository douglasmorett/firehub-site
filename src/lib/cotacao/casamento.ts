/**
 * CASAR O NOME QUE O FORNECEDOR ESCREVEU COM O PRODUTO DA LOJA. Puro.
 *
 * Cada fornecedor escreve do seu jeito: "QJO MUSS PEÇA KG", "Queijo
 * mussarela", "mussarela peça". O comparativo só funciona se os três forem o
 * mesmo produto da loja. A regra:
 *   1. apelido aprendido (o lojista já confirmou esse nome uma vez) = certeza;
 *   2. senão, semelhança por palavras e por pedaços de letras, com as
 *      abreviações de atacado abertas ("qjo" → queijo, "refri" → refrigerante);
 *   3. só é CERTO quando o melhor é bem parecido E longe do segundo — "Coca
 *      lata" e "Coca 2L" são parecidos demais um com o outro para a máquina
 *      decidir sozinha; aí vira sugestão e o lojista confirma.
 */

export type ProdutoParaCasar = { id: string; nome: string; apelidos?: string[] };
export type Casamento = { produtoId: string; confianca: number; certo: boolean } | null;

/** Acima disto, e com folga sobre o segundo, casa sozinho. */
export const CONFIANCA_PARA_CASAR = 0.82;
/** Abaixo disto nem vira sugestão. */
export const CONFIANCA_PARA_SUGERIR = 0.45;
const FOLGA_SOBRE_O_SEGUNDO = 0.08;

const ABREVIACOES: Record<string, string> = {
  qjo: "queijo", qj: "queijo", queij: "queijo",
  mus: "mussarela", muss: "mussarela", mucarela: "mussarela", muzarela: "mussarela", mozarela: "mussarela", mussarel: "mussarela", mozzarella: "mussarela",
  refri: "refrigerante", refrig: "refrigerante", ref: "refrigerante",
  presunt: "presunto", pres: "presunto",
  calab: "calabresa", calabr: "calabresa",
  frg: "frango", fgo: "frango",
  cx: "caixa", pct: "pacote", pc: "pacote", fd: "fardo", sc: "saco", bd: "bandeja", gf: "garrafa",
  lt: "lata", oleo: "oleo", azeit: "azeite", tom: "tomate", cebol: "cebola", bat: "batata",
  mol: "molho", farinh: "farinha", acuc: "acucar", ext: "extrato", requeij: "requeijao", req: "requeijao",
};
const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "com", "c", "e", "tipo", "para", "p", "em", "a", "o"]);

/** Minúsculo, sem acento e pontuação, com as abreviações abertas e sem palavras vazias. */
export function normalizarNome(s: string): string {
  return palavras(s).join(" ");
}

function palavras(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    // "2L", "350ml", "1kg" ficam juntos; "c/" e "-" viram espaço.
    .replace(/[^a-z0-9,.]+/g, " ")
    .replace(/(\d)[,.](\d)/g, "$1x$2").replace(/[,.]/g, " ").replace(/(\d)x(\d)/g, "$1,$2")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => ABREVIACOES[p] || p)
    .filter((p) => !PALAVRAS_VAZIAS.has(p));
}

function bigramas(s: string): string[] {
  const t = s.replace(/\s+/g, " ");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Dice dos pedaços de duas letras: pega erro de digitação ("muçarela" × "mussarela"). */
function dice(a: string, b: string): number {
  const A = bigramas(a), B = bigramas(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  const conta = new Map<string, number>();
  for (const x of A) conta.set(x, (conta.get(x) || 0) + 1);
  let inter = 0;
  for (const x of B) { const n = conta.get(x) || 0; if (n > 0) { inter++; conta.set(x, n - 1); } }
  return (2 * inter) / (A.length + B.length);
}

const mesmaPalavra = (x: string, y: string) =>
  x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) || (x.length >= 5 && y.length >= 5 && dice(x, y) >= 0.75);

/**
 * 0 a 1. As palavras do produto da loja que aparecem no nome lido pesam mais
 * (o fornecedor escreve a mais: marca, embalagem); número diferente derruba —
 * "Coca 2L" não é "Coca 350ml".
 */
export function semelhanca(lido: string, produto: string): number {
  const A = palavras(lido), B = palavras(produto);
  if (!A.length || !B.length) return 0;
  if (A.join(" ") === B.join(" ")) return 1;
  const cobreProduto = B.filter((b) => A.some((a) => mesmaPalavra(a, b))).length / B.length;
  const cobreLido = A.filter((a) => B.some((b) => mesmaPalavra(a, b))).length / A.length;
  const porPalavra = 0.7 * cobreProduto + 0.3 * cobreLido;
  const porLetra = dice(A.join(" "), B.join(" "));
  let nota = Math.max(porPalavra, porLetra * 0.95);
  const numA = A.filter((p) => /\d/.test(p)), numB = B.filter((p) => /\d/.test(p));
  if (numA.length && numB.length && !numB.some((n) => numA.includes(n))) nota *= 0.6;
  return Math.round(nota * 1000) / 1000;
}

/** O produto da loja para o nome lido, com a confiança. Nulo = nada parecido. */
export function casarProduto(nomeLido: string, produtos: ProdutoParaCasar[]): Casamento {
  const alvo = normalizarNome(nomeLido);
  if (!alvo) return null;
  for (const p of produtos) {
    if ((p.apelidos || []).some((a) => normalizarNome(a) === alvo)) return { produtoId: p.id, confianca: 1, certo: true };
  }
  const notas = produtos
    .map((p) => ({ id: p.id, n: Math.max(semelhanca(nomeLido, p.nome), ...(p.apelidos || []).map((a) => semelhanca(nomeLido, a))) }))
    .sort((a, b) => b.n - a.n);
  const [melhor, segundo] = notas;
  if (!melhor || melhor.n < CONFIANCA_PARA_SUGERIR) return null;
  const folga = melhor.n - (segundo?.n ?? 0);
  return { produtoId: melhor.id, confianca: melhor.n, certo: melhor.n >= CONFIANCA_PARA_CASAR && folga >= FOLGA_SOBRE_O_SEGUNDO };
}
