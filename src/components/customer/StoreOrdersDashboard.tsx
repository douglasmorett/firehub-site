"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Clock, MapPin, Phone, User, ChevronDown, ChevronUp, Search, ShoppingBag, ExternalLink, Settings, Store, Package, Bell, ToggleLeft, ToggleRight, GripVertical, Zap, ZapOff, Timer } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  NOVO: { label: "Novos Pedidos", emoji: "🔔", color: "#3B82F6", bg: "#EFF6FF" },
  ACEITO: { label: "Aceito", emoji: "✅", color: "#10B981", bg: "#ECFDF5" },
  PREPARANDO: { label: "Em Preparo", emoji: "👨‍🍳", color: "#F59E0B", bg: "#FFFBEB" },
  SAIU_ENTREGA: { label: "Em Transporte/Finalizados", emoji: "🛵", color: "#8B5CF6", bg: "#F5F3FF" },
  ENTREGUE: { label: "Entregue", emoji: "📦", color: "#10B981", bg: "#ECFDF5" },
  CANCELADO: { label: "Cancelado", emoji: "❌", color: "#EF4444", bg: "#FEF2F2" },
  ENCERRADO: { label: "Encerrado", emoji: "🔒", color: "#6B7280", bg: "#F3F4F6" },
};

// Mapping columns to statuses for drag-and-drop
const COLUMN_STATUS_MAP: Record<string, string> = {
  "col-novos": "NOVO",
  "col-preparo": "PREPARANDO",
  "col-transporte": "SAIU_ENTREGA",
};

function isStoreOpen(hours: any[]): { open: boolean; text: string } {
  if (!hours || !Array.isArray(hours)) return { open: true, text: "Sem horário" };
  const now = new Date();
  const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const today = hours[dayIdx];
  if (!today || !today.active) return { open: false, text: "Fechado hoje" };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = today.open.split(":").map(Number);
  const [ch, cm] = today.close.split(":").map(Number);
  if (nowMin >= oh * 60 + om && nowMin <= ch * 60 + cm) return { open: true, text: `Aberto até ${today.close}` };
  return { open: false, text: "Fechado" };
}


export default function StoreOrdersDashboard({ user, orders: initialOrders, isFranqueado }: { user: any; orders: any[]; isFranqueado: boolean }) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [now, setNow] = useState(new Date());
  const [motoboys, setMotoboys] = useState<any[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [autoAccept, setAutoAccept] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("autoAcceptOrders") === "true";
    return false;
  });
  const prevOrderCount = useRef(initialOrders.filter(o => o.status === "NOVO").length);

  // ===== ALTA DEMANDA (Surge Pricing) =====
  const [altaDemanda, setAltaDemanda] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("altaDemanda");
      if (saved) { const p = JSON.parse(saved); if (p.active && new Date(p.expiresAt) > new Date()) return p; }
    }
    return { active: false, extraMinutes: 15, extraFee: 3.0, activatedAt: null, expiresAt: null, logs: [] as any[] };
  });
  const [showAltaDemandaModal, setShowAltaDemandaModal] = useState(false);
  const [adExtraMinutes, setAdExtraMinutes] = useState(15);
  const [adExtraFee, setAdExtraFee] = useState(3.0);
  const [adDuration, setAdDuration] = useState(60); // minutos
  const [showAltaDemandaLog, setShowAltaDemandaLog] = useState(false);

  const activateAltaDemanda = () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + adDuration * 60000);
    const newState = {
      active: true, extraMinutes: adExtraMinutes, extraFee: adExtraFee,
      activatedAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
      logs: [
        ...(altaDemanda.logs || []),
        { activatedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), extraMinutes: adExtraMinutes, extraFee: adExtraFee, duration: adDuration }
      ]
    };
    setAltaDemanda(newState);
    localStorage.setItem("altaDemanda", JSON.stringify(newState));
    setShowAltaDemandaModal(false);
  };

  const deactivateAltaDemanda = () => {
    const newState = { ...altaDemanda, active: false, expiresAt: null };
    setAltaDemanda(newState);
    localStorage.setItem("altaDemanda", JSON.stringify(newState));
  };

  // Auto-desativar quando expirar
  useEffect(() => {
    if (!altaDemanda.active || !altaDemanda.expiresAt) return;
    const remaining = new Date(altaDemanda.expiresAt).getTime() - Date.now();
    if (remaining <= 0) { deactivateAltaDemanda(); return; }
    const t = setTimeout(deactivateAltaDemanda, remaining);
    return () => clearTimeout(t);
  }, [altaDemanda.active, altaDemanda.expiresAt]);

  // Drag state
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);
  const [weather, setWeather] = useState<any>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(todayStr + "T00:00");
  const [dateTo, setDateTo] = useState(todayStr + "T23:59");
  const [showResumo, setShowResumo] = useState(false);

  const storeName = user.storeName || user.name;
  const storeStatus = isStoreOpen(user.storeHours as any);
  const storeUrl = user.slug ? `/loja/${user.slug}` : null;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Weather fetch
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const latLng = user.storeLatLng as any;
        const weatherUrl = latLng?.lat ? `/api/weather?lat=${latLng.lat}&lng=${latLng.lng}` : `/api/weather?city=${encodeURIComponent(user.city || user.storeAddress?.split(",").pop()?.trim() || "Sa\u0303o Paulo")}`;
        const res = await fetch(weatherUrl);
        if (res.ok) setWeather(await res.json());
      } catch {}
    };
    fetchWeather();
    const wt = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(wt);
  }, [user.city, user.storeAddress, (user.storeLatLng as any)?.lat]);

  // FAST POLLING — 1s via lightweight API
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/customer-order/poll");
        if (res.ok && active) {
          const data = await res.json();
          setOrders(data);
        }
      } catch {}
      if (active) setTimeout(poll, 1000);
    };
    const timeout = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timeout); };
  }, []);

  useEffect(() => { setOrders(initialOrders); }, [initialOrders]);

  // Auto-accept logic
  useEffect(() => {
    if (!autoAccept) return;
    const novos = orders.filter(o => o.status === "NOVO");
    novos.forEach(o => {
      updateStatus(o.id, "ACEITO");
    });
  }, [orders, autoAccept]);

  // Toggle auto accept
  const toggleAutoAccept = () => {
    const next = !autoAccept;
    setAutoAccept(next);
    localStorage.setItem("autoAcceptOrders", next.toString());
  };

  // Sound + Push Notification for new orders
  useEffect(() => {
    const currentNewCount = orders.filter(o => o.status === "NOVO").length;
    if (currentNewCount > prevOrderCount.current) {
      // Play notification sound
      try {
        const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbsGczFj2markup+");
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } catch {}

      // Push Notification (browser)
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          try {
            new Notification("🔔 Novo pedido chegou!", {
              body: `Você tem ${currentNewCount} pedido${currentNewCount > 1 ? "s" : ""} aguardando confirmação.`,
              icon: "/icon.jpg",
              tag: "new-order",
            });
          } catch {}
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission().then(permission => {
            if (permission === "granted") {
              try {
                new Notification("🔔 Notificações ativadas!", {
                  body: "Você receberá alertas quando chegar novos pedidos.",
                  icon: "/icon.jpg",
                });
              } catch {}
            }
          });
        }
      }
    }
    prevOrderCount.current = currentNewCount;
  }, [orders]);

  // Solicitar permissão de notificação na montagem
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      // Pequeno delay para não parecer intrusivo
      const t = setTimeout(() => Notification.requestPermission(), 3000);
      return () => clearTimeout(t);
    }
  }, []);

  // Carrega motoboys cadastrados
  useEffect(() => {
    fetch("/api/motoboys")
      .then(r => r.ok ? r.json() : [])
      .then(data => setMotoboys(Array.isArray(data) ? data.filter((m: any) => m.active !== false) : []))
      .catch(() => {});
  }, []);

  const assignMotoboy = async (orderId: string, motoboyId: string) => {
    setAssigningId(orderId);
    try {
      await fetch("/api/customer-order/assign-motoboy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, motoboyId: motoboyId || null }),
      });
      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, motoboyId, motoboy: motoboys.find(m => m.id === motoboyId) || null }
          : o
      ));
    } finally { setAssigningId(null); }
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    setLoadingId(orderId);
    try {
      const res = await fetch("/api/customer-order/status", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: newStatus })
      });
      if (res.ok) {
        // Optimistic update
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        router.refresh();
      }
      else alert("Erro ao atualizar.");
    } catch { alert("Erro."); } finally { setLoadingId(null); }
  };

  // --- DRAG HANDLERS ---
  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    setDraggedOrderId(orderId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", orderId);
    // Add visual feedback
    if (e.currentTarget instanceof HTMLElement) {
      setTimeout(() => {
        (e.currentTarget as HTMLElement).style.opacity = "0.4";
      }, 0);
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedOrderId(null);
    setDragOverColumn(null);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = "1";
    }
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the column entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!currentTarget.contains(relatedTarget)) {
      setDragOverColumn(null);
    }
  };

  const handleDrop = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    const orderId = e.dataTransfer.getData("text/plain");
    if (!orderId) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const targetStatus = COLUMN_STATUS_MAP[columnId];
    if (!targetStatus || order.status === targetStatus) return;

    // Determine the correct target status based on the column
    // Column "novos" = NOVO (but we should only allow moving back if needed)
    // Column "preparo" = PREPARANDO (or ACEITO if coming from NOVO)
    // Column "transporte" = SAIU_ENTREGA

    let newStatus = targetStatus;

    // If dragging from NOVO to Preparo, auto-accept first then set to PREPARANDO
    if (order.status === "NOVO" && columnId === "col-preparo") {
      newStatus = "PREPARANDO";
    }
    // If dragging from NOVO to Transport, accept + prepare + set SAIU_ENTREGA
    if (order.status === "NOVO" && columnId === "col-transporte") {
      newStatus = "SAIU_ENTREGA";
    }

    updateStatus(orderId, newStatus);
  };

  // --- TOUCH DRAG SUPPORT ---
  const touchRef = useRef<{ orderId: string; startX: number; startY: number; el: HTMLElement } | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);

  const handleTouchStart = (e: React.TouchEvent, orderId: string) => {
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    touchRef.current = { orderId, startX: touch.clientX, startY: touch.clientY, el };
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchRef.current.startX);
    const dy = Math.abs(touch.clientY - touchRef.current.startY);

    // Only activate horizontal drag
    if (dx > 20 && dx > dy) {
      e.preventDefault();
      touchRef.current.el.style.opacity = "0.4";

      // Create/update ghost element
      if (!ghostRef.current) {
        const ghost = document.createElement("div");
        ghost.style.cssText = `position:fixed;z-index:9999;pointer-events:none;padding:8px 16px;background:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.2);font-weight:700;font-size:0.85rem;border:2px solid #3B82F6;`;
        ghost.textContent = `#${touchRef.current.orderId.slice(-6).toUpperCase()}`;
        document.body.appendChild(ghost);
        ghostRef.current = ghost;
      }
      ghostRef.current.style.left = `${touch.clientX - 40}px`;
      ghostRef.current.style.top = `${touch.clientY - 20}px`;

      // Highlight column under finger
      const columns = document.querySelectorAll("[data-droppable]");
      columns.forEach(col => {
        const rect = col.getBoundingClientRect();
        if (touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          (col as HTMLElement).style.background = "#E0F2FE";
          setDragOverColumn(col.getAttribute("data-droppable"));
        } else {
          (col as HTMLElement).style.background = "";
        }
      });
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchRef.current) return;
    touchRef.current.el.style.opacity = "1";

    // Remove ghost
    if (ghostRef.current) {
      ghostRef.current.remove();
      ghostRef.current = null;
    }

    // Find which column we're over
    const touch = e.changedTouches[0];
    const columns = document.querySelectorAll("[data-droppable]");
    let droppedColumn: string | null = null;

    columns.forEach(col => {
      (col as HTMLElement).style.background = "";
      const rect = col.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        droppedColumn = col.getAttribute("data-droppable");
      }
    });

    if (droppedColumn && touchRef.current) {
      const order = orders.find(o => o.id === touchRef.current!.orderId);
      if (order) {
        const targetStatus = COLUMN_STATUS_MAP[droppedColumn];
        if (targetStatus && order.status !== targetStatus) {
          let newStatus = targetStatus;
          if (order.status === "NOVO" && droppedColumn === "col-preparo") newStatus = "PREPARANDO";
          if (order.status === "NOVO" && droppedColumn === "col-transporte") newStatus = "SAIU_ENTREGA";
          updateStatus(order.id, newStatus);
        }
      }
    }

    setDragOverColumn(null);
    touchRef.current = null;
  }, [orders]);

  useEffect(() => {
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchMove, handleTouchEnd]);

  const fromDate = new Date(dateFrom);
  const toDate = new Date(dateTo);

  const filteredOrders = orders.filter(o => {
    if (o.status === "ENCERRADO") return false;
    const created = new Date(o.createdAt);
    if (created < fromDate || created > toDate) return false;
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return o.customerName?.toLowerCase().includes(s) || o.customerPhone?.includes(s) || o.customerAddress?.toLowerCase().includes(s) || o.id.includes(s);
  });

  const novos = filteredOrders.filter(o => o.status === "NOVO");
  const preparo = filteredOrders.filter(o => o.status === "ACEITO" || o.status === "PREPARANDO");
  const transporte = filteredOrders.filter(o => o.status === "SAIU_ENTREGA" || o.status === "ENTREGUE");

  // Resumo de vendas
  const allInRange = orders.filter(o => { const d = new Date(o.createdAt); return d >= fromDate && d <= toDate; });
  const resumo = {
    pendentes: allInRange.filter(o => o.status === "NOVO"),
    preparo: allInRange.filter(o => o.status === "ACEITO" || o.status === "PREPARANDO"),
    transporte: allInRange.filter(o => o.status === "SAIU_ENTREGA"),
    entregues: allInRange.filter(o => o.status === "ENTREGUE" || o.status === "ENCERRADO"),
    cancelados: allInRange.filter(o => o.status === "CANCELADO"),
    total: allInRange.filter(o => o.status !== "CANCELADO"),
  };
  const sumVal = (arr: any[]) => arr.reduce((s, o) => s + o.totalAmount, 0);
  const fmtR = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;

  const OrderCard = ({ order }: { order: any }) => {
    const expanded = expandedId === order.id;
    const st = STATUS_CONFIG[order.status] || STATUS_CONFIG.NOVO;
    const isLoading = loadingId === order.id;
    const isDragging = draggedOrderId === order.id;
    const mins = Math.floor((now.getTime() - new Date(order.createdAt).getTime()) / 60000);

    return (
      <div
        draggable
        onDragStart={e => handleDragStart(e, order.id)}
        onDragEnd={handleDragEnd}
        onTouchStart={e => handleTouchStart(e, order.id)}
        style={{
          background: "#fff", borderRadius: "10px",
          border: `1.5px solid ${isDragging ? "#3B82F6" : st.color + "20"}`,
          marginBottom: "0.5rem", overflow: "hidden",
          boxShadow: isDragging ? "0 8px 24px rgba(59,130,246,0.2)" : "0 1px 4px rgba(0,0,0,0.06)",
          cursor: "grab", transition: "box-shadow 0.2s, border-color 0.2s",
          opacity: isDragging ? 0.4 : 1,
          userSelect: "none"
        }}
      >
        <div style={{ padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ color: "#CBD5E1", cursor: "grab", display: "flex", flexShrink: 0 }}>
            <GripVertical size={16} />
          </div>
          <div style={{ flex: 1 }} onClick={() => setExpandedId(expanded ? null : order.id)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>#{order.id.slice(-6).toUpperCase()}</span>
                <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#64748B" }}>{mins < 60 ? `${mins}min` : `${Math.floor(mins/60)}h${mins%60}min`}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontWeight: 800, color: st.color }}>R$ {order.totalAmount.toFixed(2)}</span>
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "4px", fontSize: "0.8rem", color: "#64748B" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "3px" }}><User size={12} /> {order.customerName}</span>
              <span>{order.deliveryType === "DELIVERY" ? "🛵 Entrega" : "🏪 Retirada"}</span>
            </div>
          </div>
        </div>

        {expanded && (
          <div style={{ padding: "0 1rem 0.75rem", borderTop: "1px solid #F1F5F9" }}>

            {/* ── CENÁRIO 1: Banner de PEDIDO AGENDADO ── */}
            {order.scheduledDatetime && (
              <div style={{ margin: "0.6rem 0", padding: "10px 14px", background: "linear-gradient(135deg,#EFF6FF,#DBEAFE)", borderRadius: "10px", border: "2px solid #93C5FD", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1.4rem" }}>📅</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#1D4ED8" }}>PEDIDO AGENDADO</div>
                  <div style={{ fontSize: "0.82rem", color: "#1E40AF", fontWeight: 600 }}>
                    {new Date(order.scheduledDatetime).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" })}
                  </div>
                </div>
              </div>
            )}

            {/* ── CENÁRIO 3: Banner de RETIRADA ── */}
            {(order.deliveryType === "RETIRADA" || order.deliveryType === "TAKEOUT" || order.deliveryType === "PICKUP") && (
              <div style={{ margin: "0.6rem 0", padding: "10px 14px", background: "linear-gradient(135deg,#FFF7ED,#FFEDD5)", borderRadius: "10px", border: "2px solid #FCD34D", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1.4rem" }}>🏪</span>
                <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#B45309" }}>RETIRADA NO LOCAL — Cliente vem buscar</div>
              </div>
            )}

            {/* ── CENÁRIO 4: Banner de CANCELAMENTO POR PLATAFORMA ── */}
            {order.status === "CANCELADO" && order.cancelledBy === "IFOOD" && (
              <div style={{ margin: "0.6rem 0", padding: "10px 14px", background: "#FEF2F2", borderRadius: "10px", border: "2px solid #FCA5A5", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1.4rem" }}>🚫</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#DC2626" }}>CANCELADO PELA PLATAFORMA</div>
                  <div style={{ fontSize: "0.78rem", color: "#B91C1C" }}>O iFood cancelou este pedido automaticamente</div>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", margin: "0.75rem 0", fontSize: "0.82rem" }}>
              <div><span style={{ color: "#94A3B8" }}>Tel:</span> <a href={`https://wa.me/55${order.customerPhone?.replace(/\D/g,'')}`} target="_blank" style={{ color: "#25D366", fontWeight: 600 }}>{order.customerPhone}</a></div>
              {order.customerAddress && <div><span style={{ color: "#94A3B8" }}>End:</span> <strong>{order.customerAddress}</strong></div>}
            </div>

            {/* Pagamento + Troco (Cenário 5) */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "0.5rem" }}>
              {order.paymentMethod && (
                <span style={{ padding: "3px 10px", borderRadius: "20px", background: "#F1F5F9", fontSize: "0.78rem", fontWeight: 600 }}>
                  💳 {order.paymentMethod}
                </span>
              )}
              {order.changeAmount != null && order.changeAmount > 0 && (
                <span style={{ padding: "3px 10px", borderRadius: "20px", background: "#F0FDF4", border: "1px solid #BBF7D0", fontSize: "0.78rem", fontWeight: 700, color: "#15803D" }}>
                  💵 Troco para R$ {Number(order.changeAmount).toFixed(2)}
                </span>
              )}
              {order.customerCpfCnpj && (
                <span style={{ padding: "3px 10px", borderRadius: "20px", background: "#F5F3FF", border: "1px solid #DDD6FE", fontSize: "0.78rem", fontWeight: 600, color: "#6D28D9" }}>
                  🪪 CPF/CNPJ: {order.customerCpfCnpj}
                </span>
              )}
            </div>

            {/* SELETOR DE MOTOBOY */}
            {order.deliveryType === "DELIVERY" && motoboys.length > 0 && (
              <div style={{ margin: "0.5rem 0", padding: "8px 10px", background: "#F0F9FF", borderRadius: "8px", border: "1px solid #BAE6FD" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#0369A1", display: "block", marginBottom: "4px" }}>🛵 Motoboy responsável:</label>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <select
                    value={order.motoboyId || ""}
                    onChange={e => assignMotoboy(order.id, e.target.value)}
                    disabled={assigningId === order.id}
                    style={{ flex: 1, padding: "5px 8px", borderRadius: "6px", border: "1px solid #BAE6FD", fontSize: "0.82rem", outline: "none", background: "white", fontFamily: "inherit" }}
                  >
                    <option value="">— Não atribuído —</option>
                    {motoboys.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name}{m.phone ? ` · ${m.phone}` : ""}</option>
                    ))}
                  </select>
                  {order.motoboy && (
                    <a
                      href={`https://wa.me/55${(order.motoboy.phone || "").replace(/\D/g, "")}`}
                      target="_blank" rel="noopener noreferrer"
                      title={`WhatsApp ${order.motoboy.name}`}
                      style={{ padding: "5px 8px", background: "#25D366", color: "white", borderRadius: "6px", textDecoration: "none", fontSize: "0.8rem", fontWeight: 700 }}
                    >📲</a>
                  )}
                </div>
                {order.motoboy && (
                  <div style={{ fontSize: "0.72rem", color: "#0369A1", marginTop: "3px" }}>✅ {order.motoboy.name} atribuído</div>
                )}
              </div>
            )}
            {order.notes && <div style={{ padding: "0.4rem 0.6rem", background: "#FFF7ED", borderRadius: "6px", fontSize: "0.8rem", marginBottom: "0.5rem" }}>💬 {order.notes}</div>}
            <div style={{ fontSize: "0.82rem", marginBottom: "0.5rem" }}>
              {order.items?.map((item: any) => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                  <span>{item.quantity}x {item.menuProduct?.name}</span>
                  <span style={{ fontWeight: 600 }}>R$ {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            {order.status !== "ENTREGUE" && order.status !== "CANCELADO" && order.status !== "ENCERRADO" && (
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {order.status === "NOVO" && <>
                  <button disabled={isLoading} onClick={() => updateStatus(order.id, "ACEITO")} style={{ flex: 1, padding: "0.6rem 1rem", borderRadius: "8px", border: "none", background: "#10B981", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>✅ Aceitar Pedido</button>
                  <button disabled={isLoading} onClick={() => updateStatus(order.id, "CANCELADO")} style={{ padding: "0.6rem 0.75rem", borderRadius: "8px", border: "1px solid #FCA5A5", background: "#fff", color: "#EF4444", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem" }}>❌</button>
                </> }
                {order.status === "ACEITO" && <button disabled={isLoading} onClick={() => updateStatus(order.id, "PREPARANDO")} style={{ flex: 1, padding: "0.5rem", borderRadius: "8px", border: "none", background: "#F59E0B", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}>👨‍🍳 Preparar</button>}
                {order.status === "PREPARANDO" && <button disabled={isLoading} onClick={() => updateStatus(order.id, "SAIU_ENTREGA")} style={{ flex: 1, padding: "0.5rem", borderRadius: "8px", border: "none", background: "#8B5CF6", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}>🛵 Saiu Entrega</button>}
                {order.status === "SAIU_ENTREGA" && <button disabled={isLoading} onClick={() => updateStatus(order.id, "ENTREGUE")} style={{ flex: 1, padding: "0.5rem", borderRadius: "8px", border: "none", background: "#10B981", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}>📦 Entregue</button>}
              </div>
            )}
            {(order.status === "ENTREGUE" || order.status === "CANCELADO") && (
              <button disabled={isLoading} onClick={() => { if(confirm("Encerrar pedido? Ele sairá da lista.")) updateStatus(order.id, "ENCERRADO"); }} style={{ width: "100%", marginTop: "4px", padding: "0.4rem", borderRadius: "8px", border: "1px solid #D1D5DB", background: "#F9FAFB", color: "#6B7280", fontWeight: 600, cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>🔒 Encerrar pedido</button>
            )}
          </div>
        )}
      </div>
    );
  };

  const Column = ({ columnId, title, emoji, color, count, children, headerExtra }: { columnId: string; title: string; emoji: string; color: string; count: number; children: React.ReactNode; headerExtra?: React.ReactNode }) => {

    const isOver = dragOverColumn === columnId;

    return (
      <div
        data-droppable={columnId}
        onDragOver={e => handleDragOver(e, columnId)}
        onDragLeave={handleDragLeave}
        onDrop={e => handleDrop(e, columnId)}
        style={{
          flex: 1, minWidth: "300px",
          background: isOver ? "#E0F2FE" : "#FAFAFA",
          borderRadius: "14px",
          border: isOver ? "2px dashed #3B82F6" : "1px solid #E2E8F0",
          display: "flex", flexDirection: "column",
          minHeight: "calc(100vh - 175px)", maxHeight: "calc(100vh - 175px)",
          transition: "background 0.2s, border 0.2s"
        }}
      >
        <div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", borderRadius: "14px 14px 0 0", gap: "0.5rem" }}>
          <h3 style={{ fontWeight: 700, fontSize: "1.05rem", margin: 0 }}>{emoji} {title}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {headerExtra}
            <span style={{ background: color, color: "#fff", borderRadius: "20px", padding: "3px 12px", fontSize: "0.85rem", fontWeight: 700, minWidth: "28px", textAlign: "center" }}>{count}</span>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>
          {count === 0 ? (
            <div style={{ textAlign: "center", padding: "4rem 0", color: "#94A3B8", fontSize: "0.9rem" }}>
              <Package size={40} style={{ opacity: 0.25, marginBottom: "0.75rem" }} />
              <p>{isOver ? "Solte aqui!" : "Nenhum pedido"}</p>
            </div>
          ) : children}
          {count > 0 && isOver && (
            <div style={{ textAlign: "center", padding: "1rem", color: "#3B82F6", fontWeight: 700, fontSize: "0.85rem", border: "2px dashed #93C5FD", borderRadius: "10px", margin: "0.5rem 0" }}>
              ↓ Solte aqui para mover ↓
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* MODAL RESUMO DE VENDAS */}
      {showResumo && (
        <div onClick={() => setShowResumo(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "28px", minWidth: "340px", maxWidth: "95vw", boxShadow: "0 25px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Resumo das vendas</h3>
              <button onClick={() => setShowResumo(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem" }}>x</button>
            </div>
            {[
              { label: `PAGAMENTOS PENDENTES (${resumo.pendentes.length})`, val: sumVal(resumo.pendentes), bold: false, red: false },
              { label: `NOVOS PEDIDOS (${resumo.pendentes.length})`, val: sumVal(resumo.pendentes), bold: false, red: false },
              { label: `EM PREPARO (${resumo.preparo.length})`, val: sumVal(resumo.preparo), bold: false, red: false },
              { label: `EM TRANSPORTE (${resumo.transporte.length})`, val: sumVal(resumo.transporte), bold: false, red: false },
              { label: `ENTREGUES (${resumo.entregues.length})`, val: sumVal(resumo.entregues), bold: false, red: false },
              { label: `TOTAL ATE O MOMENTO (${resumo.total.length})`, val: sumVal(resumo.total), bold: true, red: false },
              { label: `CANCELADOS (${resumo.cancelados.length})`, val: sumVal(resumo.cancelados), bold: true, red: true },
            ].map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
                <span style={{ fontWeight: row.bold ? 700 : 400, color: row.red ? "#EF4444" : "#1a1a2e" }}>{row.label}</span>
                <span style={{ fontWeight: row.bold ? 700 : 400, color: row.red ? "#EF4444" : "#1a1a2e" }}>{fmtR(row.val)}</span>
              </div>
            ))}
            <div style={{ marginTop: "16px", padding: "10px", background: "#F8FAFC", borderRadius: "8px", fontSize: "0.78rem", color: "#64748B" }}>
              <div>• O periodo e de {new Date(dateFrom).toLocaleString("pt-BR")} ate {new Date(dateTo).toLocaleString("pt-BR")}.</div>
            </div>
            <button onClick={() => setShowResumo(false)} style={{ marginTop: "16px", width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E2E8F0", background: "#F8FAFC", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Fechar</button>
          </div>
        </div>
      )}

      {/* ===== MODAL ALTA DEMANDA ===== */}
      {showAltaDemandaModal && (
        <div onClick={() => setShowAltaDemandaModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "32px", width: "420px", maxWidth: "95vw", boxShadow: "0 30px 80px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{ width: 44, height: 44, borderRadius: "12px", background: "linear-gradient(135deg,#EF4444,#F97316)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Zap size={22} color="#fff" />
              </div>
              <div>
                <h3 style={{ fontWeight: 800, fontSize: "1.15rem", margin: 0 }}>⚡ Modo Alta Demanda</h3>
                <p style={{ fontSize: "0.78rem", color: "#64748B", margin: 0 }}>Ative quando a loja estiver sobrecarregada</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: "12px", padding: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <Timer size={16} color="#EA580C" />
                  <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#EA580C" }}>+Tempo de Preparo (minutos extras)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {[5,10,15,20,30].map(m => (
                    <button key={m} onClick={() => setAdExtraMinutes(m)}
                      style={{ padding: "6px 12px", borderRadius: "8px", border: `2px solid ${adExtraMinutes === m ? "#EA580C" : "#E2E8F0"}`,
                        background: adExtraMinutes === m ? "#FFF7ED" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", color: adExtraMinutes === m ? "#EA580C" : "#64748B", fontFamily: "inherit" }}>
                      +{m}min
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: "12px", padding: "14px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#E11D48" }}>💰 Taxa extra de entrega</span>
                  <span style={{ fontSize: "0.72rem", color: "#E11D48", background: "#FFE4E6", padding: "3px 8px", borderRadius: "6px", display: "inline-flex", alignItems: "center", gap: "4px", width: "fit-content" }}>
                    ⚠️ O cliente paga R${adExtraFee.toFixed(2)} a mais no frete durante o período ativo
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {[0,1,2,3,5,8].map(v => (
                    <button key={v} onClick={() => setAdExtraFee(v)}
                      style={{ padding: "6px 12px", borderRadius: "8px", border: `2px solid ${adExtraFee === v ? "#E11D48" : "#E2E8F0"}`,
                        background: adExtraFee === v ? "#FFF1F2" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", color: adExtraFee === v ? "#E11D48" : "#64748B", fontFamily: "inherit" }}>
                      {v === 0 ? "Sem taxa" : `+R$${v}`}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "12px", padding: "14px" }}>
                <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#16A34A" }}>⏱️ Duração da Ativação</span>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px" }}>
                  {[30,60,90,120].map(d => (
                    <button key={d} onClick={() => setAdDuration(d)}
                      style={{ padding: "6px 12px", borderRadius: "8px", border: `2px solid ${adDuration === d ? "#16A34A" : "#E2E8F0"}`,
                        background: adDuration === d ? "#F0FDF4" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", color: adDuration === d ? "#16A34A" : "#64748B" }}>
                      {d}min
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ background: "#F8FAFC", borderRadius: "10px", padding: "12px", fontSize: "0.82rem", color: "#475569" }}>
                <strong>Resumo:</strong> Clientes verão +{adExtraMinutes}min no tempo estimado e +R${adExtraFee.toFixed(2)} na taxa de entrega por {adDuration} minutos.
              </div>

              <button onClick={activateAltaDemanda}
                style={{ padding: "14px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg,#EF4444,#F97316)", color: "#fff", fontWeight: 800, fontSize: "1rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontFamily: "inherit" }}>
                <Zap size={18} /> Ativar Alta Demanda
              </button>

              {/* Botão desativar — aparece quando Alta Demanda já está ativa */}
              {altaDemanda.active && (
                <button onClick={() => { deactivateAltaDemanda(); setShowAltaDemandaModal(false); }}
                  style={{ padding: "12px", borderRadius: "12px", border: "2px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontFamily: "inherit" }}>
                  <ZapOff size={16} /> Desativar Alta Demanda
                </button>
              )}

              {altaDemanda.logs?.length > 0 && (
                <button onClick={() => { setShowAltaDemandaModal(false); setShowAltaDemandaLog(true); }}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
                  📋 Ver histórico de ativações ({altaDemanda.logs.length})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL LOG ALTA DEMANDA ===== */}
      {showAltaDemandaLog && (
        <div onClick={() => setShowAltaDemandaLog(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "28px", width: "460px", maxWidth: "95vw", boxShadow: "0 25px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>📋 Histórico Alta Demanda</h3>
              <button onClick={() => setShowAltaDemandaLog(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem" }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "400px", overflowY: "auto" }}>
              {[...(altaDemanda.logs || [])].reverse().map((log: any, i: number) => (
                <div key={i} style={{ padding: "12px", borderRadius: "10px", background: "#F8FAFC", border: "1px solid #E2E8F0", fontSize: "0.82rem" }}>
                  <div style={{ fontWeight: 700, marginBottom: "4px" }}>🕐 {new Date(log.activatedAt).toLocaleString("pt-BR")}</div>
                  <div style={{ color: "#64748B" }}>+{log.extraMinutes}min de preparo · +R${log.extraFee?.toFixed(2)} frete · Duração: {log.duration}min</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== BANNER ALTA DEMANDA ATIVO ===== */}
      {altaDemanda.active && (
        <div style={{ background: "linear-gradient(135deg,#EF4444,#F97316)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#fff" }}>
            <Zap size={18} />
            <span style={{ fontWeight: 800, fontSize: "0.92rem" }}>⚡ ALTA DEMANDA ATIVA</span>
            <span style={{ fontSize: "0.82rem", opacity: 0.9 }}>+{altaDemanda.extraMinutes}min preparo · +R${Number(altaDemanda.extraFee).toFixed(2)} frete</span>
            {altaDemanda.expiresAt && (
              <span style={{ fontSize: "0.78rem", opacity: 0.85 }}>
                · Expira às {new Date(altaDemanda.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <button onClick={deactivateAltaDemanda}
            style={{ padding: "6px 14px", borderRadius: "8px", border: "2px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
            <ZapOff size={14} /> Desativar
          </button>
        </div>
      )}

      {/* FILTER BAR */}

      <div style={{ background: "#fff", borderBottom: "1px solid #E2E8F0", padding: "0.5rem 1.5rem" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: "400px" }}>
            <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
            <input
              type="text" placeholder="Nome, número, telefone, endereço..."
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              style={{ width: "100%", padding: "0.5rem 0.5rem 0.5rem 36px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.85rem", outline: "none" }}
            />
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>De</span>
            <input type="datetime-local" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "5px 8px", borderRadius: "8px", border: "1.5px solid #E2E8F0", fontSize: "0.78rem", outline: "none" }} />
            <span style={{ fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Ate</span>
            <input type="datetime-local" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "5px 8px", borderRadius: "8px", border: "1.5px solid #E2E8F0", fontSize: "0.78rem", outline: "none" }} />
            <button onClick={() => setShowResumo(true)} style={{ padding: "6px 14px", background: "#1E293B", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>💰 Resumo das vendas</button>
            <button
              onClick={() => setShowAltaDemandaModal(true)}
              style={{
                padding: "6px 14px", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.8rem",
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px",
                background: altaDemanda.active ? "linear-gradient(135deg,#EF4444,#F97316)" : "#FFF7ED",
                color: altaDemanda.active ? "#fff" : "#EA580C",
                outline: altaDemanda.active ? "none" : "1.5px solid #FED7AA",
                animation: altaDemanda.active ? "pulse 1.5s infinite" : "none"
              }}
            >
              <Zap size={14} /> {altaDemanda.active ? "⚡ Alta Demanda ON" : "Alta Demanda"}
            </button>
          </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginLeft: "auto" }}>
            {/* Weather Widget */}
            {weather && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#F0F9FF", padding: "0.35rem 0.75rem", borderRadius: "10px", border: "1px solid #BAE6FD" }}>
                <span style={{ fontSize: "1.3rem" }}>{weather.current.icon}</span>
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                  <span style={{ fontWeight: 800, fontSize: "1rem", color: "#0F172A" }}>{weather.current.temp}°</span>
                  <span style={{ fontSize: "0.6rem", color: "#64748B" }}>{weather.current.text}</span>
                </div>
                <div style={{ width: "1px", height: "24px", background: "#CBD5E1" }} />
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                  <span style={{ fontSize: "0.6rem", color: "#64748B" }}>💧 {weather.current.humidity}%</span>
                  <span style={{ fontSize: "0.6rem", color: "#64748B" }}>💨 {weather.current.wind} km/h</span>
                </div>
                {weather.forecast?.length > 0 && (
                  <>
                    <div style={{ width: "1px", height: "24px", background: "#CBD5E1" }} />
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {weather.forecast.map((f: any, i: number) => (
                        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.2 }}>
                          <span style={{ fontSize: "0.6rem", color: "#94A3B8" }}>
                            {new Date(f.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
                          </span>
                          <span style={{ fontSize: "0.85rem" }}>{f.icon}</span>
                          <span style={{ fontSize: "0.6rem", color: "#0F172A", fontWeight: 600 }}>{f.tempMax}°/{f.tempMin}°</span>
                          {f.rainChance > 20 && <span style={{ fontSize: "0.55rem", color: "#3B82F6" }}>🌧 {f.rainChance}%</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* Clock */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748B" }}>{weather?.city || user.city || ""}{weather?.state ? `/${weather.state}` : ""}</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.1rem", fontWeight: 700 }}>
                  {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
                  {now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3 COLUMNS */}
      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "0.75rem 1.25rem" }}>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <Column
            columnId="col-novos"
            title="Novos Pedidos" emoji="🔔" color="#3B82F6" count={novos.length}
            headerExtra={
              <button
                onClick={toggleAutoAccept}
                title={autoAccept ? "Auto-aceitar ATIVO" : "Auto-aceitar DESLIGADO"}
                style={{
                  display: "flex", alignItems: "center", gap: "4px", padding: "3px 8px",
                  borderRadius: "8px", border: "none", cursor: "pointer", fontSize: "0.68rem", fontWeight: 700,
                  background: autoAccept ? "#DCFCE7" : "#F1F5F9",
                  color: autoAccept ? "#16A34A" : "#94A3B8",
                  transition: "all 0.2s"
                }}
              >
                {autoAccept ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                Auto
              </button>
            }
          >
            {novos.map(o => <OrderCard key={o.id} order={o} />)}
          </Column>
          <Column columnId="col-preparo" title="Em Preparo" emoji="👨‍🍳" color="#F59E0B" count={preparo.length}>
            {preparo.map(o => <OrderCard key={o.id} order={o} />)}
          </Column>
          <Column columnId="col-transporte" title="Em Transporte/Finalizados" emoji="🛵" color="#8B5CF6" count={transporte.length}>
            {transporte.map(o => <OrderCard key={o.id} order={o} />)}
          </Column>
        </div>
      </div>

      <style>{`
        @media(max-width: 900px) {
          div > div[style*="min-width: 300px"] { min-width: 100% !important; min-height: 300px !important; max-height: 50vh !important; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}
