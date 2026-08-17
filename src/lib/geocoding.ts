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

  // 2. Coordenadas do Cliente (via GPS direto ou Geocodificação Ancorada no Bairro)
  let customerLat: number | null = customerCoords?.lat || null;
  let customerLng: number | null = customerCoords?.lng || null;
  let displayName: string = customerAddressText;

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
    if (neigh) {
      const neighFallback = `${neigh}, ${city}`;
      if (!candidateQueries.includes(neighFallback)) candidateQueries.push(neighFallback);
    }

    let foundGeo: { lat: number; lng: number; displayName: string } | null = null;
    for (const query of candidateQueries) {
      foundGeo = await geocodeAddress(query, storeCenter);
      if (foundGeo) {
        displayName = foundGeo.displayName;
        break;
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

  // 4. Mapear faixas de Raio (KM) cadastradas no mapa da loja
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

  // Tolerância de 50 metros para arredondamento
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
  };
}
