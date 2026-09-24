import { distanciaPorRotaKm, medicaoDaLoja } from "@/lib/distancia-por-rota";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { nomeDeRuaParecido } from "@/lib/geocodificacao";

// Calcula a distância exata em linha reta (KM) usando a fórmula Haversine
// Alinhado 100% com os círculos de raio desenhados no mapa Leaflet de configurações da loja
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
  const straightDistance = R * c;
  // Distância exata em linha reta geométrica
  return Math.round(straightDistance * 100) / 100;
}

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
   * "endereco" = o endereço foi achado; "rua" = a rua foi achada pela busca
   * estruturada (número não confere); "bairro" = só o centro do bairro (nível 4).
   */
  precisao?: "endereco" | "rua" | "bairro";
  /** A distância veio das RUAS (roteamento), não da linha reta. */
  medidaPorRota?: boolean;
  /** A linha reta, sempre — serve para a tela explicar a diferença. */
  distanciaEmLinhaRetaKm?: number;
  /** Onde o mapa colocou o cliente. É o que a área de risco consulta. */
  clienteLat?: number;
  clienteLng?: number;
};

// Geocodifica um endereço via OpenStreetMap Nominatim API com priorização geográfica (viewbox)
export async function geocodeAddress(
  addressQuery: string,
  storeCenter?: { lat: number; lng: number } | null
): Promise<{ lat: number; lng: number; displayName: string; rua?: string } | null> {
  if (!addressQuery || addressQuery.trim().length < 3) return null;
  try {
    const cleanQuery = addressQuery
      .replace(/lt\s*\d+|qd\s*\d+|casa\s*\d+|ap\s*\d+|apt\s*\d+|bloco\s*\w+/gi, "")
      .trim();

    let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&limit=1&addressdetails=1&countrycodes=br`;
    if (storeCenter && storeCenter.lat && storeCenter.lng) {
      const delta = 0.25; // ~25km de raio ao redor da loja para restringir homônimos
      const left = (storeCenter.lng - delta).toFixed(4);
      const right = (storeCenter.lng + delta).toFixed(4);
      const top = (storeCenter.lat + delta).toFixed(4);
      const bottom = (storeCenter.lat - delta).toFixed(4);
      url += `&viewbox=${left},${top},${right},${bottom}&bounded=0`;
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "FireHub-DeliveryEngine/2.0", "Accept-Language": "pt-BR" },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const a = data[0].address || {};
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name,
        // A rua que o mapa entendeu — é por ela que se confere se ele achou a
        // rua do cliente ou outra do mesmo bairro (ver verifyStoreDeliveryAddress).
        rua: a.road || a.pedestrian || a.footway || a.residential || undefined,
      };
    }
  } catch (err: any) {
    console.warn("[Geocoding] Nominatim lookup falhou:", err?.message);
  }
  return null;
}

/**
 * Busca ESTRUTURADA (street= + city=). Medido em 07/09/2026 em Rio das Ostras:
 * a busca livre não achava "Rua Valença", "Rua José do Patrocínio", "Rua São
 * Paulo" nem "Rua Juriti"; a estruturada acha as quatro, com o bairro de cada
 * trecho. É o que separa "não sei" de "atende" para metade dos endereços que o
 * robô recebe. Devolve até 5 trechos: a mesma rua pode existir em mais de um
 * bairro, e quem chama decide o que fazer com a ambiguidade.
 */
export async function geocodeStreetStructured(
  street: string,
  city: string,
  storeCenter?: { lat: number; lng: number } | null
): Promise<Array<{ lat: number; lng: number; displayName: string; suburb: string; rua: string }>> {
  if (!street || street.trim().length < 3 || !city) return [];
  try {
    let url = `https://nominatim.openstreetmap.org/search?format=json&street=${encodeURIComponent(street.trim())}&city=${encodeURIComponent(city.trim())}&country=Brasil&limit=5&addressdetails=1`;
    if (storeCenter && storeCenter.lat && storeCenter.lng) {
      const delta = 0.25;
      url += `&viewbox=${(storeCenter.lng - delta).toFixed(4)},${(storeCenter.lat + delta).toFixed(4)},${(storeCenter.lng + delta).toFixed(4)},${(storeCenter.lat - delta).toFixed(4)}&bounded=1`;
    }
    const res = await fetch(url, {
      headers: { "User-Agent": "FireHub-DeliveryEngine/2.0", "Accept-Language": "pt-BR" },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((d: any) => ({
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      displayName: String(d.display_name || ""),
      suburb: String(d.address?.suburb || d.address?.neighbourhood || d.address?.city_district || d.address?.quarter || ""),
      // A busca por "WE 62" devolvia um comércio no número 62 da Travessa WE 13:
      // quem chama confere a rua por este campo.
      rua: String(d.address?.road || d.address?.pedestrian || d.address?.footway || ""),
    })).filter((d: any) => Number.isFinite(d.lat) && Number.isFinite(d.lng));
  } catch (err: any) {
    console.warn("[Geocoding] busca estruturada falhou:", err?.message);
    return [];
  }
}

/** "Rua Sol Nascente, 23, Aquários" → "Rua Sol Nascente". Só o logradouro, sem número, bairro ou complemento. */
export function extrairLogradouro(texto: string): string {
  const m = String(texto || "").match(
    /\b(rua|r\.|avenida|av\.?|travessa|tv\.|alameda|al\.|estrada|est\.|rodovia|rod\.|pra[çc]a|largo|beco|via|servid[ãa]o)\s+([^,;\-\n\d(]{3,60})/i
  );
  if (!m) return "";
  const tipo = m[1].toLowerCase().replace(".", "");
  const nomes: Record<string, string> = { r: "Rua", av: "Avenida", tv: "Travessa", al: "Alameda", est: "Estrada", rod: "Rodovia", praca: "Praça" };
  const tipoCheio = nomes[tipo] || (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase());
  return `${tipoCheio} ${m[2].trim().replace(/\s+(n[º°o]?|numero|número|casa|lote|lt|quadra|qd|s\/n)\b.*$/i, "").trim()}`;
}

// Algarismo romano sozinho vira n\u00famero para COMPARAR bairro: o cliente escreve
// "Cidade Nova 5" e o mapa chama de "Cidade Nova V" (Ananindeua, 24/09/2026).
const ROMANOS: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10", xi: "11", xii: "12",
};

function normalizarParaComparar(t: string): string {
  return String(t || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,2})\b/g, (m) => ROMANOS[m] || m)
    .replace(/\s+/g, " ").trim();
}

/**
 * O endere\u00e7o sem o que \u00e9 REFER\u00caNCIA.
 *
 * "WE 62, 661 - Cidade Nova 5 (pr\u00f3ximo ao Colina)" n\u00e3o voltava NADA do mapa: o
 * Nominatim tenta casar "pr\u00f3ximo ao Colina" como parte do endere\u00e7o e desiste.
 * Refer\u00eancia ajuda o motoboy, n\u00e3o o mapa \u2014 sai o par\u00eantese inteiro e as frases
 * de refer\u00eancia at\u00e9 a pr\u00f3xima v\u00edrgula ("perto do mercado", "em frente \u00e0
 * igreja", "ref: port\u00e3o azul").
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
 * Com o tipo escrito ("Rua Sol Nascente, 23"), \u00e9 ela e pronto. Sem o tipo, o
 * rob\u00f4 n\u00e3o procurava rua nenhuma: em Ananindeua as travessas da Cidade Nova se
 * chamam "WE 62", "SN 10" \u2014 e o cliente escreve assim, sem "Travessa". O mapa
 * conhece como "Travessa WE 62". A\u00ed se tenta o nome com os tipos mais comuns;
 * quem chama confere se a rua achada \u00e9 mesmo essa (`nomeDeRuaParecido`).
 */
export function logradourosCandidatos(texto: string): string[] {
  const explicito = extrairLogradouro(texto);
  if (explicito) return [explicito];
  // O c\u00f3digo de rua da Cidade Nova de Ananindeua: WE (as travessas) e SN.
  // Procurado em qualquer ponto do texto, porque no rob\u00f4 o endere\u00e7o chega no
  // meio da conversa. Outros c\u00f3digos entram aqui quando aparecerem \u2014 lista
  // aberta a esmo ("DE 10", "AS 20") acharia rua em frase comum.
  const codigo = String(texto || "").match(/\b(WE|SN)\s*-?\s*(\d{1,4})\b/i);
  if (codigo) {
    const nome = `${codigo[1].toUpperCase()} ${codigo[2]}`;
    return [`Travessa ${nome}`, `Rua ${nome}`];
  }
  return [];
}

/** A rua do resultado \u00e9 a que o cliente escreveu? Sem rua no resultado, n\u00e3o d\u00e1 para afirmar. */
function ruaConfere(procurada: string, achada: string | undefined): boolean {
  if (!achada) return false;
  return nomeDeRuaParecido(procurada, achada);
}

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
  parsedDetails?: { street?: string; number?: string; neighborhood?: string; city?: string }
): Promise<DeliveryZoneCheckResult | null> {
  const zones = Array.isArray(deliveryZones) ? deliveryZones : [];

  // 1. Obter lat/lng da Loja (puxando as coordenadas exatas configuradas pelo lojista)
  //
  // A leitura é a compartilhada (lib/ponto-da-loja): a que existia aqui exigia
  // `typeof lat === "number"` e devolvia "sem ponto" para o mesmo campo gravado
  // como texto — e aí a loja caía na geocodificação do endereço mesmo tendo
  // pino salvo.
  let storeCenter: { lat: number; lng: number } | null = lerPontoDaLoja(storeLatLng);

  if ((!storeCenter || !storeCenter.lat) && storeAddress) {
    // A cidade entra só se a loja tiver uma. O padrão era "Rio das Ostras":
    // loja sem cidade cadastrada tinha o PRÓPRIO endereço procurado em Rio das
    // Ostras, e o raio de entrega passava a ser medido de lá.
    const storeGeo = await geocodeAddress([storeAddress, storeCity].filter(Boolean).join(", "));
    if (storeGeo) storeCenter = { lat: storeGeo.lat, lng: storeGeo.lng };
  }

  if (!storeCenter || !storeCenter.lat || !storeCenter.lng) {
    return null;
  }

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

  // 2. Coordenadas do Cliente (via GPS direto ou Geocodificação Ancorada no Bairro)
  let customerLat: number | null = customerCoords?.lat || null;
  let customerLng: number | null = customerCoords?.lng || null;
  let displayName: string = customerAddressText;
  let precisao: "endereco" | "rua" | "bairro" = "endereco";

  if (customerLat === null || customerLng === null) {
    const street = parsedDetails?.street?.trim() || "";
    const num = parsedDetails?.number?.trim() || "";
    const neigh = parsedDetails?.neighborhood?.trim() || "";
    const city = parsedDetails?.city?.trim() || storeCity || "";

    const candidateQueries: string[] = [];

    // Nível 1: Rua + Número + Bairro + Cidade (Máxima precisão ancorada no bairro)
    if (street && num && neigh) {
      candidateQueries.push(`${street}, ${num} - ${neigh}, ${city}`);
      candidateQueries.push(`${street}, ${num}, ${neigh}, ${city}`);
    }

    // Nível 2: Rua + Bairro + Cidade (Garante que a rua buscada seja dentro deste bairro)
    if (street && neigh) {
      candidateQueries.push(`${street}, ${neigh}, ${city}`);
    }

    // Nível 3: Query completa fornecida — sem as referências ("(próximo ao
    // Colina)"), que fazem o mapa não achar nada.
    const textoParaOMapa = semReferencias(customerAddressText) || customerAddressText;
    if (textoParaOMapa && textoParaOMapa.trim().length >= 4) {
      const full = textoParaOMapa.toLowerCase().includes(city.toLowerCase())
        ? textoParaOMapa
        : `${textoParaOMapa}, ${city}`;
      if (!candidateQueries.includes(full)) candidateQueries.push(full);
    }

    // Nível 4: Centro do Bairro na Cidade (Fallback seguro para evitar pegar rua homônima em outro bairro ou município)
    let indiceDoFallbackDeBairro = -1;
    if (neigh) {
      const neighFallback = `${neigh}, ${city}`;
      if (!candidateQueries.includes(neighFallback)) {
        indiceDoFallbackDeBairro = candidateQueries.length;
        candidateQueries.push(neighFallback);
      }
    }

    // ── A RUA ACHADA TEM QUE SER A DO CLIENTE ────────────────────────────
    //
    // A busca livre é generosa: "WE 62, 661 - Cidade Nova 5" voltava como
    // "Travessa We 35" — outra rua do mesmo bairro. Quando dá para saber qual
    // rua o cliente escreveu, o resultado de outra rua fica só como reserva
    // (`aproximado`): antes dele se tenta a busca pelo NOME da rua (nível 5).
    // Se nada melhor aparecer, ele volta, marcado como aproximado — nunca pior
    // do que era.
    //
    // Só no endereço em TEXTO LIVRE (robô, pedido digitado): o checkout do site
    // manda rua, número e bairro separados e já ancora a busca no bairro — lá
    // a conferência trocaria um resultado de rua pelo centro do bairro antes
    // de tentar o nível 5, e ninguém reclamou desse caminho.
    const ruasProcuradas = street ? [] : logradourosCandidatos(customerAddressText);
    let aproximado: { lat: number; lng: number; displayName: string } | null = null;

    let foundGeo: { lat: number; lng: number; displayName: string } | null = null;
    for (let i = 0; i < candidateQueries.length; i++) {
      const achado = await geocodeAddress(candidateQueries[i], storeCenter);
      if (!achado) continue;
      const ehFallbackDeBairro = indiceDoFallbackDeBairro >= 0 && i >= indiceDoFallbackDeBairro;
      if (!ehFallbackDeBairro && ruasProcuradas.length > 0 && !ruasProcuradas.some((r) => ruaConfere(r, achado.rua))) {
        if (!aproximado) aproximado = achado;
        continue;
      }
      foundGeo = achado;
      displayName = achado.displayName;
      // Quem consome precisa saber se a distância é do endereço ou só do
      // bairro: o centro do bairro pode estar dentro do raio com a casa fora.
      precisao = ehFallbackDeBairro ? "bairro" : "endereco";
      break;
    }

    // Nível 5: busca ESTRUTURADA pela rua, na cidade da loja. Acha o que a
    // busca livre perde. A mesma rua pode ter trechos em bairros diferentes:
    // se o bairro do cliente aparece no texto, fica o trecho daquele bairro;
    // senão, se todos os trechos caem do mesmo lado do raio, vale o MAIS LONGE
    // (taxa conservadora); se caem em lados diferentes, ninguém sabe — e
    // "não sei" é a resposta certa, não "atende".
    if (!foundGeo) {
      // A rua como veio (do formulário ou do texto) e, sem o tipo, os nomes
      // candidatos ("WE 62" → "Travessa WE 62", "Rua WE 62").
      const ruas = street
        ? [street, ...logradourosCandidatos(street).filter((r) => r !== street)]
        : ruasProcuradas;
      const cidadeDaBusca = city || storeCity || "";
      for (const logradouro of cidadeDaBusca ? ruas : []) {
        if (foundGeo) break;
        const achados = await geocodeStreetStructured(logradouro, cidadeDaBusca, storeCenter);
        // Só trecho da MESMA rua: "WE 62" sozinho devolvia um comércio no
        // número 62 da Travessa WE 13, a 1,7 km dali.
        const trechos = achados.filter((t) => ruaConfere(logradouro, t.rua));
        if (trechos.length > 0) {
          const texto = normalizarParaComparar(`${neigh} ${customerAddressText}`);
          const doBairro = trechos.filter((t) => t.suburb && texto.includes(normalizarParaComparar(t.suburb)));
          const candidatos = doBairro.length > 0 ? doBairro : trechos;
          const medidos = candidatos.map((t) => ({ ...t, km: haversineDistanceKm(storeCenter!.lat, storeCenter!.lng, t.lat, t.lng) }));
          const dentro = medidos.filter((t) => t.km <= maxRadiusKm + 0.05).length;
          const todosDoMesmoLado = dentro === 0 || dentro === medidos.length;
          if (doBairro.length > 0 || todosDoMesmoLado) {
            const escolhido = medidos.sort((a, b) => b.km - a.km)[0];
            foundGeo = { lat: escolhido.lat, lng: escolhido.lng, displayName: escolhido.displayName };
            displayName = escolhido.displayName;
            precisao = "rua";
          } else {
            return {
              addressFound: false,
              searchedQuery: customerAddressText,
              reason: `A rua "${logradouro}" existe em mais de um bairro (${[...new Set(trechos.map((t) => t.suburb).filter(Boolean))].join(", ")}). Informe o bairro.`,
            };
          }
        }
      }
    }

    // A reserva: a busca livre achou OUTRA rua do mesmo pedaço da cidade e a
    // busca pela rua não achou a do cliente. É o que acontecia antes desta
    // conferência — só que agora vai marcado como aproximado.
    if (!foundGeo && aproximado) {
      foundGeo = aproximado;
      displayName = aproximado.displayName;
      precisao = "bairro";
    }

    if (!foundGeo) {
      return {
        addressFound: false,
        searchedQuery: customerAddressText,
        reason: "Endereço não localizado no mapa.",
      };
    }

    customerLat = foundGeo.lat;
    customerLng = foundGeo.lng;
  }

  // ── 3. A DISTÂNCIA: EM LINHA RETA OU PELAS RUAS ──────────────────────
  //
  // O raio é o padrão e é o círculo desenhado no mapa da loja. Mas ele
  // castiga quem está do outro lado de um rio, de uma linha de trem ou de um
  // morro: medido em Rio das Ostras, o Costazul fica a 1,17 km em linha reta
  // e 1,81 km de moto — 55% a mais. A loja que escolhe "por rota" passa a
  // cobrar pelo caminho que a moto faz.
  //
  // As faixas cadastradas continuam as mesmas: muda só o número que entra na
  // comparação. E se o roteamento não responder, volta para a linha reta —
  // pedido sair com a taxa do raio é muito melhor que pedido não sair.
  const emLinhaReta = haversineDistanceKm(storeCenter.lat, storeCenter.lng, customerLat, customerLng);
  let distanceKm = emLinhaReta;
  let medidaPorRota = false;
  if (medicaoDaLoja(deliveryZoneType) === "ROTA") {
    const porRua = await distanciaPorRotaKm(
      { lat: storeCenter.lat, lng: storeCenter.lng },
      { lat: customerLat, lng: customerLng },
    );
    // Rota menor que a linha reta é impossível — se vier, é resposta ruim.
    if (porRua != null && porRua >= emLinhaReta - 0.05) {
      distanceKm = porRua;
      medidaPorRota = true;
    }
  }

  // 4. Tolerância de 50 metros para arredondamento
  const isWithinRadius = distanceKm <= (maxRadiusKm + 0.05);

  // Encontrar a faixa correspondente (ordenada crescente de raio KM)
  const sortedZones = [...radiusZones].sort((a, b) => a.km - b.km);
  let matchedZone = sortedZones.find((z: any) => distanceKm <= z.km);

  if (!matchedZone && isWithinRadius && sortedZones.length > 0) {
    matchedZone = sortedZones[sortedZones.length - 1];
  }

  const baseStoreFee = Number(delivConfig?.deliveryFee || delivConfig?.defaultFee || 5.0);
  const deliveryFee = matchedZone ? matchedZone.fee : baseStoreFee;
  const estimatedTimeMin = matchedZone ? matchedZone.time : 45;

  return {
    addressFound: true,
    searchedQuery: customerAddressText,
    matchedAddress: displayName,
    distanceKm,
    maxRadiusKm,
    isWithinRadius,
    deliveryFee,
    estimatedTimeMin,
    precisao,
    medidaPorRota,
    distanciaEmLinhaRetaKm: emLinhaReta,
    clienteLat: customerLat,
    clienteLng: customerLng,
  };
}
