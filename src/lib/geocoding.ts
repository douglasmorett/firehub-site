// Calculate distance in KM using Haversine formula
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in KM
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
  // Multiplicador de 1.22x para aproximar distância de percurso de vias/ruas reais
  return Math.round(straightDistance * 1.22 * 10) / 10;
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

// Geocodifica um endereço via OpenStreetMap Nominatim API
export async function geocodeAddress(addressQuery: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
  if (!addressQuery || addressQuery.trim().length < 4) return null;
  try {
    const cleanQuery = addressQuery.replace(/lt\s*\d+|qd\s*\d+|casa\s*\d+|ap\s*\d+|apt\s*\d+|bloco\s*\w+/gi, "").trim();
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&limit=1&addressdetails=1`,
      {
        headers: { "User-Agent": "FireHub-DeliveryEngine/2.0", "Accept-Language": "pt-BR" },
        signal: AbortSignal.timeout(4000),
      }
    );
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
  customerAddressText: string
): Promise<DeliveryZoneCheckResult | null> {
  if (!customerAddressText || customerAddressText.trim().length < 5) return null;
  const zones = Array.isArray(deliveryZones) ? deliveryZones : [];

  // 1. Obter lat/lng da Loja
  let storeCenter = storeLatLng;
  if ((!storeCenter || !storeCenter.lat) && storeAddress) {
    const storeGeo = await geocodeAddress(`${storeAddress}, ${storeCity || "Rio das Ostras"}`);
    if (storeGeo) storeCenter = { lat: storeGeo.lat, lng: storeGeo.lng };
  }

  if (!storeCenter || !storeCenter.lat || !storeCenter.lng) {
    return null;
  }

  // 2. Geocodificar Endereço do Cliente
  const fullCustomerQuery = customerAddressText.toLowerCase().includes(storeCity?.toLowerCase() || "rio das ostras")
    ? customerAddressText
    : `${customerAddressText}, ${storeCity || "Rio das Ostras"}`;

  const customerGeo = await geocodeAddress(fullCustomerQuery);
  if (!customerGeo) {
    return {
      addressFound: false,
      searchedQuery: customerAddressText,
      reason: "Endereço não localizado no mapa, mas dentro da área do município.",
    };
  }

  // 3. Calcular Distância em KM
  const distanceKm = haversineDistanceKm(storeCenter.lat, storeCenter.lng, customerGeo.lat, customerGeo.lng);

  // 4. Se a loja atende por RAIO / DISTÂNCIA
  const radiusZones = zones.filter((z: any) => z.radius || z.maxKm || z.km);
  const maxRadiusKm = radiusZones.length > 0
    ? Math.max(...radiusZones.map((z: any) => Number(z.radius || z.maxKm || z.km || 0)))
    : 5.0;

  const isWithinRadius = distanceKm <= maxRadiusKm;

  // Encontrar a faixa de taxa correspondente
  const sortedZones = [...radiusZones].sort((a, b) => Number(a.radius || a.maxKm || a.km || 0) - Number(b.radius || b.maxKm || b.km || 0));
  let matchedZone = sortedZones.find((z: any) => distanceKm <= Number(z.radius || z.maxKm || z.km || 0));

  if (!matchedZone && isWithinRadius && sortedZones.length > 0) {
    matchedZone = sortedZones[sortedZones.length - 1];
  }

  const deliveryFee = matchedZone ? Number(matchedZone.fee || 0) : 5.0;
  const estimatedTimeMin = matchedZone ? Number(matchedZone.time || 45) : 45;

  return {
    addressFound: true,
    searchedQuery: customerAddressText,
    matchedAddress: customerGeo.displayName,
    distanceKm,
    maxRadiusKm,
    isWithinRadius,
    deliveryFee,
    estimatedTimeMin,
  };
}
