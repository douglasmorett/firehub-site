import {
  rotaEntre,
  medicaoDaLoja,
  fatorDeDesvio,
  estimarPelaLinhaReta,
  DESLOCAMENTO_SUSPEITO_M,
} from "@/lib/distancia-por-rota";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { nomeDeRuaParecido } from "@/lib/geocodificacao";
import type { MedidaDaDistancia, OrigemDoPonto } from "@/lib/cotacao-de-entrega";
import type { ResultadoDoGoogle } from "@/lib/geocodificacao-google";

// Calcula a distância exata em linha reta (KM) usando a fórmula Haversine
// Alinhado 100% com os círculos de raio desenhados no mapa Leaflet de configurações da loja
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return Math.round(linhaRetaKm(lat1, lon1, lat2, lon2) * 100) / 100;
}

/**
 * A linha reta SEM arredondar. É ela que entra na distância ESTIMADA (reta ×
 * fator): arredondar a reta antes e multiplicar depois arredondava duas vezes
 * — 0,7375 km virava 0,74, × 1,36 = 1,0064 → 1,01 km, e o cliente de 1,00 km
 * (R$ 5) caía na faixa de 1,5 km (R$ 8, repasse R$ 7). Visto no teste de ponta
 * a ponta de 25/09/2026 com o roteador fora (R5: arredondar uma vez só).
 */
export function linhaRetaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Raio da Terra em KM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Distância exata em linha reta geométrica
  return R * c;
}

export type Ponto = { lat: number; lng: number };

export type DeliveryZoneCheckResult = {
  addressFound: boolean;
  searchedQuery?: string;
  matchedAddress?: string;
  distanceKm?: number;
  maxRadiusKm?: number;
  isWithinRadius?: boolean;
  deliveryFee?: number;
  estimatedTimeMin?: number;
  reason?: string;
  /**
   * "endereco" = o mapa achou o número (ou o cliente mandou a coordenada);
   * "rua" = achou a rua, não o número; "bairro" = só o centro do bairro, ou
   * outra rua do mesmo pedaço da cidade.
   */
  precisao?: "endereco" | "rua" | "bairro";
  /** A distância veio das RUAS (roteamento), não da linha reta. */
  medidaPorRota?: boolean;
  /** A linha reta, sempre — serve para a tela explicar a diferença. */
  distanciaEmLinhaRetaKm?: number;
  /** Onde o mapa colocou o cliente. É o que a área de risco consulta. */
  clienteLat?: number;
  clienteLng?: number;

  // ── 25/09/2026: o que a cotação e o pedido gravam ──────────────────────
  /** De onde veio o ponto do cliente. */
  origemDoPonto?: OrigemDoPonto;
  /** Pelas ruas, estimada (roteador fora: reta × fator da loja) ou em linha reta. */
  medida?: MedidaDaDistancia;
  /** O fator usado quando a medida é "estimada". */
  fatorDeDesvio?: number;
  /** Por que a distância é estimada (o roteador disse o quê). */
  motivoDaEstimativa?: string;
  /** Km da faixa que decidiu a taxa. */
  faixaKm?: number;
  /** Quanto o roteador arrastou o ponto do cliente até a rua, em metros. */
  deslocamentoAteARuaM?: number | null;
  /**
   * O ponto veio do TEXTO e não é confiável o bastante para cobrar sem o
   * cliente confirmar no mapa (R3). Nunca é true com coordenada do cliente.
   */
  pedeConfirmacao?: boolean;
  /** Os porquês, em português, para o log e a nota do pedido. */
  motivosDaConfirmacao?: string[];
  /**
   * Por que não achou: o mapa não conhece ("nao-achado"), acabou o tempo da
   * cotação ("prazo"), o mapa não respondeu — fila cheia, 429, 5xx, rede
   * ("indisponivel") — ou quem pergunta passou do teto de buscas ("limite").
   * Só o primeiro é "o endereço não existe no mapa".
   */
  motivoDaFalha?: "nao-achado" | "prazo" | "indisponivel" | "limite";
  /** De onde a distância foi medida: o pino da loja ou o endereço dela no mapa. */
  centroDaLoja?: Ponto;
};

// ── O NOMINATIM ─────────────────────────────────────────────────────────────
//
// Status diferente de 200 voltava `null` sem log: os 4 pedidos "não
// localizados" da Divinos em 25/09/2026 (R$ 12 para quem mora a 0,5 km) não
// deixaram rastro — ninguém sabe se foi 429 ou prazo. Agora fica no log, e um
// 429 abre uma trégua: insistir no limite só estende o bloqueio do IP, que é o
// do servidor inteiro (todas as lojas, o robô, o cron e a roteirização).

const URL_DO_NOMINATIM = "https://nominatim.openstreetmap.org/search";
const CABECALHOS = { "User-Agent": "FireHub-DeliveryEngine/2.1 (contato@firehubfood.com.br)", "Accept-Language": "pt-BR" };
const PRAZO_DA_BUSCA_MS = 4500;

let nominatimEmTreguaAte = 0;
const estadoNominatim = {
  ultimoSucessoEm: 0,
  ultimoStatusNaoOk: null as null | { status: number; em: number },
  ultimaFalhaDeRede: null as null | { motivo: string; em: number },
  consultas: 0,
};

/** Para o /api/health: o Nominatim está respondendo ao caminho da taxa? Sem ir à rede. */
export function estadoDoNominatim() {
  const agora = Date.now();
  return {
    emTregua: agora < nominatimEmTreguaAte,
    treguaAte: agora < nominatimEmTreguaAte ? new Date(nominatimEmTreguaAte).toISOString() : null,
    ultimoSucesso: estadoNominatim.ultimoSucessoEm ? new Date(estadoNominatim.ultimoSucessoEm).toISOString() : null,
    ultimoStatusNaoOk: estadoNominatim.ultimoStatusNaoOk
      ? { status: estadoNominatim.ultimoStatusNaoOk.status, em: new Date(estadoNominatim.ultimoStatusNaoOk.em).toISOString() }
      : null,
    ultimaFalhaDeRede: estadoNominatim.ultimaFalhaDeRede
      ? { motivo: estadoNominatim.ultimaFalhaDeRede.motivo, em: new Date(estadoNominatim.ultimaFalhaDeRede.em).toISOString() }
      : null,
    consultas: estadoNominatim.consultas,
  };
}

/** Zera a trégua e os contadores. SÓ PARA TESTE. */
export function reiniciarNominatimParaTeste() {
  nominatimEmTreguaAte = 0;
  estadoNominatim.ultimoSucessoEm = 0;
  estadoNominatim.ultimoStatusNaoOk = null;
  estadoNominatim.ultimaFalhaDeRede = null;
  estadoNominatim.consultas = 0;
}

/**
 * A resposta de uma busca: `ok` com o que o mapa disse (inclusive "nada") ou
 * a falha. A diferença importa para o cache: "não existe no mapa" pode ser
 * lembrado; "o servidor não respondeu" não.
 */
export type RespostaDoMapa<T> = { ok: true; valor: T } | { ok: false; motivo: string };

/**
 * Um resumo curto (8 hex) do texto, para o log correlacionar buscas SEM gravar
 * o endereço do cliente. Com o Nominatim lento às 20h, cada cotação escrevia
 * de 3 a 5 linhas com a rua e o número da casa no log do Coolify (LGPD).
 */
export function resumoDaConsulta(texto: string): string {
  let h = 0x811c9dc5;
  for (const c of String(texto || "")) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

async function consultarNominatim(
  parametros: string,
  tipo: "livre" | "estruturada",
  consulta: string,
  timeoutMs: number,
): Promise<RespostaDoMapa<any[]>> {
  if (Date.now() < nominatimEmTreguaAte) return { ok: false, motivo: "Nominatim em trégua depois de um 429" };
  estadoNominatim.consultas++;
  const inicio = Date.now();
  // O log diz o tipo, o status e quanto demorou; o endereço, só pelo resumo.
  const qual = () => `busca ${tipo} #${resumoDaConsulta(consulta)}, ${Date.now() - inicio} ms`;
  try {
    const res = await fetch(`${URL_DO_NOMINATIM}?${parametros}`, {
      headers: CABECALHOS,
      signal: AbortSignal.timeout(Math.max(1, Math.round(timeoutMs))),
    });
    if (!res.ok) {
      estadoNominatim.ultimoStatusNaoOk = { status: res.status, em: Date.now() };
      // 429 = limite do IP; 403 = IP bloqueado; 5xx = servidor mal. Nos três,
      // pergunta nova agora só piora.
      const tregua = res.status === 429 || res.status === 403 ? 60_000 : res.status >= 500 ? 20_000 : 0;
      if (tregua) nominatimEmTreguaAte = Date.now() + tregua;
      console.warn(
        `[Geocodificação da taxa] Nominatim respondeu ${res.status} (${qual()})` +
          (tregua ? ` — sem novas buscas por ${tregua / 1000} s` : ""),
      );
      return { ok: false, motivo: `HTTP ${res.status}` };
    }
    const data = await res.json();
    estadoNominatim.ultimoSucessoEm = Date.now();
    return { ok: true, valor: Array.isArray(data) ? data : [] };
  } catch (err: any) {
    const motivo = err?.name === "TimeoutError" || err?.name === "AbortError" ? `sem resposta em ${Math.round(timeoutMs)} ms` : String(err?.message || err);
    estadoNominatim.ultimaFalhaDeRede = { motivo, em: Date.now() };
    console.warn(`[Geocodificação da taxa] Nominatim falhou (${qual()}): ${motivo}`);
    return { ok: false, motivo };
  }
}

/** Os nomes de município que o resultado traz (o OSM usa campos diferentes por região). */
function municipiosDoResultado(a: any): string[] {
  return [a?.city, a?.town, a?.municipality, a?.village].filter((x) => typeof x === "string" && x.trim()).map((x) => String(x));
}

/** O que o mapa achou numa busca livre. */
export type ResultadoDoMapa = {
  lat: number;
  lng: number;
  displayName: string;
  /** A rua que o mapa entendeu — é por ela que se confere se achou a rua do cliente ou outra. */
  rua?: string;
  /** O bairro do resultado no OSM. */
  bairro?: string;
  /** Os nomes do município no resultado (cidade, town, municipality...). */
  cidades?: string[];
  /** O mapa achou o NÚMERO da casa, não só a rua. */
  temNumero?: boolean;
  /**
   * O que o ponto É: a casa ("endereco"), a rua ou um lugar ("rua"), ou só
   * uma ÁREA — bairro, loteamento, cidade — cujo centro não é casa de
   * ninguém. "Boca do Mato, Cabo Frio" no texto livre volta como o centro do
   * bairro, e antes era tratado como endereço achado.
   */
  nivel?: "endereco" | "rua" | "area";
};

const TIPOS_DE_AREA = new Set([
  "suburb", "neighbourhood", "quarter", "city_district", "city", "town", "village", "hamlet", "locality",
  "municipality", "county", "state", "region", "postcode", "residential", "isolated_dwelling", "borough", "district",
]);

/** A casa, a rua (ou um lugar com rua), ou só uma área. Ver `ResultadoDoMapa.nivel`. */
function nivelDoResultado(d: any, a: any): "endereco" | "rua" | "area" {
  if (a?.house_number) return "endereco";
  const classe = String(d?.class ?? d?.category ?? "");
  const tipo = String(d?.type ?? "");
  const tipoDeEndereco = String(d?.addresstype ?? "");
  if (classe === "highway") return "rua";
  if (classe === "place" || classe === "boundary" || TIPOS_DE_AREA.has(tipoDeEndereco) || (classe === "landuse" && tipo === "residential")) return "area";
  if (a?.road || a?.pedestrian || a?.footway) return "rua";
  return "area";
}

/** Um trecho de rua da busca estruturada. */
export type TrechoDeRua = {
  lat: number;
  lng: number;
  displayName: string;
  suburb: string;
  rua: string;
  cidades?: string[];
};

function caixaDeBusca(centro: Ponto | null | undefined): string {
  if (!centro || !Number.isFinite(centro.lat) || !Number.isFinite(centro.lng)) return "";
  const delta = 0.25; // ~25 km ao redor da loja para priorizar o que está perto
  return `&viewbox=${(centro.lng - delta).toFixed(4)},${(centro.lat + delta).toFixed(4)},${(centro.lng + delta).toFixed(4)},${(centro.lat - delta).toFixed(4)}`;
}

/** Busca livre (q=). `ok` com `null` = o mapa não conhece. */
export async function buscaLivreNoMapa(
  addressQuery: string,
  storeCenter?: Ponto | null,
  opcoes?: { timeoutMs?: number },
): Promise<RespostaDoMapa<ResultadoDoMapa | null>> {
  if (!addressQuery || addressQuery.trim().length < 3) return { ok: true, valor: null };
  const cleanQuery = addressQuery
    .replace(/lt\s*\d+|qd\s*\d+|casa\s*\d+|ap\s*\d+|apt\s*\d+|bloco\s*\w+/gi, "")
    .trim();
  const caixa = caixaDeBusca(storeCenter);
  // bounded=0: a caixa só PRIORIZA — endereço de loja em cidade vizinha ainda
  // pode ser achado. Quem chama confere município e distância.
  const parametros = `format=json&q=${encodeURIComponent(cleanQuery)}&limit=1&addressdetails=1&countrycodes=br${caixa ? `${caixa}&bounded=0` : ""}`;
  const r = await consultarNominatim(parametros, "livre", cleanQuery, opcoes?.timeoutMs ?? PRAZO_DA_BUSCA_MS);
  if (!r.ok) return r;
  const d = r.valor[0];
  if (!d) return { ok: true, valor: null };
  const lat = parseFloat(d.lat);
  const lng = parseFloat(d.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: true, valor: null };
  const a = d.address || {};
  return {
    ok: true,
    valor: {
      lat,
      lng,
      displayName: String(d.display_name || ""),
      rua: a.road || a.pedestrian || a.footway || a.residential || undefined,
      bairro: String(a.suburb || a.neighbourhood || a.city_district || a.quarter || a.residential || ""),
      cidades: municipiosDoResultado(a),
      temNumero: !!a.house_number,
      nivel: nivelDoResultado(d, a),
    },
  };
}

/**
 * Busca ESTRUTURADA (street= + city=). Medido em 07/09/2026 em Rio das Ostras:
 * a busca livre não achava "Rua Valença", "Rua José do Patrocínio", "Rua São
 * Paulo" nem "Rua Juriti"; a estruturada acha as quatro, com o bairro de cada
 * trecho. Devolve até 5 trechos: a mesma rua pode existir em mais de um
 * bairro, e quem chama decide o que fazer com a ambiguidade.
 */
export async function buscaDeRuaNoMapa(
  street: string,
  city: string,
  storeCenter?: Ponto | null,
  opcoes?: { timeoutMs?: number },
): Promise<RespostaDoMapa<TrechoDeRua[]>> {
  if (!street || street.trim().length < 3 || !city) return { ok: true, valor: [] };
  const caixa = caixaDeBusca(storeCenter);
  const parametros = `format=json&street=${encodeURIComponent(street.trim())}&city=${encodeURIComponent(city.trim())}&country=Brasil&limit=5&addressdetails=1${caixa ? `${caixa}&bounded=1` : ""}`;
  const r = await consultarNominatim(parametros, "estruturada", `${street} / ${city}`, opcoes?.timeoutMs ?? PRAZO_DA_BUSCA_MS);
  if (!r.ok) return r;
  return {
    ok: true,
    valor: r.valor
      .map((d: any) => ({
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
        displayName: String(d.display_name || ""),
        suburb: String(d.address?.suburb || d.address?.neighbourhood || d.address?.city_district || d.address?.quarter || ""),
        // A busca por "WE 62" devolvia um comércio no número 62 da Travessa WE 13:
        // quem chama confere a rua por este campo.
        rua: String(d.address?.road || d.address?.pedestrian || d.address?.footway || ""),
        cidades: municipiosDoResultado(d.address),
      }))
      .filter((d: TrechoDeRua) => Number.isFinite(d.lat) && Number.isFinite(d.lng)),
  };
}

// Geocodifica um endereço via OpenStreetMap Nominatim API com priorização geográfica (viewbox)
export async function geocodeAddress(
  addressQuery: string,
  storeCenter?: Ponto | null,
  opcoes?: { timeoutMs?: number },
): Promise<ResultadoDoMapa | null> {
  const r = await buscaLivreNoMapa(addressQuery, storeCenter, opcoes);
  return r.ok ? r.valor : null;
}

/** A busca estruturada, na forma antiga: lista vazia também quando falhou. */
export async function geocodeStreetStructured(
  street: string,
  city: string,
  storeCenter?: Ponto | null,
  opcoes?: { timeoutMs?: number },
): Promise<TrechoDeRua[]> {
  const r = await buscaDeRuaNoMapa(street, city, storeCenter, opcoes);
  return r.ok ? r.valor : [];
}

/**
 * Quem faz as buscas no caminho da taxa. Injetável de propósito: em produção
 * é o de lib/geocodificacao-servidor.ts (cache no banco + a fila de 1 req/s
 * da roteirização); sem injeção, as buscas vão direto (scripts de conferência
 * contra o mapa de verdade). `prazo` é epoch ms — depois dele, não se busca.
 *
 * Devolve a resposta do mapa OU a falha, com o motivo: "não deu para
 * perguntar" (fila cheia, prazo, 429, rede) não é "o mapa não conhece".
 */
export type GeocodificadorDaTaxa = {
  livre(consulta: string, centro: Ponto | null, prazo: number): Promise<RespostaDoMapa<ResultadoDoMapa | null>>;
  estruturada(rua: string, cidade: string, centro: Ponto | null, prazo: number): Promise<RespostaDoMapa<TrechoDeRua[]>>;
  /**
   * O Google, quando o mapa aberto não achou com segurança
   * (lib/geocodificacao-google.ts). Opcional: sem ele — ou sem a chave no
   * ambiente —, a cascata é a de sempre.
   */
  google?(consulta: string, cidade: string, centro: Ponto | null, prazo: number): Promise<RespostaDoMapa<ResultadoDoGoogle | null>>;
};

export const geocodificadorDireto: GeocodificadorDaTaxa = {
  async livre(consulta, centro, prazo) {
    const resta = prazo - Date.now();
    if (resta < 500) return { ok: false, motivo: "prazo" };
    return buscaLivreNoMapa(consulta, centro, { timeoutMs: Math.min(PRAZO_DA_BUSCA_MS, resta) });
  },
  async estruturada(rua, cidade, centro, prazo) {
    const resta = prazo - Date.now();
    if (resta < 500) return { ok: false, motivo: "prazo" };
    return buscaDeRuaNoMapa(rua, cidade, centro, { timeoutMs: Math.min(PRAZO_DA_BUSCA_MS, resta) });
  },
};

const PADRAO_DO_LOGRADOURO =
  "\\b(rua|r\\.|avenida|av\\.?|travessa|tv\\.|alameda|al\\.|estrada|est\\.|rodovia|rod\\.|pra[çc]a|largo|beco|via|servid[ãa]o)\\s+([^,;\\-\\n\\d(]{3,60})";

function logradouroDoAchado(m: RegExpMatchArray): string {
  const tipo = m[1].toLowerCase().replace(".", "");
  const nomes: Record<string, string> = { r: "Rua", av: "Avenida", tv: "Travessa", al: "Alameda", est: "Estrada", rod: "Rodovia", praca: "Praça" };
  const tipoCheio = nomes[tipo] || (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase());
  return `${tipoCheio} ${m[2].trim().replace(/\s+(n[º°o]?|numero|número|casa|lote|lt|quadra|qd|s\/n)\b.*$/i, "").trim()}`;
}

/** "Rua Sol Nascente, 23, Aquários" → "Rua Sol Nascente". Só o logradouro, sem número, bairro ou complemento. */
export function extrairLogradouro(texto: string): string {
  const m = String(texto || "").match(new RegExp(PADRAO_DO_LOGRADOURO, "i"));
  return m ? logradouroDoAchado(m) : "";
}

/** Travessa, beco, servidão: a rua pequena onde a casa fica, quando o cliente cita duas. */
const RUA_PEQUENA = /^(travessa|beco|servid[aã]o)\b/i;

/**
 * TODAS as ruas escritas no texto, a pequena primeiro.
 *
 * "Rua do forno, travessa pantanal, nº 130, Jardim Esperança" (Divinos,
 * 25/09/2026): o cliente dá a rua principal e a travessa onde mora. Só a
 * primeira era procurada — e a casa fica na travessa. Com as duas, uma serve
 * de régua para a outra (`encontroDeRuas`): a Travessa Pantanal existe em dois
 * lugares de Cabo Frio, e a certa é a que fica junto da Rua do Forno.
 */
export function logradourosDoTexto(texto: string): string[] {
  const achados: string[] = [];
  const vistos = new Set<string>();
  for (const m of String(texto || "").matchAll(new RegExp(PADRAO_DO_LOGRADOURO, "gi"))) {
    const l = logradouroDoAchado(m);
    const k = normalizarParaComparar(l);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    achados.push(l);
  }
  return [...achados.filter((l) => RUA_PEQUENA.test(l)), ...achados.filter((l) => !RUA_PEQUENA.test(l))];
}

/** Até quanto um trecho de uma rua pode ficar do trecho da outra para as duas serem "a mesma esquina". */
export const ENCONTRO_DE_RUAS_KM = 1.2;

type PontoDoTrecho = { lat: number; lng: number };

/**
 * Duas (ou três) ruas do mesmo texto: o trecho da PRIMEIRA delas (a pequena)
 * que fica junto de outra rua do texto. `null` quando nenhuma fica perto de
 * outra — aí a régua não serve e segue a busca rua a rua.
 */
export function encontroDeRuas<T extends PontoDoTrecho>(
  porRua: { logradouro: string; trechos: T[] }[],
  maxKm: number = ENCONTRO_DE_RUAS_KM,
): { logradouro: string; trecho: T; km: number } | null {
  for (let i = 0; i < porRua.length; i++) {
    let melhor: { logradouro: string; trecho: T; km: number } | null = null;
    for (const t of porRua[i].trechos) {
      for (let j = 0; j < porRua.length; j++) {
        if (j === i) continue;
        for (const u of porRua[j].trechos) {
          const km = haversineDistanceKm(t.lat, t.lng, u.lat, u.lng);
          if (!melhor || km < melhor.km) melhor = { logradouro: porRua[i].logradouro, trecho: t, km: Math.round(km * 100) / 100 };
        }
      }
    }
    if (melhor && melhor.km <= maxKm) return melhor;
  }
  return null;
}

/** O trecho mais perto de um ponto (o centro do bairro do cliente). */
export function trechoMaisPerto<T extends PontoDoTrecho>(trechos: T[], ponto: PontoDoTrecho): { trecho: T; km: number } | null {
  let melhor: { trecho: T; km: number } | null = null;
  for (const t of trechos) {
    const km = haversineDistanceKm(t.lat, t.lng, ponto.lat, ponto.lng);
    if (!melhor || km < melhor.km) melhor = { trecho: t, km: Math.round(km * 100) / 100 };
  }
  return melhor;
}

// Algarismo romano sozinho vira número para COMPARAR bairro: o cliente escreve
// "Cidade Nova 5" e o mapa chama de "Cidade Nova V" (Ananindeua, 24/09/2026).
const ROMANOS: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12",
};

function normalizarParaComparar(t: string): string {
  return String(t || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,2})\b/g, (m) => ROMANOS[m] || m)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

/**
 * O endereço sem o que é REFERÊNCIA.
 *
 * "WE 62, 661 - Cidade Nova 5 (próximo ao Colina)" não voltava NADA do mapa: o
 * Nominatim tenta casar "próximo ao Colina" como parte do endereço e desiste.
 * Referência ajuda o motoboy, não o mapa — sai o parêntese inteiro e as frases
 * de referência até a próxima vírgula ("perto do mercado", "em frente à
 * igreja", "ref: portão azul").
 */
export function semReferencias(texto: string): string {
  return String(texto || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(pr[o\u00f3]x(imo|ima|\.)?|perto|ao lado|em frente|atr[a\u00e1]s|esquina|ponto de refer[e\u00ea]ncia|refer[e\u00ea]ncia|ref)\b[^,;\n]*/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;])/g, "$1")
    // A referência no meio deixa ", ," para trás.
    .replace(/([,;])(\s*[,;])+/g, "$1")
    .replace(/[\s,;-]+$/g, "")
    .trim();
}

/**
 * As ruas que vale procurar pelo NOME (busca estruturada).
 *
 * Com o tipo escrito ("Rua Sol Nascente, 23"), é ela e pronto. Sem o tipo, o
 * robô não procurava rua nenhuma: em Ananindeua as travessas da Cidade Nova se
 * chamam "WE 62", "SN 10" — e o cliente escreve assim, sem "Travessa". O mapa
 * conhece como "Travessa WE 62". Aí se tenta o nome com os tipos mais comuns;
 * quem chama confere se a rua achada é mesmo essa (`nomeDeRuaParecido`).
 */
export function logradourosCandidatos(texto: string): string[] {
  // Todas as ruas escritas, fora as de referência ("perto da Rua X" não é onde a casa fica).
  const escritas = logradourosDoTexto(semReferencias(texto));
  if (escritas.length > 0) return escritas;
  const explicito = extrairLogradouro(texto);
  if (explicito) return [explicito];
  // O código de rua da Cidade Nova de Ananindeua: WE (as travessas) e SN.
  // Procurado em qualquer ponto do texto, porque no robô o endereço chega no
  // meio da conversa. Outros códigos entram aqui quando aparecerem — lista
  // aberta a esmo ("DE 10", "AS 20") acharia rua em frase comum.
  const codigo = String(texto || "").match(/\b(WE|SN)\s*-?\s*(\d{1,4})\b/i);
  if (codigo) {
    const nome = `${codigo[1].toUpperCase()} ${codigo[2]}`;
    return [`Travessa ${nome}`, `Rua ${nome}`];
  }
  return [];
}

/** A rua do resultado é a que o cliente escreveu? Sem rua no resultado, não dá para afirmar. */
function ruaConfere(procurada: string, achada: string | undefined): boolean {
  if (!achada) return false;
  return nomeDeRuaParecido(procurada, achada);
}

/**
 * O prefixo que o nome oficial tem e o cliente não escreve: o OSM chama de
 * "Vila Monte Alegre" o que todo mundo em Cabo Frio chama de "Monte Alegre".
 * Foi essa diferença que fez uma cotação da Divinos pegar a Rua Diamante do
 * outro bairro, a 4,95 km, para um cliente a 0,13 km (25/09/2026).
 */
const PREFIXO_DE_BAIRRO = /^(bairro|vila|vl|jardim|jd|parque|pq|residencial|res|conjunto|conj|cj|loteamento|lot|condominio|cond|nucleo|setor)\s+/;

function nomeDeBairro(t: string): string {
  return normalizarParaComparar(t).replace(PREFIXO_DE_BAIRRO, "").trim();
}

/** `a` aparece inteiro, palavra por palavra, dentro de `b`. */
function contidoEm(a: string, b: string): boolean {
  if (!a || !b) return false;
  return ` ${b} `.includes(` ${a} `);
}

/**
 * O bairro que o cliente informou é o que o mapa diz? Igual, ou um contido no
 * outro, nos dois sentidos, sem o prefixo ("Vila", "Jardim"...). Sem um dos
 * dois lados, não há o que conferir: devolve true.
 */
export function bairroConfere(informado: string | null | undefined, noMapa: string | null | undefined): boolean {
  const a = nomeDeBairro(String(informado || ""));
  const b = nomeDeBairro(String(noMapa || ""));
  if (!a || !b) return true;
  if (a === b || contidoEm(a, b) || contidoEm(b, a)) return true;
  return bairroParecido(String(informado || ""), String(noMapa || ""));
}

/** Quantas letras trocar, pôr ou tirar para `a` virar `b` — até `teto` (acima, devolve teto + 1). */
function distanciaDeEdicao(a: string, b: string, teto: number): number {
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let menorDaLinha = i;
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      menorDaLinha = Math.min(menorDaLinha, atual[j]);
    }
    if (menorDaLinha > teto) return teto + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * O bairro como o cliente DIGITA no celular, medido em 25/09/2026 nas 27
 * entregas que o mapa não achou em 7 dias: tudo junto ("JardimBelaVista",
 * "Extensãodobosque") e uma letra errada ou a menos ("Atlântic" para
 * Atlântica, "Alecrin" para Alecrim, "Chácar Marilea"). Sem espaço, o nome
 * inteiro tem que ser o mesmo; com erro, só UMA letra (duas em nome longo) —
 * nome curto parecido é outro bairro ("Vila Nova" não é "Vila Nobre").
 */
function bairroParecido(informado: string, noMapa: string): boolean {
  const junto = (t: string) => normalizarParaComparar(t).replace(/\s+/g, "");
  const semPrefixoJunto = (t: string) => nomeDeBairro(t).replace(/\s+/g, "");
  // Tudo junto: com ou sem o prefixo, o nome colado tem que ser igual.
  if (junto(informado) === junto(noMapa) || junto(informado) === semPrefixoJunto(noMapa) || semPrefixoJunto(informado) === junto(noMapa)) return true;
  const a = semPrefixoJunto(informado);
  const b = semPrefixoJunto(noMapa);
  if (a === b) return true;
  const menor = Math.min(a.length, b.length);
  if (menor < 6) return false;
  const teto = menor >= 12 ? 2 : 1;
  return distanciaDeEdicao(a, b, teto) <= teto;
}

/**
 * O resultado do mapa é do bairro que o cliente informou?
 *
 *   "confere"    — o bairro do resultado bate (sem prefixo, contém nos dois
 *                  sentidos), ou o nome aparece no endereço inteiro que o mapa
 *                  devolveu (o bairro pode estar num campo que não é `suburb`);
 *   "sem-bairro" — o resultado não diz bairro nenhum: não há o que conferir
 *                  (a mesma regra de `bairroConfere`). NÃO é outro bairro;
 *   "diverge"    — o resultado diz OUTRO bairro.
 *
 * Até 25/09/2026 o "sem bairro" era tratado como outro bairro: a casa achada
 * com número a 0,3 km (Rua Beira Alta, Boca do Mato) virava reserva, e o
 * centro do bairro, a 1,7 km, passava na frente — R$ 10 com o pino
 * obrigatório para quem pagava R$ 5.
 */
function compararBairro(
  informado: string,
  r: { bairro?: string; suburb?: string; displayName: string },
): "confere" | "sem-bairro" | "diverge" {
  const alvo = nomeDeBairro(informado);
  if (!alvo) return "sem-bairro";
  const doMapa = r.bairro || r.suburb || "";
  const temBairro = !!nomeDeBairro(doMapa);
  if (temBairro && bairroConfere(informado, doMapa)) return "confere";
  if (contidoEm(alvo, normalizarParaComparar(r.displayName))) return "confere";
  return temBairro ? "diverge" : "sem-bairro";
}

// O que, depois da rua, não é bairro: complemento, número, tipo de via, sigla de estado.
const NAO_E_BAIRRO =
  /^(casa|cs|apto?|apartamento|bloco|bl|lote|lt|quadra|qd|fundos|frente|sobrado|loja|sala|andar|km|condominio|cond|edificio|edif|ed|torre|s n|sn|n|no|nr|num|numero|brasil|cep)\b/;
const TIPO_DE_VIA = /^(rua|r|avenida|av|travessa|tv|trav|alameda|al|estrada|est|rodovia|rod|praca|largo|beco|via|servidao)\b/;
const UFS = new Set("ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to".split(" "));
const ESTADO_POR_EXTENSO = /^(rio de janeiro|sao paulo|minas gerais|espirito santo)$/;

/**
 * O bairro que o cliente ESCREVEU no endereço de texto, quando não veio em
 * campo separado: "Rua Diamante, 19 - Monte Alegre" → "Monte Alegre".
 *
 * Sem isto, o texto livre (a cotação do robô na conversa, o balcão que não
 * separa as peças, /api/delivery-fee só com `address`) aceitava calado a Rua
 * Diamante do Peró, a 4,95 km, para quem escreveu "Monte Alegre" — o mesmo
 * endereço com o bairro em campo separado pedia a confirmação no mapa.
 *
 * Conservador de propósito: só o primeiro pedaço depois da rua que não é
 * número, complemento, tipo de via, cidade ou estado. Sem separador (" - ",
 * vírgula), não há bairro — e aí não se confere nada.
 */
export function bairroDoTexto(texto: string, cidade?: string | null): string {
  const partes = semReferencias(texto)
    .split(/\s+[-–]\s+|\s*[,;/]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length < 2) return "";
  const daCidade = normalizarParaComparar(cidade || "");
  for (const parte of partes.slice(1)) {
    const semRotulo = parte.replace(/^bairro\s*:?\s*/i, "").trim();
    const n = normalizarParaComparar(semRotulo);
    if (n.length < 3 || /^\d/.test(n)) continue;
    if (NAO_E_BAIRRO.test(n) || TIPO_DE_VIA.test(n)) continue;
    if (UFS.has(n) || ESTADO_POR_EXTENSO.test(n)) continue;
    if (daCidade && (n === daCidade || contidoEm(daCidade, n))) continue;
    return semRotulo;
  }
  return "";
}

/**
 * O resultado caiu em OUTRO município que não o da loja — e o cliente não
 * pediu esse município? Sem município num dos lados, não dá para afirmar.
 * Rua de mesmo nome em São Pedro da Aldeia (15 km) virava "fora do raio" para
 * um cliente legítimo de Cabo Frio.
 */
function foraDoMunicipio(cidadeDaLoja: string, cidades: string[] | undefined, textoDoCliente: string): string | null {
  const loja = normalizarParaComparar(cidadeDaLoja);
  const doMapa = (cidades || []).map(normalizarParaComparar).filter(Boolean);
  if (!loja || doMapa.length === 0) return null;
  if (doMapa.some((c) => c === loja || contidoEm(loja, c) || contidoEm(c, loja))) return null;
  const texto = normalizarParaComparar(textoDoCliente);
  if (doMapa.some((c) => contidoEm(c, texto))) return null;
  return (cidades || [])[0] || null;
}

/** Centésimos de km — a comparação da faixa não pode depender de 5 + 0,05 ≠ 5,05 em ponto flutuante. */
const centesimos = (km: number) => Math.round(km * 100);

/** Folga só na ÚLTIMA faixa: 50 m de arredondamento de mapa não recusam ninguém. */
export const FOLGA_DA_ULTIMA_FAIXA_KM = 0.05;

/**
 * A faixa de uma distância (R5). Limite INCLUSIVO ("até 1,5 km" inclui 1,50),
 * distância arredondada a 0,01 km, folga de 0,05 km só na última faixa, acima
 * disso fora. Sem km mínimo: 0 km é a primeira faixa.
 */
export function faixaDaDistancia<T extends { km: number }>(faixas: T[], distanciaKm: number): { faixa: T | null; dentro: boolean } {
  const ordenadas = faixas.filter((f) => Number.isFinite(f.km) && f.km > 0).sort((a, b) => a.km - b.km);
  if (ordenadas.length === 0 || !Number.isFinite(distanciaKm)) return { faixa: null, dentro: false };
  const d = centesimos(Math.max(0, distanciaKm));
  const faixa = ordenadas.find((f) => d <= centesimos(f.km));
  if (faixa) return { faixa, dentro: true };
  const ultima = ordenadas[ordenadas.length - 1];
  if (d <= centesimos(ultima.km) + centesimos(FOLGA_DA_ULTIMA_FAIXA_KM)) return { faixa: ultima, dentro: true };
  return { faixa: null, dentro: false };
}

/** Prazo total padrão da verificação (cotação inteira: mapa + rota). */
export const PRAZO_DA_VERIFICACAO_MS = 12_000;
/** Em ROTA, o mapa para antes disto do fim: sobra tempo para perguntar a rua. */
const RESERVA_PARA_A_ROTA_MS = 3500;
/** Menos tempo que isto não dá uma busca no mapa. */
const TEMPO_MINIMO_DO_MAPA_MS = 800;
/** Trechos de rua a mais que isto um do outro são lugares diferentes, não pedaços da mesma rua. */
const TRECHOS_ESPALHADOS_KM = 1;
/**
 * Até isto do centro do bairro que o cliente escreveu, o ponto é o MESMO lugar
 * com outro nome no mapa. É a régua anti-homônimo da roteirização
 * (lib/geocodificacao.ts): o OSM chama de "Braga" a esquina que o morador
 * chama de "Centro", e isso não é rua homônima.
 */
const PERTO_DO_BAIRRO_KM = 2.8;

export type OpcoesDaVerificacao = {
  /** Quem busca no mapa. Padrão: direto no Nominatim, sem cache. */
  geocodificador?: GeocodificadorDaTaxa;
  /** Epoch ms: fim do tempo da cotação inteira. Padrão: agora + 12 s. */
  prazo?: number;
  /** Como a coordenada do cliente chegou, quando chegou. Padrão: "gps". */
  origemDasCoords?: "pino" | "gps";
};

/** Texto normalizado para não mandar ao mapa a mesma pergunta com outra pontuação. */
function chaveDaConsulta(q: string): string {
  return normalizarParaComparar(q);
}

/** A falha de uma busca, no vocabulário do `motivoDaFalha`. */
function tipoDaFalha(motivo: string): "prazo" | "indisponivel" | "limite" {
  if (/^limite/.test(motivo)) return "limite";
  if (/prazo|sem resposta/.test(motivo)) return "prazo";
  return "indisponivel";
}

const RAZAO_DA_FALHA: Record<"prazo" | "indisponivel" | "limite", string> = {
  prazo: "O mapa não respondeu a tempo.",
  indisponivel: "O mapa não respondeu agora (ocupado ou fora do ar).",
  limite: "Muitas consultas ao mapa seguidas.",
};

// Verifica se um endereço está dentro dos raios de entrega da loja
export async function verifyStoreDeliveryAddress(
  storeAddress: string | null,
  storeLatLng: { lat: number; lng: number } | null,
  storeCity: string | null,
  deliveryZones: any[],
  deliveryZoneType: string | null,
  customerAddressText: string,
  customerCoords?: { lat: number; lng: number } | null,
  delivConfig?: any,
  parsedDetails?: { street?: string; number?: string; neighborhood?: string; city?: string },
  opcoes?: OpcoesDaVerificacao,
): Promise<DeliveryZoneCheckResult | null> {
  const zones = Array.isArray(deliveryZones) ? deliveryZones : [];
  const geo = opcoes?.geocodificador ?? geocodificadorDireto;
  const prazo = opcoes?.prazo ?? Date.now() + PRAZO_DA_VERIFICACAO_MS;
  const porRota = medicaoDaLoja(deliveryZoneType) === "ROTA";
  // Em ROTA o mapa não pode comer o tempo da rota: sem ela, a taxa sai
  // estimada mesmo com o roteador no ar.
  const prazoDoMapa = porRota ? prazo - RESERVA_PARA_A_ROTA_MS : prazo;
  const temTempoNoMapa = () => prazoDoMapa - Date.now() >= TEMPO_MINIMO_DO_MAPA_MS;
  const falhou = (motivo: string, extra?: Partial<DeliveryZoneCheckResult>): DeliveryZoneCheckResult => {
    const tipo = tipoDaFalha(motivo);
    return { addressFound: false, searchedQuery: customerAddressText, reason: RAZAO_DA_FALHA[tipo], motivoDaFalha: tipo, ...extra };
  };

  // 1. Obter lat/lng da Loja (puxando as coordenadas exatas configuradas pelo lojista)
  //
  // A leitura é a compartilhada (lib/ponto-da-loja): a que existia aqui exigia
  // `typeof lat === "number"` e devolvia "sem ponto" para o mesmo campo gravado
  // como texto — e aí a loja caía na geocodificação do endereço mesmo tendo
  // pino salvo.
  let storeCenter: Ponto | null = lerPontoDaLoja(storeLatLng);

  if (!storeCenter && storeAddress) {
    // A cidade entra só se a loja tiver uma. O padrão era "Rio das Ostras":
    // loja sem cidade cadastrada tinha o PRÓPRIO endereço procurado em Rio das
    // Ostras, e o raio de entrega passava a ser medido de lá. Pelo mesmo
    // geocodificador (com cache): o endereço da loja não muda a cada cotação.
    if (!temTempoNoMapa()) return falhou("prazo");
    const storeGeo = await geo.livre([storeAddress, storeCity].filter(Boolean).join(", "), null, prazoDoMapa);
    // Mapa fora não é "a loja não existe no mapa": a cotação diz que não deu.
    if (!storeGeo.ok) return falhou(storeGeo.motivo);
    if (storeGeo.valor) storeCenter = { lat: storeGeo.valor.lat, lng: storeGeo.valor.lng };
  }

  if (!storeCenter) {
    return null;
  }
  const loja = storeCenter;

  // Faixas de raio (KM) cadastradas no mapa da loja — antes da geocodificação,
  // porque o nível 5 (rua em mais de um bairro) precisa do raio para decidir.
  const radiusZones = zones
    .filter((z: any) => z && (z.km !== undefined || z.radius !== undefined || z.maxKm !== undefined))
    .map((z: any) => ({
      km: Number(z.km !== undefined ? z.km : z.radius !== undefined ? z.radius : z.maxKm),
      fee: Number(z.fee || 0),
      time: Number(z.time || 45)
    }))
    .filter((z: any) => !isNaN(z.km) && z.km > 0);

  const fallbackMaxKm = Number(delivConfig?.maxDeliveryRadiusKm || delivConfig?.maxRadius || delivConfig?.maxKm || 10.0);
  const maxRadiusKm = radiusZones.length > 0
    ? Math.max(...radiusZones.map((z: any) => z.km))
    : fallbackMaxKm;

  // 2. Coordenadas do Cliente (via GPS/pino direto ou geocodificação ancorada no bairro)
  const coordsDoCliente =
    customerCoords && Number.isFinite(customerCoords.lat) && Number.isFinite(customerCoords.lng) ? customerCoords : null;
  let customerLat: number;
  let customerLng: number;
  let displayName: string = customerAddressText;
  // Com `as`: `aceitar` (abaixo) muda estas variáveis dentro de uma função, e o
  // estreitamento do TypeScript não enxerga isso.
  let precisao = "endereco" as "endereco" | "rua" | "bairro";
  let origemDoPonto: OrigemDoPonto;
  let cidadesDoResultado: string[] | undefined;
  /** Por que este ponto precisa da confirmação do cliente (vazio = não precisa). */
  const motivos: string[] = [];

  if (coordsDoCliente) {
    customerLat = coordsDoCliente.lat;
    customerLng = coordsDoCliente.lng;
    origemDoPonto = opcoes?.origemDasCoords === "pino" ? "pino" : "gps";
  } else {
    const street = parsedDetails?.street?.trim() || "";
    const num = parsedDetails?.number?.trim() || "";
    const city = parsedDetails?.city?.trim() || storeCity || "";
    // O bairro do campo separado ou, sem ele, o que o cliente ESCREVEU no
    // texto ("Rua Diamante, 19 - Monte Alegre"). É por ele que se confere se
    // a rua achada é a do cliente ou a homônima de outro bairro.
    // "JardimBelaVista" (digitado colado no celular) vira "Jardim Bela Vista":
    // é assim que o mapa conhece o bairro na busca pelo nome dele.
    const neigh = (parsedDetails?.neighborhood?.trim() || bairroDoTexto(customerAddressText, city))
      .replace(/([a-zà-ÿ])([A-ZÀ-Þ])/g, "$1 $2");

    /**
     * A primeira busca que NÃO foi respondida (fila cheia, prazo, 429, rede).
     * Com ela, "não achei" vira "não deu para perguntar", e o ponto de um
     * degrau pior da cascata não é aceito no lugar do que se perdeu.
     */
    let falha: string | null = null;
    let esgotouOPrazo = false;
    const valorOu = <T,>(r: RespostaDoMapa<T>, seFalhar: T): T => {
      if (r.ok) return r.valor;
      falha ??= r.motivo;
      return seFalhar;
    };
    // A mesma pergunta nesta verificação (o centro do bairro serve de régua
    // E de ponto) sai uma vez só — com ou sem o cache do servidor.
    const perguntadas = new Map<string, Promise<RespostaDoMapa<ResultadoDoMapa | null>>>();
    const buscarLivre = (q: string) => {
      const k = chaveDaConsulta(q);
      let p = perguntadas.get(k);
      if (!p) {
        p = geo.livre(q, loja, prazoDoMapa);
        perguntadas.set(k, p);
      }
      return p;
    };

    // A mesma pergunta com outra pontuação ("Rua X, 1 - B" e "Rua X, 1, B")
    // é a mesma resposta — e cada pergunta custa 1,1 s na fila do Nominatim.
    const vistas = new Set<string>();
    const consultasLivres: string[] = [];
    const somar = (q: string) => {
      const k = chaveDaConsulta(q);
      if (!k || vistas.has(k)) return;
      vistas.add(k);
      consultasLivres.push(q);
    };

    // Nível 1: Rua + Número + Bairro + Cidade (máxima precisão ancorada no bairro)
    if (street && num && neigh) somar(`${street}, ${num} - ${neigh}, ${city}`);
    // Nível 2: Rua + Bairro + Cidade (a rua buscada dentro deste bairro)
    if (street && neigh) somar(`${street}, ${neigh}, ${city}`);
    // Nível 3: o texto inteiro — sem as referências ("(próximo ao Colina)"),
    // que fazem o mapa não achar nada.
    const textoParaOMapa = semReferencias(customerAddressText) || customerAddressText;
    if (textoParaOMapa && textoParaOMapa.trim().length >= 4) {
      somar(
        city && !normalizarParaComparar(textoParaOMapa).includes(normalizarParaComparar(city))
          ? `${textoParaOMapa}, ${city}`
          : textoParaOMapa,
      );
    }

    // ── A RUA ACHADA TEM QUE SER A DO CLIENTE ────────────────────────────
    //
    // A busca livre é generosa: "WE 62, 661 - Cidade Nova 5" voltava como
    // "Travessa We 35" — outra rua do mesmo bairro. Quando dá para saber qual
    // rua o cliente escreveu, o resultado de outra rua fica só como reserva
    // (ponto aproximado): antes dele se tenta a busca pelo NOME da rua.
    //
    // Só no endereço em TEXTO LIVRE (robô, pedido digitado): o checkout do
    // site manda rua, número e bairro separados e já ancora a busca no bairro.
    const ruasProcuradas = street ? [] : logradourosCandidatos(customerAddressText);

    let foundGeo = null as { lat: number; lng: number; displayName: string; cidades?: string[] } | null;
    const aceitar = (achado: { lat: number; lng: number; displayName: string; cidades?: string[] }, p: typeof precisao) => {
      foundGeo = achado;
      displayName = achado.displayName;
      precisao = p;
    };
    /** Achou outra rua do mesmo pedaço da cidade. */
    let reservaOutraRua: ResultadoDoMapa | null = null;
    /** Achou a rua, mas o mapa diz OUTRO bairro (a busca livre). */
    let reservaOutroBairro: ResultadoDoMapa | null = null;
    /** A busca pela rua achou a rua num lugar só, com outro bairro no mapa. */
    let reservaRuaUnica: TrechoDeRua | null = null;
    /** A busca pela rua achou trechos em lugares diferentes, e nenhum no bairro do cliente. */
    let reservaHomonima: { trecho: TrechoDeRua; motivo: string; trechos: TrechoDeRua[] } | null = null;
    /** Duas ruas no texto e a busca livre achou a PRINCIPAL, sem número: a casa fica na pequena. */
    let reservaRuaDoTexto: ResultadoDoMapa | null = null;
    /** A busca livre só achou uma ÁREA (bairro, loteamento, cidade): o centro dela. */
    let reservaArea: ResultadoDoMapa | null = null;
    /** Por que o candidato de outro bairro não foi aceito (vai no motivo do centro do bairro). */
    let motivoDoCandidato: string | null = null;

    for (const consulta of consultasLivres) {
      if (!temTempoNoMapa()) { esgotouOPrazo = true; break; }
      const achado = valorOu(await buscarLivre(consulta), null);
      if (!achado) continue;
      if (achado.nivel === "area") {
        // O texto era (ou virou) só o nome de um lugar: antes de aceitar o
        // centro dele, tenta-se a rua pelo nome.
        reservaArea ??= achado;
        continue;
      }
      if (ruasProcuradas.length > 0 && !ruasProcuradas.some((r) => ruaConfere(r, achado.rua))) {
        reservaOutraRua ??= achado;
        continue;
      }
      // Só OUTRO bairro escrito no resultado é suspeito; resultado sem bairro
      // não contradiz o cliente.
      if (neigh && compararBairro(neigh, achado) === "diverge") {
        reservaOutroBairro ??= achado;
        continue;
      }
      // Duas ruas no texto ("Rua do Forno, Travessa Pantanal, 130") e o mapa
      // achou a principal sem número: antes dela, tenta-se o encontro das duas
      // (nível 4a), que acha a travessa onde a casa fica.
      if (ruasProcuradas.length >= 2 && achado.temNumero === false && !ruaConfere(ruasProcuradas[0], achado.rua)) {
        reservaRuaDoTexto ??= achado;
        continue;
      }
      // Rua sem o número no mapa é o MEIO da rua, não a casa.
      aceitar(achado, achado.temNumero === false ? "rua" : "endereco");
      break;
    }

    // A busca estruturada de cada rua, uma vez só nesta verificação: o nível 4a
    // e o 4 perguntam pelas mesmas ruas, e cada pergunta custa 1,1 s na fila.
    const cidadeDaBusca = city || storeCity || "";
    const estruturadas = new Map<string, Promise<RespostaDoMapa<TrechoDeRua[]>>>();
    const estruturadaDe = (logradouro: string) => {
      const k = normalizarParaComparar(logradouro);
      let p = estruturadas.get(k);
      if (!p) {
        p = geo.estruturada(logradouro, cidadeDaBusca, loja, prazoDoMapa);
        estruturadas.set(k, p);
      }
      return p;
    };

    // Nível 4a: DUAS RUAS no texto. Uma é a régua da outra: o trecho da
    // pequena (travessa, beco) que fica junto da principal é onde a casa fica
    // — mesmo que a travessa exista em outro canto da cidade. Duas ruas que se
    // encontram é prova melhor que qualquer nome de bairro.
    if (!foundGeo && ruasProcuradas.length >= 2 && cidadeDaBusca) {
      const porRua: { logradouro: string; trechos: TrechoDeRua[] }[] = [];
      for (const logradouro of ruasProcuradas.slice(0, 3)) {
        if (!temTempoNoMapa()) { esgotouOPrazo = true; break; }
        const achados = valorOu(await estruturadaDe(logradouro), [] as TrechoDeRua[]);
        porRua.push({ logradouro, trechos: achados.filter((t) => ruaConfere(logradouro, t.rua)) });
      }
      const encontro = encontroDeRuas(porRua);
      if (encontro) aceitar(encontro.trecho, "rua");
    }

    // Nível 4: busca ESTRUTURADA pela rua, na cidade da loja. Acha o que a
    // busca livre perde. A mesma rua pode ter trechos em bairros diferentes:
    //   - trecho no bairro do cliente → é esse;
    //   - trechos num lugar só → é a rua dele, mesmo com o bairro de outro
    //     nome no mapa (conferido abaixo contra o centro do bairro);
    //   - trechos ESPALHADOS pela cidade e nenhum no bairro do cliente → rua
    //     HOMÔNIMA (R3): não se assume o mais longe (a Rua Diamante a 4,95 km
    //     para quem mora a 0,13 km); o ponto só vale com o cliente confirmando.
    if (!foundGeo) {
      const ruas = street
        ? [street, ...logradourosCandidatos(street).filter((r) => r !== street)]
        : ruasProcuradas;
      const maisLonge = (lista: TrechoDeRua[]) =>
        lista
          .map((t) => ({ t, km: haversineDistanceKm(loja.lat, loja.lng, t.lat, t.lng) }))
          .sort((a, b) => b.km - a.km)[0].t;
      const espalhados = (lista: TrechoDeRua[]) =>
        lista.some((a) => lista.some((b) => haversineDistanceKm(a.lat, a.lng, b.lat, b.lng) > TRECHOS_ESPALHADOS_KM));
      for (const logradouro of cidadeDaBusca ? ruas : []) {
        if (foundGeo) break;
        if (!temTempoNoMapa()) { esgotouOPrazo = true; break; }
        const achados = valorOu(await estruturadaDe(logradouro), [] as TrechoDeRua[]);
        // Só trecho da MESMA rua: "WE 62" sozinho devolvia um comércio no
        // número 62 da Travessa WE 13, a 1,7 km dali.
        const trechos = achados.filter((t) => ruaConfere(logradouro, t.rua));
        if (trechos.length === 0) continue;
        const bairros = [...new Set(trechos.map((t) => t.suburb).filter(Boolean))].join(", ");
        if (neigh) {
          // Pedaços da mesma rua no mesmo bairro: o mais longe é a taxa
          // conservadora, e a diferença entre eles é de quadras.
          const noBairro = trechos.filter((t) => compararBairro(neigh, t) === "confere");
          if (noBairro.length > 0) { aceitar(maisLonge(noBairro), "rua"); break; }
          if (!espalhados(trechos)) {
            // Um lugar só. Sem bairro nenhum no mapa, não há o que contradiga
            // o cliente; com OUTRO nome, confere-se a distância ao bairro dele.
            if (trechos.every((t) => compararBairro(neigh, t) === "sem-bairro")) { aceitar(maisLonge(trechos), "rua"); break; }
            reservaRuaUnica ??= maisLonge(trechos);
            continue;
          }
          reservaHomonima ??= {
            trecho: maisLonge(trechos),
            motivo: `a rua "${logradouro}" existe no mapa em mais de um lugar${bairros ? ` (${bairros})` : ""}, mas não no bairro "${neigh}"`,
            trechos,
          };
        } else {
          const doTexto = trechos.filter(
            (t) => !!t.suburb && contidoEm(nomeDeBairro(t.suburb), normalizarParaComparar(customerAddressText)),
          );
          if (doTexto.length > 0) { aceitar(maisLonge(doTexto), "rua"); break; }
          // Uma rua só, num lugar só, e o cliente não disse o bairro: é ela.
          if (!espalhados(trechos)) { aceitar(maisLonge(trechos), "rua"); break; }
          reservaHomonima ??= {
            trecho: maisLonge(trechos),
            motivo: `a rua "${logradouro}" existe em mais de um lugar da cidade${bairros ? ` (${bairros})` : ""}`,
            trechos,
          };
        }
      }
    }

    // ── A RUA ACHADA NUM BAIRRO DE OUTRO NOME ────────────────────────────
    //
    // O nome do bairro no OSM não é o que o morador usa, e isso é comum:
    // suspeito (R3) é só a rua em MAIS DE UM lugar sem nenhum no bairro do
    // cliente (a homônima acima). A rua num lugar só vale — a não ser que caia
    // longe do bairro que o cliente escreveu: aí o mapa só conhece a homônima
    // e a rua dele não está no mapa. A régua é o centro do bairro dele.
    const consultaDoBairro = neigh ? `${neigh}, ${city}` : "";

    // ── NÍVEL G: O GOOGLE ────────────────────────────────────────────────
    //
    // O mapa aberto não achou o endereço com segurança (o que sobrou é rua de
    // outro bairro, homônima, centro de bairro ou nada). Antes de aceitar um
    // ponto aproximado, pergunta-se ao Google (lib/geocodificacao-google.ts).
    // Só vale o ponto da CASA ou da RUA, da cidade da loja, com a rua e o
    // bairro que o cliente escreveu. Falha dele não é "o mapa não respondeu":
    // o mapa aberto respondeu, e a cascata segue como sempre.
    if (!foundGeo && geo.google && temTempoNoMapa()) {
      const g = await geo.google(textoParaOMapa, city, loja, prazoDoMapa);
      const r = g.ok ? g.valor : null;
      if (r && r.precisao !== "bairro") {
        const ruasDoCliente = street ? [street] : ruasProcuradas;
        const ruaBate = ruasDoCliente.length === 0 || (!!r.rua && ruasDoCliente.some((x) => ruaConfere(x, r.rua)));
        const bairroBate = !neigh || !r.bairro || bairroConfere(neigh, r.bairro);
        if (ruaBate && bairroBate) aceitar({ lat: r.lat, lng: r.lng, displayName: r.displayName, cidades: r.cidades }, r.precisao);
      }
    }

    // A principal das duas ruas do texto, achada pela busca livre e guardada
    // para o encontro das duas tentar antes: ninguém achou a pequena, vale ela.
    if (!foundGeo && reservaRuaDoTexto) aceitar(reservaRuaDoTexto, "rua");

    // ── A RUA HOMÔNIMA, PELO BAIRRO ─────────────────────────────────────
    //
    // A rua existe em mais de um lugar e nenhum trecho diz o bairro do
    // cliente. Ficava o trecho MAIS LONGE — ou, antes dele, o centro do
    // bairro. Com o centro do bairro na mão, o trecho que fica nele é melhor
    // que os dois: a Travessa Pantanal de quem escreveu "Jardim Esperança" é
    // a da Vila Jardim Esperança, não a do Centro (Divinos, 25/09/2026). Ainda
    // é homônima (R3): o cliente confirma o ponto.
    if (!foundGeo && reservaHomonima && consultaDoBairro) {
      if (!temTempoNoMapa()) {
        esgotouOPrazo = true;
      } else {
        const r = await buscarLivre(consultaDoBairro);
        if (!r.ok) {
          falha ??= r.motivo;
        } else if (r.valor) {
          const perto = trechoMaisPerto(reservaHomonima.trechos, r.valor);
          if (perto && perto.km <= PERTO_DO_BAIRRO_KM) {
            aceitar(perto.trecho, "rua");
            motivos.push(`${reservaHomonima.motivo} — ficou o trecho a ${String(perto.km).replace(".", ",")} km do bairro`);
          }
        }
      }
    }

    const candidato: { lat: number; lng: number; displayName: string; cidades?: string[]; bairro?: string; suburb?: string; temNumero?: boolean } | null =
      reservaOutroBairro ?? reservaRuaUnica;
    if (!foundGeo && !reservaHomonima && candidato && consultaDoBairro) {
      if (!temTempoNoMapa()) {
        esgotouOPrazo = true;
      } else {
        const r = await buscarLivre(consultaDoBairro);
        if (!r.ok) {
          falha ??= r.motivo;
        } else {
          const km = r.valor ? haversineDistanceKm(candidato.lat, candidato.lng, r.valor.lat, r.valor.lng) : null;
          const ondeFica = candidato.bairro || candidato.suburb || "outro bairro";
          if (km == null || km <= PERTO_DO_BAIRRO_KM) {
            // O mesmo lugar com outro nome (ou o mapa não conhece o bairro:
            // nada contradiz a rua achada).
            aceitar(candidato, candidato.temNumero ? "endereco" : "rua");
          } else {
            motivoDoCandidato = `o mapa só achou a rua em "${ondeFica}", a ${km} km do bairro "${neigh}"`;
          }
        }
      }
    }

    // Uma busca não respondeu (fila cheia, prazo, 429, rede) e não se achou o
    // endereço pelos degraus bons: o que sobra é ponto de degrau pior (centro
    // do bairro, outra rua), que não entra no lugar do que se perdeu. É "não
    // deu para perguntar", não "o endereço não existe".
    if (!foundGeo && (falha || esgotouOPrazo)) {
      return falhou(esgotouOPrazo && !falha ? "prazo" : falha!, { maxRadiusKm, centroDaLoja: loja });
    }

    // Nível 5: o CENTRO do bairro — depois da busca pela rua, porque a rua no
    // bairro certo é um ponto melhor que o meio do bairro.
    if (!foundGeo && consultaDoBairro) {
      if (!temTempoNoMapa()) {
        return falhou("prazo", { maxRadiusKm, centroDaLoja: loja });
      }
      const r = await buscarLivre(consultaDoBairro);
      if (!r.ok) return falhou(r.motivo, { maxRadiusKm, centroDaLoja: loja });
      if (r.valor) {
        aceitar(r.valor, "bairro");
        motivos.push(motivoDoCandidato ? `${motivoDoCandidato} — o ponto é o centro do bairro` : `só o bairro "${neigh}" foi achado no mapa — o ponto é o centro dele`);
      }
    }

    // As reservas, da melhor para a pior. Todas valem como ponto aproximado:
    // o cliente vê a taxa estimada e confirma no mapa antes de fechar. A casa
    // achada com número vem antes do trecho de rua.
    if (!foundGeo && reservaOutroBairro) {
      aceitar(reservaOutroBairro, reservaOutroBairro.nivel === "endereco" || reservaOutroBairro.temNumero ? "endereco" : "rua");
      motivos.push(`o mapa achou a rua em "${reservaOutroBairro.bairro || "outro bairro"}", não em "${neigh}"`);
    }
    if (!foundGeo && reservaRuaUnica) {
      aceitar(reservaRuaUnica, "rua");
      motivos.push(`o mapa achou a rua em "${reservaRuaUnica.suburb || "outro bairro"}", não em "${neigh}"`);
    }
    if (!foundGeo && reservaHomonima) {
      aceitar(reservaHomonima.trecho, "rua");
      motivos.push(reservaHomonima.motivo);
    }
    if (!foundGeo && reservaOutraRua) {
      // A busca livre achou OUTRA rua do mesmo pedaço da cidade e a busca pela
      // rua não achou a do cliente.
      aceitar(reservaOutraRua, "bairro");
      motivos.push("o mapa achou outra rua perto, não a do cliente");
    }
    if (!foundGeo && reservaArea) {
      aceitar(reservaArea, "bairro");
      motivos.push(`o mapa só achou a região ("${reservaArea.bairro || reservaArea.displayName.split(",")[0]}") — o ponto é o centro dela`);
    }

    const achado = foundGeo;
    if (!achado) {
      return {
        addressFound: false,
        searchedQuery: customerAddressText,
        maxRadiusKm,
        reason: "Endereço não localizado no mapa.",
        motivoDaFalha: "nao-achado",
        centroDaLoja: loja,
      };
    }

    customerLat = achado.lat;
    customerLng = achado.lng;
    cidadesDoResultado = achado.cidades;
    origemDoPonto = precisao === "bairro" ? "bairro" : "mapa";

    // Homônimo em OUTRO município: a rua existe na cidade vizinha e o mapa foi
    // lá. Não é "fora": é "não sei" até o cliente confirmar.
    const outroMunicipio = storeCity ? foraDoMunicipio(storeCity, cidadesDoResultado, `${customerAddressText} ${parsedDetails?.city || ""}`) : null;
    if (outroMunicipio) motivos.push(`o mapa achou o endereço em ${outroMunicipio}, fora de ${storeCity}`);
  }

  // ── 3. A DISTÂNCIA: EM LINHA RETA OU PELAS RUAS ──────────────────────
  //
  // O raio é o padrão e é o círculo desenhado no mapa da loja. Mas ele
  // castiga quem está do outro lado de um rio, de uma linha de trem ou de um
  // morro: medido em Rio das Ostras, o Costazul fica a 1,17 km em linha reta
  // e 1,81 km de moto — 55% a mais. A loja que escolhe "por rota" passa a
  // cobrar pelo caminho que a moto faz.
  //
  // Roteador fora (ou rota de outro ponto): linha reta × o fator de desvio
  // DA LOJA, e a medida sai "estimada" — o pedido registra. Nunca mais a
  // linha reta pura, calada, que subcobrava até 48% em Cabo Frio.
  // A reta exata é a que se multiplica pelo fator (linhaRetaKm); a de 0,01 km
  // é a que se mostra e compara.
  const retaExata = linhaRetaKm(loja.lat, loja.lng, customerLat, customerLng);
  const emLinhaReta = Math.round(retaExata * 100) / 100;
  const textual = !coordsDoCliente;
  if (textual && emLinhaReta > 2 * maxRadiusKm) {
    motivos.push(`o ponto caiu a ${emLinhaReta} km da loja, mais que o dobro do raio de ${maxRadiusKm} km — provável homônimo`);
  }

  let distanceKm = emLinhaReta;
  let medida: MedidaDaDistancia = "linha-reta";
  let deslocamentoAteARuaM: number | null = null;
  let fator: number | undefined;
  let motivoDaEstimativa: string | undefined;
  // Pela rua a distância é MAIOR que a reta: quem já está fora em linha reta
  // está fora pela rua, e o roteador nem precisa ser incomodado.
  if (porRota && centesimos(emLinhaReta) <= centesimos(maxRadiusKm + FOLGA_DA_ULTIMA_FAIXA_KM)) {
    const rota = await rotaEntre(loja, { lat: customerLat, lng: customerLng }, { prazo });
    if (rota.ok) deslocamentoAteARuaM = rota.deslocamentoM;
    // Rota menor que a linha reta é impossível: o roteador arrastou o ponto
    // até uma rua mais perto da loja, e a rota é de outro lugar.
    if (rota.ok && rota.km >= emLinhaReta - 0.05) {
      distanceKm = rota.km;
      medida = "rota";
    } else {
      const f = await fatorDeDesvio(loja);
      fator = f.fator;
      distanceKm = estimarPelaLinhaReta(retaExata, f.fator);
      medida = "estimada";
      motivoDaEstimativa = rota.ok ? "rota menor que a linha reta (ponto arrastado até a rua)" : rota.motivo;
      console.warn(
        `[Taxa de entrega] distância ESTIMADA (${Math.round(retaExata * 1000) / 1000} km × ${f.fator}${f.amostras < 3 ? ", sem histórico" : ""} = ${distanceKm} km): ${motivoDaEstimativa}`,
      );
    }
  }
  if (textual && deslocamentoAteARuaM != null && deslocamentoAteARuaM > DESLOCAMENTO_SUSPEITO_M) {
    motivos.push(`o roteador arrastou o ponto ${deslocamentoAteARuaM} m até a rua — a rota é de outro lugar`);
  }

  // 4. A faixa (R5): limite inclusivo, 0,01 km, folga só na última.
  const { faixa, dentro } = radiusZones.length > 0
    ? faixaDaDistancia(radiusZones, distanceKm)
    : { faixa: null, dentro: centesimos(distanceKm) <= centesimos(maxRadiusKm) + centesimos(FOLGA_DA_ULTIMA_FAIXA_KM) };

  const baseStoreFee = Number(delivConfig?.deliveryFee || delivConfig?.defaultFee || 5.0);
  const deliveryFee = faixa ? faixa.fee : baseStoreFee;
  const estimatedTimeMin = faixa ? faixa.time : 45;
  const pedeConfirmacao = textual && motivos.length > 0;

  return {
    addressFound: true,
    searchedQuery: customerAddressText,
    matchedAddress: displayName,
    distanceKm,
    maxRadiusKm,
    isWithinRadius: dentro,
    deliveryFee,
    estimatedTimeMin,
    precisao,
    medidaPorRota: medida === "rota",
    distanciaEmLinhaRetaKm: emLinhaReta,
    clienteLat: customerLat,
    clienteLng: customerLng,
    centroDaLoja: loja,
    origemDoPonto,
    medida,
    ...(fator != null ? { fatorDeDesvio: fator } : {}),
    ...(motivoDaEstimativa ? { motivoDaEstimativa } : {}),
    ...(faixa ? { faixaKm: faixa.km } : {}),
    deslocamentoAteARuaM,
    pedeConfirmacao,
    ...(pedeConfirmacao ? { motivosDaConfirmacao: motivos } : {}),
  };
}
