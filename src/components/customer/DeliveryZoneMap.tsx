"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { areasDeRisco as lerAreasDeRisco, type AreaDeRisco } from "@/lib/area-de-risco";
import { explicarRegraDoApp, lerRegraDeRepasse, type OrigemDoRepasseNoApp } from "@/lib/repasse-do-entregador";
import { MapPin, Search, Plus, Trash2, Check, Loader2, Navigation, Pencil } from "lucide-react";

const ZONE_COLORS = ["#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA", "#00ACC1"];

/**
 * Como a loja cobra a entrega. Três métodos, e cada um se explica em uma
 * linha — a loja escolhe um e é ele que vale para todo pedido.
 *
 * O "km percorrido" já existia no código (tipo ROTA), mas escondido num
 * sub-seletor dentro do modo raio: quem procurava não achava, e quem não
 * procurava nem sabia que existia.
 */
const METODOS_DE_COBRANCA: { chave: string; emoji: string; nome: string; ajuda: string; recomendado?: boolean }[] = [
  {
    chave: "KM", emoji: "📍", nome: "Por raio (linha reta)", recomendado: true,
    ajuda: "A distância em linha reta da loja até o cliente — é o círculo desenhado no mapa. Simples de explicar e o que quase toda loja usa.",
  },
  {
    chave: "ROTA", emoji: "🛣️", nome: "Por km percorrido",
    ajuda: "O caminho que a moto faz de verdade pelas ruas. Mais justo onde tem rio, linha de trem ou morro no meio: quem está do outro lado paga pelo trajeto real.",
  },
  {
    chave: "NEIGHBORHOOD", emoji: "🏙️", nome: "Por bairro",
    ajuda: "Você cadastra cada bairro que atende e o valor de cada um. O cliente escolhe o bairro na lista, sem depender do mapa.",
  },
];

/**
 * `fee` é o que o CLIENTE paga. `motoboyFee` é o que a LOJA repassa ao
 * entregador naquela faixa — os dois quase nunca são o mesmo número, e até
 * aqui só existia o primeiro. O relatório de entregas então caía na taxa do
 * cliente, que em pedido de iFood e 99Food é dinheiro do marketplace: o
 * Lucas via "Taxa: R$ 6,94" numa entrega que ele paga R$ 2,00 (12/09/2026).
 *
 * Ausente = a loja não separou os dois, e vale o acerto cadastrado no próprio
 * entregador.
 */
type Zone = { km: number; time: number; fee: number; motoboyFee?: number };

interface Props {
  initialAddress: string;
  initialLatLng: { lat: number; lng: number } | null;
  initialZones: Zone[];
  zoneType: string;
  initialIfoodSyncDeliveryTime?: boolean;
  /** As áreas de risco já gravadas (User.deliveryConfig.areasDeRisco). */
  initialAreasDeRisco?: unknown;
  /** `User.deliveryConfig` inteiro — daqui sai a regra de repasse já gravada. */
  initialDeliveryConfig?: unknown;
  onSave: (data: { storeLatLng: { lat: number; lng: number }; deliveryZones: Zone[]; deliveryZoneType: string; storeAddress: string; ifoodSyncDeliveryTime?: boolean; areasDeRisco?: AreaDeRisco[]; repasseDoEntregador?: { separado: boolean; marketplace: OrigemDoRepasseNoApp } }) => Promise<void>;
}

export default function DeliveryZoneMap({ initialAddress, initialLatLng, initialZones, zoneType, initialIfoodSyncDeliveryTime, initialAreasDeRisco, initialDeliveryConfig, onSave }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circlesRef = useRef<any[]>([]);
  const editingAddressRef = useRef(!initialLatLng);

  const [address, setAddress] = useState(initialAddress || "");
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(initialLatLng);
  const [ifoodSync, setIfoodSync] = useState(initialIfoodSyncDeliveryTime ?? false);
  const [currentZoneType, setCurrentZoneType] = useState<string>(zoneType || "KM");

  /**
   * Cobrança por DISTÂNCIA — as faixas em km. Vale para os dois jeitos de
   * medir: "KM"/"RADIUS" (linha reta, o círculo do mapa) e "ROTA" (o caminho
   * que a moto faz pelas ruas). As faixas cadastradas são as mesmas; muda só o
   * número que entra na comparação.
   */
  const porDistancia = currentZoneType === "KM" || currentZoneType === "RADIUS" || currentZoneType === "ROTA";
  const porRota = currentZoneType === "ROTA";
  /** O método marcado na lista. RADIUS é o nome antigo do raio. */
  const metodoAtivo = currentZoneType === "NEIGHBORHOOD" ? "NEIGHBORHOOD" : currentZoneType === "ROTA" ? "ROTA" : "KM";

  /**
   * Onde a loja NÃO entrega, por mais perto que seja.
   *
   * Raio e bairro não sabem dizer "aqui não": a rua do outro lado da avenida
   * está a 900 m e cai dentro do raio de 3 km. Sem isto, a loja descobre na
   * hora de despachar, com a comida pronta, e liga para cancelar.
   */
  const [areasDeRisco, setAreasDeRisco] = useState<AreaDeRisco[]>(() => lerAreasDeRisco(initialAreasDeRisco));
  /** Pontos sendo clicados agora. `null` = não está desenhando. */
  const [desenhando, setDesenhando] = useState<[number, number][] | null>(null);
  // O clique do mapa é registrado uma vez só, no início; ele lê estes refs
  // para saber o que fazer AGORA, em vez de capturar o estado de então.
  const desenhandoRef = useRef<[number, number][] | null>(null);
  useEffect(() => { desenhandoRef.current = desenhando; }, [desenhando]);
  const riscoRef = useRef<any[]>([]);

  // State for Radius (KM) mode
  const [zones, setZones] = useState<Zone[]>(
    (zoneType === "KM" || zoneType === "RADIUS") && initialZones?.length
      ? initialZones
      : [
          { km: 1, time: 30, fee: 5 },
          { km: 3, time: 45, fee: 8 },
          { km: 5, time: 60, fee: 12 },
        ]
  );

  // State for Neighborhood mode
  const [neighborhoodZones, setNeighborhoodZones] = useState<any[]>(
    zoneType === "NEIGHBORHOOD" && initialZones?.length
      ? initialZones
      : [
          { name: "Centro", time: 30, fee: 5 },
          { name: "Bairro Vizinho", time: 45, fee: 8 },
        ]
  );

  // State for Distance (KM Rodado / Rota) mode
  const [distanceZones, setDistanceZones] = useState<any[]>(
    zoneType === "DISTANCE" && initialZones?.length
      ? initialZones
      : [
          { maxKm: 2, time: 30, fee: 5 },
          { maxKm: 5, time: 45, fee: 9 },
          { maxKm: 10, time: 60, fee: 14 },
        ]
  );

  /**
   * A loja separa o que cobra do cliente do que paga ao entregador?
   *
   * Nasce ligado quando ALGUMA faixa ja tem repasse gravado — assim quem ja
   * configurou volta na tela e ve os proprios numeros, em vez de uma coluna
   * sumida e o valor aparentemente perdido.
   */
  /**
   * Em pedido de app, o entregador recebe o que veio do app ou o da tabela?
   *
   * Nasce do que já está gravado; o padrão é TABELA porque a taxa que o
   * iFood mostra é dinheiro do marketplace, não o que a loja paga — foi
   * exatamente essa confusão que pôs R$ 6,94 no acerto de uma entrega de
   * R$ 2,00 (12/09/2026).
   */
  const [repasseNoApp, setRepasseNoApp] = useState<OrigemDoRepasseNoApp>(
    () => lerRegraDeRepasse(initialDeliveryConfig).marketplace,
  );

  const [repasseSeparado, setRepasseSeparado] = useState<boolean>(
    () => (initialZones || []).some((z: any) => z && z.motoboyFee != null && z.motoboyFee !== ""),
  );

  const [hoveredZoneIndex, setHoveredZoneIndex] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(!!initialLatLng);
  const [msg, setMsg] = useState("");
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load Leaflet CSS dynamically
  useEffect(() => {
    if (typeof window === "undefined") return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    // Do nosso domínio: o CSP bloqueia stylesheet do unpkg (style-src),
    // e sem o CSS do Leaflet os tiles do mapa viram um embaralhado.
    link.href = "/leaflet/leaflet.css";
    document.head.appendChild(link);
    setLeafletLoaded(true);
  }, []);

  // Helper to update location and reverse-geocode address
  const updateLocationAndAddress = async (lat: number, lng: number) => {
    setLatLng({ lat, lng });
    setConfirmed(false);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
        { headers: { "Accept-Language": "pt-BR" } }
      );
      const data = await res.json();
      if (data && data.display_name) {
        const addr = data.address || {};
        const road = addr.road || addr.street || addr.pedestrian || "";
        const houseNumber = addr.house_number ? `, ${addr.house_number}` : "";
        const suburb = addr.suburb || addr.neighbourhood || addr.quarter || "";
        const city = addr.city || addr.town || addr.village || addr.municipality || "";
        const state = addr.state ? ` - ${addr.state}` : "";

        let formatted = "";
        if (road) {
          formatted = `${road}${houseNumber}${suburb ? ` - ${suburb}` : ""}${city ? `, ${city}` : ""}${state}`;
        } else {
          formatted = data.display_name.split(",").slice(0, 4).join(",");
        }
        setAddress(formatted);
      }
    } catch {}
  };

  // Initialize map
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current) return;
    if (leafletMapRef.current) return;

    import("leaflet").then((L) => {
      const defaultPos: [number, number] = latLng ? [latLng.lat, latLng.lng] : [-22.5213, -41.9422];

      const map = L.map(mapRef.current!, { zoomControl: false }).setView(defaultPos, latLng ? 13 : 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      const storeIcon = L.divIcon({
        className: "",
        html: `<div style="width:36px;height:36px;background:#1E293B;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
          <div style="transform:rotate(45deg);font-size:16px;">🏪</div>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      if (latLng) {
        markerRef.current = L.marker([latLng.lat, latLng.lng], { icon: storeIcon, draggable: true }).addTo(map);
        markerRef.current.on("dragend", (e: any) => {
          if (!editingAddressRef.current) return;
          const pos = e.target.getLatLng();
          updateLocationAndAddress(pos.lat, pos.lng);
        });
      }

      map.on("click", (e: any) => {
        // Desenhando área de risco, o clique é vértice — e nunca mexe no
        // endereço da loja, que é a outra coisa que o clique faz aqui.
        if (desenhandoRef.current) {
          const p: [number, number] = [e.latlng.lat, e.latlng.lng];
          setDesenhando((atual) => [...(atual || []), p]);
          return;
        }
        if (!editingAddressRef.current) return;
        const pos = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng(pos);
        } else {
          markerRef.current = L.marker(pos, { icon: storeIcon, draggable: true }).addTo(map);
          markerRef.current.on("dragend", (ev: any) => {
            if (!editingAddressRef.current) return;
            const p = ev.target.getLatLng();
            updateLocationAndAddress(p.lat, p.lng);
          });
        }
        updateLocationAndAddress(pos.lat, pos.lng);
      });

      leafletMapRef.current = { map, L };
      drawCircles();
    });
  }, [leafletLoaded]);


  // Draw circles/polygons when zones, zoneType, latLng, or hoveredZoneIndex change
  const drawCircles = useCallback(() => {
    if (!leafletMapRef.current || !latLng) return;
    const { map, L } = leafletMapRef.current;

    // Remove old polygons/circles
    circlesRef.current.forEach(c => map.removeLayer(c));
    circlesRef.current = [];

    // MODE 2: NEIGHBORHOOD
    if (currentZoneType === "NEIGHBORHOOD") {
      const isHovered = hoveredZoneIndex !== null;
      const circle = L.circle([latLng.lat, latLng.lng], {
        radius: 6000,
        color: isHovered ? "#9333EA" : "#8B5CF6",
        fillColor: isHovered ? "#9333EA" : "#8B5CF6",
        fillOpacity: isHovered ? 0.28 : 0.12,
        weight: isHovered ? 4.5 : 2.5,
        dashArray: "6,4",
      }).addTo(map);
      circle.bindTooltip(
        `<div style="background:#fff; border-radius:10px; padding:8px 12px; box-shadow:0 6px 20px rgba(0,0,0,0.18); border:1.5px solid #E2E8F0; font-family:'Inter',sans-serif;">
          <div style="font-weight:800; font-size:0.84rem; color:#0F172A;">🏙️ Entrega por Bairro</div>
          <div style="font-size:0.76rem; color:#64748B;">${neighborhoodZones.length} bairros cadastrados</div>
        </div>`,
        { permanent: true, direction: "center", className: "ifood-clean-tooltip" }
      );
      circlesRef.current.push(circle);
      return;
    }


    // MODE 1: KM (Por Raio - Linha Reta)
    const items = zones.map((z, origIdx) => ({
      origIdx,
      km: Number(z.km),
      displayKm: Number(z.km),
      time: Number(z.time) || 0,
      fee: Number(z.fee) || 0,
    }));

    const sorted = [...items].sort((a, b) => b.km - a.km);
    const CIRCLE_COLORS = ["#DC2626", "#EA580C", "#D97706", "#16A34A", "#2563EB", "#7C3AED"];

    sorted.forEach((zone, i) => {
      const isHovered = hoveredZoneIndex === zone.origIdx;
      const anyHovered = hoveredZoneIndex !== null;
      const colorIdx = items.length - 1 - i;
      const strokeColor = isHovered ? "#DC2626" : CIRCLE_COLORS[colorIdx % CIRCLE_COLORS.length];

      const circle = L.circle([latLng.lat, latLng.lng], {
        radius: zone.km * 1000,
        color: strokeColor,
        fillColor: strokeColor,
        fillOpacity: isHovered ? 0.35 : anyHovered ? 0.04 : 0.14,
        weight: isHovered ? 4.5 : 2.5,
        dashArray: isHovered ? undefined : "6,4",
      }).addTo(map);

      const cardHtml = `
        <div style="background:#fff; border-radius:10px; padding:8px 12px; box-shadow:0 6px 20px rgba(0,0,0,0.18); border:1.5px solid #E2E8F0; font-family:'Inter',sans-serif; min-width:105px; line-height:1.35;">
          <div style="display:flex; align-items:center; gap:6px; font-weight:800; font-size:0.84rem; color:#0F172A; margin-bottom:2px;">
            <span style="font-size:0.8rem;">📍</span> ${zone.displayKm} km (raio)
          </div>
          <div style="display:flex; align-items:center; gap:6px; font-size:0.76rem; color:#64748B; margin-bottom:2px;">
            <span style="font-size:0.75rem;">⏱️</span> ${zone.time} min
          </div>
          <div style="display:flex; align-items:center; gap:6px; font-weight:800; font-size:0.84rem; color:#0F172A;">
            <span style="font-size:0.8rem;">💰</span> R$ ${zone.fee.toFixed(2)}
          </div>
        </div>
      `;

      circle.bindTooltip(cardHtml, {
        permanent: isHovered || (!anyHovered && i === sorted.length - 1),
        direction: "center",
        className: "ifood-clean-tooltip"
      });

      circlesRef.current.push(circle);
    });
  }, [latLng, zones, distanceZones, neighborhoodZones, currentZoneType, hoveredZoneIndex]);

  useEffect(() => {
    drawCircles();
  }, [drawCircles]);

  // Os polígonos de exclusão, em vermelho tracejado — a única coisa vermelha
  // hachurada no mapa, para não se confundir com as faixas de entrega.
  useEffect(() => {
    const ref = leafletMapRef.current;
    if (!ref) return;
    const { map, L } = ref;
    riscoRef.current.forEach((c) => map.removeLayer(c));
    riscoRef.current = [];

    for (const area of areasDeRisco) {
      const poligono = L.polygon(area.pontos, {
        color: area.ativa === false ? "#94A3B8" : "#DC2626",
        weight: 2,
        dashArray: "6 5",
        fillColor: area.ativa === false ? "#94A3B8" : "#DC2626",
        fillOpacity: area.ativa === false ? 0.08 : 0.2,
      }).addTo(map);
      poligono.bindTooltip(`🚫 ${area.nome}${area.ativa === false ? " (desligada)" : ""}`, { sticky: true });
      riscoRef.current.push(poligono);
    }

    // O que está sendo desenhado agora: os vértices já clicados e a linha
    // entre eles, para a loja ver o contorno enquanto clica.
    if (desenhando && desenhando.length > 0) {
      for (const p of desenhando) {
        const bolinha = L.circleMarker(p, { radius: 5, color: "#DC2626", fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(map);
        riscoRef.current.push(bolinha);
      }
      if (desenhando.length >= 2) {
        const linha = L.polyline(desenhando, { color: "#DC2626", weight: 2, dashArray: "6 5" }).addTo(map);
        riscoRef.current.push(linha);
      }
    }
  }, [areasDeRisco, desenhando, leafletLoaded]);

  // Autocomplete live search as user types
  const handleAddressChange = (val: string) => {
    setAddress(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!val || val.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&addressdetails=1`,
          { headers: { "Accept-Language": "pt-BR" } }
        );
        const data = await res.json();
        if (Array.isArray(data)) {
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
        }
      } catch {}
    }, 300);
  };

  const selectSuggestion = (item: any) => {
    const newLatLng = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
    setLatLng(newLatLng);
    setAddress(item.display_name);
    setSuggestions([]);
    setShowSuggestions(false);
    editingAddressRef.current = true;
    setConfirmed(false);
    setMsg("");

    if (leafletMapRef.current) {
      const { map, L } = leafletMapRef.current;
      map.setView([newLatLng.lat, newLatLng.lng], 15);

      const storeIcon = L.divIcon({
        className: "",
        html: `<div style="width:36px;height:36px;background:#1E293B;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);">
          <div style="transform:rotate(45deg);font-size:16px;text-align:center;">🏪</div>
        </div>`,
        iconSize: [36, 36], iconAnchor: [18, 36],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([newLatLng.lat, newLatLng.lng]);
      } else {
        markerRef.current = L.marker([newLatLng.lat, newLatLng.lng], { icon: storeIcon, draggable: true }).addTo(map);
        markerRef.current.on("dragend", (e: any) => {
          if (!editingAddressRef.current) return;
          const p = e.target.getLatLng();
          setLatLng({ lat: p.lat, lng: p.lng });
          setConfirmed(false);
        });
      }
    }
  };

  // Geocode address
  const geocodeAddress = async () => {
    if (!address.trim()) return;
    setSearching(true);
    setMsg("");
    setShowSuggestions(false);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=1`,
        { headers: { "Accept-Language": "pt-BR" } }
      );
      const data = await res.json();
      if (data.length === 0) {
        setMsg("❌ Endereço não encontrado. Tente ser mais específico.");
        return;
      }
      const { lat, lon, display_name } = data[0];
      const newLatLng = { lat: parseFloat(lat), lng: parseFloat(lon) };
      setLatLng(newLatLng);
      setAddress(display_name.split(",").slice(0, 3).join(","));
      editingAddressRef.current = true;
      setConfirmed(false);

      if (leafletMapRef.current) {
        const { map, L } = leafletMapRef.current;
        map.setView([newLatLng.lat, newLatLng.lng], 14);

        const storeIcon = L.divIcon({
          className: "",
          html: `<div style="width:36px;height:36px;background:#1E293B;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);">
            <div style="transform:rotate(45deg);font-size:16px;text-align:center;">ðŸª</div>
          </div>`,
          iconSize: [36, 36], iconAnchor: [18, 36],
        });

        if (markerRef.current) {
          markerRef.current.setLatLng([newLatLng.lat, newLatLng.lng]);
        } else {
          markerRef.current = L.marker([newLatLng.lat, newLatLng.lng], { icon: storeIcon, draggable: true }).addTo(map);
          markerRef.current.on("dragend", (e: any) => {
            if (!editingAddressRef.current) return;
            const p = e.target.getLatLng();
            setLatLng({ lat: p.lat, lng: p.lng });
            setConfirmed(false);
          });
        }
      }
    } catch {
      setMsg("❌ Erro ao buscar endereço.");
    } finally {
      setSearching(false);
    }
  };

  const confirmLocation = () => {
    if (!latLng) return;
    setConfirmed(true);
    editingAddressRef.current = false;
    setMsg("✅ Localização confirmada! Os raios de entrega foram atualizados.");
    drawCircles();
  };

  const startEditingAddress = () => {
    editingAddressRef.current = true;
    setConfirmed(false);
    setMsg("");
  };

  const addZone = () => {
    const lastKm = zones.length ? Math.max(...zones.map(z => z.km)) : 0;
    setZones(prev => [...prev, { km: lastKm + 1, time: 45, fee: 10 }]);
  };

  const removeZone = (i: number) => setZones(prev => prev.filter((_, idx) => idx !== i));

  const updateZone = (i: number, key: keyof Zone, val: number) => {
    setZones(prev => prev.map((z, idx) => idx === i ? { ...z, [key]: val } : z));
  };

  /** Rótulo em cima do campo: é o que evita cabeçalho de coluna espremido. */
  // `maxWidth` para o campo que sobra na quebra de linha não esticar sozinho
  // até a largura toda — ficava um "Motoboy recebe" gigante embaixo de três
  // campos pequenos.
  const campoDaFaixa: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, flex: "1 1 92px", minWidth: 84, maxWidth: 150 };
  // O rótulo QUEBRA em vez de não quebrar: com `nowrap`, "🛵 Motoboy recebe"
  // era mais largo que o campo e vazava para fora do cartão.
  const rotuloDoCampo: React.CSSProperties = { fontSize: "0.68rem", fontWeight: 700, color: "#94A3B8", lineHeight: 1.25 };
  const caixaDoCampo: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "7px 8px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: "0.84rem", textAlign: "center", outline: "none", fontFamily: "inherit" };

  const dinheiro = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

  /** Cliente x motoboy por faixa/bairro, na modalidade que está ligada. */
  const resumoDoRepasse = (currentZoneType === "NEIGHBORHOOD" ? neighborhoodZones : zones)
    .filter((z: any) => z && (z.name || z.km))
    .map((z: any) => ({
      rotulo: currentZoneType === "NEIGHBORHOOD" ? String(z.name || "Bairro") : `até ${z.km} km`,
      cliente: Number(z.fee) || 0,
      motoboy: Number(z.motoboyFee ?? z.fee) || 0,
    }))
    .slice(0, 12);

  const handleSave = async () => {
    if (!latLng) {
      setMsg("⚠️ Selecione a localização da sua loja no mapa primeiro.");
      return;
    }
    setSaving(true);
    // Com o repasse ligado, toda faixa/bairro sai daqui COM o valor do
    // entregador — inclusive as que a loja não tocou. A tela mostrava o valor
    // da taxa no campo (motoboyFee ?? fee) e salvava sem ele: o cadastro dizia
    // "separado" e o relatório não achava número nenhum para usar.
    const zonasAtivas = currentZoneType === "NEIGHBORHOOD" ? neighborhoodZones : zones;
    const activeZones = repasseSeparado
      ? zonasAtivas.map((z: any) => ({ ...z, motoboyFee: Number(z.motoboyFee ?? z.fee) || 0 }))
      : zonasAtivas;
    try {
      await onSave({ storeLatLng: latLng, deliveryZones: activeZones, deliveryZoneType: currentZoneType, storeAddress: address, ifoodSyncDeliveryTime: ifoodSync, areasDeRisco, repasseDoEntregador: { separado: repasseSeparado, marketplace: repasseNoApp } });
      const syncMinutes = (window as any).__ifoodSyncOk;
      if (syncMinutes) {
        setMsg(`✅ Salvo! iFood sincronizado: ${syncMinutes} min de preparo.`);
        delete (window as any).__ifoodSyncOk;
      } else {
        setMsg("✅ Configurações de entrega salvas com sucesso!");
      }
    } catch (err: any) {
      if (err?.message?.includes("iFood")) {
        setMsg(`⚠️ Salvo, mas iFood falhou: ${err.message}`);
      } else {
        setMsg("❌ Erro ao salvar.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      <h3 style={{ fontWeight: 800, fontSize: "1.3rem", marginBottom: "4px" }}>🗺️ Configurações de Entrega</h3>
      <p style={{ color: "#64748B", fontSize: "0.88rem", marginBottom: "0.8rem" }}>
        Defina onde fica sua loja no mapa e escolha a regra de cobrança da entrega.
      </p>

      {/* ── MÉTODO DE COBRANÇA ──────────────────────────────────────────
          Três métodos, cada um com uma linha dizendo o que é. Antes eram dois
          cartões grandes e o "km percorrido" estava escondido num sub-seletor
          dentro do modo raio — quem procurava por ele não achava, e quem não
          procurava nem sabia que existia. */}
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
          Método de cobrança
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {METODOS_DE_COBRANCA.map((m) => {
            const ativo = metodoAtivo === m.chave;
            return (
              <button
                key={m.chave}
                type="button"
                onClick={() => setCurrentZoneType(m.chave)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10, width: "100%", textAlign: "left",
                  padding: "11px 13px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                  border: `2px solid ${ativo ? "#DC2626" : "#E2E8F0"}`,
                  background: ativo ? "#FEF2F2" : "#FFFFFF",
                  boxShadow: ativo ? "0 3px 12px rgba(220,38,38,0.10)" : "none",
                  transition: "all .15s ease",
                }}
              >
                <span style={{ fontSize: "1.1rem", lineHeight: 1.2, flexShrink: 0 }}>{m.emoji}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <b style={{ fontSize: "0.88rem", color: ativo ? "#991B1B" : "#1E293B" }}>{m.nome}</b>
                    {m.recomendado && (
                      <span style={{ fontSize: "0.62rem", fontWeight: 800, color: "#15803D", background: "#DCFCE7", borderRadius: 999, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Recomendado
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", fontSize: "0.74rem", color: "#64748B", lineHeight: 1.45, marginTop: 3 }}>
                    {m.ajuda}
                  </span>
                </span>
                {ativo && <Check size={16} style={{ color: "#DC2626", flexShrink: 0, marginTop: 3 }} />}
              </button>
            );
          })}
        </div>
        <p style={{ margin: "8px 0 0", fontSize: "0.72rem", color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "7px 10px", lineHeight: 1.45 }}>
          Faixa de distância e lista de bairros são cadastros diferentes: ao trocar entre eles, os valores
          não são transferidos — confira a tabela antes de salvar.
        </p>
      </div>


      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "1rem",
          background: msg.startsWith("✅") ? "#f0fdf4" : msg.startsWith("⚠") ? "#fffbeb" : "#fef2f2",
          color: msg.startsWith("✅") ? "#16a34a" : msg.startsWith("⚠") ? "#b45309" : "#dc2626",
          border: `1px solid ${msg.startsWith("✅") ? "#bbf7d0" : msg.startsWith("⚠") ? "#fde68a" : "#fecaca"}`,
          fontSize: "0.85rem" }}>
          {msg}
        </div>
      )}

      {/* Address search with autocomplete */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "1rem", position: "relative" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <MapPin size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
          <input
            value={address}
            onChange={e => handleAddressChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onKeyDown={e => e.key === "Enter" && geocodeAddress()}
            placeholder="Digite o endereço da sua loja (ex: Rua, Número, Bairro, Cidade)"
            style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: "10px", border: "1px solid #E2E8F0", fontSize: "0.85rem", outline: "none", boxSizing: "border-box" }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "#fff",
              borderRadius: "10px",
              border: "1px solid #E2E8F0",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              zIndex: 2000,
              maxHeight: "220px",
              overflowY: "auto"
            }}>
              {suggestions.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => selectSuggestion(item)}
                  style={{
                    padding: "10px 14px",
                    fontSize: "0.83rem",
                    color: "#1E293B",
                    cursor: "pointer",
                    borderBottom: idx < suggestions.length - 1 ? "1px solid #F1F5F9" : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
                >
                  <MapPin size={14} style={{ color: "#EF4444", flexShrink: 0 }} />
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.display_name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={geocodeAddress} disabled={searching}
          style={{ padding: "10px 16px", borderRadius: "10px", background: "#1E293B", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "0.85rem", fontFamily: "inherit" }}>
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {searching ? "Buscando..." : "Localizar"}
        </button>
      </div>

      {/* Map + Controls side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "1rem", alignItems: "start" }}>

        {/* MAP */}
        <div style={{ position: "relative", borderRadius: "16px", overflow: "hidden", border: "2px solid #E2E8F0", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
          <div ref={mapRef} style={{ width: "100%", height: "420px" }} />

          {/* Confirm button & address preview overlay */}
          {latLng && !confirmed && (
            <div style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              right: "12px",
              zIndex: 1000,
              background: "rgba(255,255,255,0.96)",
              backdropFilter: "blur(6px)",
              padding: "10px 14px",
              borderRadius: "12px",
              border: "1.5px solid #FCA5A5",
              boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px"
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.68rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  📍 Endereço no pino:
                </div>
                <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#0F172A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {address || "Localização selecionada"}
                </div>
              </div>
              <button onClick={confirmLocation}
                style={{ padding: "8px 14px", background: "#DC2626", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit", flexShrink: 0 }}>
                <Check size={14} /> Confirmar local
              </button>
            </div>
          )}

          {confirmed && (
            <div style={{ position: "absolute", top: "12px", left: "12px", right: "12px", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
              <div style={{ background: "#fff", borderRadius: "8px", padding: "6px 12px", fontSize: "0.8rem", fontWeight: 700, color: "#16a34a", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
                <Check size={14} /> Localização confirmada
              </div>
              <button onClick={startEditingAddress}
                style={{ background: "#fff", borderRadius: "8px", padding: "6px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#DC2626", border: "1px solid #FCA5A5", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", fontFamily: "inherit" }}>
                <Pencil size={13} /> Editar Endereço
              </button>
            </div>
          )}

          {/* Map instructions */}
          {!latLng && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 1000, background: "rgba(255,255,255,0.92)", borderRadius: "12px", padding: "16px 20px", textAlign: "center", fontSize: "0.85rem", color: "#475569", pointerEvents: "none" }}>
              <Navigation size={24} style={{ margin: "0 auto 8px", color: "#DC2626" }} />
              <strong>Busque o endereço acima</strong><br />
              ou clique no mapa para posicionar o pin
            </div>
          )}

          {/* Stats bar */}
          {zones.length > 0 && (
            <div style={{ position: "absolute", bottom: "12px", left: "12px", right: confirmed ? "12px" : "auto", zIndex: 1000, background: "rgba(255,255,255,0.92)", borderRadius: "8px", padding: "6px 12px", fontSize: "0.75rem", color: "#374151", display: "flex", gap: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
              <span>📍 {Math.min(...zones.map(z => z.km))} km → {Math.max(...zones.map(z => z.km))} km</span>
              <span>⏱️ {Math.min(...zones.map(z => z.time))} → {Math.max(...zones.map(z => z.time))} min</span>
              <span>💰 R$ {Math.min(...zones.map(z => z.fee)).toFixed(2)} → {Math.max(...zones.map(z => z.fee)).toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* ZONES CONTROL PANEL */}
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "20px" }}>
          
          {/* O título repete o método escolhido: quem rolou a tela até aqui
              precisa saber qual cadastro está editando. */}
          <h4 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "4px" }}>
            {metodoAtivo === "NEIGHBORHOOD"
              ? `Bairros atendidos (${neighborhoodZones.length})`
              : `${porRota ? "Faixas por km percorrido" : "Faixas por raio"} (${zones.length})`}
          </h4>
          <p style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "12px", lineHeight: 1.45 }}>
            {metodoAtivo === "NEIGHBORHOOD"
              ? "Cada bairro que sua loja atende, com o tempo e o valor da entrega."
              : porRota
                ? "O pedido cai na primeira faixa que alcança o trajeto pelas ruas."
                : "O pedido cai na primeira faixa que alcança a distância em linha reta."}
          </p>

          {/* ── PAGAMENTO DO ENTREGADOR ───────────────────────────────────
              Fica ANTES das tabelas, e não dentro de uma delas, porque vale
              para as duas modalidades: a loja que cobra por bairro paga
              entregador igual à que cobra por raio. Enquanto esta caixa
              esteve dentro do bloco de raio, quem cobrava por bairro não
              tinha onde informar o repasse — e o acerto caía na taxa do
              cliente, que em pedido de app é dinheiro do marketplace. */}
          <div style={{ border: `1.5px solid ${repasseSeparado ? "#FED7AA" : "#E2E8F0"}`, background: repasseSeparado ? "#FFFBF5" : "#F8FAFC", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <span style={{ fontSize: "1rem" }}>🛵</span>
              <b style={{ fontSize: "0.9rem", color: "#0F172A" }}>Pagamento do entregador</b>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: "0.76rem", color: "#64748B", lineHeight: 1.5 }}>
              O que você <b>cobra do cliente</b> e o que você <b>paga ao entregador</b> são dois valores
              diferentes na maioria das lojas. Informe os dois e o relatório de entregas fecha certo.
            </p>

            <label style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: "pointer", background: "#fff", border: `1.5px solid ${repasseSeparado ? "#FDBA74" : "#E2E8F0"}`, borderRadius: 10, padding: "10px 12px" }}>
              <input
                type="checkbox"
                checked={repasseSeparado}
                onChange={(e) => {
                  const ligado = e.target.checked;
                  setRepasseSeparado(ligado);
                  // Ligando, cada faixa nasce repassando o mesmo que cobra —
                  // assim nada muda de valor até a loja mexer de propósito.
                  if (ligado) {
                    setZones(p => p.map(z => ({ ...z, motoboyFee: z.motoboyFee ?? z.fee })));
                    setNeighborhoodZones(p => p.map(z => ({ ...z, motoboyFee: (z as any).motoboyFee ?? z.fee })));
                  } else {
                    setZones(p => p.map(({ motoboyFee, ...z }) => z));
                    setNeighborhoodZones(p => p.map(({ motoboyFee, ...z }: any) => z));
                  }
                }}
                style={{ marginTop: 2, width: 16, height: 16, accentColor: "#C2410C", cursor: "pointer", flexShrink: 0 }}
              />
              <span style={{ fontSize: "0.8rem", color: "#334155", lineHeight: 1.45 }}>
                <b>Lançar preço diferente para o cliente e para o motoboy.</b>{" "}
                <span style={{ color: "#64748B" }}>
                  Abre o campo <b>🛵 Motoboy recebe</b> em cada {metodoAtivo === "NEIGHBORHOOD" ? "bairro" : "faixa"} aqui
                  embaixo, e mostra quanto sobra para a loja. Use quando você fica com parte da entrega.
                </span>
              </span>
            </label>

            {/* ── PEDIDO DE APP: DE ONDE SAI O VALOR DO ENTREGADOR ────────
                A dúvida real do lojista, e os dois modelos que existem: quem
                repassa a entrega do iFood inteira ao motoboy, e quem paga
                sempre o mesmo, independente do que o app pagou. */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#334155", marginBottom: 7 }}>
                Nos pedidos de <b>iFood, 99Food</b> e outros apps, o entregador recebe:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
                {[
                  { v: "TABELA" as const, t: "O valor da minha tabela", d: "O que você cadastrou aqui embaixo para aquela distância ou bairro." },
                  { v: "APP" as const, t: "O valor que veio do app", d: "A taxa de entrega que o iFood/99 pagou naquele pedido." },
                ].map((op) => (
                  <button
                    key={op.v}
                    type="button"
                    onClick={() => setRepasseNoApp(op.v)}
                    style={{
                      textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                      border: `2px solid ${repasseNoApp === op.v ? "#C2410C" : "#E2E8F0"}`,
                      background: repasseNoApp === op.v ? "#FFF7ED" : "#fff", fontFamily: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 800, color: repasseNoApp === op.v ? "#9A3412" : "#334155" }}>
                      <span>{repasseNoApp === op.v ? "●" : "○"}</span>{op.t}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 3, lineHeight: 1.4 }}>{op.d}</div>
                  </button>
                ))}
              </div>
              <p style={{ margin: "8px 0 0", fontSize: "0.73rem", lineHeight: 1.45, color: repasseNoApp === "APP" ? "#334155" : "#92400E", background: repasseNoApp === "APP" ? "#F8FAFC" : "#FFFBEB", border: `1px solid ${repasseNoApp === "APP" ? "#E2E8F0" : "#FDE68A"}`, borderRadius: 8, padding: "7px 10px" }}>
                {explicarRegraDoApp({ separado: repasseSeparado, marketplace: repasseNoApp })}
              </p>
            </div>
          </div>

          {/* Mode 1: KM (Por Raio) */}
          {porDistancia && (
            <>
              {/* Adjust all quickly */}
              <div style={{ background: "#F8FAFC", borderRadius: "8px", padding: "10px 12px", marginBottom: "12px" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Ajuste rápido</div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button onClick={() => setZones(p => p.map(z => ({ ...z, time: Math.max(5, z.time - 5) })))} style={adjBtn}>– 5 min</button>
                  <button onClick={() => setZones(p => p.map(z => ({ ...z, time: z.time + 5 })))} style={adjBtn}>+ 5 min</button>
                  <button onClick={() => setZones(p => p.map(z => ({ ...z, fee: Math.max(0, z.fee - 1) })))} style={adjBtn}>– R$1</button>
                  <button onClick={() => setZones(p => p.map(z => ({ ...z, fee: z.fee + 1 })))} style={adjBtn}>+ R$1</button>
                </div>
              </div>

              {/* ── AS FAIXAS, UMA POR CARTÃO ──────────────────────────────
                  Cada campo leva o próprio rótulo em cima. A tabela de antes
                  tinha um cabeçalho de colunas de 60px, e "TEMPO(M)",
                  "CLIENTE(R$)" e "MOTOBOY(R$)" se sobrepunham — rótulo de
                  coluna não cabe em coluna estreita. */}
              {zones.sort((a, b) => a.km - b.km).map((zone, i) => {
                const repasse = Number(zone.motoboyFee ?? zone.fee) || 0;
                const sobra = Math.round(((Number(zone.fee) || 0) - repasse) * 100) / 100;
                return (
                  <div
                    key={i}
                    onMouseEnter={() => setHoveredZoneIndex(i)}
                    onMouseLeave={() => setHoveredZoneIndex(null)}
                    style={{
                      border: `1.5px solid ${hoveredZoneIndex === i ? "#FCA5A5" : "#E2E8F0"}`,
                      background: hoveredZoneIndex === i ? "#FEF2F2" : "#FFFFFF",
                      borderRadius: 12, padding: "10px 12px", marginBottom: 8, transition: "all .15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: ZONE_COLORS[i % ZONE_COLORS.length], flexShrink: 0 }} />
                      <b style={{ fontSize: "0.84rem", color: "#0F172A" }}>
                        {i === 0 ? "Até" : `De ${zones[i - 1].km} a`} {zone.km} km
                      </b>
                      <button
                        onClick={() => removeZone(i)}
                        title="Remover esta faixa"
                        style={{ marginLeft: "auto", width: 28, height: 28, borderRadius: 7, border: "1px solid #FCA5A5", background: "#fff", color: "#EF4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>Até quantos km</span>
                        <input type="number" min="0.5" step="0.5" value={zone.km}
                          onChange={e => updateZone(i, "km", parseFloat(e.target.value) || 0)}
                          style={caixaDoCampo} />
                      </label>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>Tempo (min)</span>
                        <input type="number" min="1" value={zone.time}
                          onChange={e => updateZone(i, "time", parseInt(e.target.value) || 0)}
                          style={caixaDoCampo} />
                      </label>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>👤 Cliente paga</span>
                        <input type="number" min="0" step="0.5" value={zone.fee}
                          onChange={e => updateZone(i, "fee", parseFloat(e.target.value) || 0)}
                          style={caixaDoCampo} />
                      </label>
                      {repasseSeparado && (
                        <label style={campoDaFaixa}>
                          <span style={{ ...rotuloDoCampo, color: "#C2410C" }}>🛵 Motoboy recebe</span>
                          <input type="number" min="0" step="0.5" value={zone.motoboyFee ?? zone.fee}
                            onChange={e => updateZone(i, "motoboyFee" as any, parseFloat(e.target.value) || 0)}
                            style={{ ...caixaDoCampo, border: "1.5px solid #FED7AA", background: "#FFF7ED", color: "#9A3412", fontWeight: 700 }} />
                        </label>
                      )}
                    </div>

                    {repasseSeparado && (
                      <div style={{ marginTop: 8, fontSize: "0.73rem", fontWeight: 700, color: sobra < 0 ? "#B91C1C" : "#166534" }}>
                        {sobra < 0
                          ? `Você paga ${dinheiro(Math.abs(sobra))} do próprio bolso nesta faixa`
                          : `Sobra ${dinheiro(sobra)} para a loja nesta faixa`}
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={addZone}
                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1.5px dashed #CBD5E1", background: "#F8FAFC", color: "#64748B", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "16px", fontFamily: "inherit" }}>
                <Plus size={14} /> Adicionar Faixa de KM
              </button>
            </>
          )}

          {/* Mode 2: NEIGHBORHOOD (Por Bairro) */}
          {currentZoneType === "NEIGHBORHOOD" && (
            <>
              {neighborhoodZones.map((zone, i) => {
                const repasse = Number(zone.motoboyFee ?? zone.fee) || 0;
                const sobra = Math.round(((Number(zone.fee) || 0) - repasse) * 100) / 100;
                const mudar = (patch: any) => setNeighborhoodZones(prev => prev.map((z, idx) => idx === i ? { ...z, ...patch } : z));
                return (
                  <div
                    key={i}
                    onMouseEnter={() => setHoveredZoneIndex(i)}
                    onMouseLeave={() => setHoveredZoneIndex(null)}
                    style={{
                      border: `1.5px solid ${hoveredZoneIndex === i ? "#DDD6FE" : "#E2E8F0"}`,
                      background: hoveredZoneIndex === i ? "#F5F3FF" : "#FFFFFF",
                      borderRadius: 12, padding: "10px 12px", marginBottom: 8, transition: "all .15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                      <input
                        type="text"
                        value={zone.name}
                        onChange={e => mudar({ name: e.target.value })}
                        placeholder="Nome do bairro"
                        style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: "0.86rem", fontWeight: 700, color: "#0F172A", outline: "none" }}
                      />
                      <button
                        onClick={() => setNeighborhoodZones(prev => prev.filter((_, idx) => idx !== i))}
                        title="Remover este bairro"
                        style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid #FCA5A5", background: "#fff", color: "#EF4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>Tempo (min)</span>
                        <input type="number" min="1" value={zone.time}
                          onChange={e => mudar({ time: parseInt(e.target.value) || 0 })}
                          style={caixaDoCampo} />
                      </label>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>👤 Cliente paga</span>
                        <input type="number" min="0" step="0.5" value={zone.fee}
                          onChange={e => mudar({ fee: parseFloat(e.target.value) || 0 })}
                          style={caixaDoCampo} />
                      </label>
                      {repasseSeparado && (
                        <label style={campoDaFaixa}>
                          <span style={{ ...rotuloDoCampo, color: "#C2410C" }}>🛵 Motoboy recebe</span>
                          <input type="number" min="0" step="0.5" value={zone.motoboyFee ?? zone.fee}
                            onChange={e => mudar({ motoboyFee: parseFloat(e.target.value) || 0 })}
                            style={{ ...caixaDoCampo, border: "1.5px solid #FED7AA", background: "#FFF7ED", color: "#9A3412", fontWeight: 700 }} />
                        </label>
                      )}
                    </div>

                    {repasseSeparado && (
                      <div style={{ marginTop: 8, fontSize: "0.73rem", fontWeight: 700, color: sobra < 0 ? "#B91C1C" : "#166534" }}>
                        {sobra < 0
                          ? `Você paga ${dinheiro(Math.abs(sobra))} do próprio bolso neste bairro`
                          : `Sobra ${dinheiro(sobra)} para a loja neste bairro`}
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={() => setNeighborhoodZones(prev => [...prev, { name: "", time: 40, fee: 7 }])}
                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1.5px dashed #CBD5E1", background: "#F8FAFC", color: "#64748B", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "16px", fontFamily: "inherit" }}>
                <Plus size={14} /> Adicionar Bairro
              </button>
            </>
          )}

          {/* ── ÁREAS DE RISCO ────────────────────────────────────────────
              Vale para os dois modos: raio, rota ou bairro. É a única regra
              que recusa um endereço mesmo estando dentro da área de entrega —
              e tem que ser assim, senão a loja desenha a área e continua
              recebendo o pedido. */}
          <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1.5px solid #E2E8F0" }}>
            <h4 style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 4px" }}>🚫 Onde você não entrega</h4>
            <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 12px", lineHeight: 1.45 }}>
              Desenhe no mapa as áreas que a loja não atende. Endereço que cair dentro é recusado
              <b> antes de o cliente pagar</b>, mesmo estando perto e dentro do raio.
            </p>

            {desenhando ? (
              <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#991B1B" }}>
                  Clique no mapa para marcar os cantos da área
                </p>
                <p style={{ margin: "3px 0 10px", fontSize: "0.76rem", color: "#B91C1C" }}>
                  {desenhando.length} {desenhando.length === 1 ? "ponto marcado" : "pontos marcados"} — são necessários pelo menos 3.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={desenhando.length < 3}
                    onClick={() => {
                      const nome = (prompt("Nome desta área (ex.: Morro do Cemitério, Rua sem saída):", "Área de risco") || "").trim();
                      if (!nome) return;
                      setAreasDeRisco((atual) => [...atual, { nome, pontos: desenhando, ativa: true }]);
                      setDesenhando(null);
                    }}
                    style={{ padding: "8px 14px", borderRadius: 9, border: "none", background: desenhando.length < 3 ? "#FCA5A5" : "#DC2626", color: "#fff", fontWeight: 800, fontSize: "0.82rem", cursor: desenhando.length < 3 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  >
                    ✓ Fechar área
                  </button>
                  <button type="button" onClick={() => setDesenhando(desenhando.slice(0, -1))} disabled={desenhando.length === 0}
                    style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #FCA5A5", background: "#fff", color: "#B91C1C", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                    ↶ Desfazer ponto
                  </button>
                  <button type="button" onClick={() => setDesenhando(null)}
                    style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDesenhando([])}
                style={{ width: "100%", padding: "9px", borderRadius: 9, border: "1.5px dashed #FCA5A5", background: "#FEF2F2", color: "#B91C1C", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer", fontFamily: "inherit", marginBottom: 12 }}
              >
                + Desenhar área de risco no mapa
              </button>
            )}

            {areasDeRisco.length === 0 && !desenhando && (
              <p style={{ fontSize: "0.76rem", color: "#94A3B8", margin: 0, textAlign: "center" }}>
                Nenhuma área cadastrada — a loja atende toda a área de entrega.
              </p>
            )}

            {areasDeRisco.map((area, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, border: "1px solid #E2E8F0", marginBottom: 6, background: area.ativa === false ? "#F8FAFC" : "#fff" }}>
                <input
                  type="checkbox"
                  checked={area.ativa !== false}
                  title={area.ativa === false ? "Voltar a recusar esta área" : "Parar de recusar, sem apagar o desenho"}
                  onChange={(e) => setAreasDeRisco((atual) => atual.map((a, j) => (j === i ? { ...a, ativa: e.target.checked } : a)))}
                  style={{ width: 16, height: 16, accentColor: "#DC2626", cursor: "pointer", flexShrink: 0 }}
                />
                <input
                  value={area.nome}
                  onChange={(e) => setAreasDeRisco((atual) => atual.map((a, j) => (j === i ? { ...a, nome: e.target.value } : a)))}
                  style={{ flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 7, border: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, fontFamily: "inherit", color: area.ativa === false ? "#94A3B8" : "#0F172A" }}
                />
                <span style={{ fontSize: "0.72rem", color: "#94A3B8", whiteSpace: "nowrap" }}>{area.pontos.length} pontos</span>
                <button type="button" title="Apagar esta área"
                  onClick={() => { if (confirm(`Apagar a área "${area.nome}"?`)) setAreasDeRisco((atual) => atual.filter((_, j) => j !== i)); }}
                  style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #FCA5A5", background: "#fff", color: "#EF4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>



          <button onClick={handleSave} disabled={saving || !latLng}
            style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "none",
              background: !latLng ? "#E2E8F0" : currentZoneType === "NEIGHBORHOOD" ? "#7C3AED" : "#DC2626",
              color: !latLng ? "#94A3B8" : "#fff",
              fontWeight: 800, fontSize: "0.95rem", cursor: !latLng ? "not-allowed" : "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              boxShadow: !latLng ? "none" : currentZoneType === "NEIGHBORHOOD" ? "0 4px 14px rgba(124, 58, 237, 0.3)" : "0 4px 14px rgba(220, 38, 38, 0.3)" }}>
            {saving ? <Loader2 size={16} /> : <Check size={16} />}
            {saving ? "Salvando..." : latLng ? (currentZoneType === "NEIGHBORHOOD" ? "Salvar Configurações (Modo Bairro)" : "Salvar Configurações (Modo Raio)") : "Selecione o local no mapa primeiro"}
          </button>

          {latLng && (
            <div style={{ marginTop: "12px", padding: "8px 12px", background: "#F0FDF4", borderRadius: "8px", fontSize: "0.72rem", color: "#15803D" }}>
              <strong>📍 Coordenadas:</strong> {latLng.lat.toFixed(5)}, {latLng.lng.toFixed(5)}<br />
              <span style={{ color: "#64748B" }}>Usado para clima e raio de entrega automaticamente.</span>
            </div>
          )}
        </div>
      </div>
      <style jsx global>{`
        .custom-map-tooltip {
          background: rgba(15, 23, 42, 0.9) !important;
          border: 1px solid rgba(255, 255, 255, 0.25) !important;
          color: #ffffff !important;
          font-weight: 700 !important;
          font-size: 0.76rem !important;
          border-radius: 8px !important;
          padding: 4px 8px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25) !important;
          font-family: 'Inter', sans-serif !important;
        }
        .custom-map-tooltip::before {
          border-top-color: rgba(15, 23, 42, 0.9) !important;
        }
        .ifood-clean-tooltip {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .ifood-clean-tooltip::before {
          display: none !important;
        }
      `}</style>
    </div>
  );
}

const adjBtn: React.CSSProperties = {
  padding: "5px 10px", borderRadius: "6px", border: "1px solid #E2E8F0",
  background: "#fff", color: "#374151", fontWeight: 600, fontSize: "0.75rem",
  cursor: "pointer", fontFamily: "inherit",
};

