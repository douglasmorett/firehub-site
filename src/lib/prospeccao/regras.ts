/**
 * Mapa de prospecção do vendedor — as regras puras (sem banco e sem rede), que o
 * navegador também usa.
 *
 * O mapa mostra os restaurantes de uma cidade pela Places API (New) do Google e
 * pinta cada um: cliente do FireHub, em negociação, não quis ou oportunidade.
 * As cotas do Google estão TRAVADAS na faixa grátis (Douglas, 18/10/2026: "sem
 * custo nesse momento") no projeto gen-lang-client-0505076953:
 *   - SearchTextRequest e SearchNearbyRequest: 160 por dia cada (5.000 grátis/mês);
 *   - GetPlaceRequest: 32 por dia (o cartão com telefone e site é Enterprise: 1.000 grátis/mês);
 *   - Map loads: 300 por dia (10.000 grátis/mês); fotos, avaliações e autocomplete: 0.
 * O dia da cota do Google vira à meia-noite do Pacífico — o nosso contador também.
 * Os limites daqui ficam um pouco abaixo da trava, para a tela avisar antes do erro.
 */

/**
 * `texto` (Text Search) e `area` (Nearby Search) são SKUs diferentes no Google,
 * cada um com os seus 5.000 grátis por mês e a sua trava de 160 por dia.
 */
export const LIMITES_DO_DIA = { texto: 150, area: 150, contato: 30 } as const;
export type TipoDeUso = keyof typeof LIMITES_DO_DIA;

export const STATUS_DA_MARCACAO = ["negociacao", "sem_interesse", "oportunidade"] as const;
export type StatusDaMarcacao = (typeof STATUS_DA_MARCACAO)[number];
/** O status do pino: cliente vem do nosso banco; os outros, do que o vendedor marcou. */
export type StatusDoPino = "cliente" | StatusDaMarcacao;

/** Cada busca da cidade é "<termo> em <cidade>": 1 consulta do Google, até 20 lugares. */
export const TERMOS_DA_CIDADE = ["restaurante", "lanchonete", "pizzaria", "hamburgueria"] as const;
export const TERMOS_EXTRAS = [
  "açaí", "marmitaria", "japonês sushi", "espetinho", "pastelaria", "churrascaria",
  "esfiha comida árabe", "padaria", "sorveteria", "doceria", "pastel e caldo de cana", "comida mineira",
] as const;

/** Os campos da busca: só os de nível Pro (5.000 grátis). Telefone e site são Enterprise e ficam no cartão. */
export const CAMPOS_DA_BUSCA = ["id", "displayName", "formattedAddress", "location", "primaryType", "businessStatus", "googleMapsURI"] as const;
export const CAMPOS_DO_CONTATO = ["nationalPhoneNumber", "internationalPhoneNumber", "websiteURI", "rating", "userRatingCount", "regularOpeningHours"] as const;
/** "Buscar nesta área": tipos da Tabela A do Places (New). */
export const TIPOS_DA_AREA = ["restaurant", "meal_takeaway", "meal_delivery", "fast_food_restaurant", "sandwich_shop", "bakery"] as const;

/** Dia da cota do Google (meia-noite do Pacífico), como "AAAA-MM-DD". */
export function diaDaCotaDoGoogle(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
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

// ── A varredura por áreas ───────────────────────────────────────────────────
//
// O Google devolve no máximo 20 lugares por busca, os mais relevantes — numa
// cidade inteira, os do centro. Para os bairros de fora aparecerem, a cidade é
// cortada em células e cada célula é uma busca por perto, do mais próximo para
// o mais longe. Célula que volta com 20 está "cheia" (pode ter mais) e pode ser
// cortada em 4.

export type Celula = CaixaDaCidade & { id: string; nivel: number; centro: { lat: number; lng: number }; raio: number };

const METROS_POR_GRAU = 111320;

export function celulaDaCaixa(c: CaixaDaCidade, nivel: number): Celula {
  const centro = { lat: (c.sul + c.norte) / 2, lng: (c.oeste + c.leste) / 2 };
  return {
    ...c, nivel, centro,
    id: `${nivel}:${c.sul.toFixed(5)},${c.oeste.toFixed(5)}`,
    // O círculo que cobre a célula inteira (meia diagonal), com o teto de 50 km do Google.
    raio: Math.min(50000, Math.ceil(metrosEntre(centro, { lat: c.norte, lng: c.leste }))),
  };
}

/** Lado e tamanho da caixa em metros. */
function medidas(c: CaixaDaCidade) {
  const alto = (c.norte - c.sul) * METROS_POR_GRAU;
  const largo = (c.leste - c.oeste) * METROS_POR_GRAU * Math.cos((((c.sul + c.norte) / 2) * Math.PI) / 180);
  return { alto, largo };
}

/**
 * Corta a área em células quadradas de pelo menos `ladoMinimo` metros, com no
 * máximo `maximo` células (o lado cresce até caber).
 */
export function gradeDaArea(c: CaixaDaCidade, maximo = 30, ladoMinimo = 1200): Celula[] {
  const { alto, largo } = medidas(c);
  if (!(alto > 0 && largo > 0)) return [];
  let lado = Math.max(ladoMinimo, Math.sqrt((alto * largo) / maximo));
  let linhas = Math.max(1, Math.ceil(alto / lado));
  let colunas = Math.max(1, Math.ceil(largo / lado));
  while (linhas * colunas > maximo) {
    lado *= 1.1;
    linhas = Math.max(1, Math.ceil(alto / lado));
    colunas = Math.max(1, Math.ceil(largo / lado));
  }
  const dLat = (c.norte - c.sul) / linhas;
  const dLng = (c.leste - c.oeste) / colunas;
  const saida: Celula[] = [];
  for (let i = 0; i < linhas; i++) {
    for (let j = 0; j < colunas; j++) {
      saida.push(celulaDaCaixa({ sul: c.sul + i * dLat, norte: c.sul + (i + 1) * dLat, oeste: c.oeste + j * dLng, leste: c.oeste + (j + 1) * dLng }, 0));
    }
  }
  return saida;
}

/** A célula cheia vira 4. */
export function dividirCelula(c: Celula): Celula[] {
  const lat = (c.sul + c.norte) / 2;
  const lng = (c.oeste + c.leste) / 2;
  return [
    { sul: c.sul, norte: lat, oeste: c.oeste, leste: lng },
    { sul: c.sul, norte: lat, oeste: lng, leste: c.leste },
    { sul: lat, norte: c.norte, oeste: c.oeste, leste: lng },
    { sul: lat, norte: c.norte, oeste: lng, leste: c.leste },
  ].map((x) => celulaDaCaixa(x, c.nivel + 1));
}

/**
 * A área a varrer: onde as buscas da cidade acharam restaurantes, com uma
 * folga larga (metade do tamanho de cada lado, pelo menos ~2 km): a busca por nome
 * acha o centro e os bairros de fora ficavam fora da grade (Rio das Ostras,
 * 18/10). Sem passar da caixa do município — a caixa
 * inteira pega a zona rural e gastaria busca à toa.
 */
export function areaParaVarrer(pontos: { lat: number; lng: number }[], cidade: CaixaDaCidade | null): CaixaDaCidade | null {
  if (pontos.length < 2) return cidade;
  let c: CaixaDaCidade = { sul: Infinity, norte: -Infinity, oeste: Infinity, leste: -Infinity };
  for (const p of pontos) {
    c = { sul: Math.min(c.sul, p.lat), norte: Math.max(c.norte, p.lat), oeste: Math.min(c.oeste, p.lng), leste: Math.max(c.leste, p.lng) };
  }
  const fLat = Math.max((c.norte - c.sul) * 0.5, 0.018);
  const fLng = Math.max((c.leste - c.oeste) * 0.5, 0.018);
  c = { sul: c.sul - fLat, norte: c.norte + fLat, oeste: c.oeste - fLng, leste: c.leste + fLng };
  if (cidade) {
    const corte = { sul: Math.max(c.sul, cidade.sul), norte: Math.min(c.norte, cidade.norte), oeste: Math.max(c.oeste, cidade.oeste), leste: Math.min(c.leste, cidade.leste) };
    if (corte.sul < corte.norte && corte.oeste < corte.leste) c = corte;
  }
  return c;
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
