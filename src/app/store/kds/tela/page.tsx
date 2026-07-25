"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface OrderItem {
  id: string;
  quantity: number;
  price: number;
  comboSelections: string | null;
  menuProduct: {
    name: string;
    category: string | null;
  };
}

interface Order {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  deliveryType: string | null;
  paymentMethod: string | null;
  totalAmount: number;
  deliveryFee: number;
  status: string;
  source: string | null;
  notes: string | null;
  ifoodReference: string | null;
  openDeliveryReference: string | null;
  kdsStage: string | null;
  kdsStationId: string | null;
  kdsProductionAt: string | null;
  kdsFinishingAt: string | null;
  createdAt: string;
  updatedAt: string;
  dailyOrderNumber?: number | null;
  items: OrderItem[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getOrderLabel(order: Order): string {
  if (order.dailyOrderNumber) return `#${order.dailyOrderNumber}`;
  if (order.ifoodReference) return `#${order.ifoodReference}`;
  if (order.openDeliveryReference) return `#${order.openDeliveryReference}`;
  return `#${order.id.slice(-4).toUpperCase()}`;
}

function getSourceInfo(order: Order): { label: string; color: string; bg: string } {
  const src = (order.source || "").toLowerCase();
  const ref = order.ifoodReference || order.openDeliveryReference;
  const refStr = ref ? ` #${ref}` : "";
  if (src.includes("ifood")) return { label: `iFood${refStr}`, color: "#fff", bg: "#EA1D2C" };
  if (src.includes("jotaja") || src.includes("jotajá"))
    return { label: `Jotajá${refStr}`, color: "#fff", bg: "#7c3aed" };
  return { label: `Online${refStr}`, color: "#fff", bg: "#2563EB" };
}

function getElapsedSeconds(order: Order, stage: string): number {
  let ref: string | null = null;
  if (stage === "production") {
    // Tela de Produção: conta o tempo do pedido na produção
    ref = order.kdsProductionAt || order.createdAt;
  } else if (stage === "finishing") {
    // Tela de Finalização: conta especificamente o tempo desde que a produção deu OK (kdsFinishingAt)
    ref = order.kdsFinishingAt;
    if (!ref) return 0; // se ainda não passou pela produção, inicia zerado (00:00)
  }
  if (!ref) ref = order.createdAt;
  return Math.max(0, Math.floor((Date.now() - new Date(ref).getTime()) / 1000));
}

function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timerColor(totalSeconds: number): string {
  if (totalSeconds < 300) return "#22c55e";
  if (totalSeconds < 600) return "#eab308";
  return "#ef4444";
}

function timerGlow(totalSeconds: number): string {
  if (totalSeconds >= 600) return "0 0 20px rgba(239,68,68,0.4), 0 0 40px rgba(239,68,68,0.15)";
  if (totalSeconds >= 300) return "0 0 15px rgba(234,179,8,0.2)";
  return "none";
}

function parseComboSelections(raw: string | null, parentQuantity: number = 1): { name: string; quantity: number }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item: any) => ({
          name: item.name || item.productName || item.label || "",
          quantity: (item.quantity || 1) * (parentQuantity || 1),
        }))
        .filter((item: any) => item.name);
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Font stack ─────────────────────────────────────────────────────────────────

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
const MONO_FONT = `'Courier New', 'Consolas', 'SF Mono', monospace`;

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function KDSTelaPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const stage = searchParams.get("stage") as "production" | "finishing" | null;
  const screenName = searchParams.get("name") || (stage === "production" ? "Produção" : "Finalização");
  const initialFilter = (searchParams.get("filter") || "all") as "all" | "odd" | "even" | "delivery" | "pickup";
  // Filtro de categoria: "Lanches,Bebidas" ou vazio (= mostrar tudo)
  const [activeCategories, setActiveCategories] = useState<string[]>(() => {
    const categoryFilterParam = searchParams.get("categories") || "";
    return categoryFilterParam ? categoryFilterParam.split(",").map(c => c.trim()).filter(Boolean) : [];
  });
  const [allCategories, setAllCategories] = useState<{ id: string; name: string; emoji: string; color: string }[]>([]);
  const [showCategoryPopup, setShowCategoryPopup] = useState(false);

  // ─── State ──────────────────────────────────────────────────────────────────

  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<"all" | "odd" | "even" | "delivery" | "pickup">(initialFilter);
  const [tick, setTick] = useState(0); // forces timer re-render every second
  const [currentTime, setCurrentTime] = useState(new Date());
  const [toast, setToast] = useState<{ orderId: string; label: string } | null>(null);
  const [exitingOrderId, setExitingOrderId] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [hasEnteredIds, setHasEnteredIds] = useState<Set<string>>(new Set());

  const [cashOpenedAt, setCashOpenedAt] = useState<Date | null>(null);

  // Sync with active cash session openedAt
  useEffect(() => {
    fetch("/api/cash-session")
      .then(r => r.json())
      .then(d => {
        if (d?.session?.openedAt) {
          setCashOpenedAt(new Date(d.session.openedAt));
        } else {
          setCashOpenedAt(null);
        }
      })
      .catch(() => {});
  }, []);

  // Mapeamento sequencial de números do sistema (#1, #2, #3...) idêntico ao Dashboard da Loja
  const orderNumberMap = useMemo(() => {
    const map = new Map<string, number>();

    orders.forEach((o: any) => {
      if (o.dailyOrderNumber) {
        map.set(o.id, o.dailyOrderNumber);
      }
    });

    const sessionStartCutoff = cashOpenedAt
      ? new Date(cashOpenedAt)
      : new Date(Date.now() - 48 * 60 * 60 * 1000);

    const sortedSessionOrders = [...orders]
      .filter((o: any) => new Date(o.createdAt) >= sessionStartCutoff)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    sortedSessionOrders.forEach((o, i) => {
      if (!map.has(o.id)) {
        map.set(o.id, i + 1);
      }
    });

    const sortedOlder = [...orders]
      .filter((o: any) => new Date(o.createdAt) < sessionStartCutoff)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    sortedOlder.forEach((o, i) => {
      if (!map.has(o.id)) {
        map.set(o.id, i + 1);
      }
    });

    return map;
  }, [orders, cashOpenedAt]);

  // Buscar todas as categorias no mount para o seletor de filtros
  useEffect(() => {
    fetch("/api/admin/categories")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setAllCategories(data); })
      .catch(() => {});
  }, []);


  const lastJsonRef = useRef<string>("");
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollDown = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ top: 350, behavior: "smooth" });
    } else {
      window.scrollBy({ top: 350, behavior: "smooth" });
    }
  }, []);

  const scrollUp = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ top: -350, behavior: "smooth" });
    } else {
      window.scrollBy({ top: -350, behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const code = e.keyCode;

      // Smart TV Remote keys: Seta para baixo, PageDown, CH- (keyCodes: 40, 34, 428)
      if (key === "ArrowDown" || key === "PageDown" || key === "ChannelDown" || code === 40 || code === 34 || code === 428) {
        e.preventDefault();
        scrollDown();
      }
      // Smart TV Remote keys: Seta para cima, PageUp, CH+ (keyCodes: 38, 33, 427)
      else if (key === "ArrowUp" || key === "PageUp" || key === "ChannelUp" || code === 38 || code === 33 || code === 427) {
        e.preventDefault();
        scrollUp();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [scrollDown, scrollUp]);

  // ─── Redirect if no stage ───────────────────────────────────────────────────

  useEffect(() => {
    if (!stage) {
      router.replace("/store/kds");
    }
  }, [stage, router]);

  // ─── Clock tick (every second) ──────────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ─── Poll orders every 3 seconds ───────────────────────────────────────────

  const fetchOrders = useCallback(async () => {
    if (!stage) return;
    try {
      const res = await fetch(`/api/kds?stage=${stage}`, { credentials: "include" });
      if (!res.ok) {
        setIsReconnecting(true);
        return;
      }
      const text = await res.text();
      setIsReconnecting(false);
      if (text !== lastJsonRef.current) {
        lastJsonRef.current = text;
        try {
          const data: Order[] = JSON.parse(text);
          setOrders(data);
          // Track newly entered IDs for animation
          setHasEnteredIds((prev) => {
            const next = new Set(prev);
            data.forEach((o) => next.add(o.id));
            return next;
          });
        } catch {
          // malformed JSON
        }
      }
    } catch {
      setIsReconnecting(true);
    }
  }, [stage]);

  useEffect(() => {
    if (!stage) return;

    let cancelled = false;

    const poll = async () => {
      await fetchOrders();
      if (!cancelled) {
        pollTimerRef.current = setTimeout(poll, 3000);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [stage, fetchOrders]);

  // ─── Filtered orders ───────────────────────────────────────────────────────

  const filteredOrders = useMemo(() => {
    let result = [...orders];

    switch (filter) {
      case "odd":
        result = result.filter((_, i) => i % 2 === 0);
        break;
      case "even":
        result = result.filter((_, i) => i % 2 === 1);
        break;
      case "delivery":
        result = result.filter((o) => o.deliveryType === "DELIVERY");
        break;
      case "pickup":
        result = result.filter((o) => o.deliveryType === "RETIRADA");
        break;
    }

    // Filtro por categoria: mostra só itens da(s) categoria(s) selecionada(s)
    if (activeCategories.length > 0) {
      result = result
        .map(order => ({
          ...order,
          items: order.items.filter(
            (item: any) => {
              const cat = item.menuProduct?.category || item.category || "";
              return cat && activeCategories.includes(cat);
            }
          ),
        }))
        .filter(order => order.items.length > 0); // ocultar pedidos sem nenhum item da categoria
    }

    return result;
  }, [orders, filter, activeCategories]);



  // ─── Mark as pronto ─────────────────────────────────────────────────────────

  const markAsPronto = useCallback(
    async (order: Order) => {
      if (!stage) return;
      if (exitingOrderId) return; // prevent double-action

      const action = stage === "production" ? "finish_production" : "finish_order";

      setExitingOrderId(order.id);

      // Show toast
      setToast({ orderId: order.id, label: getOrderLabel(order) });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 2000);

      // API call
      try {
        await fetch("/api/kds", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ orderId: order.id, action }),
        });
      } catch {
        // will be picked up on next poll
      }

      // Remove card after exit animation
      setTimeout(() => {
        setOrders((prev) => prev.filter((o) => o.id !== order.id));
        setExitingOrderId(null);
        // Update lastJsonRef so next poll diff works correctly
        lastJsonRef.current = "";
      }, 500);
    },
    [stage, exitingOrderId]
  );

  // ─── Keyboard support ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Numpad 0-9 codes: Numpad0-Numpad9, Digit0-Digit9
      let num: number | null = null;

      if (e.code.startsWith("Digit")) {
        num = parseInt(e.code.replace("Digit", ""), 10);
      } else if (e.code.startsWith("Numpad")) {
        num = parseInt(e.code.replace("Numpad", ""), 10);
      } else if (e.code === "Enter") {
        num = 0;
      }

      if (num === null || isNaN(num)) return;

      e.preventDefault();

      if (num === 0) {
        // Mark FIRST (oldest) order
        if (filteredOrders.length > 0) {
          markAsPronto(filteredOrders[0]);
        }
      } else {
        // num 1-9 → position index num-1
        const idx = num - 1;
        if (idx < filteredOrders.length) {
          markAsPronto(filteredOrders[idx]);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [filteredOrders, markAsPronto]);

  // ─── Accent color for stage ─────────────────────────────────────────────────

  const accent = stage === "production" ? "#f97316" : "#8b5cf6";

  // ─── Don't render if no stage ───────────────────────────────────────────────

  if (!stage) return null;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Inject keyframes animation */}
      <style>{`
        @keyframes kds-slide-in {
          from { opacity: 0; transform: translateX(60px) scale(0.95); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes kds-exit {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.03); background: rgba(34,197,94,0.15); }
          100% { opacity: 0; transform: scale(0.85); }
        }
        @keyframes kds-pulse-empty {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes kds-toast-in {
          from { opacity: 0; transform: translateY(20px) scale(0.9); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes kds-reconnecting-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes kds-flash-green {
          0% { box-shadow: inset 0 0 0 0 rgba(34,197,94,0); }
          30% { box-shadow: inset 0 0 60px 20px rgba(34,197,94,0.35); }
          100% { box-shadow: inset 0 0 0 0 rgba(34,197,94,0); }
        }
      `}</style>

      {/* Fullscreen overlay that covers everything including the store nav */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "#0a0a0a",
          fontFamily: FONT,
          color: "#ffffff",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ─── Header ──────────────────────────────────────────────────── */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            background: "linear-gradient(180deg, #111118 0%, #0d0d14 100%)",
            borderBottom: `2px solid ${accent}33`,
            flexShrink: 0,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>
              {stage === "production" ? "🔥" : "📦"} {screenName}
            </span>
            <span
              style={{
                display: "inline-block",
                padding: "4px 14px",
                borderRadius: 20,
                background: accent,
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {stage === "production" ? "Produção" : "Finalização"}
            </span>
          </div>
          {/* ─── Filter Tabs ─── */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1a1a2e", borderRadius: 10, padding: 4 }}>
            {([
              { value: "all" as const, label: "Todos" },
              { value: "odd" as const, label: "Ímpares" },
              { value: "even" as const, label: "Pares" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                style={{
                  padding: "6px 16px",
                  borderRadius: 8,
                  border: "none",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  fontFamily: FONT,
                  transition: "all 0.15s",
                  background: filter === opt.value ? accent : "transparent",
                  color: filter === opt.value ? "#fff" : "#9ca3af",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* ─── Category Filter Button ─── */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowCategoryPopup(prev => !prev)}
              style={{
                padding: "8px 18px", borderRadius: 10, border: "1px solid #3a3a5a",
                background: activeCategories.length > 0 ? accent : "#1a1a2e",
                color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8, fontFamily: FONT,
                transition: "all 0.2s"
              }}
            >
              🏷️ Filtrar por Categoria
              {activeCategories.length > 0 && (
                <span style={{ background: "#fff", color: accent, padding: "2px 6px", borderRadius: "50%", fontSize: 11, fontWeight: 800 }}>
                  {activeCategories.length}
                </span>
              )}
            </button>

            {showCategoryPopup && (
              <div
                style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 1000,
                  background: "#111118", border: "1px solid #3a3a5a", borderRadius: 12,
                  padding: "16px", minWidth: 260, display: "flex", flexDirection: "column", gap: 10,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #2a2a4a", paddingBottom: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: "#9ca3af" }}>CATEGORIAS</span>
                  {activeCategories.length > 0 && (
                    <button
                      onClick={() => setActiveCategories([])}
                      style={{ background: "none", border: "none", color: "#f97316", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    >
                      Limpar
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                  {allCategories.map(cat => {
                    const selected = activeCategories.includes(cat.name);
                    return (
                      <label
                        key={cat.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                          borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                          background: selected ? `${accent}15` : "transparent",
                          color: selected ? "#fff" : "#9ca3af",
                          transition: "all 0.15s",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            setActiveCategories(prev =>
                              selected ? prev.filter(c => c !== cat.name) : [...prev, cat.name]
                            );
                          }}
                          style={{ accentColor: accent, cursor: "pointer" }}
                        />
                        <span>{cat.emoji}</span>
                        <span>{cat.name}</span>
                      </label>
                    );
                  })}
                  {allCategories.length === 0 && (
                    <div style={{ fontSize: 12, color: "#64748b", textAlign: "center", padding: 8 }}>
                      Nenhuma categoria cadastrada.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            {isReconnecting && (
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#ef4444",
                  animation: "kds-reconnecting-pulse 1.5s ease-in-out infinite",
                }}
              >
                ⚠ Reconectando...
              </span>
            )}
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "#9ca3af",
              }}
            >
              {filteredOrders.length} {filteredOrders.length === 1 ? "pedido" : "pedidos"}
            </span>
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                fontFamily: MONO_FONT,
                color: "#e5e7eb",
                letterSpacing: "1px",
              }}
            >
              {currentTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        </header>

        {/* ─── Content ─────────────────────────────────────────────────── */}
        <div
          ref={scrollContainerRef}
          tabIndex={0}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 20px 80px 20px",
            outline: "none",
          }}
        >
          {filteredOrders.length === 0 ? (
            /* Empty state */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 16,
              }}
            >
              <span
                style={{
                  fontSize: 72,
                  animation: "kds-pulse-empty 3s ease-in-out infinite",
                }}
              >
                ☕
              </span>
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: "#6b7280",
                  animation: "kds-pulse-empty 3s ease-in-out infinite",
                }}
              >
                Nenhum pedido na fila
              </span>
              <span style={{ fontSize: 16, color: "#4b5563" }}>
                Os pedidos aparecerão automaticamente aqui
              </span>
            </div>
          ) : (
            /* Orders grid */
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))",
                gap: 16,
                maxWidth: 1600,
                margin: "0 auto",
              }}
            >
              {filteredOrders.map((order, index) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  seqNum={orderNumberMap.get(order.id)}
                  position={index + 1}
                  stage={stage}
                  accent={accent}
                  isExiting={exitingOrderId === order.id}
                  tick={tick}
                  onMarkPronto={() => markAsPronto(order)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ─── Footer ──────────────────────────────────────────────────── */}
        <footer
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "10px 24px",
            background: "linear-gradient(0deg, #0a0a0a 0%, transparent 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
        >
          <div
            style={{
              background: "#1f2937",
              padding: "8px 28px",
              borderRadius: 12,
              border: "1px solid #374151",
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600, color: "#9ca3af" }}>
              Aperte o{" "}
              <span
                style={{
                  display: "inline-block",
                  background: accent,
                  color: "#fff",
                  padding: "2px 10px",
                  borderRadius: 6,
                  fontWeight: 800,
                  fontSize: 14,
                  fontFamily: MONO_FONT,
                }}
              >
                NÚMERO
              </span>{" "}
              em destaque para dar{" "}
              <span style={{ color: accent, fontWeight: 800 }}>PRONTO</span>
            </span>
          </div>
        </footer>

        {/* Botões visuais de rolagem para TV / Controle Remoto */}
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 24,
            display: "flex",
            gap: 10,
            zIndex: 999,
          }}
        >
          <button
            type="button"
            onClick={scrollUp}
            style={{
              background: "rgba(15, 23, 42, 0.9)",
              color: "#F8FAFC",
              border: "1.5px solid rgba(255,255,255,0.25)",
              padding: "10px 18px",
              borderRadius: 14,
              fontWeight: 800,
              fontSize: "0.95rem",
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              backdropFilter: "blur(12px)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: FONT,
            }}
          >
            ⬆️ Rolar Cima
          </button>
          <button
            type="button"
            onClick={scrollDown}
            style={{
              background: "rgba(15, 23, 42, 0.9)",
              color: "#F8FAFC",
              border: "1.5px solid rgba(255,255,255,0.25)",
              padding: "10px 18px",
              borderRadius: 14,
              fontWeight: 800,
              fontSize: "0.95rem",
              cursor: "pointer",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              backdropFilter: "blur(12px)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: FONT,
            }}
          >
            ⬇️ Rolar Baixo
          </button>
        </div>

        {/* ─── Toast ──────────────────────────────────────────────────── */}
        {toast && (
          <div
            style={{
              position: "fixed",
              bottom: 80,
              left: "50%",
              transform: "translateX(-50%)",
              background: "linear-gradient(135deg, #166534, #15803d)",
              color: "#fff",
              padding: "14px 32px",
              borderRadius: 16,
              fontSize: 20,
              fontWeight: 700,
              zIndex: 20,
              animation: "kds-toast-in 0.3s ease-out",
              boxShadow: "0 8px 32px rgba(34,197,94,0.3)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 26 }}>✅</span>
            <span>Pedido {toast.label} — PRONTO!</span>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Order Card Component ───────────────────────────────────────────────────────

function OrderCard({
  order,
  seqNum,
  position,
  stage,
  accent,
  isExiting,
  tick,
  onMarkPronto,
}: {
  order: Order;
  seqNum?: number;
  position: number;
  stage: "production" | "finishing";
  accent: string;
  isExiting: boolean;
  tick: number;
  onMarkPronto?: () => void;
}) {
  const elapsed = getElapsedSeconds(order, stage);
  const tColor = timerColor(elapsed);
  const glow = timerGlow(elapsed);
  const sourceInfo = getSourceInfo(order);
  const borderColor = elapsed >= 600 ? "#ef4444" : elapsed >= 300 ? "#eab308" : "#2a2a4a";

  // ─── Order Density & TV Fit Scaling ──────────────────────────────
  const totalSubItemsCount = order.items.reduce((acc: number, item: any) => {
    const combo = parseComboSelections(item.comboSelections, item.quantity);
    return acc + 1 + combo.length;
  }, 0);

  const isVeryLargeOrder = totalSubItemsCount > 10;
  const isHugeOrder = totalSubItemsCount > 18;

  const mainFontSize = isHugeOrder ? 16 : isVeryLargeOrder ? 18 : 22;
  const subFontSize = isHugeOrder ? 13 : isVeryLargeOrder ? 15 : 18;
  const cardPadding = isHugeOrder ? "10px 14px" : isVeryLargeOrder ? "12px 16px" : "18px 20px";

  return (
    <div
      style={{
        background: "#1a1a2e",
        border: `2px solid ${borderColor}`,
        borderRadius: 16,
        padding: cardPadding,
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        animation: isExiting
          ? "kds-exit 0.5s ease-in forwards"
          : "kds-slide-in 0.4s ease-out",
        boxShadow: glow !== "none" ? glow : "0 4px 16px rgba(0,0,0,0.3)",
        cursor: "pointer",
        transition: "border-color 0.5s ease, box-shadow 0.5s ease",
        display: "flex",
        flexDirection: "column",
        gap: isHugeOrder ? 6 : isVeryLargeOrder ? 8 : 12,
      }}
      onClick={onMarkPronto}
    >
      {/* Green flash overlay for exiting cards */}
      {isExiting && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 16,
            animation: "kds-flash-green 0.5s ease-out",
            pointerEvents: "none",
            zIndex: 5,
          }}
        />
      )}

      {/* ─── Top row: Position, Order number, Source, Delivery type ─── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* Position badge */}
        {position <= 9 && (
          <div
            style={{
              width: isHugeOrder ? 34 : 44,
              height: isHugeOrder ? 34 : 44,
              borderRadius: "50%",
              background: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: isHugeOrder ? 20 : 28,
              fontWeight: 800,
              color: "#fff",
              flexShrink: 0,
              boxShadow: `0 0 12px ${accent}66`,
            }}
          >
            {position}
          </div>
        )}

        {/* Order number */}
        <span
          style={{
            fontSize: isHugeOrder ? 20 : 24,
            fontWeight: 800,
            color: "#fff",
            letterSpacing: "-0.5px",
          }}
        >
          {`#${seqNum ?? order.dailyOrderNumber ?? getOrderLabel(order).replace("#", "")}`}
        </span>

        {/* Source badge */}
        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 12,
            background: sourceInfo.bg,
            color: sourceInfo.color,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {sourceInfo.label}
        </span>

        {/* MOTOBOY IFOOD BADGE DESTACADO */}
        {(() => {
          const o = order as any;
          const isIfoodDriver = o.deliveryBy === "IFOOD";
          
          if (!isIfoodDriver) return null;
          return (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 12px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #EF4444, #DC2626)",
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: "0.5px",
                boxShadow: "0 0 14px rgba(239, 68, 68, 0.6)",
                border: "1px solid #B91C1C",
              }}
            >
              🛵 MOTOBOY IFOOD
            </span>
          );
        })()}

        {/* Delivery type badge */}
        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 12,
            background: "#1f2937",
            color: "#d1d5db",
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid #374151",
          }}
        >
          {order.deliveryType === "DELIVERY" ? "🛵 Delivery" : "🏠 Retirada"}
        </span>

        {/* Timer — pushed to the right com indicação de etapa (Produção / Finalização) */}
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <span
            style={{
              fontSize: isHugeOrder ? 18 : 22,
              fontWeight: 700,
              fontFamily: MONO_FONT,
              color: tColor,
              transition: "color 0.5s ease",
              textShadow: elapsed >= 600 ? `0 0 10px ${tColor}66` : "none",
            }}
          >
            {formatTimer(elapsed)}
          </span>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", marginTop: -2, letterSpacing: "0.05em" }}>
            {stage === "production" ? "Produção" : "Finalização"}
          </div>
        </div>
      </div>

      {/* ─── Customer name (if available) ──────────────────────────── */}
      {order.customerName && (
        <div
          style={{
            fontSize: isHugeOrder ? 12 : 14,
            color: "#9ca3af",
            fontWeight: 500,
            marginTop: -4,
            paddingLeft: position <= 9 ? (isHugeOrder ? 44 : 54) : 0,
          }}
        >
          {order.customerName}
        </div>
      )}

      {/* ─── Items list ────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isHugeOrder ? 4 : isVeryLargeOrder ? 6 : 8,
          borderTop: "1px solid #2a2a4a",
          paddingTop: isHugeOrder ? 6 : 10,
        }}
      >
        {order.items.map((item: any) => {
          const comboItems = parseComboSelections(item.comboSelections, item.quantity);
          const rawName = item.name || item.menuProduct?.name || "Item";
          const displayName = rawName.split(" | ")[0];
          return (
            <div key={item.id}>
              <div
                style={{
                  fontSize: mainFontSize,
                  fontWeight: 700,
                  color: "#e5e7eb",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  lineHeight: 1.2,
                }}
              >
                <span
                  style={{
                    color: accent,
                    fontWeight: 800,
                    fontSize: mainFontSize,
                    minWidth: isHugeOrder ? 24 : 30,
                  }}
                >
                  {item.quantity}x
                </span>
                <span>{displayName}</span>
              </div>
              {/* Combo sub-items: exibe em colunas adaptáveis sem NUNCA cortar nomes */}
              {comboItems.length > 0 && (
                <div
                  style={{
                    paddingLeft: isHugeOrder ? 14 : isVeryLargeOrder ? 20 : 36,
                    display: comboItems.length >= 6 ? "grid" : "flex",
                    gridTemplateColumns: comboItems.length >= 6 ? "repeat(auto-fit, minmax(200px, 1fr))" : undefined,
                    flexDirection: comboItems.length >= 6 ? undefined : "column",
                    gap: comboItems.length >= 6 ? "2px 14px" : (isHugeOrder ? 2 : 3),
                    marginTop: 3,
                  }}
                >
                  {comboItems.map((sub, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: subFontSize,
                        color: "#9ca3af",
                        fontWeight: 500,
                        lineHeight: 1.25,
                        whiteSpace: "normal",
                        wordBreak: "break-word",
                      }}
                    >
                      ↳ {sub.quantity}x {sub.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Notes / Observations (filter out system-generated lines) ──────────────────────────────────── */}
      {(() => {
        if (!order.notes) return null;
        const customerNotes = order.notes
          .split("\n")
          .filter((line: string) => {
            const l = line.trim();
            if (!l) return false;
            // Filter out system-generated iFood info lines
            if (l.startsWith("Pedido iFood")) return false;
            if (l.startsWith("🏷️ Desconto")) return false;
            if (l.startsWith("Fonte:")) return false;
            if (l.startsWith("📦")) return false;
            if (l.match(/^(Ref|ID|iFood|#\d)/i)) return false;
            return true;
          })
          .join("\n")
          .trim();
        if (!customerNotes) return null;
        return (
          <div
            style={{
              background: "rgba(234,179,8,0.12)",
              border: "1px solid rgba(234,179,8,0.3)",
              borderRadius: 10,
              padding: "8px 14px",
              fontSize: 15,
              fontWeight: 600,
              color: "#eab308",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>📝</span>
            <span>{customerNotes}</span>
          </div>
        );
      })()}
    </div>
  );
}
