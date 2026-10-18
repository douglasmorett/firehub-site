/**
 * Mapa de prospecção do vendedor — as regras puras (sem banco e sem rede), que o
 * navegador também usa. A varredura da cidade (a grade) mora em ./varredura.ts.
 *
 * O mapa mostra TODOS os lugares de comida de uma cidade pela Places API (New)
 * do Google e pinta cada um: cliente do FireHub, em negociação, não quis ou
 * oportunidade. O que se gasta do Google é contado por MÊS e por SKU
 * (varredura.ts, SKUS), contra o grátis de cada SKU. As travas por dia do
 * Google Cloud (projeto gen-lang-client-0505076953: SearchNearby 160/dia,
 * GetPlace 32/dia, Map loads 300/dia) continuam lá: quando o Google para por
 * elas, a varredura pausa e continua depois. O dia/mês do Google vira à
 * meia-noite do Pacífico.
 */

export const STATUS_DA_MARCACAO = ["negociacao", "sem_interesse", "oportunidade"] as const;
export type StatusDaMarcacao = (typeof STATUS_DA_MARCACAO)[number];
/** O status do pino: cliente vem do nosso banco; os outros, do que o vendedor marcou. */
export type StatusDoPino = "cliente" | StatusDaMarcacao;

/** "Buscar também": termos que pegam o que tem tipo fora da comida no Google (marmitaria cadastrada como "loja"). Text Search Pro. */
export const TERMOS_EXTRAS = [
  "açaí", "marmitaria", "japonês sushi", "espetinho", "pastelaria", "churrascaria",
  "esfiha comida árabe", "padaria", "sorveteria", "doceria", "pastel e caldo de cana", "comida mineira",
] as const;

/**
 * Os campos das buscas (varredura e "buscar também"): todos do SKU Pro — o
 * mais barato do Nearby Search (ele não tem Essentials). Telefone, site,
 * horário e nota são Enterprise e ficam no cartão (Place Details Enterprise).
 * Fonte: developers.google.com/maps/documentation/places/web-service/nearby-search (seção SKUs).
 */
export const CAMPOS_DA_BUSCA = ["id", "displayName", "formattedAddress", "location", "primaryType", "businessStatus", "googleMapsURI"] as const;
export const CAMPOS_DO_CONTATO = ["nationalPhoneNumber", "internationalPhoneNumber", "websiteURI", "rating", "userRatingCount", "regularOpeningHours"] as const;

/** Dia da cota do Google (meia-noite do Pacífico), como "AAAA-MM-DD". */
export function diaDaCotaDoGoogle(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * O texto que vai ao Nominatim: "Trindade - GO" → "Trindade, GO, Brasil". Com
 * o hífen o Nominatim devolve RUAS (a "Avenida Brasil" de Trindade), não a cidade.
 */
export function consultaDaCidade(s: string): string {
  return `${s.trim().replace(/\s*[-/(]\s*([A-Za-z]{2})\)?\s*$/, ", $1")}, Brasil`;
}

/** "Trindade - GO", "trindade/go", " Trindade " → "trindade". */
export function nomeDaCidade(s: string | null | undefined): string {
  if (!s) return "";
  return semAcento(s).toLowerCase().replace(/\s*[-/,(]\s*[a-z]{2}\)?\s*$/, "").replace(/\s+/g, " ").trim();
}

// Palavras que todo restaurante tem e não dizem QUAL é.
const PALAVRAS_GENERICAS = new Set([
  "a", "o", "as", "os", "e", "de", "da", "do", "das", "dos", "na", "no", "em", "the", "&",
  "restaurante", "lanchonete", "lanches", "lanche", "pizzaria", "pizza", "pizzas", "hamburgueria", "burger", "burguer",
  "delivery", "bar", "food", "foods", "grill", "cafe", "cafeteria", "acai", "acaiteria", "sushi", "temakeria",
  "espetinho", "espetinhos", "pastelaria", "pastel", "marmitaria", "marmitex", "marmita", "comida", "caseira",
  "churrascaria", "padaria", "sorveteria", "doceria", "lancheria", "petiscaria", "cozinha", "casa", "ltda", "me",
]);

export function palavrasDoNome(nome: string): string[] {
  return semAcento(nome).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((p) => p.length > 1 && !PALAVRAS_GENERICAS.has(p));
}

/** Distância em metros entre dois pontos (haversine). */
export function metrosEntre(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Quanto dois nomes de restaurante se parecem, de 0 a 1 (palavras que não são genéricas). */
export function parecencaDosNomes(a: string, b: string): number {
  const pa = palavrasDoNome(a);
  const pb = palavrasDoNome(b);
  if (!pa.length || !pb.length) return 0;
  const sb = new Set(pb);
  const comuns = pa.filter((p) => sb.has(p)).length;
  if (!comuns) {
    // "Frangoso" e "Frangoso's": um nome dentro do outro, sem espaço.
    const ja = pa.join("");
    const jb = pb.join("");
    return ja.length >= 5 && jb.length >= 5 && (ja.includes(jb) || jb.includes(ja)) ? 0.8 : 0;
  }
  return comuns / Math.min(pa.length, pb.length);
}

export type LojaDoMapa = {
  id: string;
  nome: string;
  lat: number | null;
  lng: number | null;
  endereco: string | null;
  slug: string | null;
  semCardapio: boolean;
  vendedor: string | null;
};

/**
 * O lugar do Google é uma loja nossa? Nome parecido e perto (até 1,5 km — o
 * ponto da loja às vezes é o do cadastro, não o da porta). Loja sem ponto casa
 * só pelo nome, com régua mais alta. Devolve a loja mais parecida.
 */
export function lojaDoLugar(
  lugar: { nome: string; lat: number; lng: number },
  lojas: LojaDoMapa[],
): LojaDoMapa | null {
  let melhor: { loja: LojaDoMapa; nota: number } | null = null;
  for (const loja of lojas) {
    const parece = parecencaDosNomes(lugar.nome, loja.nome);
    if (parece < 0.5) continue;
    let nota = parece;
    if (loja.lat != null && loja.lng != null) {
      const m = metrosEntre(lugar, { lat: loja.lat, lng: loja.lng });
      if (m > 1500) continue;
      nota += 1 - m / 1500;
    } else if (parece < 1) {
      continue;
    }
    if (!melhor || nota > melhor.nota) melhor = { loja, nota };
  }
  return melhor?.loja ?? null;
}

export type CaixaDaCidade = { sul: number; oeste: number; norte: number; leste: number };

export function dentroDaCaixa(p: { lat: number; lng: number }, c: CaixaDaCidade): boolean {
  return p.lat >= c.sul && p.lat <= c.norte && p.lng >= c.oeste && p.lng <= c.leste;
}

/** Link "Como chegar" do Google Maps — abre o app, não gasta cota. */
export function linkComoChegar(lugar: { nome: string; lat: number; lng: number; placeId?: string | null }): string {
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  u.searchParams.set("destination", `${lugar.lat},${lugar.lng}`);
  if (lugar.placeId) u.searchParams.set("destination_place_id", lugar.placeId);
  return u.toString();
}

/** "(62) 99999-0000" → link do WhatsApp com 55 na frente; fixo também vai (o WhatsApp avisa se não tiver). */
export function linkDoWhatsapp(telefone: string | null | undefined): string | null {
  if (!telefone) return null;
  let d = telefone.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12) return null;
  return `https://wa.me/${d}`;
}
