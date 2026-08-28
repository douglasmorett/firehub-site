"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { MapPin, Navigation, Flame } from "lucide-react";

type Order = {
  id: string;
  totalAmount: number;
  status: string;
  deliveryType: string;
  paymentMethod?: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  ifoodReference?: string;
  openDeliveryReference?: string;
  source?: string;
  notes?: string;
  createdAt: string;
};

// Dicionário de Bairros de Rio das Ostras e Região com Coordenadas Terrestres de Alta Precisão
const NEIGHBORHOOD_COORDS_MAP: Record<string, { lat: number; lng: number }> = {
  costazul: { lat: -22.5220, lng: -41.9250 },
  "costa azul": { lat: -22.5220, lng: -41.9250 },
  recreio: { lat: -22.5130, lng: -41.9240 },
  praiamar: { lat: -22.4990, lng: -41.9120 },
  "praia ancora": { lat: -22.5010, lng: -41.9100 },
  "praia âmcora": { lat: -22.5010, lng: -41.9100 },
  "residencial praia ancora": { lat: -22.5010, lng: -41.9100 },
  "village rio das ostras": { lat: -22.5040, lng: -41.9140 },
  marilea: { lat: -22.5130, lng: -41.9340 },
  mariléa: { lat: -22.5130, lng: -41.9340 },
  "jardim marilea": { lat: -22.5130, lng: -41.9340 },
  "jardim mariléa": { lat: -22.5130, lng: -41.9340 },
  "jardim marileia": { lat: -22.5130, lng: -41.9340 },
  "marilea chacara": { lat: -22.5080, lng: -41.9310 },
  "chacara marilea": { lat: -22.5080, lng: -41.9310 },
  "nova cidade": { lat: -22.5210, lng: -41.9480 },
  "ouro verde": { lat: -22.5170, lng: -41.9260 },
  "jardim bela vista": { lat: -22.5140, lng: -41.9270 },
  "parque sao jorge": { lat: -22.5220, lng: -41.9360 },
  "parque são jorge": { lat: -22.5220, lng: -41.9360 },
  "sao cristovao": { lat: -22.5160, lng: -41.9420 },
  "são cristóvão": { lat: -22.5160, lng: -41.9420 },
  "cantinho do mar": { lat: -22.5310, lng: -41.9580 },
  "nova alianca": { lat: -22.5300, lng: -41.9540 },
  "nova aliança": { lat: -22.5300, lng: -41.9540 },
  "extensao do bosque": { lat: -22.5280, lng: -41.9480 },
  "extensão do bosque": { lat: -22.5280, lng: -41.9480 },
  "extensao novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
  "novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
  ancora: { lat: -22.5050, lng: -41.9480 },
  âncora: { lat: -22.5050, lng: -41.9480 },
  "cidade praiana": { lat: -22.5360, lng: -41.9660 },
  centro: { lat: -22.5245, lng: -41.9455 },
  recanto: { lat: -22.5320, lng: -41.9580 },
  atlantica: { lat: -22.5030, lng: -41.9260 },
  atlântica: { lat: -22.5030, lng: -41.9260 },
  "jardim atlantico": { lat: -22.5030, lng: -41.9260 },
  "terra firme": { lat: -22.5120, lng: -41.9240 },
  "enseada das gaivotas": { lat: -22.5020, lng: -41.9240 },
  operarios: { lat: -22.5230, lng: -41.9380 },
  operários: { lat: -22.5230, lng: -41.9380 },
  "verdes mares": { lat: -22.5380, lng: -41.9560 },
  "serra mar": { lat: -22.5290, lng: -41.9620 },
  "cidade beira mar": { lat: -22.5350, lng: -41.9650 },
  "jardim campomar": { lat: -22.5320, lng: -41.9620 },
  campomar: { lat: -22.5320, lng: -41.9620 },
  "gelson apicelo": { lat: -22.5150, lng: -41.9380 },
  "boca da barra": { lat: -22.5270, lng: -41.9360 },
  viverde: { lat: -22.5180, lng: -41.9520 },
};

const CITY_NAME_BLACKLIST = [
  "rio das ostras", "macaé", "macae", "cabo frio", "unamar",
  "casimiro de abreu", "barra de são joão", "rj", "brasil", "outros", ""
];

const extractNeighborhood = (addr: string): string => {
  if (!addr) return "Outros";
  const lower = addr.toLowerCase();

  // 1. Busca em nosso dicionário oficial de bairros primeiro
  for (const key of Object.keys(NEIGHBORHOOD_COORDS_MAP)) {
    if (lower.includes(key) && !CITY_NAME_BLACKLIST.includes(key)) {
      return key.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  // 2. Limpa o endereço removendo nomes de cidade/estado antes de extrair
  const cleanAddr = addr.replace(/rio das ostras|macaé|macae|cabo frio|unamar|casimiro de abreu|rj|brasil/gi, "").trim();
  const parts = cleanAddr.split(/[-,\/]/).map(p => p.trim()).filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const pLower = p.toLowerCase();
    if (
      p.length > 2 &&
      p.length < 35 &&
      !CITY_NAME_BLACKLIST.includes(pLower) &&
      !/^(rua|av|avenida|estrada|servidao|servidão|nº|\d+|casa|apto|bloco)/i.test(p)
    ) {
      return p.charAt(0).toUpperCase() + p.slice(1);
    }
  }

  return "Outros";
};

// Trava de Continente: impede que qualquer pino caia nas águas do Oceano Atlântico
const clampToLand = (lat: number, lng: number): { lat: number; lng: number } => {
  let maxAllowedLng = -41.9240;
  if (lat < -22.5320) {
    maxAllowedLng = -41.9620; // Beira Mar / Campomar
  } else if (lat < -22.5250) {
    maxAllowedLng = -41.9400; // Centro / Boca da Barra
  } else if (lat < -22.5120) {
    maxAllowedLng = -41.9250; // Costazul / Recreio
  } else {
    maxAllowedLng = -41.9100; // Âncora / Praiamar
  }

  return {
    lat,
    lng: Math.min(lng, maxAllowedLng)
  };
};

const getCoordsForAddress = (addr: string, orderId: string): { lat: number; lng: number } => {
  if (!addr) return clampToLand(-22.5205, -41.9440);
  const lower = addr.toLowerCase();

  for (const key of Object.keys(NEIGHBORHOOD_COORDS_MAP)) {
    if (lower.includes(key)) {
      const base = NEIGHBORHOOD_COORDS_MAP[key];
      let hash = 0;
      for (let i = 0; i < orderId.length; i++) hash = (hash << 5) - hash + orderId.charCodeAt(i);
      // Espalha os pinos no bairro puxando sempre para a terra (Oeste/Norte)
      const latOffset = ((Math.abs(hash) % 80) - 40) * 0.00008;
      const lngOffset = -((Math.abs(hash >> 3) % 90)) * 0.00008;
      return clampToLand(base.lat + latOffset, base.lng + lngOffset);
    }
  }

  // Fallback genérico centro de Rio das Ostras seguro na terra
  let hash = 0;
  for (let i = 0; i < orderId.length; i++) hash = (hash << 5) - hash + orderId.charCodeAt(i);
  const latOffset = ((Math.abs(hash) % 100) - 50) * 0.00008;
  const lngOffset = -((Math.abs(hash >> 3) % 100)) * 0.00008;
  return clampToLand(-22.5205 + latOffset, -41.9440 + lngOffset);
};

export default function StoreDashboardMap({ orders, dateFilterLabel }: { orders: Order[]; dateFilterLabel: string }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // Filtrar apenas pedidos válidos de entrega (excluir cancelados e retiradas)
  const deliveryOrders = useMemo(() => {
    return orders.filter(o => {
      if (o.status === "CANCELADO") return false;
      const type = (o.deliveryType || "").toUpperCase();
      if (type === "RETIRADA" || type === "TAKEOUT" || type === "PRESENCIAL") return false;
      const addr = o.customerAddress || "";
      if (!addr || addr.toLowerCase().includes("retirada") || addr.toLowerCase().includes("balcao")) return false;
      return true;
    });
  }, [orders]);

  // Estatísticas do Mapa (Garantindo que a cidade jamais seja contada como Bairro nº 1)
  const stats = useMemo(() => {
    const neighborhoodCounts: Record<string, { count: number; total: number }> = {};
    let totalRevenue = 0;

    deliveryOrders.forEach(o => {
      const neigh = extractNeighborhood(o.customerAddress || "");
      if (!CITY_NAME_BLACKLIST.includes(neigh.toLowerCase()) && neigh !== "Outros") {
        if (!neighborhoodCounts[neigh]) neighborhoodCounts[neigh] = { count: 0, total: 0 };
        neighborhoodCounts[neigh].count += 1;
        neighborhoodCounts[neigh].total += o.totalAmount;
      }
      totalRevenue += o.totalAmount;
    });

    let topNeighborhood = "Nenhum";
    let topCount = 0;
    Object.entries(neighborhoodCounts).forEach(([neigh, data]) => {
      if (data.count > topCount) {
        topCount = data.count;
        topNeighborhood = neigh;
      }
    });

    return {
      mappedCount: deliveryOrders.length,
      totalRevenue,
      topNeighborhood,
      topCount,
    };
  }, [deliveryOrders]);

  // Inicializar e atualizar o Mapa Leaflet no cliente
  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current) return;

    let Leaflet: any;

    const initMap = async () => {
      try {
        Leaflet = (await import("leaflet")).default;

        // Injetar CSS do Leaflet se não estiver presente no head
        if (!document.getElementById("leaflet-css")) {
          const link = document.createElement("link");
          link.id = "leaflet-css";
          link.rel = "stylesheet";
          // Do nosso domínio: o CSP bloqueia stylesheet do unpkg (style-src),
          // e sem o CSS do Leaflet os tiles do mapa viram um embaralhado.
          link.href = "/leaflet/leaflet.css";
          document.head.appendChild(link);
        }

        // Se o mapa ainda não existe, cria a instância
        if (!mapInstanceRef.current) {
          const map = Leaflet.map(mapContainerRef.current, {
            center: [-22.5205, -41.9340], // Rio das Ostras
            zoom: 13,
            zoomControl: false,
          });

          Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; OpenStreetMap',
            maxZoom: 19,
          }).addTo(map);

          Leaflet.control.zoom({ position: "bottomright" }).addTo(map);
          mapInstanceRef.current = map;
        }

        const map = mapInstanceRef.current;

        // Limpar marcadores anteriores
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

        if (deliveryOrders.length === 0) return;

        const bounds = Leaflet.latLngBounds([]);

        deliveryOrders.forEach((o) => {
          const coords = getCoordsForAddress(o.customerAddress || "", o.id);
          bounds.extend([coords.lat, coords.lng]);

          // Determinar cor do pino baseado no canal
          const isIfood = (o.source || "").toUpperCase() === "IFOOD" || Boolean(o.ifoodReference);
          const isJotaja = (o.source || "").toUpperCase() === "JOTAJA" || Boolean(o.openDeliveryReference);

          const pinBg = isIfood ? "#EA1D2C" : isJotaja ? "#FF6C00" : "#10B981";
          const displayNum = o.ifoodReference ? `#${o.ifoodReference}` : o.openDeliveryReference ? `#${o.openDeliveryReference}` : `#${o.id.slice(-4).toUpperCase()}`;

          const popupContent = `
            <div style="font-family: system-ui, sans-serif; padding: 6px; min-width: 190px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <strong style="font-size: 14px; color: #0F172A;">${displayNum}</strong>
                <span style="background: ${pinBg}; color: #ffffff; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 12px;">
                  ${isIfood ? "iFood" : isJotaja ? "Jotajá" : "Site"}
                </span>
              </div>
              <div style="font-size: 13px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">
                👤 ${o.customerName || "Cliente"}
              </div>
              <div style="font-size: 11px; color: #64748B; margin-bottom: 6px; line-height: 1.3;">
                🏠 ${o.customerAddress || "Endereço não informado"}
              </div>
              <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #E2E8F0; padding-top: 6px; margin-top: 6px;">
                <span style="font-size: 12px; font-weight: 800; color: #059669;">R$ ${o.totalAmount.toFixed(2)}</span>
                <span style="font-size: 10px; font-weight: 700; color: #475569; background: #F1F5F9; padding: 2px 6px; border-radius: 4px;">${o.status}</span>
              </div>
            </div>
          `;

          // Usar CircleMarker super elegante (dots de densidade ultra-limpos) que não poluem o mapa
          const circleMarker = Leaflet.circleMarker([coords.lat, coords.lng], {
            radius: deliveryOrders.length > 80 ? 6 : 7,
            fillColor: pinBg,
            color: "#FFFFFF",
            weight: 2,
            opacity: 1,
            fillOpacity: 0.85,
          })
            .bindTooltip(`<b>${displayNum}</b> — ${o.customerName || "Cliente"}`, { direction: "top", offset: [0, -5] })
            .bindPopup(popupContent)
            .addTo(map);

          markersRef.current.push(circleMarker);
        });

        // Ajustar zoom para caber todos os pinos de forma equilibrada
        if (deliveryOrders.length > 0 && bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        }

        // Forçar resize após 200ms para renderizar sem cortes
        setTimeout(() => map.invalidateSize(), 200);
      } catch (err) {
        console.error("[StoreDashboardMap] Erro ao renderizar mapa:", err);
      }
    };

    initMap();

    return () => {
      if (markersRef.current) {
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];
      }
    };
  }, [deliveryOrders]);

  return (
    <div style={{
      background: "#ffffff",
      borderRadius: "16px",
      border: "1px solid #E2E8F0",
      boxShadow: "0 4px 20px -2px rgba(0,0,0,0.05)",
      overflow: "hidden",
      marginTop: "1.5rem",
      marginBottom: "1.5rem"
    }}>
      {/* Header do Mapa */}
      <div style={{
        padding: "1rem 1.5rem",
        background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)",
        color: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "1rem"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{
            background: "rgba(239, 68, 68, 0.2)",
            color: "#EF4444",
            padding: "8px",
            borderRadius: "10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}>
            <MapPin size={22} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#F8FAFC", display: "flex", alignItems: "center", gap: "8px" }}>
              Mapa de Calor & Distribuição de Entregas
              <span style={{ background: "rgba(255,255,255,0.15)", fontSize: "0.75rem", padding: "2px 8px", borderRadius: "12px", fontWeight: 600 }}>
                {dateFilterLabel}
              </span>
            </h3>
            <p style={{ margin: "2px 0 0 0", fontSize: "0.8rem", color: "#94A3B8" }}>
              Visualização geográfica das entregas para identificar bairros fortes e áreas de expansão
            </p>
          </div>
        </div>

        {/* Resumo Rápido Geográfico */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Navigation size={16} color="#38BDF8" />
            <span style={{ fontSize: "0.85rem", color: "#CBD5E1" }}>
              Mapeados: <strong style={{ color: "#F8FAFC", fontWeight: 700 }}>{stats.mappedCount} pedidos</strong>
            </span>
          </div>

          {stats.topNeighborhood !== "Nenhum" && (
            <div style={{
              background: "rgba(245, 158, 11, 0.15)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              padding: "4px 10px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}>
              <Flame size={15} color="#F59E0B" />
              <span style={{ fontSize: "0.8rem", color: "#FCD34D", fontWeight: 700 }}>
                Bairro nº 1: {stats.topNeighborhood} ({stats.topCount})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Container do Mapa Leaflet */}
      <div style={{ position: "relative", width: "100%", height: "420px", background: "#F1F5F9" }}>
        <div ref={mapContainerRef} style={{ width: "100%", height: "100%", zIndex: 1 }} />

        {deliveryOrders.length === 0 && (
          <div style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(248, 250, 252, 0.85)",
            backdropFilter: "blur(4px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            color: "#64748B"
          }}>
            <MapPin size={36} color="#94A3B8" style={{ marginBottom: "8px" }} />
            <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Nenhum pedido de entrega encontrado no período ({dateFilterLabel})</span>
            <span style={{ fontSize: "0.8rem" }}>Selecione "Ontem" ou "7 dias" nos filtros acima para visualizar a distribuição dos pinos.</span>
          </div>
        )}
      </div>
    </div>
  );
}
