/**
 * Mapa de prospecção — a VARREDURA COMPLETA da cidade (regras puras, sem banco
 * e sem rede; o servidor e o navegador usam).
 *
 * Douglas, 18/10/2026: "em todas as cidades não é para cortar nenhum
 * restaurante". O Nearby Search (New) devolve no máximo 20 lugares por
 * chamada e não tem página seguinte. Então a caixa da cidade vira uma GRADE:
 *
 *   1. Células-raiz de até LADO_DA_RAIZ_M de lado cobrem a caixa.
 *   2. Cada célula é 1 chamada: o círculo que passa pelos 4 cantos (o Nearby
 *      só aceita círculo), com todos os TIPOS_DE_COMIDA.
 *   3. Voltou o máximo (20) = célula CHEIA: pode ter mais. Divide em 4 e busca
 *      de novo — até nenhuma vir cheia.
 *   4. No tamanho mínimo (LADO_MINIMO_M) ainda cheia (praça de alimentação,
 *      rua de bares): mesma área, os tipos divididos em grupos; grupo cheio →
 *      um tipo por chamada; um tipo só e ainda cheio = SATURADA (a cobertura
 *      fica "quase completa", com o motivo na tela).
 *   5. Lugar repetido entre células (os círculos se sobrepõem) junta pelo id.
 *
 * A filha tem metade do raio e o centro a meio raio do centro da mãe: o
 * círculo da filha fica dentro do da mãe (nada some ao dividir).
 */

import { diaDaCotaDoGoogle, metrosEntre, parecencaDosNomes, type CaixaDaCidade } from "./regras";

/** O máximo do Nearby Search (New) por chamada (maxResultCount: 1 a 20). */
export const MAXIMO_POR_CHAMADA = 20;
export const LADO_DA_RAIZ_M = 6000;
export const LADO_MINIMO_M = 150;
export const PROFUNDIDADE_MAXIMA = 7;
/** Só contra laço infinito (o custo é travado pelo teto do dia e do mês, abaixo): nenhuma cidade passa disto. */
export const TETO_DE_CHAMADAS_POR_CIDADE = 20000;
export const MAXIMO_DE_RAIZES = 600;
/** Quantas células o navegador busca por vez antes de voltar ao servidor. */
export const TAMANHO_DO_LOTE = 8;
/**
 * O cache da cidade vale 30 dias. Termos do Google (Places API, "Caching"):
 * o place_id pode ficar sem prazo; lat/lng, até 30 dias seguidos; nome,
 * endereço, tipo e o resto NÃO ficam no banco (ver paraGuardar).
 */
export const DIAS_DO_CACHE = 30;

/**
 * Os tipos de comida da Tabela A do Places (New) — o includedTypes aceita até
 * 50. Fonte: developers.google.com/maps/documentation/places/web-service/place-types
 * (Food and Drink, conferido em 18/10/2026). "food" é Tabela B: não filtra.
 * O lugar casa se QUALQUER tipo dele estiver na lista (pizzaria também é "restaurant").
 */
export const TIPOS_DE_COMIDA = [
  "restaurant", "meal_takeaway", "meal_delivery", "fast_food_restaurant", "snack_bar",
  "pizza_restaurant", "pizza_delivery", "hamburger_restaurant", "brazilian_restaurant", "sandwich_shop",
  "bakery", "cafe", "coffee_shop", "cafeteria", "ice_cream_shop",
  "acai_shop", "juice_shop", "dessert_shop", "confectionery", "cake_shop",
  "pastry_shop", "bar", "bar_and_grill", "pub", "sports_bar",
  "barbecue_restaurant", "steak_house", "japanese_restaurant", "sushi_restaurant", "chinese_restaurant",
  "italian_restaurant", "middle_eastern_restaurant", "lebanese_restaurant", "seafood_restaurant", "buffet_restaurant",
  "family_restaurant", "chicken_restaurant", "chicken_wings_restaurant", "hot_dog_restaurant", "hot_dog_stand",
  "food_court", "diner", "deli", "mexican_restaurant", "vegetarian_restaurant",
  "vegan_restaurant", "breakfast_restaurant", "salad_shop", "kebab_shop", "fine_dining_restaurant",
] as const;

/** Os grupos da divisão por tipo (5 grupos de 10, na ordem da lista). */
export const GRUPOS_DE_TIPOS: string[][] = Array.from({ length: 5 }, (_, i) => TIPOS_DE_COMIDA.slice(i * 10, i * 10 + 10));

export type Celula = {
  id: string;
  s: number; o: number; n: number; l: number;
  nivel: number;
  /** Sem tipos = todos os TIPOS_DE_COMIDA. */
  tipos?: string[];
};

export type Ponto = { lat: number; lng: number };


export function centroDaCelula(c: Celula): Ponto {
  return { lat: (c.s + c.n) / 2, lng: (c.o + c.l) / 2 };
}

/** O círculo que passa pelos 4 cantos da célula (o Nearby só aceita círculo, até 50 km). */
export function circuloDaCelula(c: Celula): { centro: Ponto; raio: number } {
  const centro = centroDaCelula(c);
  const raio = metrosEntre(centro, { lat: c.n, lng: c.l });
  return { centro, raio: Math.min(Math.max(raio, 1), 50000) };
}

/** O lado MENOR da célula, em metros. */
export function ladoDaCelula(c: Celula): number {
  const meio = (c.s + c.n) / 2;
  const largura = metrosEntre({ lat: meio, lng: c.o }, { lat: meio, lng: c.l });
  const altura = metrosEntre({ lat: c.s, lng: c.o }, { lat: c.n, lng: c.o });
  return Math.min(largura, altura);
}

/** As células-raiz: a caixa dividida em pedaços de até LADO_DA_RAIZ_M (cidade enorme: pedaços maiores). */
export function celulasRaiz(caixa: CaixaDaCidade): Celula[] {
  const meio = (caixa.sul + caixa.norte) / 2;
  const largura = metrosEntre({ lat: meio, lng: caixa.oeste }, { lat: meio, lng: caixa.leste });
  const altura = metrosEntre({ lat: caixa.sul, lng: caixa.oeste }, { lat: caixa.norte, lng: caixa.oeste });
  let lado = LADO_DA_RAIZ_M;
  let nx = Math.max(1, Math.ceil(largura / lado));
  let ny = Math.max(1, Math.ceil(altura / lado));
  while (nx * ny > MAXIMO_DE_RAIZES) {
    lado *= 1.25;
    nx = Math.max(1, Math.ceil(largura / lado));
    ny = Math.max(1, Math.ceil(altura / lado));
  }
  const dLat = (caixa.norte - caixa.sul) / ny;
  const dLng = (caixa.leste - caixa.oeste) / nx;
  const saida: Celula[] = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      saida.push({
        id: `r${y * nx + x}`,
        s: caixa.sul + y * dLat, n: caixa.sul + (y + 1) * dLat,
        o: caixa.oeste + x * dLng, l: caixa.oeste + (x + 1) * dLng,
        nivel: 0,
      });
    }
  }
  return saida;
}

/**
 * O que fazer com a célula que voltou CHEIA: 4 filhas (enquanto cabe no
 * tamanho mínimo e na profundidade); depois, a mesma área por grupos de tipo;
 * depois, um tipo por vez. `null` = saturada (um tipo só, no mínimo, e cheia).
 */
export function filhasDaCelula(c: Celula): Celula[] | null {
  if (!c.tipos && c.nivel < PROFUNDIDADE_MAXIMA && ladoDaCelula(c) / 2 >= LADO_MINIMO_M) {
    const mLat = (c.s + c.n) / 2;
    const mLng = (c.o + c.l) / 2;
    return [
      { id: `${c.id}.0`, s: c.s, n: mLat, o: c.o, l: mLng, nivel: c.nivel + 1 },
      { id: `${c.id}.1`, s: c.s, n: mLat, o: mLng, l: c.l, nivel: c.nivel + 1 },
      { id: `${c.id}.2`, s: mLat, n: c.n, o: c.o, l: mLng, nivel: c.nivel + 1 },
      { id: `${c.id}.3`, s: mLat, n: c.n, o: mLng, l: c.l, nivel: c.nivel + 1 },
    ];
  }
  const area = { s: c.s, n: c.n, o: c.o, l: c.l, nivel: c.nivel };
  if (!c.tipos) return GRUPOS_DE_TIPOS.map((tipos, i) => ({ ...area, id: `${c.id}~g${i}`, tipos }));
  if (c.tipos.length > 1) return c.tipos.map((t) => ({ ...area, id: `${c.id}~${t}`, tipos: [t] }));
  return null;
}

export const celulaCheia = (bruto: number) => bruto >= MAXIMO_POR_CHAMADA;

export type RespostaDaCelula = { celulaId: string; bruto: number };

/**
 * Junta as respostas do lote: a cheia vira filhas (no começo da fila — termina
 * um bairro antes de ir para o outro), a saturada conta, e a célula do lote
 * que não voltou (erro do Google) volta para a fila.
 */
export function aplicarRespostas(
  pendentes: Celula[],
  lote: Celula[],
  respostas: RespostaDaCelula[],
): { pendentes: Celula[]; saturadas: Celula[]; respondidas: number } {
  const porId = new Map(respostas.map((r) => [r.celulaId, r.bruto]));
  const filhas: Celula[] = [];
  const devolvidas: Celula[] = [];
  const saturadas: Celula[] = [];
  let respondidas = 0;
  for (const c of lote) {
    const bruto = porId.get(c.id);
    if (bruto === undefined) { devolvidas.push(c); continue; }
    respondidas++;
    if (!celulaCheia(bruto)) continue;
    const f = filhasDaCelula(c);
    if (f) filhas.push(...f);
    else saturadas.push(c);
  }
  return { pendentes: [...devolvidas, ...filhas, ...pendentes], saturadas, respondidas };
}

/** As próximas células a buscar, até `limite` (o que sobra do grátis do mês, se o admin não liberou). */
export function escolherLote(pendentes: Celula[], limite: number, tamanho = TAMANHO_DO_LOTE): { lote: Celula[]; pendentes: Celula[] } {
  const n = Math.max(0, Math.min(tamanho, Math.floor(limite), pendentes.length));
  return { lote: pendentes.slice(0, n), pendentes: pendentes.slice(n) };
}

// ── Os lugares ──────────────────────────────────────────────────────────────

export type LugarDoMapa = {
  id: string;
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  tipo: string | null;
  mapsUrl: string | null;
  origem: "google" | "osm";
  /** Só do OpenStreetMap (o do Google vem pelo botão do cartão). */
  telefone?: string | null;
  /** Google que o OpenStreetMap também tem. */
  tambemNoOsm?: boolean;
  /** Google: o nome do OpenStreetMap do mesmo lugar (licença ODbL; pode ficar no banco). */
  nomeOsm?: string | null;
  /** Google: a loja do FireHub que é este lugar (casada na hora da varredura; é dado nosso). */
  lojaId?: string | null;
};

/**
 * O que do lugar pode ir para o banco. Do Google, só o place_id e o ponto
 * (30 dias): nome, endereço, tipo e link ficam só na memória do navegador.
 * Do OpenStreetMap, tudo (ODbL, com a atribuição na tela).
 */
export function paraGuardar(l: LugarDoMapa): LugarDoMapa {
  if (l.origem === "osm") return l;
  return { id: l.id, nome: "", endereco: "", lat: l.lat, lng: l.lng, tipo: null, mapsUrl: null, origem: "google", lojaId: l.lojaId ?? null };
}

/** Junta sem repetir: o mesmo id fica uma vez só (o último dado vence). */
export function juntarLugares<T extends { id: string }>(antes: Iterable<T>, novos: Iterable<T>): Map<string, T> {
  const m = new Map<string, T>();
  for (const l of antes) m.set(l.id, l);
  for (const l of novos) m.set(l.id, l);
  return m;
}

/** O lugar que veio do Google (objeto Place do Maps JS ou JSON) → o nosso. Fechado de vez fica de fora. */
export function lugarDoGoogle(p: any): LugarDoMapa | null {
  if (!p?.id || p.businessStatus === "CLOSED_PERMANENTLY") return null;
  const lat = typeof p.location?.lat === "function" ? p.location.lat() : Number(p.location?.lat ?? p.location?.latitude);
  const lng = typeof p.location?.lng === "function" ? p.location.lng() : Number(p.location?.lng ?? p.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const nome = typeof p.displayName === "string" ? p.displayName : p.displayName?.text;
  return {
    id: String(p.id), nome: String(nome || "Sem nome").slice(0, 200), endereco: String(p.formattedAddress || "").slice(0, 300),
    lat, lng, tipo: p.primaryType ? String(p.primaryType).slice(0, 60) : null,
    mapsUrl: p.googleMapsURI || p.googleMapsUri || null, origem: "google",
  };
}

// ── OpenStreetMap (complemento grátis) ─────────────────────────────────────

export const AMENIDADES_DO_OSM = ["restaurant", "fast_food", "cafe", "bar", "ice_cream", "food_court"] as const;

/** A consulta do Overpass para a caixa (sul, oeste, norte, leste). */
export function consultaDoOverpass(c: CaixaDaCidade): string {
  return `[out:json][timeout:60];nwr["amenity"~"^(${AMENIDADES_DO_OSM.join("|")})$"](${c.sul},${c.oeste},${c.norte},${c.leste});out center tags;`;
}

const TIPO_DO_OSM: Record<string, string> = {
  restaurant: "restaurant", fast_food: "fast_food_restaurant", cafe: "cafe", bar: "bar", ice_cream: "ice_cream_shop", food_court: "food_court",
};

/** A resposta do Overpass → lugares (id "osm-node-123"). Sem ponto fica de fora; sem nome, entra como "Sem nome". */
export function lerRespostaDoOverpass(d: any): LugarDoMapa[] {
  const saida: LugarDoMapa[] = [];
  for (const e of Array.isArray(d?.elements) ? d.elements : []) {
    const lat = Number(e?.lat ?? e?.center?.lat);
    const lng = Number(e?.lon ?? e?.center?.lon);
    if (!e?.type || !Number.isFinite(Number(e.id)) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const t = e.tags || {};
    const rua = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
    saida.push({
      id: `osm-${e.type}-${e.id}`,
      nome: String(t.name || t.brand || "Sem nome").slice(0, 200),
      endereco: [rua, t["addr:suburb"]].filter(Boolean).join(" - ").slice(0, 300),
      lat, lng,
      tipo: TIPO_DO_OSM[String(t.amenity)] || null,
      mapsUrl: null,
      origem: "osm",
      telefone: String(t.phone || t["contact:phone"] || t["contact:whatsapp"] || "").slice(0, 60) || null,
    });
  }
  return saida;
}

/**
 * O que o OpenStreetMap tem e o Google não trouxe. Casa com nome parecido a
 * até 150 m; o sem nome casa com qualquer lugar do Google a até 30 m.
 * Devolve os só-do-OSM e os ids do Google que o OSM também tem.
 */
export function cruzarComOsm(google: LugarDoMapa[], osm: LugarDoMapa[]): { soNoOsm: LugarDoMapa[]; tambemNoOsm: Set<string> } {
  // Índice por quadrado de ~0,002° (~220 m): só compara com os vizinhos.
  const Q = 0.002;
  const chave = (lat: number, lng: number) => `${Math.floor(lat / Q)}:${Math.floor(lng / Q)}`;
  const indice = new Map<string, LugarDoMapa[]>();
  for (const g of google) {
    const k = chave(g.lat, g.lng);
    (indice.get(k) || indice.set(k, []).get(k)!).push(g);
  }
  const soNoOsm: LugarDoMapa[] = [];
  const tambemNoOsm = new Set<string>();
  for (const o of osm) {
    const semNome = o.nome === "Sem nome";
    const by = Math.floor(o.lat / Q), bx = Math.floor(o.lng / Q);
    let par: LugarDoMapa | null = null;
    for (let dy = -1; dy <= 1 && !par; dy++) {
      for (let dx = -1; dx <= 1 && !par; dx++) {
        for (const g of indice.get(`${by + dy}:${bx + dx}`) || []) {
          const m = metrosEntre(o, g);
          if (semNome ? m <= 30 : m <= 150 && parecencaDosNomes(o.nome, g.nome) >= 0.5) { par = g; break; }
        }
      }
    }
    if (par) tambemNoOsm.add(par.id);
    else soNoOsm.push(o);
  }
  return { soNoOsm, tambemNoOsm };
}

// ── Estimativa e custo ──────────────────────────────────────────────────────

/**
 * A estimativa antes de varrer. Quantos lugares a cidade deve ter: 1 para cada
 * HABITANTES_POR_LUGAR (a população vem do Nominatim, grátis); sem população,
 * o OpenStreetMap vezes FATOR_GOOGLE_POR_OSM (o OSM do Brasil tem pouco: Rio
 * das Ostras 77, Goiânia 455 em 18/10/2026). Chutes a calibrar com as
 * primeiras cidades — o admin vê "1 lugar para cada X habitantes" depois.
 *
 * Chamadas por lugar: a grade rodada sobre cidades simuladas (scripts/
 * teste-varredura.ts) gastou de 0,25 a 0,42 por lugar — mais quanto mais
 * apertados os restaurantes. CHAMADAS_POR_LUGAR fica perto do alto.
 */
export const HABITANTES_POR_LUGAR = 150;
export const FATOR_GOOGLE_POR_OSM = 10;
export const CHAMADAS_POR_LUGAR = 0.35;

export function lugaresEsperados(populacao: number | null, lugaresNoOsm: number): number | null {
  if (populacao && populacao > 0) return Math.round(populacao / HABITANTES_POR_LUGAR);
  if (lugaresNoOsm > 0) return lugaresNoOsm * FATOR_GOOGLE_POR_OSM;
  return null;
}

/** Quantas chamadas a cidade deve gastar (as raízes + as divisões). `null` = sem base para estimar. */
export function estimarChamadas(caixa: CaixaDaCidade, populacao: number | null, lugaresNoOsm: number): number | null {
  const esperados = lugaresEsperados(populacao, lugaresNoOsm);
  if (esperados == null) return null;
  return Math.min(TETO_DE_CHAMADAS_POR_CIDADE, celulasRaiz(caixa).length + Math.ceil(esperados * CHAMADAS_POR_LUGAR));
}

/** Quantos dias a varredura leva na velocidade do teto do dia. */
export function diasDaVarredura(chamadas: number): number {
  return Math.max(1, Math.ceil(chamadas / VARREDURA_POR_DIA));
}

// ── Custo zero: o teto do dia e do mês por SKU ─────────────────────────────

/**
 * O SKU de cada chamada e o grátis do mês.
 * Fonte: developers.google.com/maps/billing-and-pricing/pricing (18/10/2026).
 * Douglas, 18/10/2026: "não quero pagar nada" — ninguém passa do grátis, nem o admin.
 */
export const SKUS = {
  nearby: { nome: "Nearby Search Pro", uso: "varredura da cidade e nomes dos pinos", gratis: 5000, cota: "SearchNearbyRequest" },
  texto: { nome: "Text Search Pro", uso: "\"buscar também\" por termo", gratis: 5000, cota: "SearchTextRequest" },
  detalhes: { nome: "Place Details Pro", uso: "nome do pino que a busca por perto não trouxe", gratis: 5000, cota: "GetPlaceRequest" },
  contato: { nome: "Place Details Enterprise", uso: "telefone e site do cartão", gratis: 1000, cota: "GetPlaceRequest" },
  mapa: { nome: "Dynamic Maps", uso: "cada vez que o mapa abre", gratis: 10000, cota: "Map loads" },
} as const;
export type Sku = keyof typeof SKUS;

/**
 * As travas por DIA no Google Cloud (projeto gen-lang-client-0505076953). A
 * quota do Cloud é por MÉTODO, não por SKU (developers.google.com/maps/documentation/
 * places/web-service/usage-and-billing: "per API method per project"): o
 * GetPlaceRequest é um só para o nome (Pro) e o telefone (Enterprise), então
 * tem de caber no grátis do mais caro — 32 × 31 = 992 < 1.000.
 * Regra: trava do dia × 31 < grátis do mês do SKU mais caro que o método alcança.
 */
export const TRAVAS_DO_CLOUD = {
  SearchNearbyRequest: { porDia: 160, skus: ["nearby"] },
  SearchTextRequest: { porDia: 160, skus: ["texto"] },
  GetPlaceRequest: { porDia: 32, skus: ["detalhes", "contato"] },
  "Map loads": { porDia: 300, skus: ["mapa"] },
} as const satisfies Record<string, { porDia: number; skus: readonly Sku[] }>;
export type CotaDoCloud = keyof typeof TRAVAS_DO_CLOUD;

/** O app para um pouco antes da trava do Cloud (a tela avisa em vez do erro do Google). */
export const MARGEM_DO_DIA = 0.97;
export const limiteDoDia = (cota: CotaDoCloud) => Math.floor(TRAVAS_DO_CLOUD[cota].porDia * MARGEM_DO_DIA);
/** Paramos 2% antes do grátis do mês. */
export const MARGEM_DO_GRATIS = 0.02;
export const tetoDoMes = (sku: Sku) => Math.floor(SKUS[sku].gratis * (1 - MARGEM_DO_GRATIS));
/** Do Nearby do dia, isto fica para os nomes dos pinos (a varredura não usa). */
export const RESERVA_DE_NOMES_POR_DIA = 40;
/** A velocidade da varredura: o que o dia deixa, fora a reserva dos nomes. */
export const VARREDURA_POR_DIA = limiteDoDia("SearchNearbyRequest") - RESERVA_DE_NOMES_POR_DIA;

export type UsoDoGoogle = { dia: string; mes: string; hoje: Record<Sku, number>; noMes: Record<Sku, number> };

/**
 * Douglas, 18/10/2026: fechar Macaé e Rio das Ostras no mesmo dia. A trava do
 * Nearby no Cloud subiu SÓ nesse dia (dia do Pacífico); o mês continua no teto
 * do grátis. No dia seguinte vale de novo a trava de cima, sem deploy.
 */
export const DIA_COM_TRAVA_MAIOR = { dia: "2026-10-18", cota: "SearchNearbyRequest", porDia: 1400 } as const;
const limiteDoDiaDoUso = (cota: CotaDoCloud, uso: UsoDoGoogle) =>
  uso.dia === DIA_COM_TRAVA_MAIOR.dia && cota === DIA_COM_TRAVA_MAIOR.cota
    ? Math.floor(DIA_COM_TRAVA_MAIOR.porDia * MARGEM_DO_DIA)
    : limiteDoDia(cota);

/** Quanto ainda dá para usar do SKU agora: o menor entre o que sobra no dia (da quota do Cloud) e no mês. */
export function vagas(uso: UsoDoGoogle, sku: Sku): { qtd: number; trava: "dia" | "mes" } {
  const cota = SKUS[sku].cota as CotaDoCloud;
  const hojeNaCota = (TRAVAS_DO_CLOUD[cota].skus as readonly Sku[]).reduce((t, k) => t + (uso.hoje[k] || 0), 0);
  const dia = Math.max(0, limiteDoDiaDoUso(cota, uso) - hojeNaCota);
  const mes = Math.max(0, tetoDoMes(sku) - (uso.noMes[sku] || 0));
  return dia <= mes ? { qtd: dia, trava: "dia" } : { qtd: mes, trava: "mes" };
}

/** Quantas buscas a varredura ainda pode fazer agora (fora a reserva dos nomes). */
export function vagasDaVarredura(uso: UsoDoGoogle): { qtd: number; trava: "dia" | "mes" } {
  const dia = Math.max(0, limiteDoDiaDoUso("SearchNearbyRequest", uso) - RESERVA_DE_NOMES_POR_DIA - (uso.hoje.nearby || 0));
  const mes = Math.max(0, tetoDoMes("nearby") - (uso.noMes.nearby || 0));
  return dia <= mes ? { qtd: dia, trava: "dia" } : { qtd: mes, trava: "mes" };
}

/** O mês da conta do Google (o faturamento é na hora do Pacífico), "AAAA-MM". */
export function mesDaCotaDoGoogle(agora = new Date()): string {
  return diaDaCotaDoGoogle(agora).slice(0, 7);
}

/** Quando a varredura pausada volta: amanhã (trava do dia) ou no dia 1º do mês seguinte (grátis do mês), "AAAA-MM-DD" do Pacífico. */
export function quandoContinua(trava: "dia" | "mes", agora = new Date()): string {
  const [a, m, d] = diaDaCotaDoGoogle(agora).split("-").map(Number);
  const dt = trava === "dia" ? new Date(Date.UTC(a, m - 1, d + 1)) : new Date(Date.UTC(a, m, 1));
  return dt.toISOString().slice(0, 10);
}

// ── Os nomes sob demanda ────────────────────────────────────────────────────

/**
 * O nome do lugar do Google não fica no banco: é buscado na hora, para o que o
 * vendedor está vendo, e fica só na memória do navegador. O jeito barato é o
 * Nearby por DISTÂNCIA em volta de um pino: 1 busca traz os 20 lugares mais
 * perto, com nome — muito menos que um Place Details por pino, e fora do
 * GetPlaceRequest, que é do telefone.
 *
 * Como temos o ponto de TODOS os lugares (`todos`), dá para prever quem cada
 * busca traz: os 20 mais perto do centro. O plano escolhe, entre os alvos sem
 * nome, o centro que cobre mais alvos, fecha o raio no 20º mais perto, e repete.
 */
export function planoDeNomes(alvos: (Ponto & { id: string })[], todos: (Ponto & { id: string })[], maximo: number): { centro: Ponto; raio: number; cobre: string[] }[] {
  let falta = [...alvos];
  const plano: { centro: Ponto; raio: number; cobre: string[] }[] = [];
  const universo = todos.length ? todos : alvos;
  while (falta.length && plano.length < maximo) {
    let melhor: { centro: Ponto; raio: number; cobre: string[] } | null = null;
    for (const t of falta.slice(0, 30)) {
      const perto = universo.map((p) => ({ id: p.id, m: metrosEntre(t, p) })).sort((a, b) => a.m - b.m).slice(0, MAXIMO_POR_CHAMADA);
      const ids = new Set(perto.map((x) => x.id));
      const cobre = falta.filter((p) => ids.has(p.id) || p.id === t.id).map((p) => p.id);
      const raio = Math.min(2000, Math.max(30, Math.ceil((perto[perto.length - 1]?.m ?? 0) + 5)));
      if (!melhor || cobre.length > melhor.cobre.length) melhor = { centro: { lat: t.lat, lng: t.lng }, raio, cobre };
    }
    plano.push(melhor!);
    const cobertos = new Set(melhor!.cobre);
    falta = falta.filter((p) => !cobertos.has(p.id));
  }
  return plano;
}

// ── O selo da cobertura ─────────────────────────────────────────────────────

export type EstadoDaVarredura = "nova" | "varrendo" | "pausada" | "completa";
export type MotivoDaPausa = "trava_do_dia" | "gratis_do_mes" | "google" | "interrompida" | "teto_da_cidade" | null;

export type ResumoDaVarredura = {
  estado: EstadoDaVarredura;
  motivo: MotivoDaPausa;
  detalhe: string | null;
  chamadas: number;
  estimativa: number | null;
  pendentes: number;
  saturadas: Ponto[];
  iniciadaEm: string | null;
  varridaEm: string | null;
  lugares: number;
  osm: number;
  populacao: number | null;
  /** Outra pessoa está varrendo agora (a tela dela segura o lote). */
  ocupadaPorOutro: boolean;
  faltamEstimadas: number;
  /** De 0 a 100: buscas feitas ÷ (feitas + as que faltam). */
  percentual: number;
  /** Quantas buscas a varredura ainda pode fazer agora (dia e mês). */
  vagasAgora: number;
  /** Pausada pela trava: o dia em que volta, "AAAA-MM-DD". */
  continuaEm: string | null;
};

/** Quanto ainda falta gastar: pelo menos o que está na fila; a estimativa, se for maior. */
export function faltamEstimadas(r: { estado: EstadoDaVarredura; chamadas: number; estimativa: number | null; pendentes: number }): number {
  if (r.estado === "completa") return 0;
  return Math.max(r.pendentes, (r.estimativa ?? 0) - r.chamadas, r.estado === "nova" ? 1 : 0);
}

export function percentualDaVarredura(chamadas: number, faltam: number, completa: boolean): number {
  if (completa) return 100;
  return Math.min(99, Math.floor((chamadas / Math.max(1, chamadas + faltam)) * 100));
}

const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function seloDaCobertura(
  r: Pick<ResumoDaVarredura, "estado" | "motivo" | "detalhe" | "saturadas" | "pendentes" | "chamadas" | "faltamEstimadas" | "percentual" | "continuaEm">,
  agora = new Date(),
): { tipo: "completa" | "parcial" | "andamento" | "nenhuma"; texto: string } {
  if (r.estado === "nova") return { tipo: "nenhuma", texto: "Cidade ainda não varrida" };
  if (r.estado === "varrendo") return { tipo: "andamento", texto: `Varrendo: ${r.percentual}% · ${r.chamadas} buscas feitas, ${r.pendentes} na fila` };
  if (r.estado === "completa") {
    if (!r.saturadas.length) return { tipo: "completa", texto: "Cobertura completa" };
    return {
      tipo: "parcial",
      texto: `Quase completa: ${r.saturadas.length} ${r.saturadas.length === 1 ? "ponto tem" : "pontos têm"} mais de 20 lugares do mesmo tipo no mesmo quarteirão (praça de alimentação, rua de bares) — ali pode faltar algum`,
    };
  }
  const feita = `Varrida ${r.percentual}%`;
  const amanha = quandoContinua("dia", agora);
  switch (r.motivo) {
    case "trava_do_dia":
    case "gratis_do_mes": {
      const quando = r.continuaEm && r.continuaEm !== amanha ? `em ${diaMes(r.continuaEm)}` : "amanhã";
      const porque = r.motivo === "gratis_do_mes" ? "o grátis do mês do Google acabou" : "a busca grátis de hoje acabou";
      return { tipo: "parcial", texto: `${feita} · continua ${quando} (${porque}; sem custo). O que já veio está no mapa` };
    }
    case "google":
      return { tipo: "parcial", texto: `${feita} · o Google parou a varredura${r.detalhe ? ` (${r.detalhe})` : ""}. Continua amanhã` };
    case "teto_da_cidade":
      return { tipo: "parcial", texto: `${feita} · a cidade bateu o limite de ${TETO_DE_CHAMADAS_POR_CIDADE} buscas (proteção contra laço)` };
    default:
      return { tipo: "parcial", texto: `${feita} · parou no meio (a tela foi fechada). Continua quando alguém abrir a cidade` };
  }
}
