"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Clock, MapPin, Phone, User, ChevronDown, ChevronUp, Search, ShoppingBag, ExternalLink, Settings, Store, Package, Bell, ToggleLeft, ToggleRight, GripVertical, Zap, ZapOff, Timer, CalendarClock, Printer, Copy, MessageCircle } from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  NOVO: { label: "Novos Pedidos", emoji: "🔔", color: "#3B82F6", bg: "#EFF6FF" },
  ACEITO: { label: "Aceito", emoji: "✅", color: "#10B981", bg: "#ECFDF5" },
  PREPARANDO: { label: "Em Preparo", emoji: "👨‍🍳", color: "#F59E0B", bg: "#FFFBEB" },
  SAIU_ENTREGA: { label: "Em Transporte/Finalizados", emoji: "🛵", color: "#8B5CF6", bg: "#F5F3FF" },
  ENTREGUE: { label: "Entregue", emoji: "📦", color: "#10B981", bg: "#ECFDF5" },
  CANCELADO: { label: "Cancelado", emoji: "❌", color: "#EF4444", bg: "#FEF2F2" },
  ENCERRADO: { label: "Encerrado", emoji: "🔒", color: "#6B7280", bg: "#F3F4F6" },
};

const PAYMENT_LABELS: Record<string, string> = {
  CREDIT: "Crédito",
  CREDITO: "Crédito",
  DEBIT: "Débito",
  DEBITO: "Débito",
  PIX: "Pix",
  CASH: "Dinheiro",
  DINHEIRO: "Dinheiro",
  VOUCHER: "Voucher",
  credit_card: "Crédito",
  debit_card: "Débito",
  pix: "Pix",
  cash: "Dinheiro",
};
const translatePayment = (method: string) => PAYMENT_LABELS[method] || PAYMENT_LABELS[method.toUpperCase()] || method;

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
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellationReasons, setCancellationReasons] = useState<{ cancelCodeId: string, description: string }[]>([]);
  const [selectedCancelCode, setSelectedCancelCode] = useState<string>("");
  const [loadingReasons, setLoadingReasons] = useState<boolean>(false);
  // === Motoboy iFood state ===
  const [ifoodDriverModalId, setIfoodDriverModalId] = useState<string | null>(null);
  const [ifoodDriverQuote, setIfoodDriverQuote] = useState<any>(null);
  const [ifoodDriverLoading, setIfoodDriverLoading] = useState(false);
  const [ifoodDriverError, setIfoodDriverError] = useState("");
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
  const [showAgendamentos, setShowAgendamentos] = useState(false);
  const [scheduleLeadHours, setScheduleLeadHours] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("scheduleLeadHours");
      return saved ? Number(saved) : 1;
    }
    return 1;
  });
  const [scheduleLeadInput, setScheduleLeadInput] = useState("");
  const [toastMsg, setToastMsg] = useState<{ text: string; color: string } | null>(null);
  const showToast = (text: string, color = "#10B981") => {
    setToastMsg({ text, color });
    setTimeout(() => setToastMsg(null), 4000);
  };

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
  // Default date — will be overridden by cash session openedAt if available
  const _now = new Date();
  const _ref = _now;
  const todayStr = `${_ref.getFullYear()}-${String(_ref.getMonth() + 1).padStart(2, "0")}-${String(_ref.getDate()).padStart(2, "0")}`;
  const [dateFrom, setDateFrom] = useState(todayStr + "T00:00");
  const [dateTo, setDateTo] = useState(todayStr + "T23:59");
  const [showResumo, setShowResumo] = useState(false);
  const storeName = user.storeName || user.name;
  const storeStatus = isStoreOpen(user.storeHours as any);
  const storeUrl = user.slug ? `/loja/${user.slug}` : null;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
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

  // FAST POLLING — 3s via lightweight API (pauses during drag)
  const isDraggingRef = useRef(false);
  const lastPollHash = useRef("");
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        if (!isDraggingRef.current) {
          const res = await fetch("/api/customer-order/poll");
          if (res.ok && active) {
            const text = await res.text();
            // Only update if data actually changed — prevents re-render closing dropdowns
            if (text !== lastPollHash.current) {
              lastPollHash.current = text;
              setOrders(JSON.parse(text));
            }
          }
        }
      } catch {}
      if (active) setTimeout(poll, 3000);
    };
    const timeout = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timeout); };
  }, []);

  useEffect(() => { setOrders(initialOrders); }, [initialOrders]);

  useEffect(() => {
    if (!cancelConfirmId) {
      setCancellationReasons([]);
      setSelectedCancelCode("");
      return;
    }

    setLoadingReasons(true);
    fetch(`/api/customer-order/cancellation-reasons?orderId=${cancelConfirmId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setCancellationReasons(data);
          setSelectedCancelCode(data[0].cancelCodeId);
          setCancelReason(data[0].description);
        }
      })
      .catch(err => {
        console.error("Error fetching cancellation reasons:", err);
      })
      .finally(() => {
        setLoadingReasons(false);
      });
  }, [cancelConfirmId]);

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

  // Pre-initialize AudioContext on first user interaction (required by browser autoplay policy)
  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const initAudio = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    };
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("touchstart", initAudio, { once: true });
    document.addEventListener("keydown", initAudio, { once: true });
    return () => {
      document.removeEventListener("click", initAudio);
      document.removeEventListener("touchstart", initAudio);
      document.removeEventListener("keydown", initAudio);
    };
  }, []);

  const playOrderChime = useCallback(async () => {
    try {
      let ctx = audioCtxRef.current;
      if (!ctx) {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;
      }
      // Resume if suspended (browser policy)
      if (ctx.state === "suspended") await ctx.resume();

      const playChime = (startTime: number) => {
        const osc1 = ctx!.createOscillator();
        const gain1 = ctx!.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(880, startTime);
        gain1.gain.setValueAtTime(0.4, startTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
        osc1.connect(gain1).connect(ctx!.destination);
        osc1.start(startTime);
        osc1.stop(startTime + 0.3);

        const osc2 = ctx!.createOscillator();
        const gain2 = ctx!.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1100, startTime + 0.15);
        gain2.gain.setValueAtTime(0.4, startTime + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
        osc2.connect(gain2).connect(ctx!.destination);
        osc2.start(startTime + 0.15);
        osc2.stop(startTime + 0.5);
      };
      const t = ctx.currentTime;
      playChime(t);
      playChime(t + 0.7);
      playChime(t + 1.4);
    } catch {}
  }, []);

  // Calcular pedidos agendados ANTES do useEffect do som
  const leadMs = scheduleLeadHours * 60 * 60 * 1000;
  const scheduledOrders = orders.filter(o => {
    if (!o.scheduledDatetime) return false;
    const deadline = new Date(o.scheduledDatetime);
    const diffMs = deadline.getTime() - new Date(o.createdAt).getTime();
    const isFutureScheduled = diffMs > 3 * 60 * 60 * 1000;
    const isNotStarted = o.status === "NOVO" || o.status === "ACEITO";
    const stillWaiting = deadline.getTime() - now.getTime() > leadMs;
    return isFutureScheduled && isNotStarted && stillWaiting;
  });
  const scheduledOrderIds = new Set(scheduledOrders.map(o => o.id));

  // Continuous alert sound — loops every 4s while there are NOVO orders
  const alertIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasNotifiedRef = useRef(false);

  useEffect(() => {
    // Só conta pedidos NOVO que NÃO estão na lista de agendados (som só para novos reais)
    const novoCount = orders.filter(o => o.status === "NOVO" && !scheduledOrderIds.has(o.id)).length;

    if (novoCount > 0) {
      // Start looping sound if not already playing
      if (!alertIntervalRef.current) {
        // Play immediately
        playOrderChime();

        // Then repeat every 4 seconds
        alertIntervalRef.current = setInterval(() => {
          playOrderChime();
        }, 4000);
      }

      // Send push notification only once per batch
      if (!hasNotifiedRef.current) {
        hasNotifiedRef.current = true;
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("🔔 Novo pedido chegou!", {
              body: `Você tem ${novoCount} pedido${novoCount > 1 ? "s" : ""} aguardando confirmação.`,
              icon: "/icon.jpg",
              tag: "new-order",
            });
          } catch {}
        }
      }
    } else {
      // All orders accepted — stop the sound
      if (alertIntervalRef.current) {
        clearInterval(alertIntervalRef.current);
        alertIntervalRef.current = null;
      }
      hasNotifiedRef.current = false;
    }

    return () => {
      // Cleanup on unmount
      if (alertIntervalRef.current) {
        clearInterval(alertIntervalRef.current);
        alertIntervalRef.current = null;
      }
    };
  }, [orders, playOrderChime, scheduledOrderIds]);

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
      else showToast("Erro ao atualizar.", "#EF4444");
    } catch { showToast("Erro.", "#EF4444"); } finally { setLoadingId(null); }
  };

  // === MOTOBOY IFOOD FUNCTIONS ===
  const fetchIfoodDriverQuote = async (orderId: string) => {
    setIfoodDriverModalId(orderId);
    setIfoodDriverLoading(true);
    setIfoodDriverError("");
    setIfoodDriverQuote(null);
    try {
      const res = await fetch(`/api/ifood/request-driver?orderId=${orderId}`);
      const data = await res.json();
      if (!data.available) throw new Error(data.error || "Motoboy iFood não disponível");
      setIfoodDriverQuote(data);
    } catch (e: any) { setIfoodDriverError(e.message); }
    finally { setIfoodDriverLoading(false); }
  };

  const requestIfoodDriver = async () => {
    if (!ifoodDriverModalId || !ifoodDriverQuote) return;
    setIfoodDriverLoading(true);
    try {
      const res = await fetch("/api/ifood/request-driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: ifoodDriverModalId, quoteId: ifoodDriverQuote.quoteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao solicitar motoboy");
      setOrders(prev => prev.map(o =>
        o.id === ifoodDriverModalId ? { ...o, ifoodDriverStatus: "REQUESTED", ifoodDriverRequestedAt: new Date().toISOString() } : o
      ));
      setIfoodDriverModalId(null);
    } catch (e: any) { setIfoodDriverError(e.message); }
    finally { setIfoodDriverLoading(false); }
  };

  const cancelIfoodDriver = async (orderId: string) => {
    if (!window.confirm("Cancelar solicitação de motoboy iFood?")) return;
    try {
      await fetch(`/api/ifood/request-driver?orderId=${orderId}`, { method: "DELETE" });
      setOrders(prev => prev.map(o =>
        o.id === orderId ? { ...o, ifoodDriverStatus: null, ifoodDriverName: null, ifoodDriverPhone: null } : o
      ));
    } catch {}
  };

  const confirmCancel = async () => {
    if (!cancelConfirmId) return;
    const finalReason = cancelReason.trim() || cancellationReasons.find(r => r.cancelCodeId === selectedCancelCode)?.description || "Cancelado pela loja";
    setLoadingId(cancelConfirmId);
    try {
      const res = await fetch("/api/customer-order/status", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: cancelConfirmId,
          status: "CANCELADO",
          cancelReason: finalReason,
          cancellationCode: selectedCancelCode
        })
      });
      if (res.ok) {
        setOrders(prev => prev.map(o => o.id === cancelConfirmId ? { ...o, status: "CANCELADO", cancelledBy: "LOJA", motoboyId: null, motoboy: null } : o));
        router.refresh();
      } else showToast("Erro ao cancelar.", "#EF4444");
    } catch { showToast("Erro.", "#EF4444"); } finally {
      setLoadingId(null);
      setCancelConfirmId(null);
      setCancelReason("");
      setSelectedCancelCode("");
    }
  };
  // --- DRAG HANDLERS ---
  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    isDraggingRef.current = true;
    setDraggedOrderId(orderId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", orderId);
  };

  const handleDragEnd = () => {
    isDraggingRef.current = false;
    setDraggedOrderId(null);
    setDragOverColumn(null);
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

    // Never allow dropping into Novos Pedidos
    if (columnId === "col-novos") return;

    const orderId = e.dataTransfer.getData("text/plain");
    if (!orderId) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const targetStatus = COLUMN_STATUS_MAP[columnId];
    if (!targetStatus) return;

    // Set the correct status based on target column
    let newStatus = targetStatus;
    if (columnId === "col-preparo") newStatus = "PREPARANDO";
    if (columnId === "col-transporte") newStatus = "SAIU_ENTREGA";

    if (order.status === newStatus) return;

    updateStatus(orderId, newStatus);
  };

  // --- TOUCH DRAG SUPPORT ---
  const touchRef = useRef<{ orderId: string; startX: number; startY: number; el: HTMLElement } | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);

  const handleTouchStart = (e: React.TouchEvent, orderId: string) => {
    isDraggingRef.current = true;
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    touchRef.current = { orderId, startX: touch.clientX, startY: touch.clientY, el };
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchRef.current.startX);
    const dy = Math.abs(touch.clientY - touchRef.current.startY);

    // Only activate horizontal drag — low threshold for fast response
    if (dx > 8 && dx > dy) {
      e.preventDefault();

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

    if (droppedColumn && droppedColumn !== "col-novos" && touchRef.current) {
      const order = orders.find(o => o.id === touchRef.current!.orderId);
      if (order) {
        let newStatus: string | null = null;
        if (droppedColumn === "col-preparo") newStatus = "PREPARANDO";
        if (droppedColumn === "col-transporte") newStatus = "SAIU_ENTREGA";
        if (newStatus && order.status !== newStatus) {
          updateStatus(order.id, newStatus);
        }
      }
    }

    isDraggingRef.current = false;
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
    
    // Pedidos ativos de integrações (iFood/Jotajá) não são filtrados por data,
    // garantindo que pedidos em andamento fiquem sempre visíveis.
    // Pedidos CANCELADOS sempre respeitam o filtro de data, independente da origem.
    const isActive = o.status !== "CANCELADO";
    const isIntegration = !!(o.ifoodOrderId || o.openDeliveryOrderId);
    
    if (isActive && isIntegration) {
      // Pedidos ativos de integração: sempre visíveis (sem filtro de data)
    } else {
      // Pedidos cancelados (qualquer origem) e pedidos manuais: filtro de data
      const refDate = o.scheduledDatetime ? new Date(o.scheduledDatetime) : new Date(o.createdAt);
      if (refDate < fromDate || refDate > toDate) return false;
    }
    
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return o.customerName?.toLowerCase().includes(s) || o.customerPhone?.includes(s) || o.customerAddress?.toLowerCase().includes(s) || o.id.includes(s);
  });

  // Sequential order numbering — includes ALL orders in period (even ENCERRADO)
  // so numbers stay stable. Resets when date range / cash session changes.
  const orderNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    const allInPeriod = orders
      .filter(o => {
        const isIntegration = !!(o.ifoodOrderId || o.openDeliveryOrderId);
        const isActive = o.status !== "CANCELADO" && o.status !== "ENCERRADO";
        if (isActive && isIntegration) return true;

        const refDate = o.scheduledDatetime ? new Date(o.scheduledDatetime) : new Date(o.createdAt);
        return refDate >= fromDate && refDate <= toDate;
      })
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    allInPeriod.forEach((o: any, i: number) => map.set(o.id, i + 1));
    return map;
  }, [orders, fromDate, toDate]);

  // scheduledOrders e scheduledOrderIds já calculados acima (antes do useEffect do som)

  const novos = filteredOrders.filter(o => o.status === "NOVO" && !scheduledOrderIds.has(o.id));
  const preparo = filteredOrders.filter(o => o.status === "ACEITO" || o.status === "PREPARANDO");
  const transporte = filteredOrders.filter(o => o.status === "SAIU_ENTREGA" || o.status === "ENTREGUE");
  const cancelados = filteredOrders.filter(o => o.status === "CANCELADO");

  // Resumo de vendas
  const allInRange = orders.filter(o => { const d = o.scheduledDatetime ? new Date(o.scheduledDatetime) : new Date(o.createdAt); return d >= fromDate && d <= toDate; });
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
    const elapsedMs = now.getTime() - new Date(order.createdAt).getTime();
    const elapsedMins = Math.max(0, Math.floor(elapsedMs / 60000));
    const seqNum = orderNumberMap.get(order.id) ?? "—";

    // Delivery deadline countdown (scheduledDatetime stores the delivery deadline for iFood orders)
    const isFinished = order.status === "ENTREGUE" || order.status === "CANCELADO" || order.status === "ENCERRADO";
    const deadline = order.scheduledDatetime ? new Date(order.scheduledDatetime) : null;
    const remainingMs = deadline ? deadline.getTime() - now.getTime() : null;
    const remainingMins = remainingMs !== null ? Math.floor(remainingMs / 60000) : null;
    // Don't flag as late/urgent once the order is finished
    const isLate = !isFinished && remainingMins !== null && remainingMins < 0;
    const isUrgent = !isFinished && remainingMins !== null && remainingMins <= 5 && remainingMins >= 0;

    // Timer display: hide countdown for finished orders, show countdown if we have a deadline, otherwise show elapsed time
    const timerLabel = isFinished
      ? (elapsedMins < 60 ? `${elapsedMins}min` : `${Math.floor(elapsedMins / 60)}h${elapsedMins % 60}min`)
      : remainingMins !== null
        ? (isLate ? `⚠️ -${Math.abs(remainingMins)}min atrasado` : `⏱️ ${remainingMins}min restante${remainingMins !== 1 ? "s" : ""}`)
        : (elapsedMins < 60 ? `${elapsedMins}min` : `${Math.floor(elapsedMins / 60)}h${elapsedMins % 60}min`);
    const timerColor = isLate ? "#EF4444" : isUrgent ? "#F59E0B" : "#64748B";

    const canDrag = order.status !== "CANCELADO" && order.status !== "ENTREGUE" && order.status !== "ENCERRADO";

    return (
      <div
        draggable={canDrag}
        onDragStart={canDrag ? (e => handleDragStart(e, order.id)) : undefined}
        onDragEnd={canDrag ? handleDragEnd : undefined}
        onTouchStart={canDrag ? (e => handleTouchStart(e, order.id)) : undefined}
        style={{
          background: "#fff", borderRadius: "10px",
          border: `1.5px solid ${isLate ? "#FCA5A5" : isUrgent ? "#FCD34D" : st.color + "20"}`,
          marginBottom: "0.5rem", overflow: "hidden",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          cursor: canDrag ? "grab" : "default",
          userSelect: "none"
        }}
      >
        {/* ─── COLLAPSED VIEW: All essential info always visible ─── */}
        <div style={{ padding: "0.6rem 0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {canDrag && (
              <div style={{ color: "#CBD5E1", cursor: "grab", display: "flex", flexShrink: 0, alignSelf: "flex-start", paddingTop: "2px" }} onClick={e => e.stopPropagation()}>
                <GripVertical size={14} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0, fontSize: "0.8rem", lineHeight: "1.7" }}>
              {/* Line 1: #{seqNum} - Name  |  Source badge + Ref */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1F2937", whiteSpace: "normal", wordBreak: "break-word", minWidth: 0 }}>
                  #{seqNum} — {order.customerName}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <span style={{ padding: "1px 8px", borderRadius: "10px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.03em",
                    background: order.source === "IFOOD" ? "#FEE2E2" : order.source === "JOTAJA" ? "#DBEAFE" : order.source === "PDV" ? "#E0E7FF" : "#ECFDF5",
                    color: order.source === "IFOOD" ? "#DC2626" : order.source === "JOTAJA" ? "#1D4ED8" : order.source === "PDV" ? "#4338CA" : "#059669"
                  }}>
                    {order.source === "IFOOD" ? "iFood" : order.source === "JOTAJA" ? "Jotajá" : order.source === "PDV" ? "PDV" : "Online"}
                  </span>
                  {(order.ifoodReference || order.openDeliveryReference) && (
                    <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#6366F1" }}>
                      #{order.ifoodReference || order.openDeliveryReference}
                    </span>
                  )}
                </div>
              </div>

              {/* Line 2: Phone  |  Date + time since */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", color: "#6B7280" }}>
                <span>
                  📞 {order.customerPhone ? order.customerPhone.replace(/\s*ID:\s*\d+/i, "").trim() : "—"}
                </span>
                <span style={{ flexShrink: 0, fontSize: "0.75rem" }}>
                  {new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  {" · "}
                  <span style={{ fontWeight: isLate || isUrgent ? 700 : 500, color: timerColor }}>
                    {timerLabel}
                  </span>
                </span>
              </div>

              {/* Line 3: Address (full, highlighted) */}
              {order.customerAddress && (
                <div style={{
                  color: "#065F46", fontWeight: 500, fontSize: "0.78rem",
                  background: "#ECFDF5", padding: "2px 8px", borderRadius: "5px", margin: "2px 0",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                }}>
                  📍 {order.customerAddress}
                </div>
              )}
              {(order.deliveryType === "RETIRADA" || order.deliveryType === "TAKEOUT" || order.deliveryType === "PICKUP") && (
                <div style={{
                  color: "#92400E", fontWeight: 600, fontSize: "0.78rem",
                  background: "#FEF3C7", padding: "2px 8px", borderRadius: "5px", margin: "2px 0"
                }}>
                  🏪 Retirada no local
                </div>
              )}

              {/* Line 4: Total + Payment + Delivery fee + Change */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#1F2937" }}>
                  R$ {order.totalAmount.toFixed(2)}
                </span>
                <span style={{ color: "#6B7280" }}>—</span>
                <span style={{ fontWeight: 600, color: "#374151" }}>
                  {order.paymentMethod ? translatePayment(order.paymentMethod) : "—"}
                </span>
                {order.deliveryType === "DELIVERY" && order.deliveryFee > 0 && (
                  <span style={{ fontSize: "0.72rem", color: "#6B7280", fontWeight: 500 }}>
                    (+R$ {Number(order.deliveryFee).toFixed(2)} entrega)
                  </span>
                )}
                {order.changeAmount != null && order.changeAmount > 0 && (
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#92400E", background: "#FEF3C7", padding: "1px 6px", borderRadius: "4px" }}>
                    💵 Troco p/ R$ {Number(order.changeAmount).toFixed(0)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ─── ACTION BAR: Always visible at bottom ─── */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginTop: "6px", paddingTop: "6px", borderTop: "1px solid #F3F4F6",
            gap: "6px"
          }}>
            {/* Left: Status action button + motoboy select */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
              {/* Status buttons */}
              {order.status === "NOVO" && (
                <button disabled={isLoading} onClick={e => { e.stopPropagation(); updateStatus(order.id, "ACEITO"); }} style={{ padding: "4px 14px", borderRadius: "6px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>✅ Aceitar</button>
              )}
              {order.status === "ACEITO" && (
                <button disabled={isLoading} onClick={e => { e.stopPropagation(); updateStatus(order.id, "PREPARANDO"); }} style={{ padding: "4px 14px", borderRadius: "6px", border: "none", background: "#D97706", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>👨‍🍳 Preparar</button>
              )}
              {order.status === "PREPARANDO" && order.deliveryType === "DELIVERY" && (
                <button disabled={isLoading} onClick={e => { e.stopPropagation(); updateStatus(order.id, "SAIU_ENTREGA"); }} style={{ padding: "4px 14px", borderRadius: "6px", border: "none", background: "#7C3AED", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>🛵 Saiu</button>
              )}
              {order.status === "PREPARANDO" && order.deliveryType !== "DELIVERY" && (
                <button disabled={isLoading} onClick={e => { e.stopPropagation(); updateStatus(order.id, "ENTREGUE"); }} style={{ padding: "4px 14px", borderRadius: "6px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>✅ Pronto</button>
              )}
              {order.status === "SAIU_ENTREGA" && (
                <button disabled={isLoading} onClick={e => { e.stopPropagation(); updateStatus(order.id, "ENTREGUE"); }} style={{ padding: "4px 14px", borderRadius: "6px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>📦 Entregue</button>
              )}
              {order.status === "ENTREGUE" && (
                <span style={{ padding: "3px 10px", borderRadius: "5px", background: "#059669", color: "#fff", fontSize: "0.72rem", fontWeight: 700 }}>
                  {(order.ifoodOrderId || order.source === "IFOOD")
                    ? (order.ifoodDriverStatus === "CONCLUDED" ? "Concluído" : "Entregue")
                    : "Entregue"}
                </span>
              )}
              {order.status === "CANCELADO" && (
                <span style={{ padding: "3px 10px", borderRadius: "5px", background: "#DC2626", color: "#fff", fontSize: "0.72rem", fontWeight: 700 }}>Cancelado</span>
              )}
              {order.status === "ENCERRADO" && (
                <span style={{ padding: "3px 10px", borderRadius: "5px", background: "#6B7280", color: "#fff", fontSize: "0.72rem", fontWeight: 700 }}>Encerrado</span>
              )}

              {/* Motoboy select (compact, in the bar) */}
              {order.deliveryType === "DELIVERY" && !order.ifoodDriverStatus && !order.motoboy && order.status !== "CANCELADO" && order.status !== "ENCERRADO" && order.status !== "ENTREGUE" && (
                <select
                  value=""
                  onChange={e => { e.stopPropagation(); assignMotoboy(order.id, e.target.value); }}
                  disabled={assigningId === order.id}
                  onClick={e => e.stopPropagation()}
                  style={{ padding: "3px 6px", borderRadius: "5px", border: "1px solid #E5E7EB", fontSize: "0.7rem", color: "#9CA3AF", background: "white", fontFamily: "inherit", cursor: "pointer", maxWidth: "110px" }}
                >
                  <option value="">Motoboy</option>
                  {motoboys.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Right: Icon buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
              {/* WhatsApp */}
              {order.customerPhone && (
                <a
                  href={`https://wa.me/55${(order.customerPhone || "").replace(/\s*ID:\s*\d+/i, "").replace(/\D/g, "")}`}
                  target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  title="WhatsApp"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "6px", background: "#059669", color: "#fff", textDecoration: "none" }}
                >
                  <MessageCircle size={15} />
                </a>
              )}

              {/* Print */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  // Build receipt content
                  const phone = (order.customerPhone || "").replace(/\s*ID:\s*\d+/i, "").trim();
                  const createdDate = new Date(order.createdAt);
                  const dateStr = createdDate.toLocaleDateString("pt-BR", { year: "2-digit", month: "2-digit", day: "2-digit" });
                  const timeStr = createdDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                  const isDelivery = order.deliveryType === "DELIVERY";

                  let receipt = `#${seqNum} ${isDelivery ? "DELIVERY" : "RETIRADA"}\n`;
                  receipt += `${order.source === "IFOOD" ? "IFOOD" : order.source === "JOTAJA" ? "APP - JOTAJÁ" : order.source === "PDV" ? "PDV" : "ONLINE"}\n`;
                  receipt += `Estabelecimento: ${storeName}\n`;
                  if (order.ifoodReference || order.openDeliveryReference) receipt += `N° do Pedido: ${order.ifoodReference || order.openDeliveryReference}\n`;
                  receipt += `Data: ${dateStr} ${timeStr}\n`;
                  receipt += `\n`;
                  receipt += `CLIENTE\n`;
                  receipt += `Nome: ${order.customerName}\n`;
                  receipt += `Telefone: ${phone}\n`;
                  receipt += `\n`;
                  if (isDelivery && order.customerAddress) {
                    receipt += `ENTREGA\n`;
                    receipt += `Endereço: ${order.customerAddress}\n`;
                    if (order.notes) receipt += `Obs: ${order.notes}\n`;
                    receipt += `\n`;
                  }
                  receipt += `RESUMO DO PEDIDO\n`;
                  order.items?.forEach((item: any) => {
                    const comboSels = (() => {
                      if (!item.comboSelections) return [];
                      try {
                        const parsed = typeof item.comboSelections === "string" ? JSON.parse(item.comboSelections) : item.comboSelections;
                        if (Array.isArray(parsed)) return parsed.filter((s: any) => s.name);
                        return [];
                      } catch { return []; }
                    })();
                    const nameParts = (item.menuProduct?.name || "Item").split(" | ");
                    const mainName = nameParts[0];
                    const extras = nameParts.slice(1);
                    receipt += `Qtd: ${item.quantity}x  Valor: R$ ${(item.price * item.quantity).toFixed(2)}\n`;
                    receipt += `${mainName}\n`;
                    if (comboSels.length > 0) {
                      comboSels.forEach((sel: any) => {
                        receipt += `  - ${sel.quantity > 1 ? sel.quantity + "x " : ""}${sel.name}\n`;
                      });
                    } else if (extras.length > 0) {
                      extras.forEach((ext: string) => {
                        receipt += `  - ${ext.trim()}\n`;
                      });
                    }
                    receipt += `\n`;
                  });
                  const subtotal = order.items?.reduce((sum: number, it: any) => sum + it.price * it.quantity, 0) || order.totalAmount;
                  receipt += `Subtotal: R$ ${subtotal.toFixed(2)}\n`;
                  if (isDelivery) receipt += `Taxa de Entrega: R$ ${Number(order.deliveryFee || 0).toFixed(2)}\n`;
                  receipt += `Total: R$ ${order.totalAmount.toFixed(2)}\n`;
                  if (order.paymentMethod) receipt += `Forma de Pagamento: ${translatePayment(order.paymentMethod)}\n`;
                  if (order.changeAmount != null && order.changeAmount > 0) receipt += `Troco para: R$ ${Number(order.changeAmount).toFixed(2)}\n`;

                  // Open print window
                  const printWin = window.open("", "_blank", "width=400,height=700");
                  if (printWin) {
                    printWin.document.write(`<html><head><title>Pedido #${seqNum}</title><style>body{font-family:'Courier New',monospace;font-size:13px;padding:20px;white-space:pre-wrap;line-height:1.5;}@media print{body{padding:0;}}</style></head><body>${receipt.replace(/\n/g, "<br>")}</body></html>`);
                    printWin.document.close();
                    printWin.focus();
                    printWin.print();
                  }
                }}
                title="Imprimir"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "6px", background: "#3B82F6", color: "#fff", border: "none", cursor: "pointer" }}
              >
                <Printer size={15} />
              </button>

              {/* Copy */}
              <button
                onClick={e => {
                  e.stopPropagation();
                  const phone = (order.customerPhone || "").replace(/\s*ID:\s*\d+/i, "").trim();
                  const isDelivery = order.deliveryType === "DELIVERY";
                  let text = `*#${seqNum} — ${order.customerName}*\n`;
                  text += `📞 ${phone}\n`;
                  if (isDelivery && order.customerAddress) text += `📍 ${order.customerAddress}\n`;
                  if (order.notes) text += `📝 ${order.notes}\n`;
                  text += `\n`;
                  order.items?.forEach((item: any) => {
                    text += `${item.quantity}× ${item.menuProduct?.name || "Item"}\n`;
                  });
                  text += `\n💰 *R$ ${order.totalAmount.toFixed(2)}* — ${order.paymentMethod ? translatePayment(order.paymentMethod) : "—"}`;
                  if (order.changeAmount != null && order.changeAmount > 0) text += `\n💵 Troco p/ R$ ${Number(order.changeAmount).toFixed(0)}`;
                  navigator.clipboard.writeText(text).catch(() => {});
                }}
                title="Copiar resumo"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "6px", background: "#6366F1", color: "#fff", border: "none", cursor: "pointer" }}
              >
                <Copy size={15} />
              </button>

              {/* Expand toggle */}
              <button
                onClick={e => { e.stopPropagation(); setExpandedId(expanded ? null : order.id); }}
                title={expanded ? "Recolher" : "Detalhes"}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "6px", background: expanded ? "#F3F4F6" : "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", cursor: "pointer" }}
              >
                {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            </div>
          </div>
        </div>

        {/* ─── EXPANDED: Secondary details panel ─── */}
        {expanded && (
          <div style={{ padding: "0 0.75rem 0.75rem", borderTop: "1px solid #E2E8F0" }}>

            {/* ── Agendamento / Prazo de entrega ── */}
            {deadline && (() => {
              const isScheduled = deadline.getTime() - new Date(order.createdAt).getTime() > 3 * 60 * 60 * 1000;
              const dateStr = deadline.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
              const timeStr = deadline.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

              if (isScheduled) {
                return (
                  <div style={{ margin: "0.6rem 0", padding: "10px 14px", background: "#F8FAFC", borderRadius: "8px", borderLeft: "4px solid #16A34A", display: "flex", alignItems: "center", gap: "10px" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#15803D", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        Pedido Agendado
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#374151", marginTop: "2px" }}>
                        {dateStr} — {timeStr}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div style={{ margin: "0.6rem 0", padding: "10px 14px", background: isLate ? "#FEF2F2" : isUrgent ? "#FFFBEB" : "#F8FAFC", borderRadius: "8px", borderLeft: `4px solid ${isLate ? "#EF4444" : isUrgent ? "#F59E0B" : "#3B82F6"}`, display: "flex", alignItems: "center", gap: "10px" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.82rem", color: isLate ? "#DC2626" : isUrgent ? "#D97706" : "#1D4ED8", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      {isLate ? `Atrasado ${Math.abs(remainingMins!)}min` : `Prazo: ${remainingMins}min restantes`}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: "1px" }}>
                      Entregar até {timeStr} · Na cozinha há {elapsedMins}min
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Retirada no local ── */}
            {(order.deliveryType === "RETIRADA" || order.deliveryType === "TAKEOUT" || order.deliveryType === "PICKUP") && (
              <div style={{ margin: "0.6rem 0", padding: "10px 14px", background: "#F8FAFC", borderRadius: "8px", borderLeft: "4px solid #D97706" }}>
                <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#92400E", textTransform: "uppercase", letterSpacing: "0.03em" }}>Retirada no local</div>
                <div style={{ fontSize: "0.78rem", color: "#6B7280", marginTop: "1px" }}>Cliente vem buscar</div>
              </div>
            )}

            {/* ── Motivo do cancelamento ── */}
            {order.status === "CANCELADO" && (
              <div style={{ margin: "0.6rem 0", padding: "10px 14px", borderRadius: "8px", borderLeft: "4px solid",
                background: order.cancelledBy === "LOJA" ? "#EFF6FF" : "#FEF2F2",
                borderLeftColor: order.cancelledBy === "LOJA" ? "#3B82F6" : "#EF4444"
              }}>
                <div style={{ fontWeight: 700, fontSize: "0.82rem", textTransform: "uppercase", letterSpacing: "0.03em",
                  color: order.cancelledBy === "LOJA" ? "#1D4ED8" : "#DC2626"
                }}>
                  {order.cancelledBy === "LOJA" ? "Cancelado pela loja"
                    : order.cancelledBy === "CUSTOMER" ? "Cancelado pelo cliente"
                    : order.cancelledBy === "IFOOD" ? "Cancelado pela plataforma"
                    : order.cancelledBy === "JOTAJA" ? "Cancelado pela plataforma"
                    : "Cancelado"}
                </div>
                <div style={{ fontSize: "0.78rem", marginTop: "1px",
                  color: order.cancelledBy === "LOJA" ? "#1E40AF" : "#B91C1C"
                }}>
                  {order.cancelledBy === "LOJA" ? "Você cancelou este pedido manualmente"
                    : order.cancelledBy === "CUSTOMER" ? "O cliente solicitou o cancelamento"
                    : order.cancelledBy === "IFOOD" ? "O iFood cancelou este pedido automaticamente"
                    : order.cancelledBy === "JOTAJA" ? "O Jotajá cancelou este pedido automaticamente"
                    : "Pedido foi cancelado"}
                </div>
              </div>
            )}

            {/* ── Dados do cliente (detailed) ── */}
            <div style={{ margin: "0.6rem 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: "0.82rem", lineHeight: "1.6" }}>
              <span style={{ color: "#9CA3AF", fontWeight: 500 }}>Telefone</span>
              <span>
                {(() => {
                  const phone = order.customerPhone || "";
                  const idMatch = phone.match(/ID:\s*(\d+)/i);
                  const phoneNumber = phone.replace(/\s*ID:\s*\d+/i, "").trim();
                  return (
                    <>
                      <a href={`https://wa.me/55${phoneNumber.replace(/\D/g,'')}`} target="_blank" style={{ color: "#059669", fontWeight: 600, textDecoration: "none" }}>{phoneNumber}</a>
                      {idMatch && (
                        <span style={{ marginLeft: "8px", fontSize: "0.75rem", fontWeight: 600, color: "#6B7280" }}>
                          ID {idMatch[1]}
                        </span>
                      )}
                    </>
                  );
                })()}
              </span>
              {order.customerAddress && (
                <>
                  <span style={{ color: "#9CA3AF", fontWeight: 500 }}>Endereço</span>
                  <span style={{ fontWeight: 500, color: "#1F2937" }}>{order.customerAddress}</span>
                </>
              )}
            </div>

            {/* ── Pagamento e detalhes ── */}
            <div style={{ margin: "0.4rem 0", padding: "10px 14px", background: "#F9FAFB", borderRadius: "8px", border: "1px solid #E5E7EB" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: "0.8rem" }}>
                {order.paymentMethod && (() => {
                  const method = translatePayment(order.paymentMethod);
                  const isDinheiro = method === "Dinheiro";
                  const isPaidOnline = !isDinheiro && (
                    order.paymentPaidAt ||
                    order.source === "IFOOD" ||
                    order.source === "JOTAJA" ||
                    order.gatewayProvider
                  );
                  return (
                    <>
                      <div>
                        <span style={{ color: "#9CA3AF", fontSize: "0.72rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Pagamento</span>
                        <div style={{ fontWeight: 600, color: "#1F2937", marginTop: "1px" }}>{method}</div>
                      </div>
                      <div>
                        <span style={{ color: "#9CA3AF", fontSize: "0.72rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</span>
                        <div style={{ fontWeight: 600, color: isPaidOnline ? "#059669" : "#D97706", marginTop: "1px" }}>
                          {isPaidOnline ? "Pago online" : "Pagar na entrega"}
                        </div>
                      </div>
                    </>
                  );
                })()}
                {order.changeAmount != null && order.changeAmount > 0 && (() => {
                  const changeFor = Number(order.changeAmount);
                  const orderTotal = Number(order.totalAmount) + Number(order.deliveryFee || 0);
                  const toSeparate = changeFor - orderTotal;
                  return (
                    <div>
                      <span style={{ color: "#92400E", fontSize: "0.72rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>💵 Troco para</span>
                      <div style={{ fontWeight: 600, color: "#78350F", marginTop: "1px" }}>R$ {changeFor.toFixed(2)}</div>
                      {toSeparate > 0 && (
                        <div style={{ fontWeight: 700, color: "#92400E", fontSize: "0.82rem", marginTop: "2px" }}>Separe R$ {toSeparate.toFixed(2)}</div>
                      )}
                    </div>
                  );
                })()}
                {order.customerCpfCnpj && (
                  <div style={{ overflow: "hidden" }}>
                    <span style={{ color: "#1E40AF", fontSize: "0.72rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>📋 CPF/CNPJ na nota</span>
                    <div style={{ fontWeight: 600, color: "#1E3A5F", marginTop: "1px", fontSize: "0.8rem", wordBreak: "break-all" }}>{order.customerCpfCnpj}</div>
                  </div>
                )}
                {order.deliveryType === "DELIVERY" && (
                  <div>
                    <span style={{ color: "#9CA3AF", fontSize: "0.72rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Taxa de entrega</span>
                    <div style={{ fontWeight: 600, color: order.deliveryFee > 0 ? "#1F2937" : "#059669", marginTop: "1px" }}>
                      {order.deliveryFee > 0 ? `R$ ${Number(order.deliveryFee).toFixed(2)}` : "Grátis"}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Descontos ── */}
            {order.discountTotal > 0 && (
              <div style={{ margin: "0.4rem 0", padding: "10px 14px", background: "#F9FAFB", borderRadius: "8px", border: "1px solid #E5E7EB" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ color: "#9CA3AF", fontSize: "0.72rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>Desconto total</span>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1F2937" }}>
                    − R$ {Number(order.discountTotal).toFixed(2)}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "16px", fontSize: "0.78rem" }}>
                  {(order.discountIfood ?? 0) > 0 && (
                    <span style={{ color: "#6B7280" }}>
                      iFood: <strong style={{ color: "#059669" }}>R$ {Number(order.discountIfood).toFixed(2)}</strong>
                    </span>
                  )}
                  {(order.discountMerchant ?? 0) > 0 && (
                    <span style={{ color: "#6B7280" }}>
                      Loja: <strong style={{ color: "#DC2626" }}>R$ {Number(order.discountMerchant).toFixed(2)}</strong>
                    </span>
                  )}
                  {(order.discountIfood ?? 0) === 0 && (order.discountMerchant ?? 0) === 0 && (
                    <span style={{ color: "#059669", fontWeight: 500 }}>Subsidiado pelo iFood</span>
                  )}
                </div>
                {Array.isArray(order.discountDetails) && order.discountDetails.length > 0 && (
                  <div style={{ marginTop: "4px", fontSize: "0.72rem", color: "#9CA3AF" }}>
                    {order.discountDetails.map((d: any, i: number) => (
                      <div key={i}>
                        {d.target === "DELIVERY_FEE" ? "Taxa de entrega" : "Carrinho"}: R$ {Number(d.value).toFixed(2)}
                        {d.description ? ` — ${d.description}` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Motoboy ── */}
            {order.deliveryType === "DELIVERY" && (
              <div style={{ margin: "0.4rem 0", padding: "10px 14px", background: "#F9FAFB", borderRadius: "8px", border: "1px solid #E5E7EB" }}>
                <span style={{ color: "#9CA3AF", fontSize: "0.72rem", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "4px" }}>Entrega</span>

                {/* === MOTOBOY IFOOD TRACKING === */}
                {order.ifoodDriverStatus && order.ifoodDriverStatus !== "FAILED" ? (
                  <div style={{ background: "#EFF6FF", borderRadius: "8px", padding: "10px 12px", border: "1px solid #BFDBFE" }}>
                    {/* Driver info */}
                    {order.ifoodDriverName && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#3B82F6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.8rem", flexShrink: 0 }}>
                          {order.ifoodDriverName?.charAt(0)?.toUpperCase() || "?"}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1E3A5F" }}>{order.ifoodDriverName}</div>
                          <div style={{ fontSize: "0.72rem", color: "#6B7280" }}>
                            {order.ifoodDriverPhone && <span>{order.ifoodDriverPhone} · </span>}
                            {order.ifoodDriverVehicle === "MOTORCYCLE" ? "🏍️ Moto" : order.ifoodDriverVehicle === "BICYCLE" ? "🚲 Bicicleta" : order.ifoodDriverVehicle === "CAR" ? "🚗 Carro" : "🛵 iFood"}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Timeline */}
                    {(() => {
                      const steps = [
                        { key: "REQUESTED", label: "Solicitado", emoji: "📤" },
                        { key: "ASSIGNED", label: "Motoboy atribuído", emoji: "👤" },
                        { key: "GOING_TO_ORIGIN", label: "A caminho da loja", emoji: "🏃" },
                        { key: "ARRIVED_AT_ORIGIN", label: "Chegou na loja", emoji: "📍" },
                        { key: "COLLECTED", label: "Coletou pedido", emoji: "📦" },
                        { key: "DISPATCHED", label: "Saiu para entrega", emoji: "🛵" },
                        { key: "ARRIVED_AT_DESTINATION", label: "Chegou no destino", emoji: "🏠" },
                        { key: "DELIVERED", label: "Entregue", emoji: "✅" },
                      ];
                      const currentIdx = steps.findIndex(s => s.key === order.ifoodDriverStatus);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "4px" }}>
                          {steps.map((step, i) => {
                            const isDone = i < currentIdx;
                            const isCurrent = i === currentIdx;
                            const isFuture = i > currentIdx;
                            return (
                              <div key={step.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 0" }}>
                                <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${isDone ? "#059669" : isCurrent ? "#3B82F6" : "#D1D5DB"}`, background: isDone ? "#059669" : isCurrent ? "#3B82F6" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                  {isDone && <span style={{ color: "#fff", fontSize: "0.55rem", fontWeight: 900 }}>✓</span>}
                                  {isCurrent && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                                </div>
                                <span style={{ fontSize: "0.78rem", fontWeight: isCurrent ? 700 : 400, color: isFuture ? "#9CA3AF" : isCurrent ? "#1D4ED8" : "#374151" }}>
                                  {step.emoji} {step.label} {isCurrent && "← agora"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {/* ETA + Cancel */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", paddingTop: "6px", borderTop: "1px solid #BFDBFE" }}>
                      {order.ifoodDeliveryEta && (
                        <span style={{ fontSize: "0.75rem", color: "#1D4ED8", fontWeight: 600 }}>
                          ⏱️ Previsão: {new Date(order.ifoodDeliveryEta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                      {order.ifoodDriverStatus === "REQUESTED" && (
                        <button onClick={e => { e.stopPropagation(); cancelIfoodDriver(order.id); }} style={{ padding: "4px 10px", background: "#FEE2E2", color: "#DC2626", border: "1px solid #FECACA", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>❌ Cancelar</button>
                      )}
                    </div>
                  </div>
                ) : order.ifoodDriverStatus === "FAILED" ? (
                  <div style={{ background: "#FEF2F2", borderRadius: "8px", padding: "10px 12px", border: "1px solid #FECACA", marginBottom: "6px" }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#DC2626" }}>❌ Nenhum motoboy iFood disponível</div>
                    <div style={{ fontSize: "0.75rem", color: "#6B7280", marginTop: "2px" }}>Tente novamente ou selecione um motoboy próprio abaixo.</div>
                  </div>
                ) : null}

                {/* Botão Chamar Motoboy iFood (se pedido iFood, sem driver solicitado) */}
                {order.source === "IFOOD" && order.ifoodOrderId && !order.ifoodDriverStatus && order.status !== "ENCERRADO" && order.status !== "CANCELADO" && order.status !== "ENTREGUE" && (
                  <button
                    onClick={e => { e.stopPropagation(); fetchIfoodDriverQuote(order.id); }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", width: "100%", padding: "8px", background: "linear-gradient(135deg, #3B82F6, #1D4ED8)", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", marginBottom: "6px" }}
                  >
                    🛵 Chamar Motoboy iFood
                  </button>
                )}

                {/* Motoboy próprio (select) */}
                {(order.status === "ENCERRADO" || order.status === "CANCELADO") ? (
                  <div style={{ fontSize: "0.82rem", fontWeight: 500, color: "#1F2937" }}>
                    {order.motoboy ? (
                      <span>{order.motoboy.name} {order.motoboy.phone ? `· ${order.motoboy.phone}` : ""}</span>
                    ) : !order.ifoodDriverName ? (
                      <span style={{ color: "#9CA3AF" }}>Não atribuído</span>
                    ) : null}
                  </div>
                ) : !order.ifoodDriverStatus || order.ifoodDriverStatus === "FAILED" ? (
                  <>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <select
                        value={order.motoboyId || ""}
                        onChange={e => assignMotoboy(order.id, e.target.value)}
                        disabled={assigningId === order.id}
                        style={{ flex: 1, padding: "6px 10px", borderRadius: "6px", border: "1px solid #D1D5DB", fontSize: "0.82rem", outline: "none", background: "white", fontFamily: "inherit", color: "#374151" }}
                      >
                        <option value="">— Motoboy próprio —</option>
                        {motoboys.map((m: any) => (
                          <option key={m.id} value={m.id}>{m.name}{m.phone ? ` · ${m.phone}` : ""}</option>
                        ))}
                      </select>
                      {order.motoboy && (
                        <a
                          href={`https://wa.me/55${(order.motoboy.phone || "").replace(/\D/g, "")}`}
                          target="_blank" rel="noopener noreferrer"
                          title={`WhatsApp ${order.motoboy.name}`}
                          style={{ padding: "6px 10px", background: "#059669", color: "white", borderRadius: "6px", textDecoration: "none", fontSize: "0.78rem", fontWeight: 600 }}
                        >WhatsApp</a>
                      )}
                    </div>
                    {order.motoboy && (
                      <div style={{ fontSize: "0.72rem", color: "#6B7280", marginTop: "3px" }}>{order.motoboy.name} atribuído</div>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {/* ── Observações ── */}
            {order.notes && <div style={{ padding: "8px 12px", background: "#F9FAFB", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "0.8rem", color: "#374151", margin: "0.4rem 0", lineHeight: "1.5" }}>{order.notes}</div>}

            {/* ── Itens do pedido (detailed with sub-options) ── */}
            <div style={{ fontSize: "0.82rem", margin: "0.5rem 0", borderTop: "1px solid #E5E7EB", paddingTop: "0.5rem" }}>
              {order.items?.map((item: any) => {
                const comboSels = (() => {
                  if (!item.comboSelections) return [];
                  try {
                    const parsed = typeof item.comboSelections === "string" ? JSON.parse(item.comboSelections) : item.comboSelections;
                    if (Array.isArray(parsed)) return parsed.filter((s: any) => s.name);
                    return [];
                  } catch { return []; }
                })();
                const nameParts = (item.menuProduct?.name || "Item").split(" | ");
                const mainName = nameParts[0];
                const extras = nameParts.slice(1);
                return (
                  <div key={item.id} style={{ padding: "4px 0", borderBottom: "1px solid #F3F4F6" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#374151", fontWeight: 600 }}>{item.quantity}× {mainName}</span>
                      <span style={{ fontWeight: 600, color: "#1F2937" }}>R$ {(item.price * item.quantity).toFixed(2)}</span>
                    </div>
                    {comboSels.length > 0 && (
                      <div style={{ paddingLeft: "16px", fontSize: "0.75rem", color: "#6B7280", lineHeight: "1.5" }}>
                        {comboSels.map((sel: any, i: number) => (
                          <div key={i}>↳ {sel.quantity > 1 ? `${sel.quantity}x ` : ""}{sel.name}</div>
                        ))}
                      </div>
                    )}
                    {comboSels.length === 0 && extras.length > 0 && (
                      <div style={{ paddingLeft: "16px", fontSize: "0.75rem", color: "#6B7280", lineHeight: "1.5" }}>
                        {extras.map((ext: string, i: number) => (
                          <div key={i}>↳ {ext.trim()}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Botões de ação (expanded - full width) ── */}
            {order.status !== "CANCELADO" && order.status !== "ENCERRADO" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}>
                {/* Primary action row */}
                {order.status === "NOVO" && (
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button disabled={isLoading} onClick={() => updateStatus(order.id, "ACEITO")} style={{ flex: 1, padding: "0.6rem 1rem", borderRadius: "8px", border: "none", background: "#059669", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit", letterSpacing: "0.02em" }}>Aceitar pedido</button>
                    <button disabled={isLoading} onClick={async () => {
                      if (!confirm("Recusar este pedido?")) return;
                      if ((order as any).openDeliveryOrderId && (order as any).source === "JOTAJA") {
                        await fetch("/api/customer-order/jotaja-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: (order as any).openDeliveryOrderId, action: "deny" }) });
                        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "CANCELADO", cancelledBy: "LOJA" } : o));
                      } else {
                        updateStatus(order.id, "CANCELADO");
                      }
                    }} style={{ padding: "0.6rem 0.75rem", borderRadius: "8px", border: "1px solid #D1D5DB", background: "#fff", color: "#6B7280", fontWeight: 500, cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>Recusar</button>
                  </div>
                )}
                {order.status === "ACEITO" && (
                  <button disabled={isLoading} onClick={() => updateStatus(order.id, "PREPARANDO")} style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "none", background: "#D97706", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>Iniciar preparo</button>
                )}
                {order.status === "PREPARANDO" && order.deliveryType === "DELIVERY" && (
                  <button disabled={isLoading} onClick={() => updateStatus(order.id, "SAIU_ENTREGA")} style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "none", background: "#7C3AED", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>Saiu para entrega</button>
                )}
                {order.status === "PREPARANDO" && order.deliveryType !== "DELIVERY" && (
                  <button disabled={isLoading} onClick={() => updateStatus(order.id, "PRONTO")} style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "none", background: "#0891B2", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>✅ Pronto para retirada</button>
                )}
                {(order.status as string) === "PRONTO" && (
                  <button disabled={isLoading} onClick={() => updateStatus(order.id, "ENTREGUE")} style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "none", background: "#059669", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>🤝 Cliente retirou</button>
                )}

                {order.status === "SAIU_ENTREGA" && (
                  <button disabled={isLoading} onClick={() => updateStatus(order.id, "ENTREGUE")} style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "none", background: "#059669", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>Marcar entregue</button>
                )}
                {/* Encerrar — above cancel */}
                {order.status === "ENTREGUE" && (
                  <button disabled={isLoading} onClick={() => updateStatus(order.id, "ENCERRADO")} style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", border: "1px solid #D1D5DB", background: "#F9FAFB", color: "#6B7280", fontWeight: 500, cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>Encerrar pedido</button>
                )}
                {/* Cancel — big red button at bottom, opens popup */}
                {order.status !== "NOVO" && (
                  <button disabled={isLoading} onClick={() => { setCancelConfirmId(order.id); setCancelReason(""); }} style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", border: "none", background: "#DC2626", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit", letterSpacing: "0.02em", marginTop: "0.2rem" }}>Cancelar pedido</button>
                )}
              </div>
            )}
            {order.status === "CANCELADO" && (
              <button disabled={isLoading} onClick={() => updateStatus(order.id, "ENCERRADO")} style={{ width: "100%", marginTop: "4px", padding: "0.4rem", borderRadius: "8px", border: "1px solid #D1D5DB", background: "#F9FAFB", color: "#6B7280", fontWeight: 500, cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>Encerrar pedido</button>
            )}
          </div>
        )}
      </div>
    );
  };

  // Scroll position refs — persists scroll across re-renders
  const scrollRefs = useRef<Record<string, number>>({});

  const Column = ({ columnId, title, emoji, color, count, children, headerExtra }: { columnId: string; title: string; emoji: string; color: string; count: number; children: React.ReactNode; headerExtra?: React.ReactNode }) => {

    const canDrop = columnId !== "col-novos";
    const isOver = canDrop && dragOverColumn === columnId;
    const scrollRef = useRef<HTMLDivElement>(null);

    // Restore scroll position after render
    useEffect(() => {
      const el = scrollRef.current;
      if (el && scrollRefs.current[columnId] != null) {
        el.scrollTop = scrollRefs.current[columnId];
      }
    });

    const handleScroll = () => {
      if (scrollRef.current) {
        scrollRefs.current[columnId] = scrollRef.current.scrollTop;
      }
    };

    return (
      <div
        data-droppable={columnId}
        onDragOver={canDrop ? (e => handleDragOver(e, columnId)) : undefined}
        onDragLeave={canDrop ? handleDragLeave : undefined}
        onDrop={canDrop ? (e => handleDrop(e, columnId)) : undefined}
        style={{
          flex: 1, minWidth: "360px",
          background: isOver ? "#E0F2FE" : "#FAFAFA",
          borderRadius: "14px",
          border: isOver ? "2px dashed #3B82F6" : "1px solid #E2E8F0",
          display: "flex", flexDirection: "column",
          minHeight: "calc(100vh - 175px)", maxHeight: "calc(100vh - 175px)",
        }}
      >
        <div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", borderRadius: "14px 14px 0 0", gap: "0.5rem" }}>
          <h3 style={{ fontWeight: 700, fontSize: "1.05rem", margin: 0 }}>{emoji} {title}</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {headerExtra}
            <span style={{ background: color, color: "#fff", borderRadius: "20px", padding: "3px 12px", fontSize: "0.85rem", fontWeight: 700, minWidth: "28px", textAlign: "center" }}>{count}</span>
          </div>
        </div>
        <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>
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
      {/* MODAL CANCELAR PEDIDO */}
      {cancelConfirmId && (
        <div onClick={() => { setCancelConfirmId(null); setCancelReason(""); setSelectedCancelCode(""); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "400px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ textAlign: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "2rem", marginBottom: "8px" }}>⚠️</div>
              <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#1F2937" }}>Tem certeza que deseja cancelar esse pedido?</div>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Selecione o motivo do cancelamento:</label>
              {loadingReasons ? (
                <div style={{ fontSize: "0.82rem", color: "#6B7280", padding: "6px 0" }}>Carregando motivos do iFood...</div>
              ) : cancellationReasons.length > 0 ? (
                <select
                  value={selectedCancelCode}
                  onChange={e => {
                    const code = e.target.value;
                    setSelectedCancelCode(code);
                    const desc = cancellationReasons.find(r => r.cancelCodeId === code)?.description || "";
                    setCancelReason(desc);
                  }}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "0.85rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "#fff", color: "#1F2937", marginBottom: "12px" }}
                >
                  {cancellationReasons.map(r => (
                    <option key={r.cancelCodeId} value={r.cancelCodeId}>
                      [{r.cancelCodeId}] {r.description}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: "0.82rem", color: "#EF4444", padding: "6px 0" }}>Usando motivos padrão do sistema.</div>
              )}

              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Detalhes do motivo (opcional):</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Ex: Cliente desistiu, item indisponível..."
                autoFocus
                style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "0.85rem", fontFamily: "inherit", resize: "vertical", minHeight: "80px", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={() => { setCancelConfirmId(null); setCancelReason(""); setSelectedCancelCode(""); }} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #D1D5DB", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>Não</button>
              <button onClick={confirmCancel} disabled={!!loadingId} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "none", background: "#DC2626", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>{loadingId ? "Cancelando..." : "Sim, cancelar"}</button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL MOTOBOY IFOOD — Cotação + Confirmação */}
      {ifoodDriverModalId && (() => {
        const driverOrder = orders.find(o => o.id === ifoodDriverModalId);
        return (
          <div onClick={() => { setIfoodDriverModalId(null); setIfoodDriverQuote(null); setIfoodDriverError(""); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "400px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ textAlign: "center", marginBottom: "16px" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>🛵</div>
                <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#1D4ED8" }}>Solicitar Motoboy iFood</div>
              </div>

              {/* Order info */}
              {driverOrder && (
                <div style={{ background: "#F8FAFC", borderRadius: "8px", padding: "10px 14px", marginBottom: "12px", fontSize: "0.82rem" }}>
                  <div><strong>Pedido:</strong> #{driverOrder.ifoodReference || driverOrder.openDeliveryReference || driverOrder.id.slice(-6).toUpperCase()}</div>
                  {driverOrder.customerAddress && <div style={{ color: "#6B7280", marginTop: "2px" }}>{driverOrder.customerAddress}</div>}
                </div>
              )}

              {/* Loading */}
              {ifoodDriverLoading && !ifoodDriverQuote && (
                <div style={{ textAlign: "center", padding: "20px", color: "#6B7280" }}>
                  <div style={{ fontSize: "1.5rem", marginBottom: "8px" }}>⏳</div>
                  Consultando disponibilidade...
                </div>
              )}

              {/* Error */}
              {ifoodDriverError && (
                <div style={{ background: "#FEF2F2", borderRadius: "8px", padding: "12px", marginBottom: "12px", border: "1px solid #FECACA" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#DC2626" }}>❌ {ifoodDriverError}</div>
                </div>
              )}

              {/* Quote */}
              {ifoodDriverQuote && (
                <div style={{ background: "#EFF6FF", borderRadius: "12px", padding: "16px", marginBottom: "16px", border: "2px solid #BFDBFE" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Custo</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#1D4ED8" }}>R$ {Number(ifoodDriverQuote.price).toFixed(2).replace('.', ',')}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Tempo estimado</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#059669" }}>~{ifoodDriverQuote.estimatedMinutes ?? "?"}min</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#6B7280", borderTop: "1px solid #BFDBFE", paddingTop: "6px" }}>
                    ⚠️ O valor será cobrado pela plataforma iFood.
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => { setIfoodDriverModalId(null); setIfoodDriverQuote(null); setIfoodDriverError(""); }} style={{ flex: 1, padding: "0.65rem", borderRadius: "8px", border: "1px solid #D1D5DB", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>Cancelar</button>
                {ifoodDriverQuote && (
                  <button onClick={requestIfoodDriver} disabled={ifoodDriverLoading} style={{ flex: 1, padding: "0.65rem", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #3B82F6, #1D4ED8)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>
                    {ifoodDriverLoading ? "Solicitando..." : "✅ Confirmar e Chamar"}
                  </button>
                )}
                {ifoodDriverError && !ifoodDriverQuote && (
                  <button onClick={() => fetchIfoodDriverQuote(ifoodDriverModalId)} style={{ flex: 1, padding: "0.65rem", borderRadius: "8px", border: "none", background: "#3B82F6", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>
                    🔄 Tentar novamente
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {/* MODAL NEGOCIAÇÃO DE CANCELAMENTO (iFood) */}
      {(() => {
        const disputeOrder = orders.find((o: any) => o.cancelDispute?.pending === true);
        if (!disputeOrder) return null;
        const dispute = (disputeOrder as any).cancelDispute;
        const orderNum = orderNumberMap.get(disputeOrder.id) || "?";
        const expiresAt = dispute.expiresAt ? new Date(dispute.expiresAt) : null;
        const timeLeft = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) : null;
        const timeLeftStr = timeLeft != null ? `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}` : null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10002, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "440px", boxShadow: "0 25px 60px rgba(0,0,0,0.35)", border: "3px solid #F59E0B" }}>
              <div style={{ textAlign: "center", marginBottom: "16px" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>⚠️</div>
                <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#92400E" }}>Pedido #{orderNum} em negociação</div>
                <div style={{ fontSize: "0.82rem", color: "#6B7280", marginTop: "4px" }}>O cliente solicitou o cancelamento {(disputeOrder as any).source === "JOTAJA" ? "pelo JotaJá" : "pelo iFood"}</div>
                {timeLeftStr && (
                  <div style={{ marginTop: "8px", padding: "4px 12px", display: "inline-block", background: timeLeft! < 60 ? "#FEE2E2" : "#FEF3C7", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 700, color: timeLeft! < 60 ? "#DC2626" : "#92400E" }}>
                    ⏱ Tempo restante: {timeLeftStr}
                  </div>
                )}
              </div>
              <div style={{ background: "#FEF3C7", borderRadius: "10px", padding: "14px", marginBottom: "16px", border: "1px solid #FDE68A" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#92400E", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Motivo do cliente:</div>
                <div style={{ fontSize: "0.95rem", color: "#78350F", fontWeight: 600 }}>"{dispute.reason || "Não informado"}"</div>
                {dispute.requestedAt && (
                  <div style={{ fontSize: "0.72rem", color: "#A16207", marginTop: "6px" }}>
                    Solicitado às {new Date(dispute.requestedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
              <div style={{ background: "#F9FAFB", borderRadius: "8px", padding: "10px", marginBottom: "16px", fontSize: "0.8rem", color: "#4B5563" }}>
                <strong>Cliente:</strong> {disputeOrder.customerName} — {disputeOrder.customerPhone}<br/>
                <strong>Valor:</strong> R$ {disputeOrder.totalAmount?.toFixed(2)}<br/>
                {(disputeOrder.ifoodReference || disputeOrder.openDeliveryReference) && <><strong>{disputeOrder.openDeliveryReference ? "Jotajá" : "iFood"}:</strong> #{disputeOrder.ifoodReference || disputeOrder.openDeliveryReference}</>}
              </div>
              {/* Campo de motivo para recusa */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: "6px" }}>Sua resposta ao cliente (obrigatório para recusar):</label>
                <textarea
                  id="dispute-deny-reason"
                  placeholder="Ex: O pedido já está em preparo e sairá em breve..."
                  rows={3}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "0.85rem", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <button
                  disabled={!!loadingId}
                  onClick={async () => {
                    const reasonEl = document.getElementById("dispute-deny-reason") as HTMLTextAreaElement;
                    const reason = reasonEl?.value?.trim();
                    if (!reason) { showToast("Por favor, informe o motivo da recusa.", "#EF4444"); reasonEl?.focus(); return; }
                    setLoadingId(disputeOrder.id);
                    try {
                      let r: Response;
                      if ((disputeOrder as any).source === "JOTAJA" && (disputeOrder as any).openDeliveryOrderId) {
                        r = await fetch("/api/customer-order/jotaja-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: (disputeOrder as any).openDeliveryOrderId, action: "deny_cancellation", reason }) });
                      } else {
                        r = await fetch("/api/customer-order/dispute", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: disputeOrder.id, action: "deny", denyReason: reason }) });
                      }
                      if (r.ok) { setOrders(prev => prev.map(o => o.id === disputeOrder.id ? { ...o, cancelDispute: { ...dispute, pending: false } } : o)); router.refresh(); }
                    } catch {} finally { setLoadingId(null); }
                  }}
                  style={{ width: "100%", padding: "0.75rem", borderRadius: "8px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.92rem", fontFamily: "inherit" }}
                >
                  {loadingId === disputeOrder.id ? "..." : "✋ Recusar cancelamento — manter pedido"}
                </button>
                <button
                  disabled={!!loadingId}
                  onClick={async () => {
                    if (!confirm("Tem certeza que deseja ACEITAR o cancelamento? O pedido será cancelado.")) return;
                    setLoadingId(disputeOrder.id);
                    try {
                      let r: Response;
                      if ((disputeOrder as any).source === "JOTAJA" && (disputeOrder as any).openDeliveryOrderId) {
                        r = await fetch("/api/customer-order/jotaja-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: (disputeOrder as any).openDeliveryOrderId, action: "accept_cancellation" }) });
                      } else {
                        r = await fetch("/api/customer-order/dispute", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: disputeOrder.id, action: "accept" }) });
                      }
                      if (r.ok) { setOrders(prev => prev.map(o => o.id === disputeOrder.id ? { ...o, status: "CANCELADO", cancelledBy: "LOJA", cancelDispute: { ...dispute, pending: false } } : o)); router.refresh(); }
                    } catch {} finally { setLoadingId(null); }
                  }}
                  style={{ width: "100%", padding: "0.75rem", borderRadius: "8px", border: "none", background: "#DC2626", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.92rem", fontFamily: "inherit" }}
                >
                  {loadingId === disputeOrder.id ? "..." : "✅ Aceitar cancelamento"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
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
                    ⚠️ O cliente paga R${adExtraFee.toFixed(2)} a mais na taxa de entrega durante o período ativo
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
                  <div style={{ color: "#64748B" }}>+{log.extraMinutes}min de preparo · +R${log.extraFee?.toFixed(2)} taxa de entrega · Duração: {log.duration}min</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL AGENDAMENTOS ===== */}
      {showAgendamentos && (
        <div onClick={() => setShowAgendamentos(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "32px", width: "520px", maxWidth: "95vw", maxHeight: "85vh", boxShadow: "0 30px 80px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{ width: 44, height: 44, borderRadius: "12px", background: "linear-gradient(135deg,#8B5CF6,#6366F1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CalendarClock size={22} color="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.15rem", margin: 0 }}>📅 Pedidos Agendados</h3>
                <p style={{ fontSize: "0.78rem", color: "#64748B", margin: 0 }}>{scheduledOrders.length} pedido{scheduledOrders.length !== 1 ? "s" : ""} agendado{scheduledOrders.length !== 1 ? "s" : ""} para os próximos dias</p>
              </div>
              <button onClick={() => setShowAgendamentos(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.4rem", color: "#94A3B8", lineHeight: 1 }}>×</button>
            </div>

            {/* Configuração de antecedência */}
            <div style={{ marginBottom: "16px", padding: "14px", background: "#F5F3FF", borderRadius: "12px", border: "1px solid #DDD6FE" }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#6D28D9", display: "block", marginBottom: "8px" }}>
                ⏰ Quantas horas antes do horário agendado você quer que o pedido vá para Novos Pedidos?
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  {[0.5, 1, 1.5, 2, 3].map(h => (
                    <button key={h} onClick={() => { setScheduleLeadHours(h); localStorage.setItem("scheduleLeadHours", String(h)); }}
                      style={{ padding: "6px 14px", borderRadius: "8px", border: `2px solid ${scheduleLeadHours === h ? "#7C3AED" : "#E2E8F0"}`, background: scheduleLeadHours === h ? "#EDE9FE" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", color: scheduleLeadHours === h ? "#7C3AED" : "#64748B", fontFamily: "inherit" }}>
                      {h === 0.5 ? "30min" : `${h}h`}
                    </button>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: "0.72rem", color: "#8B5CF6", margin: "8px 0 0" }}>
                ✅ Configurado: pedidos entram em Novos Pedidos <strong>{scheduleLeadHours === 0.5 ? "30 minutos" : `${scheduleLeadHours} hora${scheduleLeadHours > 1 ? "s" : ""}`}</strong> antes do horário agendado.
              </p>
            </div>

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
              {scheduledOrders.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
                  <CalendarClock size={48} style={{ opacity: 0.2, marginBottom: "12px" }} />
                  <p style={{ fontSize: "0.95rem", fontWeight: 600 }}>Nenhum pedido agendado</p>
                  <p style={{ fontSize: "0.8rem" }}>Pedidos agendados para os próximos dias aparecerão aqui</p>
                </div>
              ) : (
                scheduledOrders
                  .sort((a, b) => new Date(a.scheduledDatetime).getTime() - new Date(b.scheduledDatetime).getTime())
                  .map(order => {
                    const deadline = new Date(order.scheduledDatetime);
                    const dateStr = deadline.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
                    const timeStr = deadline.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    const isToday = deadline.toDateString() === now.toDateString();
                    const isTomorrow = deadline.toDateString() === new Date(now.getTime() + 86400000).toDateString();
                    const dayLabel = isToday ? "Hoje" : isTomorrow ? "Amanhã" : dateStr;

                    return (
                      <div key={order.id} style={{ padding: "16px", borderRadius: "14px", background: "linear-gradient(135deg,#F5F3FF,#EDE9FE)", border: "1.5px solid #C4B5FD" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                          <div>
                            <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#1E1B4B" }}>#{order.id.slice(-6).toUpperCase()}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                              <span style={{ fontSize: "0.82rem", color: "#64748B", display: "flex", alignItems: "center", gap: "4px" }}>
                                <User size={12} /> {order.customerName}
                              </span>
                            </div>
                          </div>
                          <span style={{ fontWeight: 800, fontSize: "1rem", color: "#7C3AED" }}>R$ {order.totalAmount.toFixed(2)}</span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px 12px", background: "#fff", borderRadius: "10px", border: "1px solid #DDD6FE" }}>
                          <span style={{ fontSize: "1.3rem" }}>📅</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#6D28D9" }}>{dayLabel}</div>
                            <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "#7C3AED" }}>🕐 {timeStr}</div>
                          </div>
                          <span style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: "20px", background: isToday ? "#FEF3C7" : "#E0E7FF", fontSize: "0.72rem", fontWeight: 700, color: isToday ? "#B45309" : "#4338CA" }}>
                            {isToday ? "📢 Hoje" : isTomorrow ? "📆 Amanhã" : "📆 Futuro"}
                          </span>
                        </div>

                        {order.items && order.items.length > 0 && (
                          <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "10px", padding: "6px 10px", background: "rgba(255,255,255,0.6)", borderRadius: "8px" }}>
                            {order.items.slice(0, 3).map((item: any, i: number) => (
                              <div key={i}>{item.quantity}x {item.menuProduct?.name}</div>
                            ))}
                            {order.items.length > 3 && <div style={{ color: "#A78BFA" }}>+{order.items.length - 3} itens...</div>}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: "6px" }}>
                          <span style={{ padding: "3px 10px", borderRadius: "20px", background: "#F1F5F9", fontSize: "0.75rem", fontWeight: 600, color: "#475569" }}>
                            {order.deliveryType === "DELIVERY" ? "🛵 Entrega" : "🏪 Retirada"}
                          </span>
                          {order.paymentMethod && (() => {
                            const method = translatePayment(order.paymentMethod);
                            const isDinheiro = method === "Dinheiro";
                            const isPaidOnline = !isDinheiro && (order.paymentPaidAt || order.source === "IFOOD" || order.source === "JOTAJA" || order.gatewayProvider);
                            return (
                              <>
                                <span style={{ padding: "3px 10px", borderRadius: "20px", background: "#F1F5F9", fontSize: "0.75rem", fontWeight: 600, color: "#475569" }}>
                                  💳 Pagamento: {method}
                                </span>
                                <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700, background: isPaidOnline ? "#F0FDF4" : "#FFF7ED", border: `1px solid ${isPaidOnline ? "#BBF7D0" : "#FED7AA"}`, color: isPaidOnline ? "#15803D" : "#C2410C" }}>
                                  {isPaidOnline ? "✅ Pago Online" : "💰 Pagar na Entrega"}
                                </span>
                              </>
                            );
                          })()}
                        </div>

                        <button
                          onClick={async () => {
                            if (!confirm(`Antecipar pedido #${order.id.slice(-6).toUpperCase()} para agora?\n\nEle será movido para Novos Pedidos imediatamente.`)) return;
                            try {
                              const res = await fetch("/api/customer-order/status", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ orderId: order.id, status: "NOVO", scheduledDatetime: null })
                              });
                              if (res.ok) {
                                setOrders(prev => prev.map(o =>
                                  o.id === order.id ? { ...o, status: "NOVO", scheduledDatetime: null } : o
                                ));
                                setShowAgendamentos(false);
                              } else {
                                showToast("Erro ao antecipar pedido.", "#EF4444");
                              }
                            } catch {
                              showToast("Erro de conexão.", "#EF4444");
                            }
                          }}
                          style={{
                            width: "100%", marginTop: "12px", padding: "10px", borderRadius: "10px", border: "none",
                            background: "linear-gradient(135deg,#7C3AED,#6366F1)", color: "#fff",
                            fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                            fontFamily: "inherit", transition: "all 0.2s"
                          }}
                          onMouseEnter={e => { (e.target as HTMLElement).style.transform = "scale(1.02)"; (e.target as HTMLElement).style.boxShadow = "0 4px 16px rgba(124,58,237,0.35)"; }}
                          onMouseLeave={e => { (e.target as HTMLElement).style.transform = "scale(1)"; (e.target as HTMLElement).style.boxShadow = "none"; }}
                        >
                          ⚡ Antecipar agendamento
                        </button>
                      </div>
                    );
                  })
              )}
            </div>

            <button onClick={() => setShowAgendamentos(false)} style={{ marginTop: "20px", width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid #E2E8F0", background: "#F8FAFC", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>Fechar</button>
          </div>
        </div>
      )}

      {/* ===== BANNER ALTA DEMANDA ATIVO ===== */}
      {altaDemanda.active && (
        <div style={{ background: "linear-gradient(135deg,#EF4444,#F97316)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#fff" }}>
            <Zap size={18} />
            <span style={{ fontWeight: 800, fontSize: "0.92rem" }}>⚡ ALTA DEMANDA ATIVA</span>
            <span style={{ fontSize: "0.82rem", opacity: 0.9 }}>+{altaDemanda.extraMinutes}min preparo · +R${Number(altaDemanda.extraFee).toFixed(2)} taxa de entrega</span>
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
            <button
              onClick={() => setShowAgendamentos(true)}
              style={{
                padding: "6px 14px", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.8rem",
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px",
                background: scheduledOrders.length > 0 ? "linear-gradient(135deg,#8B5CF6,#6366F1)" : "#F5F3FF",
                color: scheduledOrders.length > 0 ? "#fff" : "#7C3AED",
                outline: scheduledOrders.length > 0 ? "none" : "1.5px solid #DDD6FE",
                position: "relative"
              }}
            >
              <CalendarClock size={14} /> Agendamentos
              <span style={{
                background: scheduledOrders.length > 0 ? "#fff" : "#7C3AED",
                color: scheduledOrders.length > 0 ? "#7C3AED" : "#fff",
                borderRadius: "50%", minWidth: "20px", height: "20px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.72rem", fontWeight: 800, marginLeft: "2px"
              }}>
                {scheduledOrders.length}
              </span>
            </button>
            <a
              href="/store/venda-presencial"
              style={{
                padding: "6px 14px", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.8rem",
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px",
                background: "#F0FDF4", color: "#16A34A", outline: "1.5px solid #BBF7D0",
                textDecoration: "none"
              }}
            >
              🛒 Pedidos Balcão
            </a>

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
      <div style={{ maxWidth: "100%", margin: "0 auto", padding: "0.75rem 1.25rem" }}>
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
          {cancelados.length > 0 && (
            <Column columnId="col-cancelados" title="Cancelados" emoji="🚫" color="#DC2626" count={cancelados.length}>
              {cancelados.map(o => <OrderCard key={o.id} order={o} />)}
            </Column>
          )}
        </div>
      </div>

      {/* TOAST NOTIFICATION */}
      {toastMsg && (
        <div style={{
          position: "fixed", bottom: "24px", right: "24px", zIndex: 99999,
          background: toastMsg.color, color: "#fff", padding: "12px 24px",
          borderRadius: "8px", fontWeight: 700, boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
          display: "flex", alignItems: "center", gap: "8px", transition: "all 0.3s ease",
          animation: "pulse 2s infinite"
        }}>
          {toastMsg.color === "#10B981" ? "✅" : "⚠️"} {toastMsg.text}
        </div>
      )}

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
