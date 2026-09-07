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
};

// Geocodifica um endereço via OpenStreetMap Nominatim API com priorização geográfica (viewbox)
export async function geocodeAddress(
  addressQuery: string,
  storeCenter?: { lat: number; lng: number } | null
): Promise<{ lat: number; lng: number; displayName: string } | null> {
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
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name,
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
): Promise<Array<{ lat: number; lng: number; displayName: string; suburb: string }>> {
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

function normalizarParaComparar(t: string): string {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
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
  let storeCenter: { lat: number; lng: number } | null = null;
  if (storeLatLng) {
    if (typeof storeLatLng === "object" && typeof (storeLatLng as any).lat === "number" && typeof (storeLatLng as any).lng === "number") {
      storeCenter = { lat: Number((storeLatLng as any).lat), lng: Number((storeLatLng as any).lng) };
    } else if (typeof storeLatLng === "string") {
      try {
        const parsed = JSON.parse(storeLatLng);
        if (parsed && typeof parsed.lat === "number" && typeof parsed.lng === "number") {
          storeCenter = { lat: Number(parsed.lat), lng: Number(parsed.lng) };
        }
      } catch {}
    }
  }

  if ((!storeCenter || !storeCenter.lat) && storeAddress) {
    const storeGeo = await geocodeAddress(`${storeAddress}, ${storeCity || "Rio das Ostras"}`);
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

    // Nível 3: Query completa fornecida
    if (customerAddressText && customerAddressText.trim().length >= 4) {
      const full = customerAddressText.toLowerCase().includes(city.toLowerCase())
        ? customerAddressText
        : `${customerAddressText}, ${city}`;
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

    let foundGeo: { lat: number; lng: number; displayName: string } | null = null;
    for (let i = 0; i < candidateQueries.length; i++) {
      foundGeo = await geocodeAddress(candidateQueries[i], storeCenter);
      if (foundGeo) {
        displayName = foundGeo.displayName;
        // Quem consome precisa saber se a distância é do endereço ou só do
        // bairro: o centro do bairro pode estar dentro do raio com a casa fora.
        precisao = indiceDoFallbackDeBairro >= 0 && i >= indiceDoFallbackDeBairro ? "bairro" : "endereco";
        break;
      }
    }

    // Nível 5: busca ESTRUTURADA pela rua, na cidade da loja. Acha o que a
    // busca livre perde. A mesma rua pode ter trechos em bairros diferentes:
    // se o bairro do cliente aparece no texto, fica o trecho daquele bairro;
    // senão, se todos os trechos caem do mesmo lado do raio, vale o MAIS LONGE
    // (taxa conservadora); se caem em lados diferentes, ninguém sabe — e
    // "não sei" é a resposta certa, não "atende".
    if (!foundGeo) {
      const logradouro = street || extrairLogradouro(customerAddressText);
      const cidadeDaBusca = city || storeCity || "";
      if (logradouro && cidadeDaBusca) {
        const trechos = await geocodeStreetStructured(logradouro, cidadeDaBusca, storeCenter);
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

  // 3. Calcular Distância em Linha Reta / Raio Geométrico (idêntico ao círculo desenhado no mapa da loja)
  const distanceKm = haversineDistanceKm(storeCenter.lat, storeCenter.lng, customerLat, customerLng);

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
  };
}
