"use client";
import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  ShoppingCart,
  Plus,
  Minus,
  X,
  MapPin,
  Search,
  Clock,
  Store,
  Truck,
  User,
  LogIn,
  History,
  Star,
  Flame,
  Gift,
  Package,
  Sparkles,
  Tag,
  ArrowRight,
  Check,
  ChevronRight,
  Trash2,
  Edit3
} from "lucide-react";
import ComboModal from "./ComboModal";
import PaymentGateway from "./PaymentGateway";
import FacebookPixel, { trackPixelEvent } from "./FacebookPixel";
import FloatingContactWidget from "@/components/FloatingContactWidget";
import "./store.css";

type MenuProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  category: string;
  isCombo?: boolean;
  comboConfig?: any;
  comboGroups?: any[];
};

type CartItem = MenuProduct & {
  quantity: number;
  comboSelections?: any;
  notes?: string;
};

type Franchisee = {
  id: string;
  name: string;
  storeName: string | null;
  storePhone: string | null;
  storeAddress: string | null;
  storeBanner: string | null;
  storeLogo?: string | null;
  storeHours?: any;
  storeDeliveryOnly?: boolean;
  paymentFees?: any;
  deliveryZoneType?: string | null;
  deliveryZones?: any;
  city: string | null;
  slug: string | null;
  storeOpen?: boolean;
  storePause?: any;
  facebookPixelId?: string | null;
  ifoodMerchantId?: string | null;
  ifoodConnected?: boolean;
  ifoodWidgetId?: string | null;
  mpSellerId?: string | null;
  mpAccessToken?: string | null;
  hasOnlinePayment?: boolean;
};

type StoreRating = {
  average: number;
  count: number;
  reviews?: { rating: number; comment: string; customerName: string; createdAt: string }[];
};

function isStoreOpen(hours: any[]): { open: boolean; text: string } {
  if (!hours || !Array.isArray(hours)) return { open: true, text: "Horário não definido" };
  const now = new Date();
  const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const today = hours[dayIdx];
  if (!today || !today.active) return { open: false, text: "Fechado hoje" };
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (Array.isArray(today.shifts) && today.shifts.length > 0) {
    const activeShifts = today.shifts.filter((s: any) => s.open && s.close && s.active !== false);
    for (const shift of activeShifts) {
      const [oh, om] = (shift.open || "").split(":").map(Number);
      const [ch, cm] = (shift.close || "").split(":").map(Number);
      if (nowMin >= oh * 60 + om && nowMin <= ch * 60 + cm) return { open: true, text: `Aberto até as ${shift.close}` };
    }
    const nextShift = activeShifts.find((s: any) => {
      const [oh, om] = (s.open || "").split(":").map(Number);
      return nowMin < oh * 60 + om;
    });
    if (nextShift) return { open: false, text: `Abre às ${nextShift.open}` };
    return { open: false, text: "Fechado · Abre amanhã" };
  }

  if (today.open && today.close) {
    const [oh, om] = today.open.split(":").map(Number);
    const [ch, cm] = today.close.split(":").map(Number);
    if (nowMin >= oh * 60 + om && nowMin <= ch * 60 + cm) return { open: true, text: `Aberto até as ${today.close}` };
    return { open: false, text: `Abre às ${today.open}` };
  }
  return { open: true, text: "Aberto" };
}

export default function CustomerStorePage({
  franchisee,
  menuProducts,
  storeRating
}: {
  franchisee: Franchisee;
  menuProducts: MenuProduct[];
  storeRating?: StoreRating;
}) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCheckout, setIsCheckout] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [comboProduct, setComboProduct] = useState<MenuProduct | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [deliveryType, setDeliveryType] = useState("DELIVERY");

  const hasOnlinePayment = franchisee.hasOnlinePayment !== false;
  const [paymentMethod, setPaymentMethod] = useState(() => (hasOnlinePayment ? "PIX" : "DINHEIRO"));

  const [notes, setNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number; isFreeShipping?: boolean } | null>(null);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Modais especiais de alto engajamento
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [showPromotionsModal, setShowPromotionsModal] = useState(false);
  const [showMyOrdersModal, setShowMyOrdersModal] = useState(false);
  const [showBairroCalcModal, setShowBairroCalcModal] = useState(false);

  // Busca rápida de pedidos
  const [myOrdersPhone, setMyOrdersPhone] = useState("");
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);
  const [myOrdersList, setMyOrdersList] = useState<any[]>([]);
  const [myOrdersSearched, setMyOrdersSearched] = useState(false);

  // Customer login
  const [customer, setCustomer] = useState<any>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // Delivery fee
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryAvailable, setDeliveryAvailable] = useState(true);
  const [customerNeighborhood, setCustomerNeighborhood] = useState("");

  // Rating
  const [showRating, setShowRating] = useState(false);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingOrderId, setRatingOrderId] = useState<string | null>(null);

  // Pagamento Online
  const [showPayment, setShowPayment] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState(0);

  const storeName = franchisee.storeName || franchisee.name;
  const storeStatus = isStoreOpen(franchisee.storeHours as any);

  // Verificar pausa programada
  const isPaused = (() => {
    const p = franchisee.storePause as any;
    if (!p?.active) return false;
    const today = new Date();
    const from = new Date(p.from + "T00:00");
    const to = new Date(p.to + "T23:59");
    return today >= from && today <= to;
  })();
  const pauseInfo = franchisee.storePause as any;

  const DAYS_MAP = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
  const currentDayCode = DAYS_MAP[new Date().getDay()];

  const parseAvailableDays = (val: any): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return val.split(",").map(s => s.trim());
      }
    }
    return [];
  };

  const isAvailableToday = (p: any, dayCode: string): boolean => {
    const days = parseAvailableDays(p.availableDays);
    if (days.length === 0) return true;
    return days.map(d => d.toUpperCase()).includes(dayCode.toUpperCase());
  };

  const isIntegrationCategory = (catName: string) => {
    if (!catName) return false;
    const c = catName.trim().toLowerCase();
    return c === "jotajá" || c === "jotaja" || c === "jota já" || c === "ifood" || c.includes("jotajá") || c.includes("jotaja") || c.includes("ifood");
  };

  const activeTodayProducts = useMemo(() => {
    return menuProducts.filter(p => isAvailableToday(p, currentDayCode) && !isIntegrationCategory(p.category));
  }, [menuProducts, currentDayCode]);

  const categories = useMemo(() => {
    return [
      "Todos",
      ...Array.from(new Set(activeTodayProducts.map(p => (p.category || "").trim()).filter(c => c.length > 0 && !isIntegrationCategory(c))))
    ];
  }, [activeTodayProducts]);

  const promoProducts = useMemo(() => {
    return activeTodayProducts.filter(p => {
      const tags = (p as any).tags || "";
      const name = p.name.toLowerCase();
      const cat = (p.category || "").toLowerCase();
      return tags.includes("Promoção") || tags.includes("Oferta") || name.includes("promo") || cat.includes("promo");
    });
  }, [activeTodayProducts]);

  const highlightProducts = useMemo(() => {
    return activeTodayProducts.filter(p => {
      const tags = (p as any).tags || "";
      return tags.includes("Mais Vendido") || tags.includes("Destaque") || tags.includes("Promoção") || p.isCombo;
    }).slice(0, 4);
  }, [activeTodayProducts]);

  // FILTRO OBRIGATÓRIO DE 5 ESTRELAS (Para proteger a conversão de vendas)
  const fiveStarReviews = useMemo(() => {
    return (storeRating?.reviews || []).filter(r => r.rating >= 5);
  }, [storeRating]);

  const filtered = useMemo(() => {
    return activeTodayProducts.filter(p => {
      const pCat = (p.category || "").trim();
      const mc = selectedCategory === "Todos" || pCat.toLowerCase() === selectedCategory.trim().toLowerCase();
      const ms = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.description?.toLowerCase().includes(searchTerm.toLowerCase());
      return mc && ms;
    });
  }, [activeTodayProducts, selectedCategory, searchTerm]);

  const grouped: Record<string, MenuProduct[]> = useMemo(() => {
    const g: Record<string, MenuProduct[]> = {};
    filtered.forEach(p => {
      const cat = (p.category || "").trim();
      if (!cat) return;
      if (!g[cat]) g[cat] = [];
      g[cat].push(p);
    });
    return g;
  }, [filtered]);

  const delivConfig = (franchisee as any)?.deliveryConfig || {};
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const freeShippingThreshold = delivConfig.freeShippingActive && delivConfig.freeShippingMinValue ? Number(delivConfig.freeShippingMinValue) : null;
  const isFreeShippingByMin = Boolean(freeShippingThreshold && cartTotal >= freeShippingThreshold);
  const remainingForFreeShipping = freeShippingThreshold ? Math.max(0, freeShippingThreshold - cartTotal) : 0;
  const freeShippingProgress = freeShippingThreshold ? Math.min(100, (cartTotal / freeShippingThreshold) * 100) : 0;

  const effectiveDeliveryFee = (deliveryType === "DELIVERY" && !isFreeShippingByMin) ? deliveryFee : 0;
  const discount = couponApplied
    ? (couponApplied.isFreeShipping
        ? (deliveryType === "DELIVERY" ? effectiveDeliveryFee : 0)
        : couponApplied.discount)
    : 0;
  const finalTotal = Math.max(0, cartTotal - discount + (deliveryType === "DELIVERY" ? effectiveDeliveryFee : 0));
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const addToCart = (product: MenuProduct, cs?: any, extraSum: number = 0, qty: number = 1, itemNotes?: string) => {
    if (product.isCombo && (product.comboGroups?.length || product.comboConfig) && !cs) {
      setComboProduct(product);
      return;
    }
    const finalPrice = product.price + extraSum;
    setCart(prev => {
      if (cs) {
        return [...prev, {
          ...product,
          id: product.id + '_' + Date.now(),
          price: finalPrice,
          quantity: qty || 1,
          comboSelections: cs,
          notes: itemNotes || ""
        }];
      }
      const ex = prev.find(i => i.id === product.id && !i.comboSelections);
      if (ex) return prev.map(i => (i.id === product.id && !i.comboSelections) ? { ...i, quantity: i.quantity + (qty || 1) } : i);
      return [...prev, { ...product, price: finalPrice, quantity: qty || 1 }];
    });
    trackPixelEvent("AddToCart", { content_name: product.name, value: finalPrice * (qty || 1), currency: "BRL" });
  };

  const removeFromCart = (id: string) => setCart(prev => {
    const e = prev.find(i => i.id === id);
    if (e && e.quantity > 1) return prev.map(i => i.id === id ? { ...i, quantity: i.quantity - 1 } : i);
    return prev.filter(i => i.id !== id);
  });

  const deleteFromCart = (id: string) => setCart(prev => prev.filter(i => i.id !== id));
  const clearCart = () => setCart([]);
  const getQty = (id: string) => cart.find(i => i.id === id)?.quantity || 0;

  const scrollToCategory = (cat: string) => {
    setSelectedCategory(cat);
    if (cat === "Todos") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setTimeout(() => {
      const el = sectionRefs.current[cat] || sectionRefs.current[cat.trim()];
      if (el) {
        const yOffset = -140;
        const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    }, 50);
  };

  const fetchMyOrders = async (phoneToFetch?: string) => {
    const raw = phoneToFetch || myOrdersPhone || customer?.phone || customerPhone;
    if (!raw) return;
    const clean = raw.replace(/\D/g, "");
    if (clean.length < 8) return;
    setMyOrdersLoading(true);
    setMyOrdersSearched(true);
    try {
      const res = await fetch(`/api/store-customer?phone=${encodeURIComponent(clean)}`);
      if (res.ok) {
        const d = await res.json();
        setMyOrdersList(d.orders || []);
      }
    } catch {
      // ignore
    } finally {
      setMyOrdersLoading(false);
    }
  };

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    const cleanCode = couponCode.trim().toUpperCase();
    const storeCoupons = (franchisee as any).storeCoupons || [];
    const found = storeCoupons.find((c: any) => c.code?.toUpperCase() === cleanCode && c.active !== false);

    if (found) {
      if (found.minOrderValue && cartTotal < found.minOrderValue) {
        alert(`⚠️ Este cupom é válido apenas para pedidos a partir de R$ ${Number(found.minOrderValue).toFixed(2)}.`);
        setCouponApplied(null);
        return;
      }
      if (found.type === "free_shipping") {
        setCouponApplied({ code: found.code, discount: deliveryFee, isFreeShipping: true });
      } else if (found.type === "fixed") {
        const fixedVal = typeof found.discount === "number" ? found.discount : 10;
        setCouponApplied({ code: found.code, discount: fixedVal, isFreeShipping: false });
      } else {
        const pct = typeof found.discount === "number" ? found.discount : 10;
        setCouponApplied({ code: found.code, discount: cartTotal * (pct / 100), isFreeShipping: false });
      }
    } else {
      try {
        const res = await fetch(`/api/validate-coupon?code=${cleanCode}&franchiseeId=${franchisee.id}`);
        if (res.ok) {
          const d = await res.json();
          if (d.minOrderValue && cartTotal < d.minOrderValue) {
            alert(`⚠️ Este cupom é válido apenas para pedidos a partir de R$ ${Number(d.minOrderValue).toFixed(2)}.`);
            setCouponApplied(null);
            return;
          }
          const isFree = d.type === "free_shipping";
          const isFixed = d.type === "fixed";
          const calcDiscount = isFree ? deliveryFee : isFixed ? (d.discount || 0) : cartTotal * ((d.discount || 10) / 100);
          setCouponApplied({ code: cleanCode, discount: calcDiscount, isFreeShipping: isFree });
        } else {
          alert("Cupom inválido ou expirado.");
          setCouponApplied(null);
        }
      } catch {
        alert("Cupom inválido ou expirado.");
        setCouponApplied(null);
      }
    }
  };

  // Customer auth
  const handleAuth = async () => {
    setAuthError(""); setAuthLoading(true);
    try {
      const res = await fetch("/api/store-customer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: authMode, phone: authPhone, password: authPassword, name: authName })
      });
      const data = await res.json();
      if (res.ok) {
        setCustomer(data);
        setCustomerName(data.name);
        setCustomerPhone(data.phone);
        if (data.address) setCustomerAddress(data.address);
        setShowAuth(false);
        localStorage.setItem("storeCustomer", JSON.stringify({ id: data.id, phone: data.phone }));
      } else { setAuthError(data.error || "Erro"); }
    } catch { setAuthError("Erro de conexão."); }
    finally { setAuthLoading(false); }
  };

  const handleLogout = () => {
    setCustomer(null);
    localStorage.removeItem("storeCustomer");
  };

  useEffect(() => {
    const saved = localStorage.getItem("storeCustomer");
    if (saved) {
      try {
        const { phone } = JSON.parse(saved);
        if (phone) { setAuthPhone(phone); }
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (mobileCartOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      return () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [mobileCartOpen]);

  const paymentOptions = (() => {
    const base: { k: string; l: string }[] = [];
    if (hasOnlinePayment) {
      base.push(
        { k: "PIX", l: "💰 Pix (Online)" },
        { k: "CREDITO_ONLINE", l: "💳 Cartão de Crédito (Online)" }
      );
    }
    base.push(
      { k: "DINHEIRO", l: "💵 Dinheiro" },
      { k: "DEBITO", l: "💳 Débito (Entrega)" },
      { k: "CREDITO", l: "💳 Crédito (Entrega)" }
    );
    const fees = franchisee.paymentFees as any;
    if (fees?.VOUCHER?.active && fees.VOUCHER.brands) {
      const activeBrands = fees.VOUCHER.brands.filter((b: any) => b.active);
      if (activeBrands.length > 0) {
        activeBrands.forEach((b: any) => {
          base.push({ k: `VOUCHER_${b.name}`, l: `🎟️ ${b.name}` });
        });
      } else {
        base.push({ k: "VOUCHER", l: "🎟️ Voucher" });
      }
    } else {
      base.push({ k: "VOUCHER", l: "🎟️ Voucher" });
    }
    return base;
  })();

  const calcDeliveryFee = (neighborhood: string) => {
    setCustomerNeighborhood(neighborhood);
    const zones = franchisee.deliveryZones as any[];
    if (!zones || !franchisee.deliveryZoneType || franchisee.deliveryZoneType !== "NEIGHBORHOOD") {
      setDeliveryFee(0); setDeliveryAvailable(true); return;
    }
    const found = zones.find((z: any) => z.name.toLowerCase() === neighborhood.toLowerCase());
    if (found) {
      setDeliveryFee(Number(found.fee) || 0);
      setDeliveryAvailable(true);
    } else {
      setDeliveryFee(0);
      setDeliveryAvailable(false);
    }
  };

  const ONLINE_METHODS = ["PIX", "CREDITO_ONLINE", "ONLINE", "MERCADOPAGO", "CARTAO_ONLINE"];

  const submitReview = async () => {
    if (!ratingOrderId) return;
    try {
      const res = await fetch("/api/order-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: ratingOrderId, rating: ratingValue, comment: ratingComment, customerName: customer?.name || customerName || "Cliente" })
      });
      if (res.ok) {
        alert("Obrigado pela sua avaliação! ⭐");
        setShowRating(false);
      }
    } catch { alert("Erro ao enviar avaliação."); }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (!customerName.trim()) { alert("Informe seu nome."); return; }
    if (!customerPhone.trim()) { alert("Informe seu telefone."); return; }
    if (deliveryType === "DELIVERY" && !customerAddress.trim()) { alert("Informe seu endereço de entrega."); return; }
    if (deliveryType === "DELIVERY" && !deliveryAvailable) { alert("Não entregamos no bairro selecionado."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/customer-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseeId: franchisee.id,
          customerName, customerPhone,
          customerAddress: deliveryType === "DELIVERY" ? customerAddress : null,
          deliveryType, paymentMethod, notes,
          deliveryFee: deliveryFee || 0,
          couponCode: couponApplied?.code || null,
          items: cart.map(i => ({ menuProductId: i.id.split("_")[0], quantity: i.quantity, comboSelections: i.comboSelections || null, notes: i.notes || "" }))
        })
      });
      if (res.ok) {
        const d = await res.json();
        trackPixelEvent("Purchase", { value: finalTotal, currency: "BRL", order_id: d.orderId });
        const pmUpper = (paymentMethod || "").toUpperCase();
        const isOnline = ONLINE_METHODS.some(m => pmUpper.includes(m));
        if (isOnline) {
          setPendingOrderId(d.orderId);
          setPendingAmount(finalTotal);
          setShowPayment(true);
          setIsCheckout(false);
          setMobileCartOpen(false);
          setCart([]);
        } else {
          setOrderSuccess(d.orderId);
          setCart([]);
          setIsCheckout(false);
          setMobileCartOpen(false);
        }
      } else { const d = await res.json(); alert(d.error || "Erro."); }
    } catch { alert("Erro ao conectar."); } finally { setLoading(false); }
  };

  // ===== ORDER TRACKING =====
  const [trackingStatus, setTrackingStatus] = useState("NOVO");
  const STATUSES = [
    { key: "NOVO", label: "Pedido Enviado", icon: "📩", desc: "Aguardando confirmação da loja" },
    { key: "ACEITO", label: "Aceito", icon: "✅", desc: "A loja confirmou seu pedido" },
    { key: "PREPARANDO", label: "Preparando", icon: "👨‍🍳", desc: "Seu pedido está sendo preparado" },
    { key: "SAIU_ENTREGA", label: "Saiu para Entrega", icon: "🛵", desc: "O entregador está a caminho" },
    { key: "ENTREGUE", label: "Entregue", icon: "🎉", desc: "Pedido finalizado. Bom apetite!" },
    { key: "CANCELADO", label: "Cancelado", icon: "❌", desc: "Pedido cancelado pela loja" },
  ];

  useEffect(() => {
    if (!orderSuccess) return;
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/customer-order/status?id=${orderSuccess}`);
        if (r.ok) { const d = await r.json(); setTrackingStatus(d.status); }
      } catch {}
    }, 5000);
    return () => clearInterval(poll);
  }, [orderSuccess]);

  if (orderSuccess) {
    const currentIdx = STATUSES.findIndex(s => s.key === trackingStatus);
    const isCancelled = trackingStatus === "CANCELADO";
    const isDelivered = trackingStatus === "ENTREGUE";

    return (
      <div className="order-success-bg">
        <div className="order-success-card" style={{ maxWidth: "420px" }}>
          <div className="order-success-icon">{isCancelled ? "❌" : isDelivered ? "🎉" : "📦"}</div>
          <h1 className="order-success-title">{isCancelled ? "Pedido Cancelado" : isDelivered ? "Pedido Entregue!" : "Acompanhe seu Pedido"}</h1>
          <p className="order-success-sub">Pedido recebido por <strong>{storeName}</strong></p>
          <div className="order-code-box">
            <p className="order-code-label">Código do Pedido</p>
            <p className="order-code">#{orderSuccess.slice(-6).toUpperCase()}</p>
          </div>

          {!isCancelled && (
            <div style={{ margin: "1.25rem 0", textAlign: "left" }}>
              {STATUSES.filter(s => s.key !== "CANCELADO").map((s, i) => {
                const done = i <= currentIdx;
                const active = i === currentIdx;
                return (
                  <div key={s.key} style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: i < 4 ? "0" : "0" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "32px" }}>
                      <div style={{
                        width: "32px", height: "32px", borderRadius: "50%",
                        background: done ? "linear-gradient(135deg, #16A34A, #22C55E)" : "#E2E8F0",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.9rem", color: done ? "white" : "#94A3B8",
                        boxShadow: active ? "0 0 0 4px rgba(22,163,74,0.2)" : "none",
                        transition: "all 0.3s ease",
                        animation: active ? "pulse 2s infinite" : "none"
                      }}>{done ? "✓" : (i + 1)}</div>
                      {i < 4 && <div style={{ width: "2px", height: "28px", background: done && i < currentIdx ? "#22C55E" : "#E2E8F0", transition: "all 0.3s" }} />}
                    </div>
                    <div style={{ paddingTop: "4px", paddingBottom: i < 4 ? "12px" : "0" }}>
                      <p style={{ fontWeight: active ? 800 : 600, fontSize: "0.85rem", color: done ? "#111" : "#94A3B8" }}>
                        {s.icon} {s.label}
                      </p>
                      {active && <p style={{ fontSize: "0.72rem", color: "#666", marginTop: "2px" }}>{s.desc}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {isCancelled && (
            <p style={{ color: "#EF4444", fontWeight: 600, fontSize: "0.85rem", margin: "1rem 0" }}>
              A loja cancelou este pedido. Entre em contato para mais informações.
            </p>
          )}

          {!isDelivered && !isCancelled && (
            <p style={{ fontSize: "0.72rem", color: "#999", textAlign: "center" }}>🔄 Atualizando automaticamente...</p>
          )}

          {franchisee.storePhone && <a href={`https://wa.me/55${franchisee.storePhone.replace(/\D/g, "")}`} target="_blank" className="order-whatsapp">💬 Falar no WhatsApp</a>}

          {!isCancelled && (
            <a
              href={`/loja/${franchisee.slug}/pedido/${orderSuccess}`}
              style={{
                display: "block", width: "100%", padding: "12px", borderRadius: "14px",
                background: "linear-gradient(135deg, #1E293B, #0F172A)", color: "#fff",
                fontWeight: 700, fontSize: "0.9rem", textAlign: "center", textDecoration: "none",
                marginBottom: "8px", boxSizing: "border-box",
              }}
            >
              📍 Abrir Rastreamento ao Vivo
            </a>
          )}
          <button onClick={() => { setOrderSuccess(null); setTrackingStatus("NOVO"); }} className="order-new-btn">Fazer Novo Pedido</button>
        </div>
      </div>
    );
  }

  // ===== CART SIDEBAR CONTENT (LIMPO, FOCO TOTAL NOS PRODUTOS SEM UPSELL) =====
  const cartContentJSX = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* HEADER DA SACOLA */}
      <div style={{ padding: "1rem 1.25rem 0.75rem", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>
          {isCheckout ? "Finalizar Pedido" : "Sua sacola"}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {!isCheckout && cart.length > 0 && (
            <button
              type="button"
              onClick={clearCart}
              style={{ background: "none", border: "none", color: "#64748B", fontWeight: 800, fontSize: "0.75rem", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}
            >
              Limpar
            </button>
          )}
          <button className="mob-close-btn" onClick={() => setMobileCartOpen(false)} style={{ cursor: "pointer", background: "none", border: "none" }}><X size={20} /></button>
        </div>
      </div>

      {/* AVISO DE FRETE GRÁTIS */}
      {freeShippingThreshold && (
        <div style={{ padding: "0.6rem 1.25rem", background: isFreeShippingByMin ? "#F0FDF4" : "#FFFBEB", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: isFreeShippingByMin ? "#15803D" : "#B45309", textAlign: "center" }}>
            {isFreeShippingByMin ? "🎉 Você ganhou Frete Grátis!" : `Entrega grátis em pedidos a partir de R$ ${freeShippingThreshold.toFixed(2).replace(".", ",")}`}
          </div>
        </div>
      )}

      {/* CORPO DA SACOLA */}
      <div className="cart-body" style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>
        {!isCheckout ? (
          cart.length === 0 ? (
            <div className="cart-empty" style={{ padding: "3rem 1rem", textAlign: "center", color: "#94A3B8" }}>
              <ShoppingCart size={42} style={{ opacity: 0.3, marginBottom: "8px" }} />
              <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#64748B", margin: "0 0 4px" }}>Sua sacola está vazia</p>
              <p style={{ fontSize: "0.8rem", margin: 0 }}>Adicione itens do cardápio para começar seu pedido.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {cart.map(item => {
                const itemTotal = item.price * item.quantity;
                const formattedSelections = item.comboSelections ? Object.entries(item.comboSelections).flatMap(([_, gObj]: any) => Object.entries(gObj).filter(([_, q]) => (q as number) > 0).map(([name, q]) => `${(q as number) > 1 ? `${q}x ` : ""}${name}`)) : [];

                return (
                  <div
                    key={item.id}
                    style={{
                      background: "#FFFFFF",
                      border: "1.5px solid #E2E8F0",
                      borderRadius: "14px",
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.02)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", lineHeight: 1.3 }}>
                          {item.quantity}x {item.name}
                        </div>
                        {formattedSelections.length > 0 && (
                          <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: "3px", lineHeight: 1.35 }}>
                            {formattedSelections.map((sel, sIdx) => (
                              <div key={sIdx}>• {sel}</div>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <div style={{ fontSize: "0.72rem", color: "#92400E", backgroundColor: "#FEF3C7", padding: "2px 6px", borderRadius: "4px", marginTop: "4px", display: "inline-block" }}>
                            📝 {item.notes}
                          </div>
                        )}
                      </div>

                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>
                          R$ {itemTotal.toFixed(2).replace(".", ",")}
                        </div>
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt="" style={{ width: "42px", height: "42px", borderRadius: "8px", objectFit: "cover", marginTop: "4px" }} />
                        )}
                      </div>
                    </div>

                    {/* BOTÕES DE QUANTIDADE E REMOVER */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #F1F5F9", paddingTop: "8px", marginTop: "4px" }}>
                      <button
                        type="button"
                        onClick={() => deleteFromCart(item.id)}
                        style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer" }}
                      >
                        Remover
                      </button>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.id)}
                          style={{ width: 24, height: 24, borderRadius: "50%", border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <Minus size={11} strokeWidth={2.5} />
                        </button>
                        <span style={{ fontWeight: 800, fontSize: "0.85rem", minWidth: "16px", textAlign: "center" }}>{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => addToCart(item)}
                          style={{ width: 24, height: 24, borderRadius: "50%", border: "none", background: "#059669", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <Plus size={11} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* CUPOM DE DESCONTO */}
              <div style={{ marginTop: "0.5rem", borderTop: "1px solid #F1F5F9", paddingTop: "0.75rem" }}>
                {!showCouponInput && !couponApplied ? (
                  <button
                    type="button"
                    onClick={() => setShowCouponInput(true)}
                    style={{ background: "none", border: "none", padding: 0, color: "#2563EB", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
                  >
                    🏷️ Que tal usar um cupom de desconto?
                  </button>
                ) : (
                  <div>
                    <div className="coupon-row">
                      <input className="coupon-input" placeholder="Digite seu cupom" value={couponCode} onChange={e => setCouponCode(e.target.value)} />
                      <button className="coupon-btn" onClick={applyCoupon}>Aplicar</button>
                    </div>
                    {couponApplied && (
                      <p style={{ fontSize: "0.76rem", color: "#16A34A", fontWeight: 700, margin: "4px 0 0" }}>
                        {couponApplied.isFreeShipping
                          ? `✅ Cupom "${couponApplied.code}" aplicado! Frete Grátis 🚚`
                          : `✅ Cupom "${couponApplied.code}" aplicado! -R$ ${discount.toFixed(2)}`}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* RESUMO DOS VALORES */}
              <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: "0.75rem", display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.82rem", color: "#64748B" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Subtotal</span>
                  <span style={{ fontWeight: 700, color: "#0F172A" }}>R$ {cartTotal.toFixed(2).replace(".", ",")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Taxa de entrega</span>
                  <span style={{ fontWeight: 700, color: deliveryFee === 0 || isFreeShippingByMin ? "#16A34A" : "#0F172A" }}>
                    {deliveryType === "PICKUP" ? "Retirada no local" : deliveryFee === 0 || isFreeShippingByMin ? "Grátis" : `R$ ${deliveryFee.toFixed(2).replace(".", ",")}`}
                  </span>
                </div>
                {discount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#16A34A" }}>
                    <span>Desconto</span>
                    <span style={{ fontWeight: 700 }}>- R$ {discount.toFixed(2).replace(".", ",")}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1rem", fontWeight: 900, color: "#0F172A", marginTop: "4px", paddingTop: "4px", borderTop: "1px dashed #E2E8F0" }}>
                  <span>Total</span>
                  <span>R$ {finalTotal.toFixed(2).replace(".", ",")}</span>
                </div>
              </div>
            </div>
          )
        ) : (
          /* TELA DE IDENTIFICAÇÃO E FINALIZAÇÃO */
          <div className="checkout-form">
            <div><label className="checkout-label">Seu Nome *</label><input className="checkout-input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Como podemos te chamar?" /></div>
            <div><label className="checkout-label">WhatsApp *</label><input className="checkout-input" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="(21) 99999-9999" /></div>
            <div>
              <label className="checkout-label">Tipo de Pedido</label>
              <div className="checkout-type-row">
                <button onClick={() => setDeliveryType("DELIVERY")} className={`checkout-type-btn ${deliveryType === "DELIVERY" ? "active" : ""}`}>🛵 Entrega</button>
                <button onClick={() => setDeliveryType("PICKUP")} className={`checkout-type-btn ${deliveryType === "PICKUP" ? "active" : ""}`}>🏪 Retirada</button>
              </div>
            </div>
            {deliveryType === "DELIVERY" && (
              <div>
                <label className="checkout-label">Endereço de Entrega (Rua e Número) *</label>
                <input className="checkout-input" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="Ex: Av. Atlântica, 1500 - Apto 201" />
                {franchisee.deliveryZoneType === "NEIGHBORHOOD" && franchisee.deliveryZones && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <label className="checkout-label">Seu Bairro *</label>
                    <select className="checkout-input" value={customerNeighborhood} onChange={e => calcDeliveryFee(e.target.value)} style={{ cursor: "pointer" }}>
                      <option value="">Selecione seu bairro</option>
                      {(franchisee.deliveryZones as any[]).map((z: any, i: number) => (
                        <option key={i} value={z.name}>{z.name} — R$ {(z.fee || 0).toFixed(2).replace(".", ",")}</option>
                      ))}
                    </select>
                    {!deliveryAvailable && customerNeighborhood && <p style={{ color: "#EF4444", fontSize: "0.78rem", fontWeight: 600, marginTop: "4px" }}>❌ Bairro fora da área de entrega</p>}
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="checkout-label">Forma de Pagamento</label>
              <div className="checkout-type-row" style={{ flexWrap: "wrap" }}>
                {paymentOptions.map(pm => (
                  <button key={pm.k} onClick={() => setPaymentMethod(pm.k)} className={`checkout-type-btn ${paymentMethod === pm.k ? "active" : ""}`} style={{ flex: "1 1 30%", fontSize: "0.78rem" }}>{pm.l}</button>
                ))}
              </div>
            </div>
            <div><label className="checkout-label">Observações do Pedido</label><textarea rows={2} className="checkout-input" style={{ resize: "vertical" }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex: Sem talher, tocar interfone..." /></div>
          </div>
        )}
      </div>

      {/* FOOTER DA SACOLA */}
      {cart.length > 0 && (
        <div style={{ padding: "0.85rem 1.25rem", borderTop: "1px solid #E2E8F0", background: "#FFFFFF" }}>
          {!isCheckout ? (
            <button
              type="button"
              onClick={() => {
                setIsCheckout(true);
                trackPixelEvent("InitiateCheckout", { value: finalTotal, currency: "BRL" });
              }}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                border: "none",
                background: "#0F172A",
                color: "#FFFFFF",
                fontWeight: 800,
                fontSize: "0.95rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: "0 4px 12px rgba(15, 23, 42, 0.25)",
                transition: "all 0.2s ease"
              }}
            >
              <span>Continuar pedido</span>
              <span>R$ {finalTotal.toFixed(2).replace(".", ",")}</span>
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <button
                type="button"
                onClick={handleCheckout}
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "12px",
                  border: "none",
                  background: "#059669",
                  color: "#FFFFFF",
                  fontWeight: 800,
                  fontSize: "0.95rem",
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 12px rgba(5, 150, 105, 0.3)"
                }}
              >
                {loading ? "Enviando pedido..." : `Confirmar Pedido • R$ ${finalTotal.toFixed(2).replace(".", ",")}`}
              </button>
              <button
                type="button"
                onClick={() => setIsCheckout(false)}
                style={{ width: "100%", padding: "6px", background: "none", border: "none", color: "#64748B", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}
              >
                ← Voltar para a sacola
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ===== MAIN RENDER =====
  return (
    <div className="saipos-store">
      {franchisee.facebookPixelId && <FacebookPixel pixelId={franchisee.facebookPixelId} />}

      {/* BANNER DE PAUSA */}
      {isPaused && (
        <div style={{ background: "linear-gradient(135deg,#B91C1C,#DC2626)", color: "#fff", padding: "1rem 1.5rem", textAlign: "center" }}>
          <p style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "4px" }}>📅 Loja Temporariamente Fechada</p>
          <p style={{ fontSize: "0.85rem", opacity: 0.9, margin: 0 }}>
            Motivo: {pauseInfo?.reason || "Pausa programada"} · Retorna em {new Date((pauseInfo?.to || "") + "T12:00").toLocaleDateString("pt-BR")}
          </p>
        </div>
      )}

      {/* Loja manualmente fechada */}
      {!isPaused && franchisee.storeOpen === false && (
        <div style={{ background: "#374151", color: "#fff", padding: "0.6rem 1.5rem", textAlign: "center", fontSize: "0.85rem", fontWeight: 700 }}>
          🔴 Loja fechada no momento · Em breve voltamos!
        </div>
      )}

      {/* BANNER PANORÂMICO */}
      {franchisee.storeBanner && (
        <div className="store-banner">
          <img src={franchisee.storeBanner} alt={storeName} />
          <div className="store-banner-overlay" />
        </div>
      )}

      {/* STORE HEADER */}
      <div className="store-header">
        <div className="store-header-inner">
          {franchisee.storeLogo ? (
            <img src={franchisee.storeLogo} alt="Logo" className="store-logo" />
          ) : (
            <div className="store-logo-placeholder"><Store size={28} color="white" /></div>
          )}

          <div className="store-info">
            <h1 className="store-name">{storeName}</h1>
            {franchisee.storeAddress && (
              <div className="store-address"><MapPin size={13} /><span>{franchisee.storeAddress}</span></div>
            )}
            <div className="store-meta">
              <span className={`store-status ${storeStatus.open ? "open" : "closed"}`}>
                <Clock size={12} /> {storeStatus.text}
              </span>

              {/* AVALIAÇÕES CLICÁVEIS */}
              {storeRating && storeRating.count > 0 && (
                <button
                  type="button"
                  onClick={() => setShowReviewsModal(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "#D97706",
                    background: "#FFFBEB",
                    border: "1px solid #FCD34D",
                    padding: "2px 9px",
                    borderRadius: "20px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                    transition: "transform 0.15s ease",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  title="Clique para ver todas as avaliações dos clientes"
                >
                  <Star size={13} fill="#F59E0B" color="#F59E0B" />
                  <span>{storeRating.average.toFixed(1)}</span>
                  <span style={{ fontWeight: 600, color: "#92400E" }}>({storeRating.count})</span>
                </button>
              )}

              {franchisee.storeDeliveryOnly && (
                <span className="store-delivery-tag">• Somente Delivery</span>
              )}
            </div>
          </div>

          {/* HEADER ACTION BUTTONS */}
          <div className="store-header-actions" style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            {promoProducts.length > 0 && (
              <button
                onClick={() => setShowPromotionsModal(true)}
                style={{
                  background: "linear-gradient(135deg, #EF4444, #F97316)",
                  border: "none",
                  borderRadius: "10px",
                  padding: "6px 12px",
                  cursor: "pointer",
                  color: "white",
                  fontSize: "0.78rem",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  boxShadow: "0 2px 6px rgba(239, 68, 68, 0.3)"
                }}
              >
                <Flame size={14} /> Ofertas
                <span style={{ background: "white", color: "#DC2626", borderRadius: "10px", padding: "1px 6px", fontSize: "0.7rem", fontWeight: 900 }}>
                  {promoProducts.length}
                </span>
              </button>
            )}

            <button
              onClick={() => {
                setShowMyOrdersModal(true);
                if (customer?.phone || customerPhone) {
                  fetchMyOrders(customer?.phone || customerPhone);
                }
              }}
              style={{
                background: "rgba(15, 23, 42, 0.06)",
                border: "1px solid #E2E8F0",
                borderRadius: "10px",
                padding: "6px 12px",
                cursor: "pointer",
                color: "#1E293B",
                fontSize: "0.78rem",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <Package size={14} /> Pedidos
            </button>

            {customer ? (
              <button onClick={() => setShowHistory(!showHistory)} style={{ background: "rgba(15, 23, 42, 0.06)", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "6px 12px", cursor: "pointer", color: "#1E293B", fontSize: "0.78rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                <User size={14} /> {customer.name.split(" ")[0]}
              </button>
            ) : (
              <button onClick={() => setShowAuth(true)} style={{ background: "rgba(15, 23, 42, 0.06)", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "6px 12px", cursor: "pointer", color: "#1E293B", fontSize: "0.78rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                <LogIn size={14} /> Entrar
              </button>
            )}

            <button className="header-cart-btn" onClick={() => setMobileCartOpen(true)}>
              <ShoppingCart size={18} />{cartCount > 0 && <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{cartCount}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="store-search-bar">
        <div className="store-search-inner">
          <div className="store-search-wrap">
            <Search size={18} />
            <input type="text" className="store-search-input" placeholder="Buscar no cardápio..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>
      </div>

      {/* CATEGORY TABS */}
      <div className="store-cats">
        {promoProducts.length > 0 && (
          <button
            onClick={() => setShowPromotionsModal(true)}
            style={{
              padding: "0.35rem 1rem",
              borderRadius: "20px",
              fontSize: "0.82rem",
              fontWeight: 800,
              whiteSpace: "nowrap",
              cursor: "pointer",
              border: "none",
              background: "linear-gradient(135deg, #EF4444, #F97316)",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              boxShadow: "0 2px 6px rgba(239, 68, 68, 0.25)"
            }}
          >
            <Flame size={13} /> Ofertas do Dia
          </button>
        )}
        {categories.map(c => (
          <button key={c} onClick={() => scrollToCategory(c)} className={`store-cat-btn ${selectedCategory === c ? "active" : ""}`}>{c}</button>
        ))}
      </div>

      {/* CONTENT */}
      <div className="store-content">
        <div className="store-products">

          {/* ===== VITRINE DE DESTAQUES (High-Impact Hero Products) ===== */}
          {selectedCategory === "Todos" && !searchTerm && highlightProducts.length > 0 && (
            <div style={{ marginBottom: "2rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.85rem" }}>
                <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: 0, color: "#0F172A" }}>
                  ⭐ Destaques da Casa
                </h2>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#16A34A", backgroundColor: "#DCFCE7", padding: "2px 8px", borderRadius: "12px" }}>
                  Mais pedidos
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
                {highlightProducts.map(p => {
                  const q = getQty(p.id);
                  return (
                    <div
                      key={`highlight_${p.id}`}
                      onClick={() => p.isCombo ? setComboProduct(p) : q === 0 && addToCart(p)}
                      style={{
                        backgroundColor: "#FFFFFF",
                        borderRadius: "14px",
                        border: q > 0 ? "1.5px solid #16A34A" : "1px solid #E2E8F0",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        cursor: "pointer",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                        transition: "all 0.2s ease"
                      }}
                    >
                      {p.imageUrl && (
                        <div style={{ width: "100%", height: "130px", overflow: "hidden", position: "relative" }}>
                          <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          {p.isCombo && (
                            <span style={{ position: "absolute", top: "8px", left: "8px", background: "rgba(15,23,42,0.85)", color: "#fff", padding: "2px 8px", borderRadius: "6px", fontSize: "0.68rem", fontWeight: 800 }}>
                              COMBO
                            </span>
                          )}
                        </div>
                      )}
                      <div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", marginBottom: "4px" }}>
                          {p.name}
                        </div>
                        {p.description && (
                          <p style={{ fontSize: "0.76rem", color: "#64748B", margin: "0 0 8px 0", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {p.description}
                          </p>
                        )}
                        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "6px" }}>
                          <span style={{ fontWeight: 800, fontSize: "1rem", color: "#059669" }}>
                            {p.isCombo && <span style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600 }}>a partir de </span>}
                            R$ {p.price.toFixed(2).replace(".", ",")}
                          </span>
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              p.isCombo ? setComboProduct(p) : addToCart(p);
                            }}
                            style={{
                              padding: "5px 12px",
                              borderRadius: "8px",
                              border: "none",
                              backgroundColor: "#059669",
                              color: "#fff",
                              fontWeight: 700,
                              fontSize: "0.78rem",
                              cursor: "pointer"
                            }}
                          >
                            {p.isCombo ? "Montar" : "+ Pedir"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LISTAGEM DE CATEGORIAS & PRODUTOS */}
          {Object.keys(grouped).length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "#94A3B8" }}>Nenhum item encontrado.</div>
          ) : Object.entries(grouped).map(([cat, prods]) => (
            <div key={cat} className="store-section" ref={el => { sectionRefs.current[cat] = el; }}>
              <h2 className="store-section-title">{cat}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {prods.map(p => {
                  const q = getQty(p.id);
                  return (
                    <div key={p.id} className={`product-card ${q > 0 ? "in-cart" : ""}`} onClick={() => p.isCombo ? setComboProduct(p) : q === 0 && addToCart(p)}>
                      {p.imageUrl && <img src={p.imageUrl} alt="" className="product-img" />}
                      <div className="product-info">
                        <div className="product-name">
                          {p.name}
                          {p.isCombo && <span className="product-combo-tag">COMBO</span>}
                        </div>
                        {p.description && <p className="product-desc">{p.description}</p>}
                        {(p as any).tags && (() => {
                          try {
                            const t = JSON.parse((p as any).tags);
                            return t.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", margin: "4px 0" }}>
                                {t.map((tag: string) => {
                                  const colorMap: Record<string, { bg: string; color: string }> = {
                                    "🔥 Mais Vendido": { bg: "#FEF2F2", color: "#DC2626" },
                                    "✨ Novo": { bg: "#F5F3FF", color: "#7C3AED" },
                                    "🏷️ Promoção": { bg: "#F0FDF4", color: "#16A34A" },
                                    "🌱 Vegano": { bg: "#DCFCE7", color: "#15803D" },
                                    "🌶️ Picante": { bg: "#FEF3C7", color: "#D97706" },
                                    "⭐ Destaque": { bg: "#FEFCE8", color: "#CA8A04" },
                                    "❄️ Gelado": { bg: "#EFF6FF", color: "#2563EB" },
                                    "🎉 Especial do Dia": { bg: "#FDF2F8", color: "#BE185D" },
                                  };
                                  const c = colorMap[tag] || { bg: "#F8FAFC", color: "#475569" };
                                  return (
                                    <span key={tag} style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: "20px", background: c.bg, color: c.color }}>
                                      {tag}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : null;
                          } catch { return null; }
                        })()}
                        <p className="product-price">
                          {p.isCombo && <span className="product-price-from">A partir de </span>}
                          R$ {p.price.toFixed(2)}
                        </p>
                      </div>
                      <div className="product-actions">
                        {q === 0 ? (
                          <button className="add-btn" onClick={e => { e.stopPropagation(); p.isCombo ? setComboProduct(p) : addToCart(p); }}><Plus size={18} /></button>
                        ) : (
                          <div className="qty-controls">
                            <button className="qty-btn-minus" onClick={e => { e.stopPropagation(); removeFromCart(p.id); }}><Minus size={14} /></button>
                            <span className="qty-num">{q}</span>
                            <button className="qty-btn-plus" onClick={e => { e.stopPropagation(); addToCart(p); }}><Plus size={14} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* ===== SEÇÃO DE AVALIAÇÕES (EXIBINDO APENAS AS DE 5 ESTRELAS) ===== */}
          {fiveStarReviews.length > 0 && (
            <div style={{ marginTop: "2rem", paddingBottom: "2rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1.1rem", margin: 0 }}>⭐ Avaliações dos clientes</h2>
                <div
                  onClick={() => setShowReviewsModal(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "#FFF7ED",
                    border: "1px solid #FCD34D",
                    borderRadius: "20px",
                    padding: "3px 12px",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: "#92400E",
                    cursor: "pointer"
                  }}
                >
                  <Star size={12} fill="#F59E0B" color="#F59E0B" />
                  {storeRating?.average.toFixed(1)} ({storeRating?.count} avaliações)
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                {fiveStarReviews.slice(0, 6).map((r, i) => (
                  <div key={i} style={{ background: "#fff", borderRadius: "14px", padding: "1rem 1.25rem", border: "1px solid #F1F5F9", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, #E63946, #C62828)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "0.82rem" }}>
                        {r.customerName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>{r.customerName.split(" ")[0]}</p>
                        <p style={{ fontSize: "0.65rem", color: "#94A3B8", margin: 0 }}>{new Date(r.createdAt).toLocaleDateString("pt-BR")}</p>
                      </div>
                      <div style={{ marginLeft: "auto", display: "flex", gap: "2px" }}>
                        {[1,2,3,4,5].map(n => <Star key={n} size={11} fill="#F59E0B" color="#F59E0B" />)}
                      </div>
                    </div>
                    <p style={{ fontSize: "0.82rem", color: "#475569", margin: 0, lineHeight: 1.5 }}>"{r.comment}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ===== DESKTOP SIDEBAR ===== */}
        <div className="desk-cart" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* CARD 1: FIDELIDADE & RECOMPENSAS */}
          <div style={{ background: "#FFFFFF", borderRadius: "16px", border: "1px solid #E2E8F0", padding: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "1.2rem" }}>🎁</span>
              <span style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A" }}>Troque pontos por recompensas</span>
            </div>
            <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 6px 0", lineHeight: 1.4 }}>
              A cada R$ 1,00 em compras você ganha pontos para trocar por cupons e itens grátis.
            </p>
            <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#059669", margin: 0 }}>
              ✨ Novos clientes ganham 5 pontos de boas-vindas!
            </p>
          </div>

          {/* CARD 2: CALCULADORA DE FRETE POR BAIRRO (SEM CEP) */}
          <div style={{ background: "#FFFFFF", borderRadius: "16px", border: "1px solid #E2E8F0", padding: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Truck size={16} color="#2563EB" />
                <span style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>Taxa e tempo de entrega</span>
              </div>
            </div>

            {franchisee.deliveryZones && (
              <select
                value={customerNeighborhood}
                onChange={e => calcDeliveryFee(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "1px solid #CBD5E1",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  outline: "none",
                  backgroundColor: "#F8FAFC",
                  cursor: "pointer",
                  marginBottom: "6px"
                }}
              >
                <option value="">Selecione seu bairro...</option>
                {(franchisee.deliveryZones as any[]).map((z: any, i: number) => (
                  <option key={i} value={z.name}>{z.name}</option>
                ))}
              </select>
            )}

            {customerNeighborhood && deliveryAvailable && (
              <div style={{ fontSize: "0.78rem", color: "#15803D", fontWeight: 700, marginTop: "4px" }}>
                🛵 Taxa: {deliveryFee === 0 || isFreeShippingByMin ? "GRÁTIS" : `R$ ${deliveryFee.toFixed(2).replace(".", ",")}`}
              </div>
            )}

            {freeShippingThreshold && (
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#D97706", marginTop: "4px" }}>
                🎉 Entrega grátis a partir de R$ {freeShippingThreshold.toFixed(2).replace(".", ",")}
              </div>
            )}
          </div>

          {/* CARD 3: SACOLA / CARRINHO */}
          <div style={{ background: "#FFFFFF", borderRadius: "16px", border: "1px solid #E2E8F0", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.03)" }}>
            {cartContentJSX}
          </div>
        </div>
      </div>

      {/* MOBILE BOTTOM BAR */}
      {cartCount > 0 && !mobileCartOpen && (
        <div className="mob-bar">
          <button className="mob-bar-btn" onClick={() => setMobileCartOpen(true)}>
            <span>🛒 Ver sacola ({cartCount})</span>
            <span>R$ {finalTotal.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* MOBILE CART BOTTOM SHEET */}
      {mobileCartOpen && (
        <div className="mob-cart-overlay" onClick={() => setMobileCartOpen(false)}>
          <div className="mob-cart-sheet" onClick={e => e.stopPropagation()}>
            {cartContentJSX}
          </div>
        </div>
      )}

      {/* COMBO MODAL COM PADRÃO IFOOD */}
      {comboProduct && comboProduct.isCombo && (comboProduct.comboGroups?.length || comboProduct.comboConfig) && (
        <ComboModal
          product={{
            id: comboProduct.id,
            name: comboProduct.name,
            description: comboProduct.description,
            price: comboProduct.price,
            imageUrl: comboProduct.imageUrl,
            comboGroups: comboProduct.comboGroups || []
          }}
          onClose={() => setComboProduct(null)}
          onConfirm={(selections, extraSum, qty, comboNotes) => {
            addToCart(comboProduct, selections, extraSum, qty, comboNotes);
            setComboProduct(null);
          }}
        />
      )}

      {/* MODAL DE AVALIAÇÕES COMPLETAS (APENAS 5 ESTRELAS) */}
      {showReviewsModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setShowReviewsModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "24px", maxWidth: "520px", width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "12px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.4rem" }}>⭐</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>Avaliações dos Clientes</h3>
                  {storeRating && (
                    <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>
                      Média: <strong>{storeRating.average.toFixed(1)}</strong> ({storeRating.count} avaliações registradas)
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => setShowReviewsModal(false)} style={{ background: "#F1F5F9", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontWeight: 800 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" }}>
              {fiveStarReviews.length > 0 ? (
                fiveStarReviews.map((r, i) => (
                  <div key={i} style={{ background: "#F8FAFC", borderRadius: "12px", padding: "14px", border: "1px solid #E2E8F0" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, #E63946, #C62828)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "0.8rem" }}>
                          {r.customerName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "0.84rem", color: "#0F172A" }}>{r.customerName}</div>
                          <div style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{new Date(r.createdAt).toLocaleDateString("pt-BR")}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "2px" }}>
                        {[1,2,3,4,5].map(n => (
                          <Star key={n} size={13} fill="#F59E0B" color="#F59E0B" />
                        ))}
                      </div>
                    </div>
                    {r.comment && (
                      <p style={{ fontSize: "0.82rem", color: "#334155", margin: "4px 0 0", lineHeight: 1.45 }}>
                        "{r.comment}"
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
                  <Star size={40} style={{ opacity: 0.2, marginBottom: "8px" }} />
                  <p style={{ fontSize: "0.9rem" }}>Esta loja ainda não possui avaliações públicas 5 estrelas.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE PROMOÇÕES / OFERTAS DO DIA */}
      {showPromotionsModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setShowPromotionsModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "24px", maxWidth: "680px", width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "12px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.4rem" }}>🔥</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>Ofertas & Promoções</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Descontos e combos especiais selecionados para você</p>
                </div>
              </div>
              <button onClick={() => setShowPromotionsModal(false)} style={{ background: "#F1F5F9", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontWeight: 800 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px", paddingRight: "4px" }}>
              {promoProducts.length > 0 ? (
                promoProducts.map(p => {
                  const q = getQty(p.id);
                  return (
                    <div
                      key={`promo_${p.id}`}
                      onClick={() => {
                        setShowPromotionsModal(false);
                        p.isCombo ? setComboProduct(p) : addToCart(p);
                      }}
                      style={{
                        background: "#FFFFFF",
                        border: "1.5px solid #FCA5A5",
                        borderRadius: "14px",
                        padding: "12px",
                        display: "flex",
                        gap: "10px",
                        cursor: "pointer",
                        boxShadow: "0 2px 8px rgba(239,68,68,0.06)",
                        position: "relative"
                      }}
                    >
                      {p.imageUrl && (
                        <img src={p.imageUrl} alt={p.name} style={{ width: "65px", height: "65px", borderRadius: "10px", objectFit: "cover" }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ background: "#FEE2E2", color: "#DC2626", padding: "1px 6px", borderRadius: "4px", fontSize: "0.65rem", fontWeight: 800 }}>
                          🔥 OFERTA
                        </span>
                        <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A", marginTop: "2px" }}>{p.name}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "4px" }}>
                          <span style={{ fontWeight: 900, fontSize: "0.95rem", color: "#059669" }}>
                            R$ {p.price.toFixed(2).replace(".", ",")}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8", gridColumn: "1 / -1" }}>
                  <Flame size={40} style={{ opacity: 0.2, marginBottom: "8px" }} />
                  <p>Nenhuma promoção ativa no momento.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE MEUS PEDIDOS & ACOMPANHAMENTO */}
      {showMyOrdersModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setShowMyOrdersModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "24px", maxWidth: "480px", width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "12px", marginBottom: "16px" }}>
              <div style={{ display: "center", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.4rem" }}>📦</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>Meus Pedidos</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Consulte o status e histórico de pedidos</p>
                </div>
              </div>
              <button onClick={() => setShowMyOrdersModal(false)} style={{ background: "#F1F5F9", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontWeight: 800 }}>✕</button>
            </div>

            {/* BUSCADOR POR WHATSAPP */}
            <div style={{ marginBottom: "16px", background: "#F8FAFC", padding: "12px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <label style={{ fontSize: "0.76rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: "6px" }}>
                Digite seu WhatsApp para buscar seus pedidos:
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="(21) 99999-9999"
                  value={myOrdersPhone}
                  onChange={e => setMyOrdersPhone(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", outline: "none" }}
                />
                <button
                  type="button"
                  onClick={() => fetchMyOrders(myOrdersPhone)}
                  disabled={myOrdersLoading}
                  style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "#0F172A", color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}
                >
                  {myOrdersLoading ? "Buscando..." : "Buscar"}
                </button>
              </div>
            </div>

            {/* LISTA DE PEDIDOS */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
              {myOrdersList.length > 0 ? (
                myOrdersList.map(o => (
                  <div key={o.id} style={{ background: "#FFFFFF", border: "1.5px solid #E2E8F0", borderRadius: "14px", padding: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>#{o.id.slice(-6).toUpperCase()}</span>
                      <span style={{ padding: "2px 8px", borderRadius: "6px", fontSize: "0.7rem", fontWeight: 800, background: o.status === "ENTREGUE" ? "#DCFCE7" : "#FEF3C7", color: o.status === "ENTREGUE" ? "#15803D" : "#B45309" }}>
                        {o.status}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "8px" }}>
                      {o.items?.map((it: any) => `${it.quantity}x ${it.menuProduct?.name || "Item"}`).join(", ")}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #F1F5F9", paddingTop: "8px" }}>
                      <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>R$ {Number(o.totalAmount || 0).toFixed(2).replace(".", ",")}</span>
                      <button
                        onClick={() => {
                          setOrderSuccess(o.id);
                          setTrackingStatus(o.status);
                          setShowMyOrdersModal(false);
                        }}
                        style={{ padding: "5px 12px", borderRadius: "8px", border: "1px solid #3B82F6", background: "#EFF6FF", color: "#1D4ED8", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer" }}
                      >
                        Acompanhar Rota →
                      </button>
                    </div>
                  </div>
                ))
              ) : myOrdersSearched ? (
                <div style={{ textAlign: "center", padding: "2rem 1rem", color: "#94A3B8" }}>
                  <Package size={36} style={{ opacity: 0.3, marginBottom: "6px" }} />
                  <p style={{ fontSize: "0.85rem" }}>Nenhum pedido encontrado para este telefone.</p>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "2rem 1rem", color: "#94A3B8" }}>
                  <p style={{ fontSize: "0.85rem" }}>Digite seu número acima para ver seus pedidos recentes.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AUTH MODAL */}
      {showAuth && (
        <div className="mob-cart-overlay" onClick={() => setShowAuth(false)} style={{ zIndex: 9999 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: "16px", padding: "1.5rem", maxWidth: "380px", width: "90%", margin: "auto", position: "relative", top: "50%", transform: "translateY(-50%)" }}>
            <button onClick={() => setShowAuth(false)} style={{ position: "absolute", top: "12px", right: "12px", background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.5rem" }}>{authMode === "login" ? "🔐 Entrar" : "📝 Criar Conta"}</h2>
            <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "1rem" }}>
              {authMode === "login" ? "Entre com seu telefone e senha" : "Crie sua conta para salvar seus dados"}
            </p>
            {authError && <p style={{ color: "#EF4444", fontSize: "0.8rem", marginBottom: "0.5rem", fontWeight: 600 }}>❌ {authError}</p>}
            {authMode === "register" && (
              <div style={{ marginBottom: "0.75rem" }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>Seu Nome</label>
                <input value={authName} onChange={e => setAuthName(e.target.value)} placeholder="João Silva" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", boxSizing: "border-box" }} />
              </div>
            )}
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>WhatsApp / Telefone</label>
              <input value={authPhone} onChange={e => setAuthPhone(e.target.value)} placeholder="(21) 99999-9999" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>Senha</label>
              <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="••••••" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", boxSizing: "border-box" }} />
            </div>
            <button onClick={handleAuth} disabled={authLoading} style={{ width: "100%", padding: "12px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg, #E63946, #FF6B35)", color: "white", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
              {authLoading ? "Aguarde..." : (authMode === "login" ? "Entrar" : "Criar Conta")}
            </button>
            <p style={{ textAlign: "center", fontSize: "0.78rem", marginTop: "0.75rem", color: "#666" }}>
              {authMode === "login" ? "Não tem conta? " : "Já tem conta? "}
              <button onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }} style={{ background: "none", border: "none", color: "#E63946", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                {authMode === "login" ? "Criar conta" : "Fazer login"}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* CUSTOMER HISTORY DROPDOWN */}
      {showHistory && customer && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9998 }} onClick={() => setShowHistory(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "80px", right: "16px", background: "white", borderRadius: "16px", padding: "1.25rem", maxWidth: "360px", width: "90%", maxHeight: "70vh", overflowY: "auto", boxShadow: "0 20px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1rem" }}>👋 Olá, {customer.name.split(" ")[0]}!</h3>
              <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.5rem" }}>📱 {customer.phone}</p>
            {customer.address && <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.75rem" }}>📍 {customer.address}</p>}
            <button onClick={handleLogout} style={{ width: "100%", padding: "8px", borderRadius: "10px", border: "1.5px solid #EF4444", background: "none", color: "#EF4444", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
              Sair da Conta
            </button>
          </div>
        </div>
      )}

      {/* RATING MODAL */}
      {showRating && (
        <div className="mob-cart-overlay" onClick={() => setShowRating(false)} style={{ zIndex: 9999 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: "16px", padding: "1.5rem", maxWidth: "380px", width: "90%", margin: "auto", position: "relative", top: "50%", transform: "translateY(-50%)", textAlign: "center" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.5rem" }}>⭐ Avaliar Pedido</h2>
            <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "1rem" }}>Como foi sua experiência?</p>
            <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "1rem" }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRatingValue(n)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "2rem", opacity: n <= ratingValue ? 1 : 0.3, transition: "all 0.15s", transform: n <= ratingValue ? "scale(1.1)" : "scale(0.9)" }}>⭐</button>
              ))}
            </div>
            <textarea value={ratingComment} onChange={e => setRatingComment(e.target.value)} placeholder="Deixe um comentário (opcional)..." rows={3} style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.85rem", boxSizing: "border-box", resize: "vertical", marginBottom: "1rem" }} />
            <button onClick={submitReview} style={{ width: "100%", padding: "12px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "white", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
              Enviar Avaliação
            </button>
          </div>
        </div>
      )}

      {/* PAYMENT GATEWAY MODAL */}
      {showPayment && pendingOrderId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.65)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(4px)" }} onClick={() => setShowPayment(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: "24px", padding: "1.75rem", maxWidth: "440px", width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", position: "relative" }}>
            <PaymentGateway
              orderId={pendingOrderId}
              amount={pendingAmount}
              initialMethod={paymentMethod === "CREDITO_ONLINE" ? "credit_card" : "pix"}
              onPaid={() => { setShowPayment(false); setOrderSuccess(pendingOrderId); }}
              onError={(msg) => {
                alert(`❌ ${msg}`);
              }}
              onCancel={() => { setShowPayment(false); setOrderSuccess(pendingOrderId); }}
            />
          </div>
        </div>
      )}

      {/* CONTACT WIDGET */}
      {franchisee.ifoodWidgetId && franchisee.ifoodMerchantId && (
        <FloatingContactWidget
          ifoodWidgetId={franchisee.ifoodWidgetId}
          ifoodMerchantId={franchisee.ifoodMerchantId}
        />
      )}
    </div>
  );
}
