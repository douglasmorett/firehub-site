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
  items: OrderItem[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getOrderLabel(order: Order, seqNum?: number): string {
  if (seqNum !== undefined) return `#${seqNum}`;
  return `#${order.id.slice(-4).toUpperCase()}`;
}

function getSourceInfo(order: Order): { label: string; color: string; bg: string } {
  const src = (order.source || "").toLowerCase();
  if (src.includes("ifood")) return { label: "iFood", color: "#fff", bg: "#EA1D2C" };
  if (src.includes("jotaja") || src.includes("jotajá"))
    return { label: "Jotajá", color: "#fff", bg: "#7c3aed" };
  return { label: "Online", color: "#fff", bg: "#2563EB" };
}

function getElapsedSeconds(order: Order, stage: string): number {
  let ref: string | null = null;
  if (stage === "production") ref = order.kdsProductionAt;
  else if (stage === "finishing") ref = order.kdsFinishingAt;
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

  // Mapeamento sequencial de números do sistema (#1, #2, #3...)
  const orderNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    sorted.forEach((o, i) => map.set(o.id, i + 1));
    return map;
  }, [orders]);

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
            (item: any) => item.menuProduct?.category && activeCategories.includes(item.menuProduct.category)
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
          style={{
            flex: 1,
            overflow: "auto",
            padding: "20px 20px 80px 20px",
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
                gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
                gap: 16,
                maxWidth: 1400,
                margin: "0 auto",
              }}
            >
              {filteredOrders.map((order, index) => (
                <OrderCard
                  key={order.id}
                  order={order}
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
  position,
  stage,
  accent,
  isExiting,
  tick,
  onMarkPronto,
}: {
  order: Order;
  position: number;
  stage: "production" | "finishing";
  accent: string;
  isExiting: boolean;
  tick: number;
  onMarkPronto: () => void;
}) {
  const elapsed = getElapsedSeconds(order, stage);
  const tColor = timerColor(elapsed);
  const glow = timerGlow(elapsed);
  const sourceInfo = getSourceInfo(order);

  const borderColor = elapsed >= 600 ? "#ef4444" : elapsed >= 300 ? "#eab308" : "#2a2a4a";

  return (
    <div
      style={{
        background: "#1a1a2e",
        border: `2px solid ${borderColor}`,
        borderRadius: 16,
        padding: "18px 20px",
        position: "relative",
        overflow: "hidden",
        animation: isExiting
          ? "kds-exit 0.5s ease-in forwards"
          : "kds-slide-in 0.4s ease-out",
        boxShadow: glow !== "none" ? glow : "0 4px 16px rgba(0,0,0,0.3)",
        cursor: "pointer",
        transition: "border-color 0.5s ease, box-shadow 0.5s ease",
        display: "flex",
        flexDirection: "column",
        gap: 12,
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
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
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
            fontSize: 24,
            fontWeight: 800,
            color: "#fff",
            letterSpacing: "-0.5px",
          }}
        >
          {getOrderLabel(order, position)}
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

        {/* Timer — pushed to the right */}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 22,
            fontWeight: 700,
            fontFamily: MONO_FONT,
            color: tColor,
            transition: "color 0.5s ease",
            textShadow: elapsed >= 600 ? `0 0 10px ${tColor}66` : "none",
          }}
        >
          {formatTimer(elapsed)}
        </span>
      </div>

      {/* ─── Customer name (if available) ──────────────────────────── */}
      {order.customerName && (
        <div
          style={{
            fontSize: 14,
            color: "#9ca3af",
            fontWeight: 500,
            marginTop: -4,
            paddingLeft: 54,
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
          gap: 6,
          borderTop: "1px solid #2a2a4a",
          paddingTop: 10,
        }}
      >
        {order.items.map((item) => {
          const comboItems = parseComboSelections(item.comboSelections, item.quantity);
          const displayName = item.menuProduct.name.split(" | ")[0];
          return (
            <div key={item.id}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#e5e7eb",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    color: accent,
                    fontWeight: 800,
                    fontSize: 22,
                    minWidth: 30,
                  }}
                >
                  {item.quantity}x
                </span>
                <span>{displayName}</span>
              </div>
              {/* Combo sub-items */}
              {comboItems.length > 0 && (
                <div style={{ paddingLeft: 42, display: "flex", flexDirection: "column", gap: 3, marginTop: 3 }}>
                  {comboItems.map((sub, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: 18,
                        color: "#9ca3af",
                        fontWeight: 500,
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
