"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Search, Plus, Trash2, Check, Loader2, Navigation } from "lucide-react";

const ZONE_COLORS = ["#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA", "#00ACC1"];

type Zone = { km: number; time: number; fee: number };

interface Props {
  initialAddress: string;
  initialLatLng: { lat: number; lng: number } | null;
  initialZones: Zone[];
  zoneType: string;
  onSave: (data: { storeLatLng: { lat: number; lng: number }; deliveryZones: Zone[]; deliveryZoneType: string; storeAddress: string }) => Promise<void>;
}

export default function DeliveryZoneMap({ initialAddress, initialLatLng, initialZones, zoneType, onSave }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circlesRef = useRef<any[]>([]);

  const [address, setAddress] = useState(initialAddress || "");
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(initialLatLng);
  const [zones, setZones] = useState<Zone[]>(
    initialZones?.length ? initialZones : [
      { km: 1, time: 30, fee: 5 },
      { km: 3, time: 45, fee: 8 },
      { km: 5, time: 60, fee: 12 },
    ]
  );
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(!!initialLatLng);
  const [msg, setMsg] = useState("");
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Load Leaflet CSS dynamically
  useEffect(() => {
    if (typeof window === "undefined") return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    setLeafletLoaded(true);
  }, []);

  // Initialize map
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current) return;
    if (leafletMapRef.current) return;

    import("leaflet").then((L) => {
      const defaultPos: [number, number] = latLng ? [latLng.lat, latLng.lng] : [-22.5213, -41.9422]; // Rio das Ostras default

      const map = L.map(mapRef.current!, { zoomControl: false }).setView(defaultPos, latLng ? 13 : 12);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "Â© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: "bottomright" }).addTo(map);

      // Custom store icon
      const storeIcon = L.divIcon({
        className: "",
        html: `<div style="width:36px;height:36px;background:#1E293B;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
          <div style="transform:rotate(45deg);font-size:16px;">ðŸª</div>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      if (latLng) {
        markerRef.current = L.marker([latLng.lat, latLng.lng], { icon: storeIcon, draggable: true }).addTo(map);
        markerRef.current.on("dragend", (e: any) => {
          const pos = e.target.getLatLng();
          setLatLng({ lat: pos.lat, lng: pos.lng });
          setConfirmed(false);
        });
      }

      // Click on map to place marker
      map.on("click", (e: any) => {
        const pos = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng(pos);
        } else {
          markerRef.current = L.marker(pos, { icon: storeIcon, draggable: true }).addTo(map);
          markerRef.current.on("dragend", (ev: any) => {
            const p = ev.target.getLatLng();
            setLatLng({ lat: p.lat, lng: p.lng });
            setConfirmed(false);
          });
        }
        setLatLng({ lat: pos.lat, lng: pos.lng });
        setConfirmed(false);
      });

      leafletMapRef.current = { map, L };
    });

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.map.remove();
        leafletMapRef.current = null;
      }
    };
  }, [leafletLoaded]);

  // Draw circles when zones or latLng change
  const drawCircles = useCallback(() => {
    if (!leafletMapRef.current || !latLng) return;
    const { map, L } = leafletMapRef.current;

    // Remove old circles
    circlesRef.current.forEach(c => map.removeLayer(c));
    circlesRef.current = [];

    // Draw from largest to smallest so smaller are on top
    const sorted = [...zones].sort((a, b) => b.km - a.km);
    sorted.forEach((zone, i) => {
      const colorIdx = zones.length - 1 - i;
      const color = ZONE_COLORS[colorIdx % ZONE_COLORS.length];
      const circle = L.circle([latLng.lat, latLng.lng], {
        radius: zone.km * 1000,
        color,
        fillColor: color,
        fillOpacity: 0.15,
        weight: 2,
        dashArray: "6,4",
      }).addTo(map);
      circle.bindTooltip(`${zone.km} km â€” R$ ${zone.fee.toFixed(2)} â€” ${zone.time} min`, { permanent: false });
      circlesRef.current.push(circle);
    });
  }, [latLng, zones]);

  useEffect(() => {
    drawCircles();
  }, [drawCircles]);

  // Geocode address
  const geocodeAddress = async () => {
    if (!address.trim()) return;
    setSearching(true);
    setMsg("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=1`,
        { headers: { "Accept-Language": "pt-BR" } }
      );
      const data = await res.json();
      if (data.length === 0) {
        setMsg("âŒ EndereÃ§o nÃ£o encontrado. Tente ser mais especÃ­fico.");
        return;
      }
      const { lat, lon, display_name } = data[0];
      const newLatLng = { lat: parseFloat(lat), lng: parseFloat(lon) };
      setLatLng(newLatLng);
      setAddress(display_name.split(",").slice(0, 3).join(","));
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
            const p = e.target.getLatLng();
            setLatLng({ lat: p.lat, lng: p.lng });
            setConfirmed(false);
          });
        }
      }
    } catch {
      setMsg("âŒ Erro ao buscar endereÃ§o.");
    } finally {
      setSearching(false);
    }
  };

  const confirmLocation = () => {
    if (!latLng) return;
    setConfirmed(true);
    setMsg("âœ… LocalizaÃ§Ã£o confirmada! Os raios de entrega foram atualizados.");
    drawCircles();
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
    if (!latLng || !confirmed) {
      setMsg("âš ï¸ Confirme a localizaÃ§Ã£o no mapa primeiro.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ storeLatLng: latLng, deliveryZones: zones, deliveryZoneType: "KM", storeAddress: address });
      setMsg("âœ… ConfiguraÃ§Ãµes de entrega salvas!");
    } catch {
      setMsg("âŒ Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      <h3 style={{ fontWeight: 800, fontSize: "1.3rem", marginBottom: "4px" }}>ðŸ—ºï¸ ConfiguraÃ§Ãµes de Entrega</h3>
      <p style={{ color: "#64748B", fontSize: "0.88rem", marginBottom: "1rem" }}>
        Defina onde fica sua loja no mapa e configure os raios de entrega.
      </p>

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "1rem",
          background: msg.startsWith("âœ…") ? "#f0fdf4" : msg.startsWith("âš ï¸") ? "#fffbeb" : "#fef2f2",
          color: msg.startsWith("âœ…") ? "#16a34a" : msg.startsWith("âš ï¸") ? "#b45309" : "#dc2626",
          border: `1px solid ${msg.startsWith("âœ…") ? "#bbf7d0" : msg.startsWith("âš ï¸") ? "#fde68a" : "#fecaca"}`,
          fontSize: "0.85rem" }}>
          {msg}
        </div>
      )}

      {/* Address search */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "1rem" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <MapPin size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
          <input
            value={address}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => e.key === "Enter" && geocodeAddress()}
            placeholder="Digite o endereÃ§o da sua loja..."
            style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", outline: "none" }}
          />
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

          {/* Confirm button overlay */}
          {latLng && !confirmed && (
            <div style={{ position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)", zIndex: 1000 }}>
              <button onClick={confirmLocation}
                style={{ padding: "10px 20px", background: "#DC2626", color: "#fff", border: "none", borderRadius: "10px", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", boxShadow: "0 4px 12px rgba(220,38,38,0.4)", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
                <Check size={16} /> Confirmar esta localizaÃ§Ã£o
              </button>
            </div>
          )}

          {confirmed && (
            <div style={{ position: "absolute", top: "12px", left: "12px", zIndex: 1000, background: "#fff", borderRadius: "8px", padding: "6px 12px", fontSize: "0.8rem", fontWeight: 700, color: "#16a34a", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
              <Check size={14} /> LocalizaÃ§Ã£o confirmada
            </div>
          )}

          {/* Map instructions */}
          {!latLng && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 1000, background: "rgba(255,255,255,0.92)", borderRadius: "12px", padding: "16px 20px", textAlign: "center", fontSize: "0.85rem", color: "#475569" }}>
              <Navigation size={24} style={{ margin: "0 auto 8px", color: "#DC2626" }} />
              <strong>Busque o endereÃ§o acima</strong><br />
              ou clique no mapa para posicionar o pin
            </div>
          )}

          {/* Stats bar */}
          {zones.length > 0 && (
            <div style={{ position: "absolute", bottom: "12px", left: "12px", right: confirmed ? "12px" : "auto", zIndex: 1000, background: "rgba(255,255,255,0.92)", borderRadius: "8px", padding: "6px 12px", fontSize: "0.75rem", color: "#374151", display: "flex", gap: "12px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
              <span>ðŸ“ {Math.min(...zones.map(z => z.km))} km â†’ {Math.max(...zones.map(z => z.km))} km</span>
              <span>â±ï¸ {Math.min(...zones.map(z => z.time))} â†’ {Math.max(...zones.map(z => z.time))} min</span>
              <span>ðŸ’° R$ {Math.min(...zones.map(z => z.fee)).toFixed(2)} â†’ {Math.max(...zones.map(z => z.fee)).toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* ZONES CONTROL PANEL */}
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "20px" }}>
          <h4 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "4px" }}>Raios de entrega</h4>
          <p style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "16px" }}>Configure raio, tempo estimado e taxa por faixa.</p>

          {/* Adjust all quickly */}
          <div style={{ background: "#F8FAFC", borderRadius: "8px", padding: "10px 12px", marginBottom: "12px" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Ajuste rÃ¡pido</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button onClick={() => setZones(p => p.map(z => ({ ...z, time: Math.max(5, z.time - 5) })))}
                style={adjBtn}>â€” 5 min</button>
              <button onClick={() => setZones(p => p.map(z => ({ ...z, time: z.time + 5 })))}
                style={adjBtn}>+ 5 min</button>
              <button onClick={() => setZones(p => p.map(z => ({ ...z, fee: Math.max(0, z.fee - 1) })))}
                style={adjBtn}>â€” R$1</button>
              <button onClick={() => setZones(p => p.map(z => ({ ...z, fee: z.fee + 1 })))}
                style={adjBtn}>+ R$1</button>
            </div>
          </div>

          {/* Table header */}
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 32px", gap: "6px", fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", padding: "0 4px", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
            <span>Raio</span><span>Tempo (min)</span><span>Taxa (R$)</span><span></span>
          </div>

          {zones.sort((a, b) => a.km - b.km).map((zone, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 32px", gap: "6px", alignItems: "center", marginBottom: "8px" }}>
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

          <button onClick={handleSave} disabled={saving || !confirmed}
            style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "none",
              background: !confirmed ? "#E2E8F0" : "#DC2626", color: !confirmed ? "#94A3B8" : "#fff",
              fontWeight: 800, fontSize: "0.95rem", cursor: !confirmed ? "not-allowed" : "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            {saving ? <Loader2 size={16} /> : <Check size={16} />}
            {saving ? "Salvando..." : confirmed ? "Salvar ConfiguraÃ§Ãµes" : "Confirme o local no mapa primeiro"}
          </button>

          {latLng && (
            <div style={{ marginTop: "12px", padding: "8px 12px", background: "#F0FDF4", borderRadius: "8px", fontSize: "0.72rem", color: "#15803D" }}>
              <strong>ðŸ“ Coordenadas:</strong> {latLng.lat.toFixed(5)}, {latLng.lng.toFixed(5)}<br />
              <span style={{ color: "#64748B" }}>Usado para clima e raio de entrega automaticamente.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const adjBtn: React.CSSProperties = {
  padding: "5px 10px", borderRadius: "6px", border: "1px solid #E2E8F0",
  background: "#fff", color: "#374151", fontWeight: 600, fontSize: "0.75rem",
  cursor: "pointer", fontFamily: "inherit",
};

