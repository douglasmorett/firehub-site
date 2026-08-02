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
  dailyOrderNumber?: number | string;
  orderNumber?: number | string;
  displayId?: string;
  ifoodReference?: string;
  openDeliveryReference?: string;
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

export const getOrderDisplayNumber = (order: any): string => {
  if (!order) return "—";
  if (order.dailyOrderNumber != null && order.dailyOrderNumber !== "") {
    return String(order.dailyOrderNumber);
  }
  if (order.ifoodReference) return String(order.ifoodReference);
  if (order.openDeliveryReference) return String(order.openDeliveryReference);
  if (order.orderNumber) return String(order.orderNumber);
  if (order.displayId) return String(order.displayId);
  return String(order.id || "").slice(-4).toUpperCase();
};

export const getOrderPaymentInfo = (order: any) => {
  if (!order) return { isCash: false, isCardOnDelivery: false, changeNeeded: 0, methodRaw: "" };

  const methodRaw = String(order.paymentMethod || order.payment_method || order.paymentType || "").toUpperCase();
  const notesRaw = String(order.notes || "").toUpperCase();
  const total = Number(order.totalAmount || 0);

  const isCash = methodRaw.includes("DINHEIRO") || methodRaw.includes("CASH") || notesRaw.includes("DINHEIRO") || notesRaw.includes("TROCO");
  const isCardOnDelivery = methodRaw.includes("CARTAO") || methodRaw.includes("MAQUINA") || methodRaw.includes("MAQUININHA") || methodRaw.includes("DEBITO") || methodRaw.includes("CREDITO") || methodRaw.includes("VALE") || notesRaw.includes("LEVAR MAQUINA") || notesRaw.includes("MAQUININHA");

  let changeNeeded = 0;
  if (typeof order.changeAmount === "number" && order.changeAmount > 0) {
    changeNeeded = order.changeAmount > total ? (order.changeAmount - total) : order.changeAmount;
  } else {
    const match = notesRaw.match(/TROCO\s*(?:PARA)?\s*R?\$?\s*(\d+[\.,]?\d*)/i) || notesRaw.match(/TROCO\s*(\d+[\.,]?\d*)/i);
    if (match && match[1]) {
      const trocoPara = parseFloat(match[1].replace(",", "."));
      if (trocoPara > total) {
        changeNeeded = trocoPara - total;
      } else {
        changeNeeded = trocoPara;
      }
    }
  }

  return {
    isCash,
    isCardOnDelivery,
    changeNeeded,
    methodRaw
  };
};

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
  storeSlug?: string;
  storeId?: string;
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
  storeSlug,
  storeId,
  storeLatLng = null,
  onRefreshOrders,
  onUpdateOrderStatus
}: RoteirizacaoModalProps) {
  const [activeTab, setActiveTab] = useState<"PENDING" | "ROTAS">("PENDING");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [hoveredOrderId, setHoveredOrderId] = useState<string | null>(null);
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]);

  // Custom Created Routes State
  const [createdRoutes, setCreatedRoutes] = useState<RouteItem[]>([]);

  // Saipos Roteirização Configuration Settings
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [routeMode, setRouteMode] = useState<"Manual" | "Automatizada" | "Inteligente">("Inteligente");
  const [onlyProntoOrders, setOnlyProntoOrders] = useState(false); // Roteirizar só os prontos ou todos
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
  const [customMotoboyPhone, setCustomMotoboyPhone] = useState("");
  const [sendWhatsAppToMotoboy, setSendWhatsAppToMotoboy] = useState(true);
  const [isDispatching, setIsDispatching] = useState(false);
  const [copiedRouteId, setCopiedRouteId] = useState<string | null>(null);

  // Resumo de Troco Total e Maquininha para a Rota Selecionada
  const routePaymentSummary = useMemo(() => {
    let totalChangeToCarry = 0;
    let needsCardMachine = false;
    let cashOrdersCount = 0;
    let cardOrdersCount = 0;

    selectedOrderIds.forEach((id) => {
      const order = orders.find((o) => o.id === id);
      if (!order) return;

      const info = getOrderPaymentInfo(order);
      if (info.isCash) {
        cashOrdersCount++;
        totalChangeToCarry += info.changeNeeded;
      }
      if (info.isCardOnDelivery) {
        cardOrdersCount++;
        needsCardMachine = true;
      }
    });

    return {
      totalChangeToCarry,
      needsCardMachine,
      cashOrdersCount,
      cardOrdersCount,
    };
  }, [selectedOrderIds, orders]);

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

  // Load saved routes and config from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("firehub_created_routes");
      if (saved) {
        setCreatedRoutes(JSON.parse(saved));
      }

      const savedConfig = localStorage.getItem("firehub_roteirizacao_config");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        if (parsed.routeMode) setRouteMode(parsed.routeMode);
        if (typeof parsed.onlyProntoOrders === "boolean") setOnlyProntoOrders(parsed.onlyProntoOrders);
        if (parsed.maxWaitMinutes) setMaxWaitMinutes(parsed.maxWaitMinutes);
        if (parsed.targetStatus) setTargetStatus(parsed.targetStatus);
        if (parsed.autoMoveStatus) setAutoMoveStatus(parsed.autoMoveStatus);
        if (parsed.autoPrint) setAutoPrint(parsed.autoPrint);
        if (parsed.maxOrdersPerRoute) setMaxOrdersPerRoute(parsed.maxOrdersPerRoute);
        if (parsed.maxDistanceKm) setMaxDistanceKm(parsed.maxDistanceKm);
      }
    } catch (e) {}
  }, []);

  // Save config to localStorage
  const handleSaveConfig = () => {
    try {
      const cfg = {
        routeMode,
        onlyProntoOrders,
        maxWaitMinutes,
        targetStatus,
        autoMoveStatus,
        autoPrint,
        maxOrdersPerRoute,
        maxDistanceKm
      };
      localStorage.setItem("firehub_roteirizacao_config", JSON.stringify(cfg));
    } catch (e) {}
    setShowConfigModal(false);
  };

  const handleToggleOnlyPronto = (val: boolean) => {
    setOnlyProntoOrders(val);
    try {
      const savedConfig = localStorage.getItem("firehub_roteirizacao_config");
      const parsed = savedConfig ? JSON.parse(savedConfig) : {};
      parsed.onlyProntoOrders = val;
      localStorage.setItem("firehub_roteirizacao_config", JSON.stringify(parsed));
    } catch (e) {}
  };

  // Save routes to localStorage
  const saveRoutes = (routes: RouteItem[]) => {
    setCreatedRoutes(routes);
    try {
      localStorage.setItem("firehub_created_routes", JSON.stringify(routes));
    } catch (e) {}
  };

  // Helper base de pedidos de entrega elegíveis (sem filtro da cozinha)
  const baseDeliveryOrders = useMemo(() => {
    return orders.filter((o: any) => {
      const statusUpper = String(o.status || "").toUpperCase().trim();
      if (statusUpper.includes("CANCEL")) return false;
      if (statusUpper === "ENTREGUE" || statusUpper === "ENCERRADO" || statusUpper === "FINISHED") return false;

      const isAlreadyDispatched =
        statusUpper === "SAIU_ENTREGA" ||
        statusUpper === "SAIU_PARA_ENTREGA" ||
        statusUpper === "OUT_FOR_DELIVERY" ||
        statusUpper === "EM_TRANSITO" ||
        statusUpper === "DISPATCHED" ||
        statusUpper === "EM_ROTA" ||
        Boolean(o.motoboyId) ||
        Boolean(o.dispatchedAt);

      if (isAlreadyDispatched) return false;

      const deliveryTypeUpper = String(o.deliveryType || o.orderType || o.type || "").toUpperCase().trim();
      const isPickupType =
        deliveryTypeUpper === "TAKEOUT" ||
        deliveryTypeUpper === "PICKUP" ||
        deliveryTypeUpper === "RETIRADA" ||
        deliveryTypeUpper === "BALCAO" ||
        deliveryTypeUpper === "MESA" ||
        deliveryTypeUpper === "PRESENCIAL" ||
        deliveryTypeUpper === "IN_STORE" ||
        o.isPickup === true ||
        Boolean(o.takeout);

      if (isPickupType) return false;

      const addrRaw = String(o.customerAddress || o.address || `${o.street || ""} ${o.number || ""} ${o.neighborhood || ""}`).toLowerCase();
      if (
        addrRaw.includes("retirada") ||
        addrRaw.includes("retirar") ||
        addrRaw.includes("retira em loja") ||
        addrRaw.includes("no balcao") ||
        addrRaw.includes("comer no local")
      ) {
        return false;
      }

      return addrRaw.trim().length > 2;
    });
  }, [orders]);

  // Contagem de todos os pedidos elegíveis de entrega
  const allDeliveryOrdersCount = useMemo(() => {
    return baseDeliveryOrders.length;
  }, [baseDeliveryOrders]);

  // Contagem de pedidos prontos na cozinha
  const prontoOrdersCount = useMemo(() => {
    return baseDeliveryOrders.filter((o: any) => {
      const statusUpper = String(o.status || "").toUpperCase().trim();
      return (
        statusUpper === "PRONTO" ||
        statusUpper === "PRONTO_ENTREGA" ||
        statusUpper === "PREPARADO" ||
        statusUpper === "READY" ||
        statusUpper === "FINISHED" ||
        o.kdsStage === "READY" ||
        o.kdsStage === "FINISHED"
      );
    }).length;
  }, [baseDeliveryOrders]);

  // Filter Delivery Orders (Strictly exclude Pickup/Retirada, Dispatched/Out for delivery, and respect onlyProntoOrders setting)
  const deliveryOrders = useMemo(() => {
    return baseDeliveryOrders.filter((o: any) => {
      if (onlyProntoOrders) {
        const statusUpper = String(o.status || "").toUpperCase().trim();
        const isPronto =
          statusUpper === "PRONTO" ||
          statusUpper === "PRONTO_ENTREGA" ||
          statusUpper === "PREPARADO" ||
          statusUpper === "READY" ||
          statusUpper === "FINISHED" ||
          o.kdsStage === "READY" ||
          o.kdsStage === "FINISHED";
        if (!isPronto) return false;
      }
      return true;
    });
  }, [baseDeliveryOrders, onlyProntoOrders]);

  // Filtered Orders based on search term (ordenado do MENOR para o MAIOR número de pedido #137 -> #156)
  const filteredPendingOrders = useMemo(() => {
    const list = deliveryOrders.filter((o) => {
      const isInRoute = createdRoutes.some((r) => r.orders.some((ro) => ro.id === o.id));
      if (isInRoute) return false;

      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      const numStr = getOrderDisplayNumber(o).toLowerCase();
      const name = (o.customerName || "").toLowerCase();
      const addr = (o.address || `${o.street || ""} ${o.neighborhood || ""}`).toLowerCase();
      return numStr.includes(term) || name.includes(term) || addr.includes(term);
    });

    return list.sort((a, b) => {
      const idxA = selectedOrderIds.indexOf(a.id);
      const idxB = selectedOrderIds.indexOf(b.id);
      const isSelA = idxA !== -1;
      const isSelB = idxB !== -1;

      // 1. Se ambos estiverem selecionados, mantém a ordem de seleção (#1, #2, #3...)
      if (isSelA && isSelB) return idxA - idxB;
      // 2. Se apenas A estiver selecionado, fica no topo
      if (isSelA) return -1;
      // 3. Se apenas B estiver selecionado, fica no topo
      if (isSelB) return 1;

      // 4. Ordenação Ascendente: do MENOR número de pedido para o MAIOR (#137, #139, #140 ... #156)
      const numA = parseInt(getOrderDisplayNumber(a).replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(getOrderDisplayNumber(b).replace(/\D/g, ""), 10) || 0;
      if (numA !== numB) {
        return numA - numB;
      }

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [deliveryOrders, createdRoutes, searchTerm, selectedOrderIds]);

  // Clean Address for Nominatim OpenStreetMap Geocoding
  const cleanAddressForGeocoding = (rawAddress: string) => {
    let clean = rawAddress
      .replace(/(-?\s*Comp:.*)/gi, "")
      .replace(/(-?\s*Casa.*)/gi, "")
      .replace(/(-?\s*Ap.*)/gi, "")
      .replace(/(-?\s*Apto.*)/gi, "")
      .replace(/(-?\s*Bloco.*)/gi, "")
      .replace(/(-?\s*Fundos.*)/gi, "")
      .trim();

    clean = clean
      .replace(/^R\.\s*/i, "Rua ")
      .replace(/^Av\.\s*/i, "Avenida ")
      .replace(/^Alameda\s*/i, "Alameda ");

    return clean;
  };

  // Automatic Geocoding Engine for Order Addresses with Instant LocalStorage Cache & Parallel Batches
  useEffect(() => {
    if (!isOpen || deliveryOrders.length === 0) return;

    // Load persistent address cache from localStorage
    let localCache: Record<string, { lat: number; lng: number }> = {};
    try {
      const stored = localStorage.getItem("firehub_geo_cache");
      if (stored) localCache = JSON.parse(stored);
    } catch {}

    const initialMap = { ...geocodedMap };
    let initialUpdated = false;
    const toGeocode: { id: string; searchAddress: string; cleanAddr: string }[] = [];

    deliveryOrders.forEach((order, idx) => {
      const rawAddr = (order as any).customerAddress || order.address || `${order.street || ""} ${order.number || ""} ${order.neighborhood || ""}`;
      const cleanedAddr = cleanAddressForGeocoding(rawAddr);
      const cacheKey = `${cleanedAddr}_${storeCity}`.toLowerCase().trim();

      // Check if address is in persistent localStorage cache
      if (localCache[cacheKey]) {
        if (!initialMap[order.id] || initialMap[order.id].lat !== localCache[cacheKey].lat) {
          initialMap[order.id] = localCache[cacheKey];
          initialUpdated = true;
        }
      } else if (!initialMap[order.id]) {
        // Fallback coordinates near store so pins render instantly in 0.001s
        const idHash = (order.id || "").split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const offsetLat = (((idHash % 17) - 8) * 0.0015) + (idx * 0.0003);
        const offsetLng = ((((idHash * 5) % 17) - 8) * 0.0015) - (idx * 0.0002);
        initialMap[order.id] = {
          lat: defaultCenter.lat + offsetLat,
          lng: defaultCenter.lng + offsetLng
        };
        initialUpdated = true;
        toGeocode.push({
          id: order.id,
          cleanAddr: cacheKey,
          searchAddress: `${cleanedAddr}, ${storeCity}, RJ, Brasil`
        });
      }
    });

    if (initialUpdated) {
      setGeocodedMap(initialMap);
    }

    if (toGeocode.length === 0) {
      setGeocodingLoading(false);
      return;
    }

    // Process un-cached addresses in fast parallel batches
    let isMounted = true;
    const geocodeAddresses = async () => {
      setGeocodingLoading(true);
      const updatedMap = { ...initialMap };
      const updatedCache = { ...localCache };
      let hasNewCache = false;

      // Process in batches of 4 for maximum speed without hitting rate limits
      const BATCH_SIZE = 4;
      for (let i = 0; i < toGeocode.length; i += BATCH_SIZE) {
        if (!isMounted) break;
        const batch = toGeocode.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (item) => {
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(item.searchAddress)}&limit=1`,
                { headers: { "User-Agent": "FireHub-Roteirizacao/1.0" }, signal: AbortSignal.timeout(4000) }
              );

              if (res.ok) {
                const data = await res.json();
                if (data && data.length > 0) {
                  const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                  updatedMap[item.id] = coords;
                  updatedCache[item.cleanAddr] = coords;
                  hasNewCache = true;
                }
              }
            } catch (err) {}
          })
        );

        if (isMounted) {
          setGeocodedMap({ ...updatedMap });
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      if (hasNewCache) {
        try {
          localStorage.setItem("firehub_geo_cache", JSON.stringify(updatedCache));
        } catch {}
      }

      if (isMounted) setGeocodingLoading(false);
    };

    geocodeAddresses();

    return () => {
      isMounted = false;
    };
  }, [isOpen, deliveryOrders, storeCity, defaultCenter]);

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

  // Algoritmo TSP Nearest-Neighbor para Ordenação Inteligente do Trajeto a partir da Loja
  const optimizeRouteSequence = (
    orderIds: string[],
    storeCoords: { lat: number; lng: number }
  ): string[] => {
    if (orderIds.length <= 1) return orderIds;

    const validIds = orderIds.filter((id) => geocodedMap[id]);
    const unmappedIds = orderIds.filter((id) => !geocodedMap[id]);

    if (validIds.length <= 1) return orderIds;

    const result: string[] = [];
    let currentPos = storeCoords;
    let remaining = [...validIds];

    while (remaining.length > 0) {
      let nearestIndex = 0;
      let minDistance = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const coords = geocodedMap[remaining[i]];
        if (!coords) continue;
        const dist = calculateHaversineKm(currentPos.lat, currentPos.lng, coords.lat, coords.lng);
        if (dist < minDistance) {
          minDistance = dist;
          nearestIndex = i;
        }
      }

      const nextId = remaining[nearestIndex];
      result.push(nextId);
      currentPos = geocodedMap[nextId];
      remaining.splice(nearestIndex, 1);
    }

    return [...result, ...unmappedIds];
  };

  const handleOptimizeSelectedRoute = () => {
    if (selectedOrderIds.length <= 1) return;
    const optimized = optimizeRouteSequence(selectedOrderIds, defaultCenter);
    setSelectedOrderIds(optimized);
  };

  // Smart Auto-Clustering Algorithm: Garante SEMPRE o pedido mais antigo na rota + busca vizinhos próximos a ele
  const handleAutoClusterRoutes = () => {
    const unrouted = filteredPendingOrders.filter((o) => geocodedMap[o.id]);
    if (unrouted.length === 0) {
      alert("Nenhum pedido pendente mapeado no GPS para agrupar!");
      return;
    }

    // 1. O pedido mais antigo pendente (ex: #7) É OBRIGATORIAMENTE a semente da rota e NÃO PODE ser deixado para trás
    const oldestOrder = unrouted[0];
    const oldestCoords = geocodedMap[oldestOrder.id];
    const cluster: string[] = [oldestOrder.id];

    // 2. Busca entre os outros pedidos pendentes aqueles que estão na mesma região do pedido mais antigo (até maxDistanceKm)
    for (let i = 1; i < unrouted.length; i++) {
      if (cluster.length >= maxOrdersPerRoute) break;
      const candidate = unrouted[i];
      const candidateCoords = geocodedMap[candidate.id];
      if (!candidateCoords || !oldestCoords) continue;

      const isCloseToSeed = calculateHaversineKm(oldestCoords.lat, oldestCoords.lng, candidateCoords.lat, candidateCoords.lng) <= maxDistanceKm;

      const isCloseToCluster = cluster.every((clusterOrderId) => {
        const cCoords = geocodedMap[clusterOrderId];
        if (!cCoords) return false;
        return calculateHaversineKm(cCoords.lat, cCoords.lng, candidateCoords.lat, candidateCoords.lng) <= maxDistanceKm;
      });

      if (isCloseToSeed && isCloseToCluster) {
        cluster.push(candidate.id);
      }
    }

    // 3. Otimiza a sequência do trajeto a partir da Loja (Loja -> Parada 1 -> Parada 2 -> Parada 3) no sentido mais eficiente
    const optimizedCluster = optimizeRouteSequence(cluster, defaultCenter);
    setSelectedOrderIds(optimizedCluster);
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
      const isHovered = hoveredOrderId === order.id;

      const assignedRoute = createdRoutes.find(r => r.orders.some(ro => ro.id === order.id));
      
      let bgColor = "#EF4444"; // Default red pin badge like Saipos
      let labelText = getOrderDisplayNumber(order);
      let borderColor = "#ffffff";
      let scaleCss = "scale(1)";
      let zIdx = 100;
      let shadowCss = "0 4px 10px rgba(0,0,0,0.3)";

      if (isHovered) {
        bgColor = "#2563EB";
        borderColor = "#93C5FD";
        scaleCss = "scale(1.4)";
        shadowCss = "0 0 20px rgba(37,99,235,0.8)";
        zIdx = 999;
      } else if (isSelected) {
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
          border: 2px solid ${borderColor}; box-shadow: ${shadowCss};
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
            <b style="color:#0F172A;">Pedido #${getOrderDisplayNumber(order)}</b><br/>
            <span>👤 ${order.customerName || "Cliente"}</span><br/>
            <span style="color:#64748B;">📍 ${order.address || `${order.street || ""}, ${order.neighborhood || ""}`}</span>
          </div>
        `);

      orderMarker.on("click", () => {
        toggleOrderSelection(order.id);
      });

      markersRef.current.set(order.id, orderMarker);
    });

    // 3. Render Motoboys Markers with Helmets & Blue Name Badges (Saipos Style)
    motoboys.forEach(mb => {
      const mbLat = (mb as any).lastLat;
      const mbLng = (mb as any).lastLng;
      if (!mbLat || !mbLng) return;

      const mbHtml = `
        <div style="
          display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;
        ">
          <div style="
            background: #1D4ED8; color: #FFFFFF; font-size: 0.72rem; font-weight: 900;
            padding: 2px 7px; border-radius: 4px; border: 1.5px solid #FFFFFF;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3); text-transform: uppercase; white-space: nowrap;
            margin-bottom: 2px;
          ">
            ${mb.name}
          </div>
          <div style="
            background: #DC2626; color: #FFFFFF; width: 30px; height: 30px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            border: 2px solid #FFFFFF; box-shadow: 0 3px 8px rgba(0,0,0,0.35); font-size: 0.95rem;
          ">
            ⛑️
          </div>
        </div>
      `;

      const mbIcon = L.divIcon({
        html: mbHtml,
        className: `custom-motoboy-pin-${mb.id}`,
        iconSize: [60, 48],
        iconAnchor: [30, 44],
      });

      const mbMarker = L.marker([mbLat, mbLng], { icon: mbIcon, zIndexOffset: 950 })
        .addTo(map)
        .bindPopup(`<b>🛵 Entregador ${mb.name}</b><br/>📍 Localização GPS em tempo real`);

      markersRef.current.set(`MOTOBOY_${mb.id}`, mbMarker);
    });

    // 4. Draw Polylines for Active Selection Sequence
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

      // Automatic WhatsApp Dispatch to Motoboy
      let targetPhone = customMotoboyPhone.trim().replace(/\D/g, "");
      if (selectedMotoboyId) {
        const found = motoboys.find(m => m.id === selectedMotoboyId);
        if (found && found.phone) targetPhone = found.phone.replace(/\D/g, "");
      }

      // Build Multi-stop Google Maps URL & Itinerary Text
      const mapWaypoints = routeOrders.map(o => {
        const addr = (o as any).customerAddress || o.address || `${o.street || ""} ${o.number || ""} ${o.neighborhood || ""}`;
        return encodeURIComponent(`${addr}, ${storeCity}`);
      });
      const googleMapsLink = `https://www.google.com/maps/dir/${encodeURIComponent(storeAddress || storeCity)}/${mapWaypoints.join("/")}`;
      const motoboyAppLink = typeof window !== "undefined" ? `${window.location.origin}/loja/${storeSlug}/motoboy` : "";

      let waMsg = `🚀 *NOVA ROTA DE ENTREGA DESPACHADA! (Rota #${routeNum})*\n`;
      waMsg += `🛵 *Entregador:* ${motoboyName}\n`;
      waMsg += `📦 *Total de Pedidos:* ${routeOrders.length}\n`;

      if (routePaymentSummary.totalChangeToCarry > 0) {
        waMsg += `💵 *Troco Total a Levar no Caixa:* R$ ${routePaymentSummary.totalChangeToCarry.toFixed(2)}\n`;
      }
      if (routePaymentSummary.needsCardMachine) {
        waMsg += `💳 *Levar Maquininha de Cartão:* SIM (Cobrar na Entrega)\n`;
      }
      waMsg += `\n`;

      routeOrders.forEach((o, idx) => {
        const num = (o as any).dailyOrderNumber || o.orderNumber || o.displayId || o.id;
        const name = o.customerName || "Cliente";
        const addr = (o as any).customerAddress || o.address || `${o.street || ""} ${o.number || ""} ${o.neighborhood || ""}`;
        const phone = o.customerPhone ? `📞 *Tel:* ${o.customerPhone}\n` : "";

        const pInfo = getOrderPaymentInfo(o);
        let payNote = "";
        if (pInfo.isCash && pInfo.changeNeeded > 0) {
          payNote = ` 💵 (Dinheiro - levar R$ ${pInfo.changeNeeded.toFixed(2)} de troco)`;
        } else if (pInfo.isCardOnDelivery) {
          payNote = ` 💳 (Cobrar no Cartão na entrega)`;
        }

        waMsg += `*${idx + 1}º Parada:* Pedido #${num}${payNote}\n👤 *Cliente:* ${name}\n📍 *Endereço:* ${addr}\n${phone}\n`;
      });

      waMsg += `🗺️ *Navegação Google Maps (GPS):*\n${googleMapsLink}\n\n`;
      if (motoboyAppLink) waMsg += `📲 *Seu App de Entregador:* ${motoboyAppLink}\n`;

      if (sendWhatsAppToMotoboy && targetPhone) {
        try {
          await fetch("/api/motoboys/dispatch-whatsapp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              motoboyPhone: targetPhone,
              routeText: waMsg
            })
          });
        } catch (e) {
          console.warn("Falha no disparo via API, abrindo fallback do WhatsApp Web:", e);
          window.open(`https://wa.me/55${targetPhone}?text=${encodeURIComponent(waMsg)}`, "_blank");
        }
      }

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
                <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #F1F5F9", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  
                  {/* Seletor de Filtro: Mostrar Todos vs Mostrar Prontos */}
                  <div style={{ display: "flex", gap: "4px", background: "#F1F5F9", padding: "4px", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
                    <button
                      type="button"
                      onClick={() => handleToggleOnlyPronto(false)}
                      style={{
                        flex: 1, padding: "6px 10px", borderRadius: "7px", border: "none",
                        background: !onlyProntoOrders ? "#FFFFFF" : "transparent",
                        color: !onlyProntoOrders ? "#0F172A" : "#64748B",
                        fontWeight: !onlyProntoOrders ? 900 : 700,
                        fontSize: "0.78rem", cursor: "pointer",
                        boxShadow: !onlyProntoOrders ? "0 2px 5px rgba(0,0,0,0.08)" : "none",
                        transition: "all 0.15s ease",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                      }}
                    >
                      📋 Mostrar Todos ({allDeliveryOrdersCount})
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleOnlyPronto(true)}
                      style={{
                        flex: 1, padding: "6px 10px", borderRadius: "7px", border: "none",
                        background: onlyProntoOrders ? "linear-gradient(135deg, #16A34A, #15803D)" : "transparent",
                        color: onlyProntoOrders ? "#FFFFFF" : "#64748B",
                        fontWeight: onlyProntoOrders ? 900 : 700,
                        fontSize: "0.78rem", cursor: "pointer",
                        boxShadow: onlyProntoOrders ? "0 2px 6px rgba(22,163,74,0.3)" : "none",
                        transition: "all 0.15s ease",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                      }}
                    >
                      🍳 Mostrar Prontos ({prontoOrdersCount})
                    </button>
                  </div>
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
                        width: "100%", padding: "10px 14px",
                        background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                        border: "none",
                        borderRadius: "10px", fontSize: "0.85rem", fontWeight: 900, color: "#FFFFFF",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        boxShadow: "0 4px 12px rgba(16, 185, 129, 0.35)",
                        transition: "transform 0.1s ease"
                      }}
                      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                    >
                      ⚡ 🤖 Auto-Agrupar Rota {routeMode} (Máx: {maxOrdersPerRoute} pedidos / {maxDistanceKm}km)
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
                      const isHovered = hoveredOrderId === order.id;
                      const seqIndex = selectedOrderIds.indexOf(order.id);
                      const displayNum = getOrderDisplayNumber(order);
                      const addrText = (order as any).customerAddress || order.address || `${order.street || ""} ${order.number || ""} ${order.neighborhood || ""}` || "Endereço a confirmar";

                      return (
                        <div
                          key={order.id}
                          onClick={() => toggleOrderSelection(order.id)}
                          onMouseEnter={() => setHoveredOrderId(order.id)}
                          onMouseLeave={() => setHoveredOrderId(null)}
                          style={{
                            border: isHovered ? "2px solid #3B82F6" : isSelected ? "2px solid #2563EB" : "1px solid #E2E8F0",
                            background: isHovered ? "#E0E7FF" : isSelected ? "#F0F6FF" : "#FFFFFF",
                            boxShadow: isHovered ? "0 4px 14px rgba(59,130,246,0.25)" : "none",
                            transform: isHovered ? "translateX(4px)" : "none",
                            borderRadius: "10px", padding: "0.75rem 0.85rem", marginBottom: "0.6rem",
                            cursor: "pointer", transition: "all 0.15s ease", position: "relative"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>

                            {/* Sequence Badge / Checkbox */}
                            <div style={{
                              width: "30px", height: "30px", borderRadius: "50%",
                              background: isSelected ? "linear-gradient(135deg, #2563EB, #1D4ED8)" : "#F1F5F9",
                              color: isSelected ? "#FFFFFF" : "#64748B",
                              border: isSelected ? "none" : "1.5px solid #CBD5E1",
                              boxShadow: isSelected ? "0 3px 8px rgba(37,99,235,0.4)" : "none",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 900, fontSize: "0.82rem", flexShrink: 0, marginTop: 2
                            }}>
                              {isSelected ? `#${seqIndex + 1}` : ""}
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

                {selectedOrderIds.length > 1 && (
                  <button
                    type="button"
                    onClick={handleOptimizeSelectedRoute}
                    style={{
                      background: "linear-gradient(135deg, #059669, #10B981)", color: "#FFFFFF", border: "none",
                      padding: "8px 14px", borderRadius: "20px", fontWeight: 800,
                      fontSize: "0.82rem", cursor: "pointer", display: "flex",
                      alignItems: "center", gap: 6, boxShadow: "0 4px 12px rgba(16,185,129,0.3)"
                    }}
                    title="Reordenar sequência pela menor distância a partir da loja sem idas e voltas"
                  >
                    ⚡ Otimizar Trajeto
                  </button>
                )}

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
            <div style={{ background: "#F8FAFC", borderRadius: "10px", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #E2E8F0" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569" }}>SEQUÊNCIA DE PARADAS:</span>
              <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {selectedOrderIds.map((id, idx) => {
                  const o = deliveryOrders.find(item => item.id === id);
                  if (!o) return null;
                  const pInfo = getOrderPaymentInfo(o);
                  return (
                    <div key={id} style={{ fontSize: "0.8rem", color: "#1E293B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ background: "#2563EB", color: "#fff", width: "18px", height: "18px", borderRadius: "50%", fontSize: "0.7rem", fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {idx + 1}
                        </span>
                        <b>#{o.orderNumber || o.displayId || o.id.slice(-4)}</b> — {o.customerName} ({o.neighborhood || "Centro"})
                      </div>
                      <span style={{ fontSize: "0.72rem", fontWeight: 700, color: pInfo.isCash ? "#DC2626" : pInfo.isCardOnDelivery ? "#2563EB" : "#16A34A" }}>
                        {pInfo.isCash ? `💵 Troco: R$ ${pInfo.changeNeeded.toFixed(2)}` : pInfo.isCardOnDelivery ? "💳 Cartão" : "✅ Pago Online"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Resumo de Logística de Pagamento (Troco & Maquininha) */}
            <div style={{ background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderRadius: "10px", padding: "0.85rem", marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#166534", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "6px" }}>
                💼 RESUMO DE LOGÍSTICA DE PAGAMENTO:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.82rem", color: "#15803D" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>💵 Troco Total a Levar no Caixa:</span>
                  <b style={{ fontSize: "0.95rem", color: routePaymentSummary.totalChangeToCarry > 0 ? "#DC2626" : "#166534" }}>
                    {routePaymentSummary.totalChangeToCarry > 0 ? `R$ ${routePaymentSummary.totalChangeToCarry.toFixed(2)}` : "Sem troco (R$ 0,00)"}
                  </b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>💳 Levar Maquininha de Cartão:</span>
                  <b style={{ color: routePaymentSummary.needsCardMachine ? "#2563EB" : "#475569" }}>
                    {routePaymentSummary.needsCardMachine ? "✅ SIM (Cobrar Cartão na Entrega)" : "❌ NÃO (Pago Online / Dinheiro)"}
                  </b>
                </div>
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
                    <option key={m.id} value={m.id}>🛵 {m.name} {m.phone ? `(${m.phone})` : ""}</option>
                  ))}
                </select>
              ) : null}

              {!selectedMotoboyId && (
                <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Ou digite o nome e telefone do motoboy:</span>
                  <input
                    type="text"
                    placeholder="Nome ex: MATHEUS, MARCOS CEBOLA, FRED..."
                    value={customMotoboyName}
                    onChange={(e) => setCustomMotoboyName(e.target.value)}
                    style={{
                      width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #CBD5E1",
                      fontSize: "0.9rem", outline: "none", fontFamily: "inherit"
                    }}
                  />
                  <input
                    type="text"
                    placeholder="WhatsApp do Motoboy (ex: 22999998888)"
                    value={customMotoboyPhone}
                    onChange={(e) => setCustomMotoboyPhone(e.target.value)}
                    style={{
                      width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #CBD5E1",
                      fontSize: "0.9rem", outline: "none", fontFamily: "inherit"
                    }}
                  />
                </div>
              )}

              {/* Opção de Envio por WhatsApp */}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", fontWeight: 700, color: "#1E293B", cursor: "pointer", marginTop: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={sendWhatsAppToMotoboy}
                  onChange={(e) => setSendWhatsAppToMotoboy(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#2563EB" }}
                />
                📱 Disparar rota automaticamente no WhatsApp do Motoboy
              </label>
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
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                      ⏱️ Janela Máxima de Espera para Agrupar Pedidos (em minutos - máx 15):
                    </label>
                    <input
                      type="number"
                      max={15}
                      min={1}
                      value={maxWaitMinutes}
                      onChange={(e) => setMaxWaitMinutes(Math.min(15, Math.max(1, Number(e.target.value))))}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    />
                    <p style={{ margin: "4px 0 0 0", fontSize: "0.74rem", color: "#64748B", lineHeight: 1.3 }}>
                      💡 <b>O que significa:</b> É o tempo máximo que um pedido antigo pode esperar na loja por outros pedidos da mesma região antes de sair na entrega. Evita que o pedido fique esperando tempo demais e chegue frio.
                    </p>
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
                      Quais pedidos exibir na Roteirização?
                    </label>
                    <select
                      value={onlyProntoOrders ? "PRONTOS" : "TODOS"}
                      onChange={(e) => setOnlyProntoOrders(e.target.value === "PRONTOS")}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #2563EB", background: "#EFF6FF", fontWeight: 800, color: "#1E40AF" }}
                    >
                      <option value="TODOS">Todos os pedidos pendentes (Cozinha, Aceito, Pronto)</option>
                      <option value="PRONTOS">Roteirizar APENAS pedidos com status "Pronto"</option>
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
                onClick={handleSaveConfig}
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
