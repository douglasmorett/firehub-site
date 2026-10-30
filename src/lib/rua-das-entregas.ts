/**
 * A RUA QUE O MAPA NÃO TEM — o ponto das entregas que a própria loja já fez
 * nela, com ponto de verdade (GPS ou pino do cliente, iFood, posição dada pela
 * loja na roteirização).
 *
 * ── Por que existe (Divinos Burger, Cabo Frio, 30/10/2026) ─────────────────
 *
 * "Todo bairro dele vem escrito VILA no mapa, então o robô não acha nada." A
 * queixa veio pelo aviso "📍 Taxa pelo bairro: o mapa achou o bairro, não a
 * rua do cliente" — 94 pedidos assim em 30 dias. O "Vila" NÃO era a causa: a
 * comparação de bairro já tira o prefixo (`bairroConfere` em lib/geocoding.ts)
 * e o centro da "Vila Monte Alegre" do OSM foi aceito para quem escreveu
 * "Monte alegre". A causa é que o OpenStreetMap não tem as ruas: perguntado em
 * 30/10/2026, o Nominatim não conhece "Rua Moacir dos Santos Moreira", "Rua
 * Isabela", "Rua Francisco Viana" nem "Travessa Andorinha" de Cabo Frio — nem
 * pela busca livre, nem pela estruturada. Sem a rua, sobra o centro do bairro.
 *
 * Quem sabe onde essas ruas ficam é a loja: a mesma Rua Moacir dos Santos
 * Moreira tinha entrega com GPS do robô na véspera, a Rua Isabela e a Rua
 * Francisco Viana também. Com as entregas de ponto de verdade dos últimos 180
 * dias, cerca de metade dos pedidos "pelo bairro" da Divinos teria a rua.
 *
 * Nada é gravado (o dono recusou base que cresce com o uso, 26/09/2026): as
 * entregas são lidas de novo, como a âncora do CEP (lib/ancora-do-cep.ts).
 *
 * ── A regra ────────────────────────────────────────────────────────────────
 *
 * A rua é comparada pelo NOME, sem acento, sem o tipo ("Rua travessa Monte
 * Horebe" = "Monte Horebe"), sem "de/da/do", "Dr" = "Doutor", "um" = "1", e
 * cortado no número da casa ("Rua Marina n°5" = "Marina"). E:
 *
 *   - havendo entregas com o MESMO bairro escrito pelo cliente (sem prefixo,
 *     com erro de digitação: `bairroConfere`), só elas; senão, todas — o
 *     morador troca o nome de bairros vizinhos;
 *   - as entregas usadas a menos de 800 m entre si (o corte da âncora do
 *     CEP): a mesma rua em dois cantos da cidade não é uma rua;
 *   - em lib/geocoding.ts, o ponto tem de ficar perto do centro do bairro que
 *     o cliente escreveu (a régua de sempre, 2,8 km): "Rua Diamante" do Peró,
 *     a 4,95 km, não vira a Travessa Diamante do Monte Alegre. Sem o centro do
 *     bairro, vale com duas entregas ou com o mesmo bairro escrito;
 *   - ponto que não é o centro de um bairro: o pino que o cliente confirma sem
 *     arrastar fica onde o mapa abriu, no centro do bairro (a Rua Isabela da
 *     Divinos tinha um "pino" exatamente no centro da Vila Monte Alegre).
 *
 * O ponto é a mediana das entregas (por eixo), como a âncora do CEP.
 *
 * Teste: scripts/teste-rua-das-entregas.ts.
 */
import { bairroConfere } from "@/lib/geocoding";
import { distanciaKm, type Ponto } from "@/lib/ponto-do-pedido";

/** Entregas da mesma rua mais espalhadas que isto não são uma rua só (o mesmo corte da âncora do CEP). */
export const ESPALHAMENTO_MAXIMO_DA_RUA_KM = 0.8;

/** O pino que ficou a menos disto do centro de um bairro é o pino que ninguém arrastou. */
export const PINO_NO_CENTRO_DO_BAIRRO_KM = 0.03;

export type EntregaComPonto = {
  /** O endereço como o pedido gravou ("Rua Isabela, 12 - Boca do Mato (Casa)"). */
  endereco: string;
  /** O bairro escrito no pedido, se deu para ler (lib/bairro-do-endereco.ts). */
  bairro: string | null;
  ponto: Ponto;
};

export type PontoDaRua = Ponto & {
  /** Quantas entregas da loja deram o ponto. */
  entregas: number;
  /** As entregas escreveram o mesmo bairro que o cliente. */
  mesmoBairro: boolean;
  /** A rua como uma das entregas escreveu (para o texto do resultado). */
  rua: string;
};

/** As entregas de cada rua, pela chave do nome. */
export type RuasDasEntregas = Map<string, EntregaComPonto[]>;

const TIPOS_DE_VIA = new Set([
  "rua", "r", "avenida", "av", "travessa", "tv", "trav", "estrada", "estr", "est", "alameda", "al",
  "beco", "rodovia", "rod", "praca", "pca", "largo", "via", "servidao", "ladeira",
]);
const LIGACOES = new Set(["de", "da", "do", "das", "dos", "d", "e"]);
const SINONIMOS: Record<string, string> = { dr: "doutor", prof: "professor", sto: "santo", sta: "santa", um: "1", dois: "2", tres: "3" };

/**
 * A chave do NOME da rua: "Rua travessa Monte Horebe, 00 - Monte Alegre" →
 * "monte horebe"; "Rua Marina n°5, 5 - Boca do mato" → "marina"; "Rua 13 de
 * Maio, 47" → "13 maio". Vazio quando não sobra nome (menos de 3 letras: "Rua
 * A", "Beco Um" são de toda cidade).
 */
export function chaveDaRua(texto: unknown): string {
  // A rua é o começo do endereço: antes do " - " do bairro e da vírgula do número.
  const comeco = String(texto ?? "")
    .replace(/\([^)]*\)?/g, " ")
    .split(/\s+[-–—]\s+/)[0]
    .split(/[,;]/)[0];
  let p = comeco
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((x) => SINONIMOS[x] ?? x);
  // O tipo da via sai, quantos houver ("Rua travessa ..."), desde que sobre nome.
  while (p.length > 1 && TIPOS_DE_VIA.has(p[0])) p = p.slice(1);
  // O número da casa: "marina n 5", "jopao 1 proximo de zirinho". Número no
  // começo é nome ("13 de maio").
  const corte = p.findIndex((x, i) => i > 0 && (/^\d+$/.test(x) || (x === "n" || x === "no" || x === "nr") && /^\d/.test(p[i + 1] || "")));
  if (corte > 0) p = p.slice(0, corte);
  p = p.filter((x) => !LIGACOES.has(x));
  if (p.join("").replace(/\d/g, "").length < 3) return "";
  return p.join(" ");
}

/**
 * As entregas agrupadas pela rua. `centrosDeBairro`: os pontos que o mapa deu
 * como centro de bairro nos pedidos da loja — o pino que ficou em cima de um
 * deles não foi arrastado e não diz onde a casa fica.
 */
export function ruasDasEntregas(entregas: EntregaComPonto[], centrosDeBairro: Ponto[] = []): RuasDasEntregas {
  const ruas: RuasDasEntregas = new Map();
  for (const e of entregas) {
    if (!e?.ponto || !Number.isFinite(e.ponto.lat) || !Number.isFinite(e.ponto.lng)) continue;
    if (centrosDeBairro.some((c) => distanciaKm(c, e.ponto) <= PINO_NO_CENTRO_DO_BAIRRO_KM)) continue;
    const chave = chaveDaRua(e.endereco);
    if (!chave) continue;
    const lista = ruas.get(chave);
    if (lista) lista.push(e);
    else ruas.set(chave, [e]);
  }
  return ruas;
}

function mediana(valores: number[]): number {
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const temBairro = (b: string | null | undefined) => !!String(b || "").trim();

/**
 * O ponto da rua do cliente pelas entregas da loja, ou null. `ruas`: os jeitos
 * de escrever a rua do cliente (o campo da rua, ou as ruas achadas no texto);
 * vale a primeira que tiver entregas. `bairro`: o que o cliente escreveu.
 */
export function pontoDaRuaNasEntregas(
  ruas: (string | null | undefined)[],
  bairro: string | null | undefined,
  indice: RuasDasEntregas,
): PontoDaRua | null {
  const vistas = new Set<string>();
  for (const r of ruas) {
    const chave = chaveDaRua(r);
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);
    const todas = indice.get(chave);
    if (!todas?.length) continue;
    // As do MESMO bairro escrito, se houver; senão todas — o morador troca o
    // nome de bairros vizinhos ("Monte Alegre" × "Jardim Esperança"), e quem
    // separa a homônima de longe é a régua do centro do bairro, em
    // lib/geocoding.ts.
    const doBairro = temBairro(bairro) ? todas.filter((e) => temBairro(e.bairro) && bairroConfere(bairro, e.bairro)) : [];
    const usadas = doBairro.length ? doBairro : todas;
    const espalhada = usadas.some((a) => usadas.some((b) => distanciaKm(a.ponto, b.ponto) > ESPALHAMENTO_MAXIMO_DA_RUA_KM));
    if (espalhada) continue;
    const nome = String(usadas[usadas.length - 1].endereco).split(/\s+[-–—]\s+|[,;(]/)[0].trim();
    return {
      lat: mediana(usadas.map((e) => e.ponto.lat)),
      lng: mediana(usadas.map((e) => e.ponto.lng)),
      entregas: usadas.length,
      mesmoBairro: doBairro.length > 0,
      rua: nome,
    };
  }
  return null;
}
