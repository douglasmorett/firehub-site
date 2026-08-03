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

// Dicionário de Bairros de Rio das Ostras e Região com Coordenadas de Alta Precisão
const NEIGHBORHOOD_COORDS_MAP: Record<string, { lat: number; lng: number }> = {
  costazul: { lat: -22.5205, lng: -41.9175 },
  "costa azul": { lat: -22.5205, lng: -41.9175 },
  recreio: { lat: -22.5115, lng: -41.9160 },
  praiamar: { lat: -22.4980, lng: -41.9060 },
  "praia ancora": { lat: -22.5010, lng: -41.9050 },
  "praia âmcora": { lat: -22.5010, lng: -41.9050 },
  "residencial praia ancora": { lat: -22.5010, lng: -41.9050 },
  "village rio das ostras": { lat: -22.5040, lng: -41.9120 },
  marilea: { lat: -22.5130, lng: -41.9340 },
  mariléa: { lat: -22.5130, lng: -41.9340 },
  "jardim marilea": { lat: -22.5130, lng: -41.9340 },
  "jardim mariléa": { lat: -22.5130, lng: -41.9340 },
  "jardim marileia": { lat: -22.5130, lng: -41.9340 },
  "marilea chacara": { lat: -22.5080, lng: -41.9310 },
  "chacara marilea": { lat: -22.5080, lng: -41.9310 },
  "nova cidade": { lat: -22.5210, lng: -41.9480 },
  "ouro verde": { lat: -22.5170, lng: -41.9240 },
  "jardim bela vista": { lat: -22.5140, lng: -41.9270 },
  "parque sao jorge": { lat: -22.5220, lng: -41.9360 },
  "parque são jorge": { lat: -22.5220, lng: -41.9360 },
  "sao cristovao": { lat: -22.5160, lng: -41.9420 },
  "são cristóvão": { lat: -22.5160, lng: -41.9420 },
  "cantinho do mar": { lat: -22.5310, lng: -41.9560 },
  "nova alianca": { lat: -22.5300, lng: -41.9530 },
  "nova aliança": { lat: -22.5300, lng: -41.9530 },
  "extensao do bosque": { lat: -22.5280, lng: -41.9480 },
  "extensão do bosque": { lat: -22.5280, lng: -41.9480 },
  "extensao novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
  "novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
  ancora: { lat: -22.5050, lng: -41.9480 },
  âncora: { lat: -22.5050, lng: -41.9480 },
  "cidade praiana": { lat: -22.5360, lng: -41.9660 },
  centro: { lat: -22.5245, lng: -41.9455 },
  recanto: { lat: -22.5320, lng: -41.9560 },
  atlantica: { lat: -22.5030, lng: -41.9240 },
  atlântica: { lat: -22.5030, lng: -41.9240 },
  "jardim atlantico": { lat: -22.5030, lng: -41.9240 },
  "terra firme": { lat: -22.5120, lng: -41.9200 },
  "enseada das gaivotas": { lat: -22.5020, lng: -41.9200 },
  operarios: { lat: -22.5230, lng: -41.9380 },
  operários: { lat: -22.5230, lng: -41.9380 },
  "verdes mares": { lat: -22.5380, lng: -41.9520 },
  "serra mar": { lat: -22.5290, lng: -41.9620 },
  "cidade beira mar": { lat: -22.5350, lng: -41.9630 },
  "jardim campomar": { lat: -22.5320, lng: -41.9600 },
  campomar: { lat: -22.5320, lng: -41.9600 },
  "gelson apicelo": { lat: -22.5150, lng: -41.9380 },
  "boca da barra": { lat: -22.5280, lng: -41.9320 },
  viverde: { lat: -22.5180, lng: -41.9520 },
};

const extractNeighborhood = (addr: string): string => {
  if (!addr) return "Outros";
  const lower = addr.toLowerCase();
  for (const key of Object.keys(NEIGHBORHOOD_COORDS_MAP)) {
    if (lower.includes(key)) {
      return key.charAt(0).toUpperCase() + key.slice(1);
    }
  }
  const parts = addr.split("-");
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 1].split(",")[0].trim();
    if (candidate.length > 2 && candidate.length < 30) return candidate;
  }
  return "Outros";
};

const getCoordsForAddress = (addr: string, orderId: string): { lat: number; lng: number } => {
  if (!addr) return { lat: -22.5205, lng: -41.9340 };
  const lower = addr.toLowerCase();

  for (const key of Object.keys(NEIGHBORHOOD_COORDS_MAP)) {
    if (lower.includes(key)) {
      const base = NEIGHBORHOOD_COORDS_MAP[key];
      // Adiciona um pequeno jitter pseudo-aleatório baseado no orderId para espalhar os pinos no mesmo bairro
      let hash = 0;
      for (let i = 0; i < orderId.length; i++) hash = (hash << 5) - hash + orderId.charCodeAt(i);
      const latOffset = ((Math.abs(hash) % 100) - 50) * 0.00008;
      const lngOffset = ((Math.abs(hash >> 3) % 100) - 50) * 0.00008;
      return { lat: base.lat + latOffset, lng: base.lng + lngOffset };
    }
  }

  // Fallback genérico centro de Rio das Ostras com jitter
  let hash = 0;
  for (let i = 0; i < orderId.length; i++) hash = (hash << 5) - hash + orderId.charCodeAt(i);
  const latOffset = ((Math.abs(hash) % 200) - 100) * 0.0001;
  const lngOffset = ((Math.abs(hash >> 3) % 200) - 100) * 0.0001;
  return { lat: -22.5205 + latOffset, lng: -41.9340 + lngOffset };
};

export default function StoreDashboardMap({ orders, dateFilterLabel }: { orders: Order[]; dateFilterLabel: string }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  // Filtrar apenas pedidos válidos de entrega (excluir cancelados se preferir ou incluir com cor especial)
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

  // Estatísticas do Mapa
  const stats = useMemo(() => {
    const neighborhoodCounts: Record<string, { count: number; total: number }> = {};
    let totalRevenue = 0;

    deliveryOrders.forEach(o => {
      const neigh = extractNeighborhood(o.customerAddress || "");
      if (!neighborhoodCounts[neigh]) neighborhoodCounts[neigh] = { count: 0, total: 0 };
      neighborhoodCounts[neigh].count += 1;
      neighborhoodCounts[neigh].total += o.totalAmount;
      totalRevenue += o.totalAmount;
    });

    let topNeighborhood = "Nenhum";
    let topCount = 0;
    Object.entries(neighborhoodCounts).forEach(([neigh, data]) => {
      if (data.count > topCount && neigh !== "Outros") {
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
          link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
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

          // Determinar cor do pino baseado no canal / status
          const isIfood = (o.source || "").toUpperCase() === "IFOOD" || Boolean(o.ifoodReference);
          const isJotaja = (o.source || "").toUpperCase() === "JOTAJA" || Boolean(o.openDeliveryReference);

          const pinBg = isIfood ? "#EA1D2C" : isJotaja ? "#FF6C00" : "#10B981";
          const displayNum = o.ifoodReference ? `#${o.ifoodReference}` : o.openDeliveryReference ? `#${o.openDeliveryReference}` : `#${o.id.slice(-4).toUpperCase()}`;

          const iconHtml = `
            <div style="
              background: ${pinBg};
              color: white;
              font-weight: 800;
              font-size: 11px;
              padding: 4px 8px;
              border-radius: 20px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              gap: 4px;
              border: 2px solid white;
              white-space: nowrap;
              transform: translate(-50%, -100%);
            ">
              <span style="font-size: 12px;">📍</span> ${displayNum}
            </div>
          `;

          const customIcon = Leaflet.divIcon({
            html: iconHtml,
            className: "custom-map-pin",
            iconSize: [0, 0],
          });

          const popupContent = `
            <div style="font-family: inherit; padding: 4px; min-width: 180px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <strong style="font-size: 14px; color: #0F172A;">${displayNum}</strong>
                <span style="background: ${pinBg}20; color: ${pinBg}; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 6px;">
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
                <span style="font-size: 11px; font-weight: 600; color: #059669;">R$ ${o.totalAmount.toFixed(2)}</span>
                <span style="font-size: 10px; font-weight: 700; color: #475569;">${o.status}</span>
              </div>
            </div>
          `;

          const marker = Leaflet.marker([coords.lat, coords.lng], { icon: customIcon })
            .bindPopup(popupContent)
            .addTo(map);

          markersRef.current.push(marker);
        });

        // Ajustar zoom para caber todos os pinos se houver mais de 1 pino
        if (deliveryOrders.length > 0 && bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
        }

        // Forçar resize após 200ms para renderizar corretamente
        setTimeout(() => map.invalidateSize(), 200);
      } catch (err) {
        console.error("[StoreDashboardMap] Erro ao renderizar mapa:", err);
      }
    };

    initMap();

    return () => {
      // Clean up markers
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
