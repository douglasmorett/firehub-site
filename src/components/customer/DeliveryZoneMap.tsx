"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Search, Plus, Trash2, Check, Loader2, Navigation, Pencil } from "lucide-react";

const ZONE_COLORS = ["#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA", "#00ACC1"];

type Zone = { km: number; time: number; fee: number };

interface Props {
  initialAddress: string;
  initialLatLng: { lat: number; lng: number } | null;
  initialZones: Zone[];
  zoneType: string;
  initialIfoodSyncDeliveryTime?: boolean;
  onSave: (data: { storeLatLng: { lat: number; lng: number }; deliveryZones: Zone[]; deliveryZoneType: string; storeAddress: string; ifoodSyncDeliveryTime?: boolean }) => Promise<void>;
}

export default function DeliveryZoneMap({ initialAddress, initialLatLng, initialZones, zoneType, initialIfoodSyncDeliveryTime, onSave }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circlesRef = useRef<any[]>([]);
  const editingAddressRef = useRef(!initialLatLng);

  const [address, setAddress] = useState(initialAddress || "");
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(initialLatLng);
  const [ifoodSync, setIfoodSync] = useState(initialIfoodSyncDeliveryTime ?? false);
  const [currentZoneType, setCurrentZoneType] = useState<string>(zoneType || "KM");

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
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
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

  const handleSave = async () => {
    if (!latLng) {
      setMsg("⚠️ Selecione a localização da sua loja no mapa primeiro.");
      return;
    }
    setSaving(true);
    const activeZones = currentZoneType === "NEIGHBORHOOD" ? neighborhoodZones : zones;
    try {
      await onSave({ storeLatLng: latLng, deliveryZones: activeZones, deliveryZoneType: currentZoneType, storeAddress: address, ifoodSyncDeliveryTime: ifoodSync });
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

      {/* 2-Mode Selector Tabs com Botão e Indicador Ativo/Inativo */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "1rem" }}>
        {/* TAB 1: POR RAIO */}
        <div
          onClick={() => setCurrentZoneType("KM")}
          style={{
            padding: "12px 14px",
            borderRadius: "14px",
            border: `2px solid ${currentZoneType === "KM" || currentZoneType === "RADIUS" ? "#DC2626" : "#E2E8F0"}`,
            background: currentZoneType === "KM" || currentZoneType === "RADIUS" ? "#FEF2F2" : "#FFFFFF",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            transition: "all 0.2s ease",
            boxShadow: currentZoneType === "KM" || currentZoneType === "RADIUS" ? "0 4px 14px rgba(220, 38, 38, 0.12)" : "none"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 800, fontSize: "0.92rem", color: currentZoneType === "KM" || currentZoneType === "RADIUS" ? "#991B1B" : "#334155" }}>
              📍 Por Raio (Linha Reta)
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 800,
                padding: "3px 8px",
                borderRadius: "20px",
                background: currentZoneType === "KM" || currentZoneType === "RADIUS" ? "#16A34A" : "#F1F5F9",
                color: currentZoneType === "KM" || currentZoneType === "RADIUS" ? "#FFFFFF" : "#64748B",
                display: "flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              {currentZoneType === "KM" || currentZoneType === "RADIUS" ? "🟢 ATIVO NA LOJA" : "⚪ Inativo"}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.74rem", color: currentZoneType === "KM" || currentZoneType === "RADIUS" ? "#B91C1C" : "#64748B", lineHeight: 1.3 }}>
            Calcula a taxa e validação pelo mapa em KM a partir do raio da sua loja.
          </p>
        </div>

        {/* TAB 2: POR BAIRRO */}
        <div
          onClick={() => setCurrentZoneType("NEIGHBORHOOD")}
          style={{
            padding: "12px 14px",
            borderRadius: "14px",
            border: `2px solid ${currentZoneType === "NEIGHBORHOOD" ? "#7C3AED" : "#E2E8F0"}`,
            background: currentZoneType === "NEIGHBORHOOD" ? "#F5F3FF" : "#FFFFFF",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            transition: "all 0.2s ease",
            boxShadow: currentZoneType === "NEIGHBORHOOD" ? "0 4px 14px rgba(124, 58, 237, 0.12)" : "none"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 800, fontSize: "0.92rem", color: currentZoneType === "NEIGHBORHOOD" ? "#5B21B6" : "#334155" }}>
              🏙️ Por Bairro
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 800,
                padding: "3px 8px",
                borderRadius: "20px",
                background: currentZoneType === "NEIGHBORHOOD" ? "#16A34A" : "#F1F5F9",
                color: currentZoneType === "NEIGHBORHOOD" ? "#FFFFFF" : "#64748B",
                display: "flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              {currentZoneType === "NEIGHBORHOOD" ? "🟢 ATIVO NA LOJA" : "⚪ Inativo"}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.74rem", color: currentZoneType === "NEIGHBORHOOD" ? "#6D28D9" : "#64748B", lineHeight: 1.3 }}>
            O cliente seleciona os bairros pré-cadastrados com taxas fixas definidas por você.
          </p>
        </div>
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
          
          {/* Banner de Modo Ativo com Switch Exclusivo */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "12px",
              marginBottom: "14px",
              background: currentZoneType === "NEIGHBORHOOD" ? "#F5F3FF" : "#FEF2F2",
              border: `1.5px solid ${currentZoneType === "NEIGHBORHOOD" ? "#DDD6FE" : "#FECACA"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px"
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.82rem", fontWeight: 800, color: currentZoneType === "NEIGHBORHOOD" ? "#5B21B6" : "#991B1B" }}>
                <span>{currentZoneType === "NEIGHBORHOOD" ? "🏙️ Modo Bairro ATIVO" : "📍 Modo Raio ATIVO"}</span>
              </div>
              <div style={{ fontSize: "0.70rem", color: currentZoneType === "NEIGHBORHOOD" ? "#7C3AED" : "#DC2626", marginTop: "2px" }}>
                {currentZoneType === "NEIGHBORHOOD"
                  ? "Clientes selecionarão bairros cadastrados. Modo Raio desativado."
                  : "Frete calculado por distância em KM. Modo Bairro desativado."}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCurrentZoneType(currentZoneType === "NEIGHBORHOOD" ? "KM" : "NEIGHBORHOOD")}
              style={{
                padding: "6px 10px",
                borderRadius: "8px",
                border: "1px solid #CBD5E1",
                background: "#FFFFFF",
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "#1E293B",
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
              }}
            >
              🔄 {currentZoneType === "NEIGHBORHOOD" ? "Ativar Modo Raio" : "Ativar Modo Bairro"}
            </button>
          </div>

          <h4 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "4px" }}>
            {currentZoneType === "NEIGHBORHOOD" ? "Bairros Atendidos" : "Raios de Entrega (KM)"}
          </h4>
          <p style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "12px" }}>
            {currentZoneType === "NEIGHBORHOOD"
              ? "Cadastre os bairros que sua loja atende e o valor do frete para cada um."
              : "Configure os limites de raio (KM), tempo estimado e taxa por faixa."}
          </p>

          {/* Mode 1: KM (Por Raio) */}
          {(currentZoneType === "KM" || currentZoneType === "RADIUS") && (
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

              {/* Table header */}
              <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 32px", gap: "6px", fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", padding: "0 4px", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                <span>Raio</span><span>Tempo (min)</span><span>Taxa (R$)</span><span></span>
              </div>

              {zones.sort((a, b) => a.km - b.km).map((zone, i) => (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredZoneIndex(i)}
                  onMouseLeave={() => setHoveredZoneIndex(null)}
                  style={{
                    display: "grid", gridTemplateColumns: "60px 1fr 1fr 32px", gap: "6px", alignItems: "center", marginBottom: "8px",
                    padding: "4px 6px", borderRadius: "8px", transition: "all 0.15s ease",
                    background: hoveredZoneIndex === i ? "#FEF2F2" : "transparent",
                    boxShadow: hoveredZoneIndex === i ? "0 0 0 1.5px #FCA5A5" : "none"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: ZONE_COLORS[i % ZONE_COLORS.length], flexShrink: 0 }} />
                    <input type="number" min="0.5" step="0.5" value={zone.km}
                      onChange={e => updateZone(i, "km", parseFloat(e.target.value) || 0)}
                      style={{ width: "42px", padding: "6px 4px", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.82rem", textAlign: "center", outline: "none" }} />
                  </div>
                  <input type="number" min="1" value={zone.time}
                    onChange={e => updateZone(i, "time", parseInt(e.target.value) || 0)}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 4px", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.82rem", textAlign: "center", outline: "none" }} />
                  <input type="number" min="0" step="0.5" value={zone.fee}
                    onChange={e => updateZone(i, "fee", parseFloat(e.target.value) || 0)}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 4px", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.82rem", textAlign: "center", outline: "none" }} />
                  <button onClick={() => removeZone(i)}
                    style={{ width: "28px", height: "28px", borderRadius: "6px", border: "1px solid #FCA5A5", background: "#fff", color: "#EF4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              <button onClick={addZone}
                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1.5px dashed #CBD5E1", background: "#F8FAFC", color: "#64748B", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "16px", fontFamily: "inherit" }}>
                <Plus size={14} /> Adicionar Faixa de KM
              </button>
            </>
          )}

          {/* Mode 2: NEIGHBORHOOD (Por Bairro) */}
          {currentZoneType === "NEIGHBORHOOD" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 65px 65px 28px", gap: "6px", fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", padding: "0 4px", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                <span>Bairro</span><span>Tempo(m)</span><span>Taxa(R$)</span><span></span>
              </div>
              {neighborhoodZones.map((zone, i) => (
                <div
                  key={i}
                  onMouseEnter={() => setHoveredZoneIndex(i)}
                  onMouseLeave={() => setHoveredZoneIndex(null)}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr 65px 65px 28px", gap: "6px", alignItems: "center", marginBottom: "8px",
                    padding: "4px 6px", borderRadius: "8px", transition: "all 0.15s ease",
                    background: hoveredZoneIndex === i ? "#FEF2F2" : "transparent",
                    boxShadow: hoveredZoneIndex === i ? "0 0 0 1.5px #FCA5A5" : "none"
                  }}
                >
                  <input
                    type="text"
                    value={zone.name}
                    onChange={e => setNeighborhoodZones(prev => prev.map((z, idx) => idx === i ? { ...z, name: e.target.value } : z))}
                    placeholder="Nome do Bairro"
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.82rem", outline: "none" }}
                  />
                  <input
                    type="number"
                    min="1"
                    value={zone.time}
                    onChange={e => setNeighborhoodZones(prev => prev.map((z, idx) => idx === i ? { ...z, time: parseInt(e.target.value) || 0 } : z))}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 4px", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.82rem", textAlign: "center", outline: "none" }}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={zone.fee}
                    onChange={e => setNeighborhoodZones(prev => prev.map((z, idx) => idx === i ? { ...z, fee: parseFloat(e.target.value) || 0 } : z))}
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 4px", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.82rem", textAlign: "center", outline: "none" }}
                  />
                  <button onClick={() => setNeighborhoodZones(prev => prev.filter((_, idx) => idx !== i))}
                    style={{ width: "28px", height: "28px", borderRadius: "6px", border: "1px solid #FCA5A5", background: "#fff", color: "#EF4444", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button onClick={() => setNeighborhoodZones(prev => [...prev, { name: "", time: 40, fee: 7 }])}
                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1.5px dashed #CBD5E1", background: "#F8FAFC", color: "#64748B", fontWeight: 600, fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "16px", fontFamily: "inherit" }}>
                <Plus size={14} /> Adicionar Bairro
              </button>
            </>
          )}

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

