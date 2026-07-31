"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  MapPin,
  X,
  Search,
  Check,
  Navigation,
  Copy,
  Trash2,
  Loader2,
  RefreshCw,
  CheckCircle2
} from "lucide-react";

interface Motoboy {
  id: string;
  name: string;
  phone?: string;
}

interface CustomerOrder {
  id: string;
  orderNumber?: number | string;
  displayId?: string;
  customerName: string;
  customerPhone?: string;
  address?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  status: string;
  totalAmount?: number;
  itemsCount?: number;
  items?: any[];
  platform?: string;
  createdAt: string;
  motoboyId?: string;
  motoboy?: Motoboy;
  routeId?: string;
}

interface RouteItem {
  id: string;
  routeNumber: number | string;
  motoboyName: string;
  motoboyPhone?: string;
  color: string;
  orders: CustomerOrder[];
  createdAt: string;
  status: string;
}

interface RoteirizacaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: CustomerOrder[];
  storeAddress?: string;
  storeCity?: string;
  storeLatLng?: { lat: number; lng: number } | null;
  onRefreshOrders?: () => void;
  onUpdateOrderStatus?: (orderId: string, status: string, motoboyId?: string) => Promise<void>;
}

const ROUTE_COLORS = [
  "#22C55E", // Verde
  "#3B82F6", // Azul
  "#EAB308", // Amarelo
  "#06B6D4", // Ciano
  "#EC4899", // Rosa
  "#8B5CF6", // Roxo
  "#F97316", // Laranja
  "#14B8A6"  // Verde Água
];

export default function RoteirizacaoModal({
  isOpen,
  onClose,
  orders = [],
  storeAddress = "",
  storeCity = "Rio das Ostras",
  storeLatLng = null,
  onRefreshOrders,
  onUpdateOrderStatus
}: RoteirizacaoModalProps) {
  const [activeTab, setActiveTab] = useState<"PENDING" | "ROTAS">("PENDING");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]);

  // Custom Created Routes State
  const [createdRoutes, setCreatedRoutes] = useState<RouteItem[]>([]);

  // Saipos Roteirização Configuration Settings
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [routeMode, setRouteMode] = useState<"Manual" | "Automatizada" | "Inteligente">("Inteligente");
  const [maxWaitMinutes, setMaxWaitMinutes] = useState(5);
  const [targetStatus, setTargetStatus] = useState("Cozinha");
  const [autoMoveStatus, setAutoMoveStatus] = useState("Não");
  const [autoPrint, setAutoPrint] = useState("Não");
  const [maxOrdersPerRoute, setMaxOrdersPerRoute] = useState(3);
  const [maxDistanceKm, setMaxDistanceKm] = useState(2);

  // Dispatch Modal
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [selectedMotoboyId, setSelectedMotoboyId] = useState("");
  const [customMotoboyName, setCustomMotoboyName] = useState("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [copiedRouteId, setCopiedRouteId] = useState<string | null>(null);

  // Map & Geocoding State
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const polylinesRef = useRef<any[]>([]);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [geocodedMap, setGeocodedMap] = useState<Record<string, { lat: number; lng: number }>>({});
  const [geocodingLoading, setGeocodingLoading] = useState(false);

  // Default Store Center (Rio das Ostras / Store Coordinates)
  const defaultCenter = useMemo(() => {
    if (storeLatLng && storeLatLng.lat && storeLatLng.lng) {
      return storeLatLng;
    }
    return { lat: -22.5262, lng: -41.9461 }; // Default Rio das Ostras
  }, [storeLatLng]);

  // Load Leaflet CSS & Script dynamically
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).L) {
      setLeafletLoaded(true);
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Load Motoboys from API
  useEffect(() => {
    if (!isOpen) return;
    const fetchMotoboys = async () => {
      try {
        const res = await fetch("/api/motoboys");
        if (res.ok) {
          const data = await res.json();
          setMotoboys(Array.isArray(data) ? data : data.motoboys || []);
        }
      } catch (err) {
        console.error("Erro ao buscar motoboys:", err);
      }
    };
    fetchMotoboys();
  }, [isOpen]);

  // Load saved routes from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("firehub_created_routes");
      if (saved) {
        setCreatedRoutes(JSON.parse(saved));
      }
    } catch (e) {}
  }, []);

  // Save routes to localStorage
  const saveRoutes = (routes: RouteItem[]) => {
    setCreatedRoutes(routes);
    try {
      localStorage.setItem("firehub_created_routes", JSON.stringify(routes));
    } catch (e) {}
  };

  // Filter Delivery Orders (Exclude Pickup/Presencial unless needed)
  const deliveryOrders = useMemo(() => {
    return orders.filter(o => {
      const isCancelled = o.status === "CANCELLED" || o.status === "CANCELED";
      if (isCancelled) return false;
      const addr = o.address || `${o.street || ""} ${o.number || ""} ${o.neighborhood || ""}`;
      return addr.trim().length > 3;
    });
  }, [orders]);

  // Filtered Orders based on search term
  const filteredPendingOrders = useMemo(() => {
    return deliveryOrders.filter(o => {
      const isInRoute = createdRoutes.some(r => r.orders.some(ro => ro.id === o.id));
      if (isInRoute) return false;

      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      const numStr = String(o.orderNumber || o.displayId || o.id).toLowerCase();
      const name = (o.customerName || "").toLowerCase();
      const addr = (o.address || `${o.street || ""} ${o.neighborhood || ""}`).toLowerCase();
      return numStr.includes(term) || name.includes(term) || addr.includes(term);
    });
  }, [deliveryOrders, createdRoutes, searchTerm]);

  // Automatic Geocoding Engine for Order Addresses
  useEffect(() => {
    if (!isOpen || deliveryOrders.length === 0) return;

    const geocodeAddresses = async () => {
      setGeocodingLoading(true);
      const newMap = { ...geocodedMap };
      let updated = false;

      for (const order of deliveryOrders) {
        const fullAddr = order.address || `${order.street || ""}, ${order.number || ""}, ${order.neighborhood || ""}, ${storeCity}`;
        if (!fullAddr || newMap[order.id]) continue;

        try {
          const searchAddress = `${order.street || ""} ${order.number || ""}, ${order.neighborhood || ""}, ${storeCity}, RJ, Brasil`;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}&limit=1`,
            { headers: { "User-Agent": "FireHub-Roteirizacao/1.0" } }
          );

          if (res.ok) {
            const data = await res.json();
            if (data && data.length > 0) {
              newMap[order.id] = {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
              };
              updated = true;
            } else {
              const cityRes = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(`${order.neighborhood || storeCity}, ${storeCity}, RJ, Brasil`)}&limit=1`,
                { headers: { "User-Agent": "FireHub-Roteirizacao/1.0" } }
              );
              if (cityRes.ok) {
                const cityData = await cityRes.json();
                if (cityData && cityData.length > 0) {
                  const baseLat = parseFloat(cityData[0].lat);
                  const baseLng = parseFloat(cityData[0].lon);
                  const idHash = (order.id || "").split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
                  const offsetLat = ((idHash % 10) - 5) * 0.002;
                  const offsetLng = (((idHash * 3) % 10) - 5) * 0.002;
                  newMap[order.id] = { lat: baseLat + offsetLat, lng: baseLng + offsetLng };
                  updated = true;
                }
              }
            }
          }
        } catch (err) {
          console.warn("[Roteirização] Erro ao geocodificar pedido:", order.id, err);
        }
        await new Promise(r => setTimeout(r, 200));
      }

      if (updated) {
        setGeocodedMap(newMap);
      }
      setGeocodingLoading(false);
    };

    geocodeAddresses();
  }, [isOpen, deliveryOrders, storeCity]);

  // Haversine Distance Calculation (in KM)
  const calculateHaversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of Earth in KM
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Smart Auto-Clustering Algorithm (Modo Inteligente / Automatizado)
  const handleAutoClusterRoutes = () => {
    const unrouted = filteredPendingOrders.filter(o => geocodedMap[o.id]);
    if (unrouted.length === 0) {
      alert("Nenhum pedido pendente mapeado no GPS para agrupar!");
      return;
    }

    const firstOrder = unrouted[0];
    const cluster: string[] = [firstOrder.id];

    for (let i = 1; i < unrouted.length; i++) {
      if (cluster.length >= maxOrdersPerRoute) break;
      const candidate = unrouted[i];
      const candidateCoords = geocodedMap[candidate.id];

      const isClose = cluster.every(clusterOrderId => {
        const cCoords = geocodedMap[clusterOrderId];
        if (!cCoords || !candidateCoords) return false;
        const dist = calculateHaversineKm(cCoords.lat, cCoords.lng, candidateCoords.lat, candidateCoords.lng);
        return dist <= maxDistanceKm;
      });

      if (isClose) {
        cluster.push(candidate.id);
      }
    }

    setSelectedOrderIds(cluster);
  };

  // Initialize and Update Leaflet Map
  useEffect(() => {
    if (!isOpen || !leafletLoaded || !mapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    if (!leafletMapRef.current) {
      const map = L.map(mapRef.current, {
        center: [defaultCenter.lat, defaultCenter.lng],
        zoom: 13,
        zoomControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      leafletMapRef.current = map;
    }

    const map = leafletMapRef.current;

    // Clear existing markers and polylines
    markersRef.current.forEach(m => m.remove());
    markersRef.current.clear();
    polylinesRef.current.forEach(p => p.remove());
    polylinesRef.current = [];

    // 1. Render Store Marker (Blue House Icon)
    const storeHtml = `
      <div style="
        background: #2563EB; color: #fff; width: 38px; height: 38px; borderRadius: 50%;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 12px rgba(37,99,235,0.5); border: 3px solid #fff;
        font-size: 1.2rem; cursor: pointer;
      " title="Sua Loja - ${storeAddress || storeCity}">
        🏠
      </div>
    `;
    const storeIcon = L.divIcon({
      html: storeHtml,
      className: "custom-store-pin",
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });

    const storeMarker = L.marker([defaultCenter.lat, defaultCenter.lng], { icon: storeIcon })
      .addTo(map)
      .bindPopup(`<b>🏠 ${storeAddress || "Sua Loja"}</b><br/>Ponto Inicial de Entrega`);
    markersRef.current.set("STORE", storeMarker);

    // 2. Render Orders Markers
    deliveryOrders.forEach(order => {
      const coords = geocodedMap[order.id];
      if (!coords) return;

      const isSelected = selectedOrderIds.includes(order.id);
      const selectedIndex = selectedOrderIds.indexOf(order.id);
      
      const assignedRoute = createdRoutes.find(r => r.orders.some(ro => ro.id === order.id));
      
      let bgColor = "#EF4444"; // Default red pin badge like Saipos
      let labelText = String(order.orderNumber || order.displayId || order.id.slice(-3));
      let borderColor = "#ffffff";
      let scaleCss = "scale(1)";
      let zIdx = 100;

      if (isSelected) {
        bgColor = "#2563EB"; // Bright blue for active route selection
        labelText = `${selectedIndex + 1}`; // Sequence 1, 2, 3
        borderColor = "#93C5FD";
        scaleCss = "scale(1.2)";
        zIdx = 900;
      } else if (assignedRoute) {
        bgColor = assignedRoute.color || "#10B981"; // Route specific color
        borderColor = "#ffffff";
        zIdx = 500;
      }

      const pinHtml = `
        <div style="
          background: ${bgColor}; color: #ffffff;
          padding: 4px 9px; border-radius: 6px; font-size: 0.85rem; font-weight: 900;
          border: 2px solid ${borderColor}; box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          transform: ${scaleCss}; transition: all 0.2s ease; display: inline-flex;
          align-items: center; justify-content: center; min-width: 28px; height: 26px;
          cursor: pointer;
        ">
          ${isSelected ? `<span style="font-size:0.7rem; margin-right:3px; opacity:0.9;">#</span>` : ""}${labelText}
        </div>
      `;

      const orderIcon = L.divIcon({
        html: pinHtml,
        className: `custom-order-pin-${order.id}`,
        iconSize: [32, 28],
        iconAnchor: [16, 14],
      });

      const orderMarker = L.marker([coords.lat, coords.lng], { icon: orderIcon, zIndexOffset: zIdx })
        .addTo(map)
        .bindPopup(`
          <div style="font-family: sans-serif; font-size: 0.85rem; padding: 4px;">
            <b style="color:#0F172A;">Pedido #${order.orderNumber || order.displayId || order.id}</b><br/>
            <span>👤 ${order.customerName || "Cliente"}</span><br/>
            <span style="color:#64748B;">📍 ${order.address || `${order.street || ""}, ${order.neighborhood || ""}`}</span>
          </div>
        `);

      orderMarker.on("click", () => {
        toggleOrderSelection(order.id);
      });

      markersRef.current.set(order.id, orderMarker);
    });

    // 3. Draw Polylines for Active Selection Sequence
    if (selectedOrderIds.length > 0) {
      const routePoints: [number, number][] = [[defaultCenter.lat, defaultCenter.lng]];

      selectedOrderIds.forEach(id => {
        const coords = geocodedMap[id];
        if (coords) {
          routePoints.push([coords.lat, coords.lng]);
        }
      });

      if (routePoints.length > 1) {
        const polyline = L.polyline(routePoints, {
          color: "#2563EB",
          weight: 4,
          dashArray: "8, 8",
          opacity: 0.95,
        }).addTo(map);

        polylinesRef.current.push(polyline);
      }
    }

    // 4. Draw Polylines for Existing Created Routes
    if (activeTab === "ROTAS") {
      createdRoutes.forEach(route => {
        const points: [number, number][] = [[defaultCenter.lat, defaultCenter.lng]];
        route.orders.forEach(ro => {
          const coords = geocodedMap[ro.id];
          if (coords) points.push([coords.lat, coords.lng]);
        });

        if (points.length > 1) {
          const routePoly = L.polyline(points, {
            color: route.color || "#10B981",
            weight: 4,
            opacity: 0.8,
          }).addTo(map);
          polylinesRef.current.push(routePoly);
        }
      });
    }

  }, [isOpen, leafletLoaded, defaultCenter, deliveryOrders, geocodedMap, selectedOrderIds, createdRoutes, activeTab]);

  // Toggle order selection for forming a route
  const toggleOrderSelection = (id: string) => {
    setSelectedOrderIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // Open Dispatch Modal
  const handleOpenDispatch = () => {
    if (selectedOrderIds.length === 0) return;
    setShowDispatchModal(true);
  };

  // Confirm Dispatch & Create Route
  const handleConfirmDispatch = async () => {
    if (selectedOrderIds.length === 0) return;

    let motoboyName = customMotoboyName.trim();
    let motoboyId = selectedMotoboyId;

    if (selectedMotoboyId) {
      const found = motoboys.find(m => m.id === selectedMotoboyId);
      if (found) {
        motoboyName = found.name;
      }
    }

    if (!motoboyName) {
      alert("Por favor, selecione ou informe o nome do motoboy!");
      return;
    }

    setIsDispatching(true);

    try {
      const routeOrders = selectedOrderIds
        .map(id => deliveryOrders.find(o => o.id === id))
        .filter(Boolean) as CustomerOrder[];

      for (const order of routeOrders) {
        if (onUpdateOrderStatus) {
          await onUpdateOrderStatus(order.id, "OUT_FOR_DELIVERY", motoboyId || undefined);
        } else if (motoboyId) {
          await fetch("/api/customer-order/assign-motoboy", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: order.id, motoboyId })
          });
        }
      }

      const routeNum = Math.floor(1000 + Math.random() * 9000);
      const color = ROUTE_COLORS[createdRoutes.length % ROUTE_COLORS.length];

      const newRoute: RouteItem = {
        id: `ROUTE-${Date.now()}`,
        routeNumber: routeNum,
        motoboyName,
        color,
        orders: routeOrders,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: "Sem a localização ativa"
      };

      const updated = [newRoute, ...createdRoutes];
      saveRoutes(updated);

      setSelectedOrderIds([]);
      setShowDispatchModal(false);
      setCustomMotoboyName("");
      setSelectedMotoboyId("");
      setActiveTab("ROTAS");

      if (onRefreshOrders) onRefreshOrders();

    } catch (err) {
      console.error("Erro ao criar rota:", err);
      alert("Erro ao despachar rota. Tente novamente!");
    } finally {
      setIsDispatching(false);
    }
  };

  // Copy Formatted Route Text for WhatsApp
  const handleCopyRouteText = (route: RouteItem) => {
    let text = `🚀 *ROTA DE ENTREGA #${route.routeNumber}*\n`;
    text += `🛵 *Motoboy:* ${route.motoboyName}\n`;
    text += `📦 *Total de Pedidos:* ${route.orders.length}\n\n`;

    const mapsStops: string[] = [];

    route.orders.forEach((o, idx) => {
      const addr = o.address || `${o.street || ""}, ${o.number || ""} - ${o.neighborhood || ""}`;
      text += `*${idx + 1}º Parada:* Pedido #${o.orderNumber || o.displayId || o.id}\n`;
      text += `👤 *Cliente:* ${o.customerName}\n`;
      text += `📍 *Endereço:* ${addr}\n`;
      if (o.customerPhone) text += `📞 *Tel:* ${o.customerPhone}\n`;
      text += `------------------------------\n`;

      mapsStops.push(encodeURIComponent(addr));
    });

    if (mapsStops.length > 0) {
      const mapsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(storeAddress || storeCity)}/${mapsStops.join("/")}`;
      text += `🗺️ *GPS Rota no Google Maps:*\n${mapsUrl}`;
    }

    navigator.clipboard.writeText(text);
    setCopiedRouteId(route.id);
    setTimeout(() => setCopiedRouteId(null), 3000);
  };

  // Delete Route
  const handleDeleteRoute = (routeId: string) => {
    if (!confirm("Deseja realmente cancelar esta rota?")) return;
    const updated = createdRoutes.filter(r => r.id !== routeId);
    saveRoutes(updated);
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999, background: "rgba(15, 23, 42, 0.75)",
      backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "1rem"
    }}>
      <div style={{
        background: "#F8FAFC", width: "100%", maxWidth: "1400px", height: "92vh",
        borderRadius: "16px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid #CBD5E1"
      }}>

        {/* ─── HEADER BAR ─── */}
        <div style={{
          background: "#FFFFFF", padding: "0.85rem 1.5rem", borderBottom: "1px solid #E2E8F0",
          display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ background: "#EFF6FF", color: "#2563EB", padding: "8px 12px", borderRadius: "10px", display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
              <MapPin size={20} />
              <span style={{ fontSize: "1.1rem" }}>Módulo de Roteirização</span>
            </div>
            <span style={{ fontSize: "0.85rem", color: "#64748B" }}>
              Monte rotas inteligentes por proximidade no mapa para seus motoboys
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              onClick={() => setShowConfigModal(true)}
              style={{
                padding: "8px 14px", background: "#EFF6FF", border: "1px solid #93C5FD",
                borderRadius: "8px", fontSize: "0.85rem", fontWeight: 800, color: "#1D4ED8",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6
              }}
            >
              ⚙️ Configurações
            </button>

            {onRefreshOrders && (
              <button
                onClick={onRefreshOrders}
                style={{
                  padding: "8px 14px", background: "#F1F5F9", border: "1px solid #CBD5E1",
                  borderRadius: "8px", fontSize: "0.85rem", fontWeight: 700, color: "#475569",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6
                }}
              >
                <RefreshCw size={15} /> Atualizar Pedidos
              </button>
            )}

            <button
              onClick={onClose}
              style={{
                padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FCA5A5",
                borderRadius: "8px", fontSize: "0.85rem", fontWeight: 800, color: "#DC2626",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 4
              }}
            >
              <X size={18} /> Fechar
            </button>
          </div>
        </div>

        {/* ─── MAIN CONTENT CONTAINER (2-COLUMNS: SIDEBAR + MAP) ─── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

          {/* ─── LEFT SIDEBAR PANEL (390px) ─── */}
          <div style={{
            width: "390px", background: "#FFFFFF", borderRight: "1px solid #E2E8F0",
            display: "flex", flexDirection: "column", flexShrink: 0, zIndex: 10
          }}>

            {/* TAB SELECTOR HEADER */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "2px solid #E2E8F0" }}>
              <button
                onClick={() => setActiveTab("PENDING")}
                style={{
                  padding: "12px 16px", border: "none", background: activeTab === "PENDING" ? "#FFFFFF" : "#F8FAFC",
                  borderBottom: activeTab === "PENDING" ? "3px solid #2563EB" : "none",
                  fontWeight: 800, fontSize: "0.88rem", color: activeTab === "PENDING" ? "#2563EB" : "#64748B",
                  cursor: "pointer", transition: "all 0.2s"
                }}
              >
                {filteredPendingOrders.length} PEDIDOS PENDENTES
              </button>

              <button
                onClick={() => setActiveTab("ROTAS")}
                style={{
                  padding: "12px 16px", border: "none", background: activeTab === "ROTAS" ? "#FFFFFF" : "#F8FAFC",
                  borderBottom: activeTab === "ROTAS" ? "3px solid #2563EB" : "none",
                  fontWeight: 800, fontSize: "0.88rem", color: activeTab === "ROTAS" ? "#2563EB" : "#64748B",
                  cursor: "pointer", transition: "all 0.2s"
                }}
              >
                {createdRoutes.length} ROTAS
              </button>
            </div>

            {/* TAB 1: PEDIDOS PENDENTES */}
            {activeTab === "PENDING" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                
                {/* Search Bar & Smart Auto-Cluster */}
                <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #F1F5F9", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div style={{
                    display: "flex", alignItems: "center", background: "#F8FAFC",
                    border: "1px solid #CBD5E1", borderRadius: "8px", padding: "6px 10px"
                  }}>
                    <Search size={16} color="#94A3B8" />
                    <input
                      type="text"
                      placeholder="Buscar por número do pedido ou cliente"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{
                        border: "none", background: "transparent", outline: "none",
                        width: "100%", marginLeft: "8px", fontSize: "0.82rem", fontFamily: "inherit"
                      }}
                    />
                  </div>

                  {(routeMode === "Inteligente" || routeMode === "Automatizada") && (
                    <button
                      onClick={handleAutoClusterRoutes}
                      style={{
                        width: "100%", padding: "7px 12px", background: "#F0FDF4", border: "1px solid #86EFAC",
                        borderRadius: "8px", fontSize: "0.78rem", fontWeight: 800, color: "#166534",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6
                      }}
                    >
                      🤖 Auto-Agrupar Rota {routeMode} (Máx: {maxOrdersPerRoute} pedidos / {maxDistanceKm}km)
                    </button>
                  )}
                </div>

                {/* Orders List Scroll Area */}
                <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>

                  {geocodingLoading && (
                    <div style={{ background: "#EFF6FF", color: "#1D4ED8", padding: "8px 12px", borderRadius: "8px", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={14} className="animate-spin" /> Mapeando endereços no GPS...
                    </div>
                  )}

                  {filteredPendingOrders.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
                      <CheckCircle2 size={40} style={{ margin: "0 auto 0.5rem", opacity: 0.5 }} />
                      <p style={{ fontWeight: 700, fontSize: "0.9rem" }}>Nenhum pedido pendente</p>
                      <p style={{ fontSize: "0.78rem" }}>Todos os pedidos já foram roteirizados ou entregues!</p>
                    </div>
                  ) : (
                    filteredPendingOrders.map((order) => {
                      const isSelected = selectedOrderIds.includes(order.id);
                      const seqIndex = selectedOrderIds.indexOf(order.id);
                      const displayNum = order.orderNumber || order.displayId || order.id.slice(-4);
                      const addrText = order.address || `${order.street || ""}, ${order.number || ""} - ${order.neighborhood || ""}`;

                      return (
                        <div
                          key={order.id}
                          onClick={() => toggleOrderSelection(order.id)}
                          style={{
                            border: isSelected ? "2px solid #2563EB" : "1px solid #E2E8F0",
                            background: isSelected ? "#F0F6FF" : "#FFFFFF",
                            borderRadius: "10px", padding: "0.75rem 0.85rem", marginBottom: "0.6rem",
                            cursor: "pointer", transition: "all 0.15s ease", position: "relative"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>

                            {/* Sequence Badge / Checkbox */}
                            <div style={{
                              width: "28px", height: "28px", borderRadius: "50%",
                              background: isSelected ? "#2563EB" : "#F1F5F9",
                              color: isSelected ? "#FFFFFF" : "#64748B",
                              border: isSelected ? "none" : "1px solid #CBD5E1",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 900, fontSize: "0.85rem", flexShrink: 0, marginTop: 2
                            }}>
                              {isSelected ? seqIndex + 1 : ""}
                            </div>

                            {/* Order Details */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                                <span style={{ fontWeight: 900, fontSize: "0.95rem", color: "#0F172A" }}>
                                  Pedido #{displayNum}
                                </span>
                                <span style={{
                                  background: "#F1F5F9", color: "#475569", fontSize: "0.7rem",
                                  fontWeight: 700, padding: "2px 6px", borderRadius: "4px"
                                }}>
                                  {order.platform || "Direto"}
                                </span>
                              </div>

                              <p style={{ fontWeight: 700, fontSize: "0.82rem", color: "#1E293B", margin: "0 0 3px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                📍 {addrText}
                              </p>

                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.76rem", color: "#64748B" }}>
                                <span>👤 {order.customerName}</span>
                                <span>{order.itemsCount || order.items?.length || 1} itens</span>
                              </div>
                            </div>

                          </div>
                        </div>
                      );
                    })
                  )}

                </div>

                {/* Saipos Plan Footer Info Banner */}
                <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid #E2E8F0", background: "#F8FAFC" }}>
                  <div style={{ fontSize: "0.75rem", color: "#64748B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>ROTEIRIZAÇÃO FIREHUB</span>
                    <span style={{ fontWeight: 800, color: "#16A34A" }}>ILIMITADO</span>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 2: ROTAS CRIADAS */}
            {activeTab === "ROTAS" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", padding: "0.75rem" }}>
                {createdRoutes.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
                    <Navigation size={40} style={{ margin: "0 auto 0.5rem", opacity: 0.5 }} />
                    <p style={{ fontWeight: 700, fontSize: "0.9rem" }}>Nenhuma rota despachada ainda</p>
                    <p style={{ fontSize: "0.78rem" }}>Selecione os pedidos pendentes no mapa e clique em Criar Rota!</p>
                  </div>
                ) : (
                  createdRoutes.map(route => (
                    <div
                      key={route.id}
                      style={{
                        border: "1px solid #E2E8F0", background: "#FFFFFF",
                        borderRadius: "12px", padding: "0.85rem", marginBottom: "0.75rem",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.03)"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {/* Route Color Marker */}
                          <div style={{
                            width: "16px", height: "16px", borderRadius: "50%",
                            background: route.color, border: "2px solid #fff",
                            boxShadow: "0 0 0 1px #CBD5E1"
                          }} />
                          <span style={{ fontWeight: 900, fontSize: "1rem", color: "#0F172A" }}>
                            ROTA #{route.routeNumber}
                          </span>
                        </div>

                        <span style={{ fontSize: "0.72rem", color: "#EF4444", fontWeight: 700 }}>
                          {route.status || "Sem localização ativa"}
                        </span>
                      </div>

                      <div style={{ fontSize: "0.8rem", color: "#475569", marginBottom: "0.75rem" }}>
                        <p style={{ margin: "0 0 2px 0", fontWeight: 700 }}>📦 {route.orders.length} {route.orders.length > 1 ? "Pedidos" : "Pedido"}</p>
                        <p style={{ margin: 0 }}>🛵 Entregador: <b>{route.motoboyName}</b></p>
                      </div>

                      {/* Action Buttons */}
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <button
                          onClick={() => handleCopyRouteText(route)}
                          style={{
                            flex: 1, padding: "7px", border: "1.5px solid #2563EB",
                            borderRadius: "8px", background: copiedRouteId === route.id ? "#DCFCE7" : "#FFFFFF",
                            color: copiedRouteId === route.id ? "#15803D" : "#2563EB",
                            fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 4
                          }}
                        >
                          {copiedRouteId === route.id ? <Check size={14} /> : <Copy size={14} />}
                          {copiedRouteId === route.id ? "COPIADO!" : "COPIAR ROTA"}
                        </button>

                        <button
                          onClick={() => handleDeleteRoute(route.id)}
                          style={{
                            padding: "7px 10px", border: "1px solid #CBD5E1",
                            borderRadius: "8px", background: "#F8FAFC", color: "#64748B",
                            cursor: "pointer"
                          }}
                          title="Excluir rota"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                    </div>
                  ))
                )}
              </div>
            )}

          </div>

          {/* ─── RIGHT MAP PANEL (FULL FLEX) ─── */}
          <div style={{ flex: 1, height: "100%", position: "relative" }}>
            <div ref={mapRef} style={{ width: "100%", height: "100%", zIndex: 1 }} />

            {/* ─── FLOATING ROUTE SELECTION ACTION BAR (OVER MAP BOTTOM) ─── */}
            {selectedOrderIds.length > 0 && (
              <div style={{
                position: "absolute", bottom: "24px", left: "50%", transform: "translateX(-50%)",
                zIndex: 999, background: "#1E293B", color: "#FFFFFF", padding: "0.75rem 1.25rem",
                borderRadius: "30px", boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
                display: "flex", alignItems: "center", gap: "1rem"
              }}>
                <span style={{ fontWeight: 800, fontSize: "0.9rem" }}>
                  {selectedOrderIds.length} selecionado(s)
                </span>

                <button
                  onClick={() => setSelectedOrderIds([])}
                  style={{
                    background: "transparent", border: "none", color: "#94A3B8",
                    fontWeight: 700, fontSize: "0.85rem", cursor: "pointer"
                  }}
                >
                  Cancelar
                </button>

                <button
                  onClick={handleOpenDispatch}
                  style={{
                    background: "#2563EB", color: "#FFFFFF", border: "none",
                    padding: "8px 18px", borderRadius: "20px", fontWeight: 800,
                    fontSize: "0.88rem", cursor: "pointer", display: "flex",
                    alignItems: "center", gap: 6, boxShadow: "0 4px 12px rgba(37,99,235,0.4)"
                  }}
                >
                  <Navigation size={16} /> Criar rota
                </button>
              </div>
            )}

          </div>

        </div>

      </div>

      {/* ─── DISPATCH MODAL (DESPACHAR COM MOTOBOY) ─── */}
      {showDispatchModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem"
        }}>
          <div style={{
            background: "#FFFFFF", borderRadius: "14px", width: "100%", maxWidth: "480px",
            padding: "1.5rem", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)"
          }}>
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.2rem", fontWeight: 900, color: "#0F172A" }}>
              🛵 Despachar Rota de Entrega
            </h3>
            <p style={{ fontSize: "0.85rem", color: "#64748B", marginBottom: "1.25rem" }}>
              Selecione o motoboy para enviar esta rota com <b>{selectedOrderIds.length} pedido(s)</b>.
            </p>

            {/* Route Sequence Preview */}
            <div style={{ background: "#F8FAFC", borderRadius: "10px", padding: "0.75rem", marginBottom: "1.25rem", border: "1px solid #E2E8F0" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569" }}>SEQUÊNCIA DE PARADAS:</span>
              <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {selectedOrderIds.map((id, idx) => {
                  const o = deliveryOrders.find(item => item.id === id);
                  if (!o) return null;
                  return (
                    <div key={id} style={{ fontSize: "0.8rem", color: "#1E293B", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ background: "#2563EB", color: "#fff", width: "18px", height: "18px", borderRadius: "50%", fontSize: "0.7rem", fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        {idx + 1}
                      </span>
                      <b>#{o.orderNumber || o.displayId || o.id.slice(-4)}</b> — {o.customerName} ({o.neighborhood || "Centro"})
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Motoboy Selector */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 6 }}>
                SELECIONE O MOTOBOY:
              </label>

              {motoboys.length > 0 ? (
                <select
                  value={selectedMotoboyId}
                  onChange={(e) => setSelectedMotoboyId(e.target.value)}
                  style={{
                    width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #CBD5E1",
                    fontSize: "0.9rem", fontWeight: 700, background: "#FFFFFF", outline: "none"
                  }}
                >
                  <option value="">-- Escolha um Motoboy Cadastrado --</option>
                  {motoboys.map(m => (
                    <option key={m.id} value={m.id}>🛵 {m.name}</option>
                  ))}
                </select>
              ) : null}

              <div style={{ marginTop: "0.75rem" }}>
                <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Ou digite o nome do motoboy:</span>
                <input
                  type="text"
                  placeholder="Ex: MATHEUS, MARCOS CEBOLA, FRED..."
                  value={customMotoboyName}
                  onChange={(e) => setCustomMotoboyName(e.target.value)}
                  style={{
                    width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #CBD5E1",
                    fontSize: "0.9rem", marginTop: 4, outline: "none", fontFamily: "inherit"
                  }}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button
                onClick={() => setShowDispatchModal(false)}
                style={{
                  flex: 1, padding: "10px", background: "#F1F5F9", border: "1px solid #CBD5E1",
                  borderRadius: "8px", fontWeight: 700, fontSize: "0.85rem", color: "#475569", cursor: "pointer"
                }}
              >
                Voltar
              </button>

              <button
                onClick={handleConfirmDispatch}
                disabled={isDispatching}
                style={{
                  flex: 2, padding: "10px", background: "#2563EB", border: "none",
                  borderRadius: "8px", fontWeight: 800, fontSize: "0.88rem", color: "#FFFFFF",
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6
                }}
              >
                {isDispatching ? <Loader2 size={16} className="animate-spin" /> : <Navigation size={16} />}
                Despachar Rota agora
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ─── CONFIGURAÇÃO DE MODALIDADES (ESTILO SAIPOS) ─── */}
      {showConfigModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem"
        }}>
          <div style={{
            background: "#FFFFFF", borderRadius: "14px", width: "100%", maxWidth: "560px",
            padding: "1.75rem", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)"
          }}>
            <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1.2rem", fontWeight: 900, color: "#0F172A" }}>
              ⚙️ Configurações da Roteirização
            </h3>
            <p style={{ fontSize: "0.82rem", color: "#64748B", marginBottom: "1.25rem" }}>
              Escolha e configure as regras de agrupamento de pedidos estilo Saipos.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
              
              {/* Modalidade */}
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                  Escolha a modalidade de roteirização que deseja habilitar:
                </label>
                <select
                  value={routeMode}
                  onChange={(e: any) => setRouteMode(e.target.value)}
                  style={{
                    width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #2563EB",
                    fontSize: "0.9rem", fontWeight: 800, color: "#1D4ED8", background: "#EFF6FF"
                  }}
                >
                  <option value="Manual">Manual</option>
                  <option value="Automatizada">Automatizada</option>
                  <option value="Inteligente">Inteligente</option>
                </select>
              </div>

              {routeMode !== "Manual" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                      Tempo limite para que o pedido seja inserido em uma rota (em minutos - máximo 15):
                    </label>
                    <input
                      type="number"
                      max={15}
                      min={1}
                      value={maxWaitMinutes}
                      onChange={(e) => setMaxWaitMinutes(Number(e.target.value))}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                      Em qual status os pedidos deverão ser roteirizados?
                    </label>
                    <select
                      value={targetStatus}
                      onChange={(e) => setTargetStatus(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    >
                      <option value="Cozinha">Cozinha</option>
                      <option value="Pronto">Pronto</option>
                      <option value="Aceito">Aceito</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                      Depois de roteirizados, os pedidos deverão ser movimentados automaticamente ao próximo status?
                    </label>
                    <select
                      value={autoMoveStatus}
                      onChange={(e) => setAutoMoveStatus(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    >
                      <option value="Não">Não</option>
                      <option value="Sim">Sim</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                      Imprimir automaticamente os pedidos após roteirizar?
                    </label>
                    <select
                      value={autoPrint}
                      onChange={(e) => setAutoPrint(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    >
                      <option value="Não">Não</option>
                      <option value="Sim">Sim</option>
                    </select>
                  </div>
                </>
              )}

              {routeMode === "Inteligente" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#1D4ED8", marginBottom: 4 }}>
                      Número máximo de pedidos a serem inseridos em uma mesma rota:
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={maxOrdersPerRoute}
                      onChange={(e) => setMaxOrdersPerRoute(Number(e.target.value))}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #93C5FD", background: "#EFF6FF", fontWeight: 800 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#1D4ED8", marginBottom: 4 }}>
                      Distância máxima entre pedidos de uma mesma rota (em quilômetros):
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={maxDistanceKm}
                      onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #93C5FD", background: "#EFF6FF", fontWeight: 800 }}
                    />
                  </div>
                </>
              )}

            </div>

            <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                onClick={() => setShowConfigModal(false)}
                style={{
                  padding: "10px 20px", background: "#2563EB", color: "#FFFFFF",
                  border: "none", borderRadius: "8px", fontWeight: 800, fontSize: "0.9rem",
                  cursor: "pointer"
                }}
              >
                💾 SALVAR CONFIGURAÇÃO
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
