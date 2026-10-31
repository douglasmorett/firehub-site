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

// ── O CENTRO DO BAIRRO PELAS ENTREGAS DA LOJA ─────────────────────────────
//
// Duga Burguer, Rio das Ostras, 30/10/2026: o pedido 42 do Jota Já veio sem
// coordenada, "Rua 29, qd 46 ... Extensão Serramar". "Rua 29" é de vários
// bairros e o OSM não tem o Extensão Serramar: o pino foi para o dicionário de
// bairros (lib/geocodificacao.ts), que punha o bairro 1,7 km a leste, em cima
// do Recanto — "tá dando no Recanto, sendo que é Serramar". A loja tinha 73
// entregas com ponto de verdade (iFood/GPS) no Extensão do Serramar; a mediana
// delas fica no bairro. Onde os clientes do bairro moram vale mais que o
// centro que o mapa (ou o dicionário) chuta.

/** Entregas do bairro que dão o centro dele: menos que isto é palpite. */
export const MINIMO_DE_ENTREGAS_NO_BAIRRO = 3;

/** A entrega a mais que isto da mediana é de outro canto (bairro com nome repetido, endereço trocado). */
export const RAIO_DO_BAIRRO_NAS_ENTREGAS_KM = 2;

const PREFIXO_DE_BAIRRO = new Set(["bairro", "vila", "vl", "jardim", "jd", "parque", "pq", "residencial", "res", "conjunto", "loteamento", "condominio"]);

/** "Extensão do Serramar" e "Extensao Serramar" → "extensao serramar"; "Vila Monte Alegre" → "monte alegre". */
export function chaveDoBairro(bairro: unknown): string {
  let p = String(bairro ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((x) => x && !LIGACOES.has(x));
  while (p.length > 1 && PREFIXO_DE_BAIRRO.has(p[0])) p = p.slice(1);
  return p.join(" ");
}

export type CentroDoBairro = Ponto & { entregas: number };

/**
 * O centro do bairro escrito pelo cliente, pela mediana das entregas da loja
 * nele, ou null. Vale o MESMO nome (sem acento, "do", "Vila"); sem entregas
 * suficientes com o mesmo nome, as de nome parecido (`bairroConfere`). As
 * entregas longe da mediana saem, e o que sobra tem de ser a maioria.
 */
export function centroDoBairroNasEntregas(
  bairro: string | null | undefined,
  entregas: EntregaComPonto[],
): CentroDoBairro | null {
  const chave = chaveDoBairro(bairro);
  if (!chave) return null;
  const comBairro = entregas.filter((e) => temBairro(e.bairro));
  let usadas = comBairro.filter((e) => chaveDoBairro(e.bairro) === chave);
  if (usadas.length < MINIMO_DE_ENTREGAS_NO_BAIRRO) usadas = comBairro.filter((e) => bairroConfere(bairro, e.bairro));
  if (usadas.length < MINIMO_DE_ENTREGAS_NO_BAIRRO) return null;
  const meio = { lat: mediana(usadas.map((e) => e.ponto.lat)), lng: mediana(usadas.map((e) => e.ponto.lng)) };
  const perto = usadas.filter((e) => distanciaKm(meio, e.ponto) <= RAIO_DO_BAIRRO_NAS_ENTREGAS_KM);
  if (perto.length < MINIMO_DE_ENTREGAS_NO_BAIRRO || perto.length * 2 < usadas.length) return null;
  return {
    lat: mediana(perto.map((e) => e.ponto.lat)),
    lng: mediana(perto.map((e) => e.ponto.lng)),
    entregas: perto.length,
  };
}
