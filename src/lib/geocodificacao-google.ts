/**
 * O GOOGLE como segunda fonte de endereço da cotação de frete.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O mapa aberto (OpenStreetMap/Nominatim) é bom de rua e fraco de NÚMERO no
 * Brasil, e em bairro de periferia falta rua inteira: a travessa não está no
 * mapa, o bairro tem outro nome ("Vila Jardim Esperança"), a rua existe em
 * dois cantos da cidade. Divinos Burger, 25/09/2026: o robô não achou o
 * endereço e chamou um atendente. Resolver cidade a cidade não escala; o
 * cadastro de endereços do Google cobre o país inteiro, com número.
 *
 * ── Como entra ──────────────────────────────────────────────────────────────
 *
 * Só quando o mapa aberto NÃO achou o endereço com segurança (a cascata de
 * lib/geocoding.ts, `verifyStoreDeliveryAddress`), e só com a chave no
 * ambiente (`GOOGLE_MAPS_API_KEY`) — sem ela, nada muda. O resultado precisa
 * ser da cidade da loja e, com rua e bairro escritos pelo cliente, bater com
 * eles; senão não vale. Custo: 10 mil consultas grátis por mês e US$ 5 por
 * mil depois — com o cache (o mesmo endereço não é pago duas vezes, nem o
 * "não achei") e o teto diário (`GOOGLE_GEOCODING_TETO_DIA`, padrão 1.000),
 * a conta não foge.
 *
 * Este arquivo é a leitura da resposta (pura, testada) e a chamada; o cache e
 * o teto moram em lib/geocodificacao-servidor.ts.
 * Teste: scripts/teste-motor-da-entrega.ts (seção do Google).
 */
import type { RespostaDoMapa } from "./geocoding";

export type PrecisaoDoGoogle = "endereco" | "rua" | "bairro";

export type ResultadoDoGoogle = {
  lat: number;
  lng: number;
  displayName: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  cidades: string[];
  precisao: PrecisaoDoGoogle;
};

const URL_DO_GOOGLE = "https://maps.googleapis.com/maps/api/geocode/json";

/** A chave, ou "" — sem ela o Google fica desligado. */
export function chaveDoGoogle(): string {
  return String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
}

const normal = (t: unknown) =>
  String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** "Cabo Frio" e "Município de Cabo Frio" são o mesmo lugar. */
function mesmoMunicipio(a: unknown, b: unknown): boolean {
  const x = normal(a), y = normal(b);
  if (!x || !y) return false;
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

/**
 * A resposta do Geocoding API lida para a cotação. `valor: null` = o Google
 * não tem um ponto que sirva (não achou, só a cidade, ou outra cidade).
 * `ok: false` = não deu para perguntar (chave recusada, cota, erro).
 */
export function lerRespostaDoGoogle(d: any, cidadeDaLoja?: string | null): RespostaDoMapa<ResultadoDoGoogle | null> {
  const status = String(d?.status || "");
  if (status === "ZERO_RESULTS") return { ok: true, valor: null };
  if (status !== "OK") {
    return { ok: false, motivo: `google: ${status || "sem resposta"}${d?.error_message ? ` (${String(d.error_message).slice(0, 120)})` : ""}` };
  }
  const r = Array.isArray(d?.results) ? d.results[0] : null;
  if (!r) return { ok: true, valor: null };

  const componentes: any[] = Array.isArray(r.address_components) ? r.address_components : [];
  const comp = (tipo: string) => componentes.find((c) => Array.isArray(c?.types) && c.types.includes(tipo))?.long_name as string | undefined;
  const rua = comp("route");
  const numero = comp("street_number");
  const bairro = comp("sublocality_level_1") || comp("sublocality") || comp("neighborhood");
  const cidades = [comp("administrative_area_level_2"), comp("locality")].filter((c): c is string => !!c);
  const tipos: string[] = Array.isArray(r.types) ? r.types : [];
  const tipoDoPonto = String(r.geometry?.location_type || "");
  const exato = tipoDoPonto === "ROOFTOP" || tipoDoPonto === "RANGE_INTERPOLATED";

  let precisao: PrecisaoDoGoogle | null = null;
  // A casa: ponto no número (ou interpolado entre números) e tudo casou.
  if (exato && numero && rua && r.partial_match !== true) precisao = "endereco";
  // A rua: achou a rua (o número, se veio, não casou por inteiro).
  else if (rua && (exato || tipos.includes("route") || tipos.includes("street_address") || tipoDoPonto === "GEOMETRIC_CENTER")) precisao = "rua";
  // Só o bairro.
  else if (bairro && tipos.some((t) => t.startsWith("sublocality") || t === "neighborhood")) precisao = "bairro";
  // Cidade, estado, país: não é ponto de entrega.
  if (!precisao) return { ok: true, valor: null };

  // Outra cidade é homônimo: não vale.
  if (cidadeDaLoja && cidades.length > 0 && !cidades.some((c) => mesmoMunicipio(c, cidadeDaLoja))) return { ok: true, valor: null };

  const lat = Number(r.geometry?.location?.lat);
  const lng = Number(r.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: true, valor: null };

  return {
    ok: true,
    valor: { lat, lng, displayName: String(r.formatted_address || ""), rua, numero, bairro, cidades, precisao },
  };
}

/** A consulta ao Google, com o viés para a região da loja (bounds ~25 km). */
export async function buscarNoGoogle(
  endereco: string,
  cidade: string,
  centro: { lat: number; lng: number } | null,
  timeoutMs: number,
): Promise<RespostaDoMapa<ResultadoDoGoogle | null>> {
  const chave = chaveDoGoogle();
  if (!chave) return { ok: true, valor: null };
  const texto = [endereco, cidade && !normal(endereco).includes(normal(cidade)) ? cidade : ""].filter(Boolean).join(", ");
  const params = new URLSearchParams({ address: texto, components: "country:BR", region: "br", language: "pt-BR", key: chave });
  if (centro) {
    const d = 0.25;
    params.set("bounds", `${centro.lat - d},${centro.lng - d}|${centro.lat + d},${centro.lng + d}`);
  }
  try {
    const res = await fetch(`${URL_DO_GOOGLE}?${params}`, { signal: AbortSignal.timeout(Math.max(500, timeoutMs)) });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return { ok: false, motivo: `google: HTTP ${res.status}` };
    return lerRespostaDoGoogle(d, cidade);
  } catch (e: any) {
    const tempo = e?.name === "TimeoutError" || e?.name === "AbortError";
    return { ok: false, motivo: tempo ? "google: sem resposta a tempo" : `google: ${e?.message || e}` };
  }
}
