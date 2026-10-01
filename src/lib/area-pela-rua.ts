/**
 * src/lib/area-pela-rua.ts — ATÉ ONDE A MOTO CHEGA EM X KM DE RUA.
 *
 * A loja que cobra por km percorrido via no mapa círculos em linha reta, que
 * atravessam rio, muro e mar. O dono pediu o mapa "parecido com o do iFood"
 * (01/10/2026): manchas por faixa, seguindo as ruas. Isto pede ao Geoapify a
 * isolinha por DISTÂNCIA (type=distance, mode=drive — o mesmo carro da cotação)
 * para cada faixa e devolve um polígono por faixa.
 *
 * É só o DESENHO da tela da loja: a taxa continua saindo da rota de cada
 * pedido (lib/distancia-por-rota.ts). Na borda, o desenho e a cotação podem
 * discordar por alguns metros — o simulador do mapa diz o valor que vale.
 *
 * Custo: 1 crédito a cada 5 km pedidos (3.000/dia no grátis); os termos
 * permitem guardar o resultado. Fica em memória por loja+pino+faixas.
 */

export type AreaDaFaixa = {
  km: number;
  /** Anéis externos (e buracos) em [lat, lng], como o L.polygon aceita. */
  poligonos: [number, number][][][];
};

export type ResultadoDaArea = { ok: true; areas: AreaDaFaixa[]; doCache: boolean } | { ok: false; motivo: string };

const ISOLINHA = "https://api.geoapify.com/v1/isoline";
/** Até 10 faixas por pergunta (limite do Geoapify). */
const FAIXAS_POR_PERGUNTA = 10;
/** Maior faixa desenhada: acima disto o desenho sai caro e a loja não entrega. */
export const KM_MAXIMO_DA_AREA = 30;
/** Quantas vezes perguntar pelo resultado quando o Geoapify responde 202. */
const ESPERAS_DO_202 = 10;
const VALIDADE_MS = 7 * 24 * 60 * 60_000;
const TETO_DO_CACHE = 300;
/** Pontos por anel depois de afinar: o bastante para seguir a rua, leve para a tela. */
const PONTOS_POR_ANEL = 500;

const cache = new Map<string, { areas: AreaDaFaixa[]; em: number }>();

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function chaveDaArea(ponto: { lat: number; lng: number }, kms: number[]): string {
  return `${ponto.lat.toFixed(4)},${ponto.lng.toFixed(4)}|${kms.join(",")}`;
}

/** Os km das faixas, sem repetir, em ordem, dentro do limite. */
export function kmsDaArea(bruto: unknown[]): number[] {
  const kms = bruto
    .map((v) => Math.round(Number(v) * 100) / 100)
    .filter((k) => Number.isFinite(k) && k > 0 && k <= KM_MAXIMO_DA_AREA);
  return [...new Set(kms)].sort((a, b) => a - b).slice(0, 20);
}

/** [lng, lat] → [lat, lng], arredondado e afinado. */
function anel(coordenadas: unknown): [number, number][] {
  if (!Array.isArray(coordenadas)) return [];
  const pontos: [number, number][] = [];
  for (const c of coordenadas) {
    const lng = Number((c as any)?.[0]);
    const lat = Number((c as any)?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) pontos.push([Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]);
  }
  if (pontos.length <= PONTOS_POR_ANEL) return pontos;
  const passo = pontos.length / PONTOS_POR_ANEL;
  const afinado: [number, number][] = [];
  for (let i = 0; i < pontos.length; i += passo) afinado.push(pontos[Math.floor(i)]);
  return afinado;
}

function poligonosDaGeometria(g: any): [number, number][][][] {
  const lista: unknown[] = g?.type === "MultiPolygon" ? g.coordinates : g?.type === "Polygon" ? [g.coordinates] : [];
  const saida: [number, number][][][] = [];
  for (const poligono of lista || []) {
    if (!Array.isArray(poligono)) continue;
    const aneis = poligono.map(anel).filter((a) => a.length >= 3);
    if (aneis.length) saida.push(aneis);
  }
  return saida;
}

async function pedirIsolinhas(
  chave: string,
  ponto: { lat: number; lng: number },
  kms: number[],
): Promise<{ ok: true; areas: AreaDaFaixa[] } | { ok: false; motivo: string }> {
  const metros = kms.map((k) => Math.round(k * 1000));
  const url = `${ISOLINHA}?lat=${ponto.lat}&lon=${ponto.lng}&type=distance&mode=drive&range=${metros.join(",")}&apiKey=${encodeURIComponent(chave)}`;
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (e: any) {
    return { ok: false, motivo: `rede: ${e?.message || e}` };
  }
  let d: any = await r.json().catch(() => null);
  // 202: o cálculo ainda está rodando — a resposta traz o id para buscar depois.
  for (let i = 0; r.status === 202 && i < ESPERAS_DO_202; i++) {
    const id = d?.properties?.id || d?.id;
    if (!id) return { ok: false, motivo: "Geoapify: 202 sem id" };
    await dormir(1500);
    try {
      r = await fetch(`${ISOLINHA}?id=${encodeURIComponent(id)}&apiKey=${encodeURIComponent(chave)}`, { signal: AbortSignal.timeout(15_000) });
    } catch (e: any) {
      return { ok: false, motivo: `rede: ${e?.message || e}` };
    }
    d = await r.json().catch(() => null);
  }
  if (!r.ok) return { ok: false, motivo: `Geoapify: HTTP ${r.status} ${String(d?.message || "").slice(0, 100)}` };
  const features: any[] = Array.isArray(d?.features) ? d.features : [];
  const areas: AreaDaFaixa[] = [];
  for (const f of features) {
    const faixaM = Number(f?.properties?.range ?? f?.properties?.value);
    const km = Number.isFinite(faixaM) ? Math.round(faixaM / 10) / 100 : NaN;
    const poligonos = poligonosDaGeometria(f?.geometry);
    if (Number.isFinite(km) && poligonos.length) areas.push({ km, poligonos });
  }
  if (areas.length === 0) return { ok: false, motivo: "Geoapify: sem área na resposta" };
  return { ok: true, areas };
}

/** Já calculada (e ainda válida)? Para o freio de quem pede não contar o cache. */
export function areaNoCache(ponto: { lat: number; lng: number }, kmsBrutos: unknown[]): boolean {
  const g = cache.get(chaveDaArea(ponto, kmsDaArea(kmsBrutos)));
  return !!g && Date.now() - g.em < VALIDADE_MS;
}

export async function areaPelaRua(ponto: { lat: number; lng: number }, kmsBrutos: unknown[]): Promise<ResultadoDaArea> {
  if (!Number.isFinite(ponto?.lat) || !Number.isFinite(ponto?.lng)) return { ok: false, motivo: "ponto inválido" };
  const kms = kmsDaArea(kmsBrutos);
  if (kms.length === 0) return { ok: false, motivo: "sem faixa de km" };
  const chave = chaveDaArea(ponto, kms);
  const guardada = cache.get(chave);
  if (guardada && Date.now() - guardada.em < VALIDADE_MS) return { ok: true, areas: guardada.areas, doCache: true };

  const apiKey = String(process.env.GEOAPIFY_API_KEY || "").trim();
  if (!apiKey) return { ok: false, motivo: "GEOAPIFY_API_KEY ausente" };

  const areas: AreaDaFaixa[] = [];
  for (let i = 0; i < kms.length; i += FAIXAS_POR_PERGUNTA) {
    const r = await pedirIsolinhas(apiKey, ponto, kms.slice(i, i + FAIXAS_POR_PERGUNTA));
    if (!r.ok) return r;
    areas.push(...r.areas);
  }
  areas.sort((a, b) => a.km - b.km);
  if (cache.size >= TETO_DO_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(chave, { areas, em: Date.now() });
  return { ok: true, areas, doCache: false };
}
