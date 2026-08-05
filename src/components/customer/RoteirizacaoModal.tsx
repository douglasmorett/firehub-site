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
  motoboyId?: string;
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

  // Load Motoboys from API (Pré-carrega em background sem atrasar a abertura)
  useEffect(() => {
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
  }, []);

  // Forçar resize do mapa instantaneamente ao abrir a modal pré-carregada
  useEffect(() => {
    if (isOpen && leafletMapRef.current) {
      setTimeout(() => {
        try {
          leafletMapRef.current?.invalidateSize();
        } catch {}
      }, 100);
    }
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

  // Save routes to API & localStorage
  const saveRoutes = (routes: RouteItem[]) => {
    setCreatedRoutes(routes);
    try {
      localStorage.setItem("firehub_created_routes", JSON.stringify(routes));
    } catch (e) {}
  };

  // Buscar rotas sincronizadas no banco de dados (multi-dispositivo)
  const fetchStoreRoutes = async () => {
    try {
      const res = await fetch("/api/store/routes");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.routes)) {
          const dbRoutes: RouteItem[] = data.routes.map((r: any) => ({
            id: r.id,
            routeNumber: r.routeNumber,
            motoboyName: r.motoboy?.name || "Aguardando Motoboy",
            motoboyPhone: r.motoboy?.phone || "",
            motoboyId: r.motoboyId || null,
            color: r.color || "#3B82F6",
            orders: (r.orders || []).map((o: any) => ({
              id: o.id,
              dailyOrderNumber: o.dailyOrderNumber,
              customerName: o.customerName || "Cliente",
              customerPhone: o.customerPhone,
              address: o.customerAddress,
              status: o.status,
              totalAmount: o.totalAmount,
            })),
            createdAt: new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            status: r.status === "DISPATCHED" ? "🚀 Despachada" : "⏳ Aguardando Despacho",
          }));
          setCreatedRoutes(dbRoutes);
        }
      }
    } catch (err) {
      console.error("Erro ao buscar rotas da API:", err);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchStoreRoutes();
    const interval = setInterval(fetchStoreRoutes, 4000);
    return () => clearInterval(interval);
  }, [isOpen]);

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

  // Helper para verificar se um ponto caiu no Oceano Atlântico em Rio das Ostras
  const isPointInSea = (lat: number, lng: number): boolean => {
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) return true;
    // Linha costeira de Rio das Ostras: terra fica estritamente a oeste de Lng -41.915
    if (lng > -41.915) return true;
    // Na curva ao sul de Costazul / Boca da Barra (Lat < -22.525), a costa entra para Oeste
    if (lat < -22.525 && lng > -41.921) return true;
    // Na região de Cidade Beira Mar / Praiana / Cantinho do Mar (Lat < -22.533)
    if (lat < -22.533 && lng > -41.952) return true;
    return false;
  };

  // Helper para extrair e destacar o Bairro e formatar endereço completo
  const parseAddressDetails = (rawAddr: string) => {
    if (!rawAddr || typeof rawAddr !== "string") {
      return { neighborhood: "", fullAddress: "Endereço a confirmar" };
    }

    const fullAddress = rawAddr.trim();
    let neighborhood = "";

    // Lista de Bairros Conhecidos da Região (Prioridade MÁXIMA de identificação)
    const knownNeighborhoods = [
      "Praiamar", "Praia Âncora", "Praia Ancora", "Residencial Praia Âncora", "Village Rio das Ostras",
      "Bosque D'Areia", "Reduto da Paz", "Colinas", "Chácara Mariléa", "Chacara Marilea", "Chacara Marileia",
      "Jardim Mariléa", "Jardim Marilea", "Novo Rio das Ostras", "Extensão Novo Rio das Ostras",
      "Extensao Novo Rio das Ostras", "Recanto Rio das Ostras", "Bairro Operário", "Bairro Operario",
      "Parque São Jorge", "Parque Sao Jorge", "Extensão do Bosque", "Extensao do Bosque",
      "Jardim Bela Vista", "Cidade Beira Mar", "Cidade Praiana", "Costa Azul", "Costazul",
      "Serra Mar", "Verdes Mares", "Ouro Verde", "Terra Firme", "Enseada das Gaivotas",
      "Nova Esperança", "Nova Esperanca", "Jardim Esperança", "Jardim Esperanca",
      "Casas Velhas", "Rocha Leão", "Rocha Leao", "Balneário Remanso", "Balneario Remanso",
      "Boca da Barra", "Boca do Mato", "Jardim Atlântico", "Jardim Atlantico", "Nova Aliança", "Nova Alianca",
      "São Cristóvão", "São Cristovao", "Sao Cristovao", "Cantinho do Mar", "Gelson Apicelo",
      "Jardim Campomar", "Campomar", "Bosque da Praia", "Viverde", "Cláudio Ribeiro", "Claudio Ribeiro",
      "Mariléa", "Marilea", "Centro", "Remanso", "Âncora", "Ancora", "Zabulão", "Zambulao",
      "Extremoz", "Recreio", "Operários", "Operarios", "Cantagalo", "Unamar", "Tamoios",
      "Peró", "Atlântica", "Atlantica", "Recanto"
    ];

    // 1. Procurar primeiro se o endereço cita explicitamente algum bairro conhecido
    for (const bName of knownNeighborhoods) {
      const reg = new RegExp(`\\b${bName}\\b`, "i");
      if (reg.test(fullAddress)) {
        neighborhood = bName;
        break;
      }
    }

    // 2. Se não achou na lista conhecida, procurar por "Bairro: XXX" ou "Bairro XXX" (Evitando 'Brasil')
    if (!neighborhood) {
      const bairroMatch = fullAddress.match(/(?:bairro|b\.:?)\s*([^-,]+)/i);
      if (bairroMatch && bairroMatch[1]) {
        const candidate = bairroMatch[1].trim();
        if (candidate.length > 2 && candidate.toLowerCase() !== "asil" && !/brasil|rio das ostras|cabo frio|rj/i.test(candidate)) {
          neighborhood = candidate;
        }
      }
    }

    // 3. Se ainda não achou e o endereço tem partes divididas por "-" ou ","
    if (!neighborhood) {
      const parts = fullAddress.split(/\s*-\s*|\s*,\s*/);
      if (parts.length >= 2) {
        const filteredParts = parts.filter(p => !/rio das ostras|cabo frio|unamar|macaé|macae|rj|brasil|asil/i.test(p.trim()));
        if (filteredParts.length >= 2) {
          const lastPart = filteredParts[filteredParts.length - 1].trim();
          if (!/comp|complemento|casa|apto|bloco|sobrado|ponto|muro|portão|ref/i.test(lastPart) && lastPart.length < 35 && lastPart.toLowerCase() !== "asil") {
            neighborhood = lastPart;
          }
        }
      }
    }

    return {
      neighborhood,
      fullAddress,
    };
  };

  // Dicionário de Bairros de Rio das Ostras e Região com Coordenadas de Alta Precisão (RIGOROSAMENTE EM TERRA FIRME)
  const NEIGHBORHOOD_COORDS_MAP: Record<string, { lat: number; lng: number }> = {
    costazul: { lat: -22.5205, lng: -41.9175 },
    "costa azul": { lat: -22.5205, lng: -41.9175 },
    recreio: { lat: -22.5115, lng: -41.9160 },
    praiamar: { lat: -22.4980, lng: -41.9060 },
    "praia ancora": { lat: -22.5010, lng: -41.9050 },
    "praia âmcora": { lat: -22.5010, lng: -41.9050 },
    "residencial praia ancora": { lat: -22.5010, lng: -41.9050 },
    "residencial praia Âncora": { lat: -22.5010, lng: -41.9050 },
    "village rio das ostras": { lat: -22.5040, lng: -41.9120 },
    marilea: { lat: -22.5130, lng: -41.9340 },
    mariléa: { lat: -22.5130, lng: -41.9340 },
    "jardim marilea": { lat: -22.5130, lng: -41.9340 },
    "jardim mariléa": { lat: -22.5130, lng: -41.9340 },
    "jardim marileia": { lat: -22.5130, lng: -41.9340 },
    "marilea chacara": { lat: -22.5080, lng: -41.9310 },
    "mariléa chácara": { lat: -22.5080, lng: -41.9310 },
    "chacara marilea": { lat: -22.5080, lng: -41.9310 },
    "chácara mariléa": { lat: -22.5080, lng: -41.9310 },
    "chacara marileia": { lat: -22.5080, lng: -41.9310 },
    "nova cidade": { lat: -22.5210, lng: -41.9480 },
    "ouro verde": { lat: -22.5170, lng: -41.9240 },
    "jardim bela vista": { lat: -22.5140, lng: -41.9270 },
    "parque sao jorge": { lat: -22.5220, lng: -41.9360 },
    "parque são jorge": { lat: -22.5220, lng: -41.9360 },
    "sao cristovao": { lat: -22.5160, lng: -41.9420 },
    "são cristóvão": { lat: -22.5160, lng: -41.9420 },
    "sao cristóvão": { lat: -22.5160, lng: -41.9420 },
    "são cristovao": { lat: -22.5160, lng: -41.9420 },
    "cantinho do mar": { lat: -22.5310, lng: -41.9560 },
    "nova alianca": { lat: -22.5300, lng: -41.9530 },
    "nova aliança": { lat: -22.5300, lng: -41.9530 },
    "extensao do bosque": { lat: -22.5280, lng: -41.9480 },
    "extensão do bosque": { lat: -22.5280, lng: -41.9480 },
    "extensao novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
    "extensão novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
    "novo rio das ostras": { lat: -22.5210, lng: -41.9430 },
    ancora: { lat: -22.5050, lng: -41.9480 },
    âncora: { lat: -22.5050, lng: -41.9480 },
    "cidade praiana": { lat: -22.5360, lng: -41.9660 },
    centro: { lat: -22.5245, lng: -41.9455 },
    recanto: { lat: -22.5320, lng: -41.9560 },
    "recanto rio das ostras": { lat: -22.5320, lng: -41.9560 },
    atlantica: { lat: -22.5030, lng: -41.9240 },
    atlântica: { lat: -22.5030, lng: -41.9240 },
    "jardim atlantico": { lat: -22.5030, lng: -41.9240 },
    "jardim atlântico": { lat: -22.5030, lng: -41.9240 },
    "terra firme": { lat: -22.5120, lng: -41.9200 },
    "enseada das gaivotas": { lat: -22.5020, lng: -41.9200 },
    operarios: { lat: -22.5230, lng: -41.9380 },
    operários: { lat: -22.5230, lng: -41.9380 },
    "bairro operario": { lat: -22.5230, lng: -41.9380 },
    "bairro operário": { lat: -22.5230, lng: -41.9380 },
    "verdes mares": { lat: -22.5380, lng: -41.9520 },
    "serra mar": { lat: -22.5290, lng: -41.9620 },
    "cidade beira mar": { lat: -22.5350, lng: -41.9630 },
    "jardim campomar": { lat: -22.5320, lng: -41.9600 },
    campomar: { lat: -22.5320, lng: -41.9600 },
    "gelson apicelo": { lat: -22.5150, lng: -41.9380 },
    "boca da barra": { lat: -22.5280, lng: -41.9320 },
    viverde: { lat: -22.5180, lng: -41.9520 },
  };

  // Limpa Complementos / Referências mantendo rua, número e bairro intactos (idêntico ao Google Maps)
  const cleanAddressForGeocoding = (rawAddress: string) => {
    if (!rawAddress) return "";
    let clean = rawAddress.replace(/\s*-\s*null\s*$/gi, "").replace(/\s*-\s*undefined\s*$/gi, "").trim();
    clean = clean.replace(/[\.,\s\-]+$/, "");

    const parts = clean.split(/[-–—,]/).map(p => p.trim()).filter(Boolean);
    const cleanParts: string[] = [];

    for (const part of parts) {
      if (
        /^(ref|referencia|referência|ponto de ref|ponto de referencia|ponto de referência|comp|complemento|ao lado|proximo|próximo|prox|apto|apt|ap|bloco|bl|qd|lote|lt|fundos|frente|casa\s*\d+)/i.test(part) ||
        /^(ref|referencia|referência|comp|complemento)\s*:/i.test(part) ||
        /^ao lado d/i.test(part) ||
        /^pr[óo]ximo/i.test(part)
      ) {
        continue;
      }

      let fixedPart = part.replace(/\bn[ºo]?\s*(\d+)\b/gi, "$1");
      fixedPart = fixedPart
        .replace(/\bR\.\s*/gi, "Rua ")
        .replace(/\bAv\.\s*/gi, "Avenida ")
        .replace(/\bRes\.\s*/gi, "Residencial ")
        .replace(/\bTv\.\s*/gi, "Travessa ")
        .replace(/\bEst\.\s*/gi, "Estrada ")
        .replace(/\bPq\.\s*/gi, "Parque ");

      if (fixedPart.trim() && !/brasil|rj/i.test(fixedPart.trim())) {
        cleanParts.push(fixedPart.trim());
      }
    }

    return cleanParts.join(", ");
  };

  // Motor Inteligente de Geocodificação Automática com Filtro Anti-Mar e Cache Persistente
  useEffect(() => {
    if (deliveryOrders.length === 0) return;

    // Carregar cache local de geocodificação
    let localCache: Record<string, { lat: number; lng: number }> = {};
    try {
      const stored = localStorage.getItem("firehub_geo_cache");
      if (stored) localCache = JSON.parse(stored);
    } catch {}

    const initialMap = { ...geocodedMap };
    let initialUpdated = false;
    const toGeocode: { id: string; idx: number; rawAddr: string; neighborhood: string; cleanedStreet: string; cacheKey: string; dictFallback?: { lat: number; lng: number } }[] = [];

    deliveryOrders.forEach((order, idx) => {
      const rawAddr = (order as any).customerAddress || order.address || `${order.street || ""} ${order.number || ""} ${order.neighborhood || ""}`;
      const { neighborhood } = parseAddressDetails(rawAddr);
      const cleanedStreet = cleanAddressForGeocoding(rawAddr);
      const cacheKey = `${cleanedStreet}_${neighborhood}_${storeCity}`.toLowerCase().trim();

      const orderLat = (order as any).customerLatLng?.lat || (order as any).latitude || (order as any).lat;
      const orderLng = (order as any).customerLatLng?.lng || (order as any).longitude || (order as any).lng;

      const cleanBairroKey = neighborhood.toLowerCase().trim();
      const dictFallback =
        NEIGHBORHOOD_COORDS_MAP[cleanBairroKey] ||
        NEIGHBORHOOD_COORDS_MAP[cleanBairroKey.replace(/^jardim\s+/i, "")] ||
        NEIGHBORHOOD_COORDS_MAP[cleanBairroKey.replace(/^bairro\s+/i, "")] ||
        NEIGHBORHOOD_COORDS_MAP[cleanBairroKey.replace(/^residencial\s+/i, "")];

      // Se o pedido já possui lat/lng válidas e NÃO estão no mar, usa direto
      if (orderLat && orderLng && !isNaN(Number(orderLat)) && !isNaN(Number(orderLng)) && !isPointInSea(Number(orderLat), Number(orderLng))) {
        if (!initialMap[order.id] || initialMap[order.id].lat !== Number(orderLat)) {
          initialMap[order.id] = { lat: Number(orderLat), lng: Number(orderLng) };
          initialUpdated = true;
        }
      } else if (localCache[cacheKey] && !isPointInSea(localCache[cacheKey].lat, localCache[cacheKey].lng)) {
        if (!initialMap[order.id] || initialMap[order.id].lat !== localCache[cacheKey].lat) {
          initialMap[order.id] = localCache[cacheKey];
          initialUpdated = true;
        }
      } else {
        // Atribui o dictFallback provisório para a tela não abrir em branco
        if (dictFallback && !initialMap[order.id]) {
          initialMap[order.id] = dictFallback;
          initialUpdated = true;
        }
        // SEMPRE coloca no toGeocode para buscar a rua exata no Nominatim
        toGeocode.push({
          id: order.id,
          idx,
          rawAddr,
          neighborhood,
          cleanedStreet,
          cacheKey,
          dictFallback,
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

    let isMounted = true;
    const geocodeAddresses = async () => {
      setGeocodingLoading(true);
      const updatedMap = { ...initialMap };
      const updatedCache = { ...localCache };
      let hasNewCache = false;

      const fetchNominatim = async (query: string) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
            { headers: { "User-Agent": "FireHub-Roteirizacao/1.0" }, signal: AbortSignal.timeout(3500) }
          );
          if (res.ok) {
            const data = await res.json();
            if (data && data.length > 0) {
              const lat = parseFloat(data[0].lat);
              const lng = parseFloat(data[0].lon);
              // FILTRO ANTI-MAR: Se o Nominatim retornar uma coordenada no oceano, ignora!
              if (!isPointInSea(lat, lng)) {
                return { lat, lng };
              }
            }
          }
        } catch {}
        return null;
      };

      const BATCH_SIZE = 4;
      for (let i = 0; i < toGeocode.length; i += BATCH_SIZE) {
        if (!isMounted) break;
        const batch = toGeocode.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map(async (item) => {
            let coords: { lat: number; lng: number } | null = null;

            // 1. Tentativa com Endereço Limpo 100% no padrão do Google Maps (Rua, Número, Bairro, Cidade)
            const query1 = item.cleanedStreet.toLowerCase().includes(storeCity.toLowerCase())
              ? `${item.cleanedStreet}, RJ, Brasil`
              : `${item.cleanedStreet}, ${storeCity}, RJ, Brasil`;
            coords = await fetchNominatim(query1);

            // 2. Segunda tentativa anexando bairro se o endereço ainda for muito curto
            if (!coords && item.neighborhood && !item.cleanedStreet.toLowerCase().includes(item.neighborhood.toLowerCase())) {
              const query2 = `${item.cleanedStreet}, ${item.neighborhood}, ${storeCity}, RJ, Brasil`;
              coords = await fetchNominatim(query2);
            }

            // 3. Tentativa apenas pelo Bairro no Nominatim
            if (!coords && item.neighborhood) {
              const query3 = `${item.neighborhood}, ${storeCity}, RJ, Brasil`;
              coords = await fetchNominatim(query3);
            }

            // 4. Fallback pelo Dicionário Estático do Bairro (RIGOROSAMENTE EM TERRA)
            if (!coords && item.dictFallback) {
              coords = item.dictFallback;
            }

            // 5. Fallback Absoluto Garantido em Terra Firme (Centro da Cidade com Jitter)
            if (!coords) {
              coords = {
                lat: defaultCenter.lat + ((item.idx % 5) - 2) * 0.002,
                lng: defaultCenter.lng + (Math.floor(item.idx / 5) - 2) * 0.002,
              };
            }

            // Garante 100% que o ponto final não cai no oceano!
            if (isPointInSea(coords.lat, coords.lng)) {
              coords = item.dictFallback || { lat: -22.5245, lng: -41.9455 };
            }

            updatedMap[item.id] = coords;
            updatedCache[item.cacheKey] = coords;
            hasNewCache = true;
          })
        );

        if (isMounted) {
          setGeocodedMap({ ...updatedMap });
        }
        await new Promise((r) => setTimeout(r, 150));
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

  // Smart Auto-Clustering Algorithm: Garante SEMPRE o pedido mais antigo/prioritário + busca pedidos no caminho (corredor) ou próximos
  const handleAutoClusterRoutes = () => {
    const unrouted = filteredPendingOrders.filter((o) => geocodedMap[o.id]);
    if (unrouted.length === 0) {
      alert("Nenhum pedido pendente mapeado no GPS para agrupar!");
      return;
    }

    // 1. O pedido mais antigo pendente (ex: #14) É OBRIGATORIAMENTE a semente da rota
    const oldestOrder = unrouted[0];
    const targetCoords = geocodedMap[oldestOrder.id];
    if (!targetCoords) return;

    const storeCoords = defaultCenter;
    const distStoreToTarget = calculateHaversineKm(storeCoords.lat, storeCoords.lng, targetCoords.lat, targetCoords.lng);

    // Lista de candidatos elegíveis com pontuação de menor desvio
    const candidatesWithScore: { id: string; detourKm: number; distToTargetKm: number; score: number }[] = [];

    for (let i = 1; i < unrouted.length; i++) {
      const candidate = unrouted[i];
      const candCoords = geocodedMap[candidate.id];
      if (!candCoords) continue;

      const distStoreToCand = calculateHaversineKm(storeCoords.lat, storeCoords.lng, candCoords.lat, candCoords.lng);
      const distCandToTarget = calculateHaversineKm(candCoords.lat, candCoords.lng, targetCoords.lat, targetCoords.lng);

      // Desvio de trajeto adicionado ao ir até o candidato a caminho do destino principal
      const detourKm = distStoreToCand + distCandToTarget - distStoreToTarget;

      // Critério 1: Está próximo do destino final (raio até maxDistanceKm)
      const isNearTarget = distCandToTarget <= maxDistanceKm;

      // Critério 2: Está "no caminho" (corredor da loja até o destino) com desvio baixo (ex: até 1.8km ou maxDistanceKm)
      const maxAllowedDetour = Math.min(1.8, Math.max(1.0, maxDistanceKm * 0.75));
      const isEnRoute = detourKm <= maxAllowedDetour && distStoreToCand <= (distStoreToTarget + 1.0);

      if (isNearTarget || isEnRoute) {
        const score = (detourKm * 0.6) + (distCandToTarget * 0.4);
        candidatesWithScore.push({
          id: candidate.id,
          detourKm,
          distToTargetKm: distCandToTarget,
          score
        });
      }
    }

    // Ordenar os candidatos pelo menor desvio / maior conveniência de percurso
    candidatesWithScore.sort((a, b) => a.score - b.score);

    const clusterIds = [oldestOrder.id];
    for (const cand of candidatesWithScore) {
      if (clusterIds.length >= maxOrdersPerRoute) break;
      clusterIds.push(cand.id);
    }

    // 3. Otimiza a sequência do trajeto a partir da Loja (Loja -> Parada 1 -> Parada 2 -> Destino) no sentido mais eficiente
    const optimizedCluster = optimizeRouteSequence(clusterIds, defaultCenter);
    setSelectedOrderIds(optimizedCluster);
  };

  // Helper para centralizar manualmente a visão do mapa sob demanda do usuário
  const handleFitAllBounds = () => {
    if (!leafletMapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    const points: [number, number][] = [[defaultCenter.lat, defaultCenter.lng]];
    deliveryOrders.forEach((o) => {
      const coords = geocodedMap[o.id];
      if (coords) points.push([coords.lat, coords.lng]);
    });

    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      leafletMapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  };

  // 1. Inicializa o Mapa Leaflet uma única vez (Pré-carregado em background)
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    if (!leafletMapRef.current) {
      const map = L.map(mapRef.current, {
        center: [defaultCenter.lat, defaultCenter.lng],
        zoom: 13,
        zoomControl: true,
        preferCanvas: true,
        updateWhenZooming: false,
        updateWhenIdle: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        keepBuffer: 5,
      }).addTo(map);

      leafletMapRef.current = map;
    }

    return () => {
      // Limpa a instância APENAS se o componente for completamente desmontado da página
      if (leafletMapRef.current) {
        try {
          leafletMapRef.current.remove();
        } catch {}
        leafletMapRef.current = null;
      }
    };
  }, [leafletLoaded, defaultCenter]);

  // 2. Reajusta dimensões do container do mapa instantaneamente ao abrir o modal
  useEffect(() => {
    if (isOpen && leafletMapRef.current) {
      const t1 = setTimeout(() => {
        try { leafletMapRef.current?.invalidateSize(); } catch {}
      }, 50);
      const t2 = setTimeout(() => {
        try { leafletMapRef.current?.invalidateSize(); } catch {}
      }, 200);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [isOpen]);

  // 3. Desenha Pinos, Motoboys e Rotas reusando o mapa existente (SEM resetar o zoom do usuário)
  useEffect(() => {
    if (!leafletLoaded || !leafletMapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

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

    // 5. Draw Polylines for Existing Created Routes
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
  }, [leafletLoaded, defaultCenter, deliveryOrders, geocodedMap, selectedOrderIds, createdRoutes, activeTab, hoveredOrderId, motoboys, storeAddress, storeCity]);

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

  // Criar Rota no Banco de Dados (Com ou Sem Motoboy)
  const handleCreateRouteToDB = async (motoboyIdToAssign?: string) => {
    if (selectedOrderIds.length === 0) return;
    setIsDispatching(true);

    try {
      const color = ROUTE_COLORS[createdRoutes.length % ROUTE_COLORS.length];
      const res = await fetch("/api/store/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: selectedOrderIds,
          motoboyId: motoboyIdToAssign || selectedMotoboyId || null,
          color,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || "Erro ao criar rota no servidor");
        return;
      }

      await fetchStoreRoutes();
      setSelectedOrderIds([]);
      setShowDispatchModal(false);
      setSelectedMotoboyId("");
      setCustomMotoboyName("");
      setActiveTab("ROTAS");

      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      console.error("Erro ao criar rota no banco:", err);
      alert("Erro ao criar rota: " + (err?.message || err));
    } finally {
      setIsDispatching(false);
    }
  };

  // Despachar Rota Existente (Move pedidos para SAIU_ENTREGA e notifica WhatsApp)
  const handleDispatchExistingRoute = async (routeId: string, assignedMotoboyId?: string) => {
    const finalMbId = assignedMotoboyId || selectedMotoboyId;
    if (!finalMbId) {
      alert("Por favor, selecione o motoboy para despachar a rota!");
      return;
    }

    setIsDispatching(true);

    try {
      const res = await fetch("/api/store/routes/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeId,
          motoboyId: finalMbId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        alert(errData.error || "Erro ao despachar rota");
        return;
      }

      await fetchStoreRoutes();
      if (onRefreshOrders) onRefreshOrders();
      alert("🚀 Rota despachada com sucesso! Pedidos movidos para 'Saiu para Entrega'.");
    } catch (err: any) {
      console.error("Erro ao despachar rota:", err);
      alert("Erro ao despachar rota: " + (err?.message || err));
    } finally {
      setIsDispatching(false);
    }
  };

  // Confirm Dispatch & Create/Dispatch Route from Modal
  const handleConfirmDispatch = async () => {
    if (selectedOrderIds.length === 0) return;

    if (!selectedMotoboyId && !customMotoboyName.trim()) {
      // Se não escolheu motoboy, cria a rota como "Aguardando Motoboy" no banco!
      await handleCreateRouteToDB();
      return;
    }

    // Se escolheu motoboy, cria a rota e despacha imediatamente!
    let motoboyId = selectedMotoboyId;
    if (!motoboyId && customMotoboyName.trim()) {
      // Se digitou nome de motoboy customizado, cria o motoboy se necessário
      try {
        const mbRes = await fetch("/api/motoboys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: customMotoboyName.trim(),
            phone: customMotoboyPhone.trim(),
          }),
        });
        if (mbRes.ok) {
          const newMb = await mbRes.json();
          motoboyId = newMb.id;
        }
      } catch (e) {}
    }

    try {
      // 1. Cria a rota no banco
      const color = ROUTE_COLORS[createdRoutes.length % ROUTE_COLORS.length];
      const createRes = await fetch("/api/store/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: selectedOrderIds,
          motoboyId: motoboyId || null,
          color,
        }),
      });

      if (!createRes.ok) {
        const errData = await createRes.json();
        alert(errData.error || "Erro ao criar rota");
        return;
      }

      const { route } = await createRes.json();

      // 2. Se informou motoboy, despacha a rota imediatamente
      if (motoboyId && route?.id) {
        await handleDispatchExistingRoute(route.id, motoboyId);
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

      const cleanAddr = addr
        .replace(/(-?\s*Comp(?:lemento)?:.*)/gi, "")
        .replace(/(-?\s*Ref(?:erencia)?:.*)/gi, "")
        .trim();
      const cityStr = storeCity || "Rio das Ostras";
      const fullAddr = cleanAddr.toLowerCase().includes(cityStr.toLowerCase()) ? cleanAddr : `${cleanAddr}, ${cityStr}`;
      mapsStops.push(encodeURIComponent(fullAddr));
    });

    if (mapsStops.length > 0) {
      let mapsUrl = "";
      if (mapsStops.length === 1) {
        mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${mapsStops[0]}`;
      } else {
        const lastStop = mapsStops[mapsStops.length - 1];
        const waypoints = mapsStops.slice(0, -1).join("|");
        mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lastStop}&waypoints=${waypoints}`;
      }
      text += `🗺️ *GPS Rota no Google Maps:*\n${mapsUrl}`;
    }

    navigator.clipboard.writeText(text);
    setCopiedRouteId(route.id);
    setTimeout(() => setCopiedRouteId(null), 3000);
  };

  // Delete Route (Remove do Banco de Dados)
  const handleDeleteRoute = async (routeId: string) => {
    if (!confirm("Deseja realmente desfazer/excluir esta rota? OS pedidos voltarão para pendentes.")) return;
    try {
      await fetch(`/api/store/routes?routeId=${encodeURIComponent(routeId)}`, { method: "DELETE" });
      await fetchStoreRoutes();
      if (onRefreshOrders) onRefreshOrders();
    } catch (e) {
      console.error("Erro ao deletar rota:", e);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999, background: "rgba(15, 23, 42, 0.75)",
      backdropFilter: "blur(4px)", display: isOpen ? "flex" : "none", alignItems: "center", justifyContent: "center",
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

                              {/* Bairro em Destaque & Endereço Completo sem cortes */}
                              {(() => {
                                const { neighborhood, fullAddress } = parseAddressDetails(addrText);
                                const isMapped = Boolean(geocodedMap[order.id]);
                                return (
                                  <div style={{ margin: "3px 0 5px 0" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                                      {neighborhood ? (
                                        <span style={{
                                          background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A",
                                          padding: "2px 7px", borderRadius: "5px", fontWeight: 800, fontSize: "0.78rem"
                                        }}>
                                          🏘️ Bairro: {neighborhood}
                                        </span>
                                      ) : null}

                                      {!isMapped && (
                                        <span style={{
                                          background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE",
                                          padding: "2px 7px", borderRadius: "5px", fontWeight: 700, fontSize: "0.72rem"
                                        }}>
                                          📍 Localizando GPS...
                                        </span>
                                      )}
                                    </div>

                                    <p style={{ fontWeight: 700, fontSize: "0.82rem", color: "#1E293B", margin: 0, lineHeight: 1.35, wordBreak: "break-word" }}>
                                      📍 {fullAddress}
                                    </p>
                                  </div>
                                );
                              })()}

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
                  createdRoutes.map(route => {
                    const isDispatched = route.status?.includes("Despachada") || route.status === "DISPATCHED";
                    return (
                      <div
                        key={route.id}
                        style={{
                          border: isDispatched ? "1.5px solid #BBF7D0" : "1.5px solid #FED7AA",
                          background: isDispatched ? "#F0FDF4" : "#FFFBEB",
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
                              {route.routeNumber}
                            </span>
                          </div>

                          <span style={{
                            fontSize: "0.74rem",
                            color: isDispatched ? "#15803D" : "#D97706",
                            fontWeight: 900,
                            background: isDispatched ? "#DCFCE7" : "#FEF3C7",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            border: isDispatched ? "1px solid #86EFAC" : "1px solid #FDE68A",
                          }}>
                            {route.status || (isDispatched ? "🚀 Despachada" : "⏳ Aguardando Despacho")}
                          </span>
                        </div>

                        <div style={{ fontSize: "0.8rem", color: "#475569", marginBottom: "0.75rem" }}>
                          <p style={{ margin: "0 0 4px 0", fontWeight: 700 }}>📦 {route.orders.length} {route.orders.length > 1 ? "Pedidos" : "Pedido"}: {route.orders.map(o => getOrderDisplayNumber(o)).join(", ")}</p>
                          <p style={{ margin: "0 0 8px 0" }}>🛵 Entregador: <b>{route.motoboyName || "Aguardando Seleção"}</b></p>

                          {/* Se ainda não foi despachada, permite selecionar motoboy na hora */}
                          {!isDispatched && (
                            <div style={{ marginTop: "6px", marginBottom: "8px" }}>
                              <select
                                defaultValue={route.motoboyId || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val) {
                                    handleDispatchExistingRoute(route.id, val);
                                  }
                                }}
                                style={{
                                  width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1.5px solid #CBD5E1",
                                  fontSize: "0.8rem", fontWeight: 700, background: "#FFFFFF"
                                }}
                              >
                                <option value="">-- Selecione o Motoboy para Despachar --</option>
                                {motoboys.map(m => (
                                  <option key={m.id} value={m.id}>🛵 {m.name} {m.phone ? `(${m.phone})` : ""}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          {!isDispatched && (
                            <button
                              onClick={() => {
                                const mbId = route.motoboyId || selectedMotoboyId;
                                if (!mbId) {
                                  alert("Selecione o motoboy para despachar a rota!");
                                  return;
                                }
                                handleDispatchExistingRoute(route.id, mbId);
                              }}
                              disabled={isDispatching}
                              style={{
                                flex: 2, padding: "8px", border: "none",
                                borderRadius: "8px", background: "linear-gradient(135deg, #16A34A, #15803D)",
                                color: "#FFFFFF", fontWeight: 900, fontSize: "0.82rem", cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                boxShadow: "0 2px 8px rgba(22,163,74,0.3)"
                              }}
                            >
                              <Navigation size={14} /> 🚀 Despachar Rota
                            </button>
                          )}

                          <button
                            onClick={() => handleCopyRouteText(route)}
                            style={{
                              flex: 1, padding: "8px", border: "1.5px solid #2563EB",
                              borderRadius: "8px", background: copiedRouteId === route.id ? "#DCFCE7" : "#FFFFFF",
                              color: copiedRouteId === route.id ? "#15803D" : "#2563EB",
                              fontWeight: 800, fontSize: "0.78rem", cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 4
                            }}
                          >
                            {copiedRouteId === route.id ? <Check size={14} /> : <Copy size={14} />}
                            {copiedRouteId === route.id ? "COPIADO!" : "COPIAR"}
                          </button>

                          <button
                            onClick={() => handleDeleteRoute(route.id)}
                            style={{
                              padding: "8px 10px", border: "1px solid #CBD5E1",
                              borderRadius: "8px", background: "#F8FAFC", color: "#64748B",
                              cursor: "pointer"
                            }}
                            title="Desfazer/Excluir rota"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                      </div>
                    );
                  })
                )}
              </div>
            )}

          </div>

          {/* ─── RIGHT MAP PANEL (FULL FLEX) ─── */}
          <div style={{ flex: 1, height: "100%", position: "relative" }}>
            <div ref={mapRef} style={{ width: "100%", height: "100%", zIndex: 1 }} />

            {/* FLOATING MAP CONTROLS (TOP RIGHT) */}
            <div style={{
              position: "absolute", top: "16px", right: "16px", zIndex: 999,
              display: "flex", gap: "8px"
            }}>
              <button
                type="button"
                onClick={handleFitAllBounds}
                style={{
                  background: "#FFFFFF", color: "#0F172A", border: "1.5px solid #CBD5E1",
                  borderRadius: "8px", padding: "8px 12px", fontSize: "0.82rem", fontWeight: 800,
                  cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  display: "flex", alignItems: "center", gap: "6px"
                }}
                title="Centralizar visão em todos os pinos de entrega"
              >
                <Navigation size={15} style={{ transform: "rotate(45deg)", color: "#2563EB" }} />
                Centralizar Visão
              </button>
            </div>

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
