/**
 * O ponto no mapa que o PARCEIRO já mandou junto do pedido.
 *
 * ── Por que isto vale mais que geocodificar ─────────────────────────────────
 *
 * O cliente marcou o endereço no app do parceiro, no mapa, com o dedo. Esse
 * ponto é o melhor dado que existe — melhor que qualquer geocodificação do
 * texto, que erra bairro homônimo, rua repetida em duas cidades e CEP truncado.
 * O pedido 17 da Lucas Pimenta caiu a 1,7 km da casa por causa de uma travessa
 * que o OpenStreetMap não conhece (10/09/2026).
 *
 * Isto nasceu só para o iFood (lib/ifood-coordenadas.ts). Em 13/09/2026 o
 * Frangoso reclamou que as localizações do 99Food batiam erradas — e o banco
 * confirmou: NENHUM pedido de 99Food tinha coordenada, todos caíam no texto.
 * A melhoria era de uma integração só; agora é de todas.
 *
 * ── Por que um leitor tolerante e não um por parceiro ───────────────────────
 *
 * Cada parceiro nomeia o campo do seu jeito (`coordinates.latitude`, `lat`,
 * `latitude`, `geo.lat`), às vezes como string. Escrever um leitor por parceiro
 * significa descobrir o formato de cada um em produção, um pedido por vez. Este
 * aqui procura os nomes conhecidos em qualquer profundidade razoável e valida o
 * que achou — o que não casar é ignorado, nunca chutado.
 */

export type Ponto = { lat: number; lng: number };

/** Brasil, com folga. Fora disto é dado errado, não endereço do cliente. */
function dentroDoBrasil(lat: number, lng: number): boolean {
  return lat >= -34 && lat <= 6 && lng >= -74 && lng <= -34;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  // String com vírgula decimal aparece em parceiro que serializa em pt-BR.
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v);
  return Number.isFinite(n) ? n : null;
}

/** Os pares de nomes que os parceiros usam, na ordem em que são procurados. */
const PARES: [string, string][] = [
  ["latitude", "longitude"],
  ["lat", "lng"],
  ["lat", "lon"],
  ["lat", "long"],
  ["latitude", "lng"],
  ["poi_lat", "poi_lng"],
  ["receiveLat", "receiveLng"],
];

/** Onde o ponto costuma estar dentro do objeto do endereço. */
const NINHOS = ["coordinates", "coordinate", "location", "geo", "geoLocation", "position", "point", "latLng", "latlng"];

function doObjeto(alvo: any): Ponto | null {
  if (!alvo || typeof alvo !== "object") return null;
  for (const [chaveLat, chaveLng] of PARES) {
    const lat = numero(alvo[chaveLat]);
    const lng = numero(alvo[chaveLng]);
    if (lat === null || lng === null) continue;
    if (lat === 0 && lng === 0) continue; // app que não conseguiu localizar
    if (!dentroDoBrasil(lat, lng)) continue;
    return { lat, lng };
  }
  return null;
}

/**
 * O ponto que veio no pedido do parceiro, ou `undefined`.
 *
 * `undefined`, nunca `null`: para o Prisma, null num campo Json exige
 * `Prisma.JsonNull` — passar null cru derruba o create do pedido inteiro.
 */
export function coordenadasDoParceiro(...candidatos: unknown[]): Ponto | undefined {
  for (const bruto of candidatos) {
    if (!bruto || typeof bruto !== "object") continue;
    const obj = bruto as Record<string, any>;

    // 1. No próprio objeto ({ latitude, longitude } solto no endereço).
    const direto = doObjeto(obj);
    if (direto) return direto;

    // 2. Num dos ninhos conhecidos.
    for (const ninho of NINHOS) {
      const dentro = doObjeto(obj[ninho]);
      if (dentro) return dentro;
    }

    // 3. Um nível abaixo, em qualquer objeto filho. Cobre
    //    `address.deliveryAddress.coordinates` sem precisar saber o caminho.
    for (const valor of Object.values(obj)) {
      if (!valor || typeof valor !== "object") continue;
      const nele = doObjeto(valor);
      if (nele) return nele;
      for (const ninho of NINHOS) {
        const fundo = doObjeto((valor as any)[ninho]);
        if (fundo) return fundo;
      }
    }
  }
  return undefined;
}

/**
 * O que o endereço do parceiro TEM, para o log quando não achamos o ponto.
 *
 * Sem isto, "parceiro não mandou coordenada" é um beco: ninguém sabe se o campo
 * não veio ou se veio com um nome que o leitor não conhece. Com a lista de
 * chaves no log, o próximo pedido real termina o trabalho.
 */
export function chavesDoEndereco(bruto: unknown): string {
  if (!bruto || typeof bruto !== "object") return "(sem objeto de endereço)";
  const obj = bruto as Record<string, any>;
  return Object.keys(obj)
    .map((k) => (obj[k] && typeof obj[k] === "object" ? `${k}{${Object.keys(obj[k]).slice(0, 8).join(",")}}` : k))
    .slice(0, 25)
    .join(", ");
}
