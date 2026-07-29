"use client";
import { useState, useRef, useEffect } from "react";
import { ShoppingCart, Plus, Minus, X, MapPin, Search, Clock, Store, Truck, User, Lock, LogIn, History, Star, ChevronRight } from "lucide-react";
import ComboModal from "./ComboModal";
import PaymentGateway from "./PaymentGateway";
import FacebookPixel, { trackPixelEvent } from "./FacebookPixel";
import FloatingContactWidget from "@/components/FloatingContactWidget";
import "./store.css";

type MenuProduct = { id: string; name: string; description: string; price: number; imageUrl: string | null; category: string; isCombo?: boolean; comboConfig?: any; comboGroups?: any[] };
type CartItem = MenuProduct & { quantity: number; comboSelections?: any };
type Franchisee = { id: string; name: string; storeName: string | null; storePhone: string | null; storeAddress: string | null; storeBanner: string | null; storeLogo?: string | null; storeHours?: any; storeDeliveryOnly?: boolean; paymentFees?: any; deliveryZoneType?: string | null; deliveryZones?: any; city: string | null; slug: string | null; storeOpen?: boolean; storePause?: any; facebookPixelId?: string | null; ifoodMerchantId?: string | null; ifoodConnected?: boolean; ifoodWidgetId?: string | null };
type StoreRating = { average: number; count: number; reviews?: { rating: number; comment: string; customerName: string; createdAt: string }[] };

function isStoreOpen(hours: any[]): { open: boolean; text: string } {
  if (!hours || !Array.isArray(hours)) return { open: true, text: "Horário não definido" };
  const now = new Date();
  const dayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const today = hours[dayIdx];
  if (!today || !today.active) return { open: false, text: "Fechado hoje" };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = today.open.split(":").map(Number);
  const [ch, cm] = today.close.split(":").map(Number);
  if (nowMin >= oh * 60 + om && nowMin <= ch * 60 + cm) return { open: true, text: `Aberto até as ${today.close}` };
  if (nowMin < oh * 60 + om) return { open: false, text: `Abre às ${today.open}` };
  return { open: false, text: "Fechado · Abre amanhã" };
}

export default function CustomerStorePage({ franchisee, menuProducts, storeRating }: { franchisee: Franchisee; menuProducts: MenuProduct[]; storeRating?: StoreRating }) {
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
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [notes, setNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number } | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
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
  // Meus Pedidos
  const [showMyOrders, setShowMyOrders] = useState(false);
  // Rating
  const [showRating, setShowRating] = useState(false);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingOrderId, setRatingOrderId] = useState<string | null>(null);
  // Pagamento Online (Pagar.me)
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

  const isStoreEffectivelyClosed = isPaused || franchisee.storeOpen === false || !storeStatus.open;
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

  const activeTodayProducts = menuProducts.filter(p => isAvailableToday(p, currentDayCode));
  const categories = ["Todos", ...Array.from(new Set(activeTodayProducts.map(p => p.category)))];

  const filtered = activeTodayProducts.filter(p => {
    const mc = selectedCategory === "Todos" || p.category === selectedCategory;
    const ms = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.description?.toLowerCase().includes(searchTerm.toLowerCase());
    return mc && ms;
  });
  const grouped: Record<string, MenuProduct[]> = {};
  filtered.forEach(p => { if (!grouped[p.category]) grouped[p.category] = []; grouped[p.category].push(p); });

  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const discount = couponApplied ? couponApplied.discount : 0;
  const finalTotal = Math.max(0, cartTotal - discount + (deliveryType === "DELIVERY" ? deliveryFee : 0));
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const addToCart = (product: MenuProduct, cs?: any) => {
    if (product.isCombo && (product.comboGroups?.length || product.comboConfig) && !cs) { setComboProduct(product); return; }
    setCart(prev => {
      if (cs) return [...prev, { ...product, id: product.id + '_' + Date.now(), quantity: 1, comboSelections: cs }];
      const ex = prev.find(i => i.id === product.id);
      if (ex) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...product, quantity: 1 }];
    });
  };
  const removeFromCart = (id: string) => setCart(prev => { const e = prev.find(i => i.id === id); if (e && e.quantity > 1) return prev.map(i => i.id === id ? { ...i, quantity: i.quantity - 1 } : i); return prev.filter(i => i.id !== id); });
  const deleteFromCart = (id: string) => setCart(prev => prev.filter(i => i.id !== id));
  const getQty = (id: string) => cart.find(i => i.id === id)?.quantity || 0;

  const scrollToCategory = (cat: string) => {
    setSelectedCategory(cat);
    if (cat !== "Todos" && sectionRefs.current[cat]) {
      sectionRefs.current[cat]!.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    try {
      const res = await fetch(`/api/validate-coupon?code=${couponCode}&franchiseeId=${franchisee.id}`);
      if (res.ok) { const d = await res.json(); setCouponApplied({ code: couponCode, discount: d.discount || 0 }); }
      else { alert("Cupom inválido."); setCouponApplied(null); }
    } catch { setCouponApplied({ code: couponCode, discount: 5 }); }
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

  // Auto-login from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("storeCustomer");
    if (saved) {
      try {
        const { phone } = JSON.parse(saved);
        if (phone) { setAuthPhone(phone); }
      } catch {}
    }
  }, []);

  // ===== BODY SCROLL LOCK quando carrinho mobile abre =====
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

  // Build dynamic payment options
  const paymentOptions = (() => {
    const base = [
      { k: "PIX", l: "💰 Pix" },
      { k: "DINHEIRO", l: "💵 Dinheiro" },
      { k: "DEBITO", l: "💳 Débito" },
      { k: "CREDITO", l: "💳 Crédito" },
    ];
    const fees = franchisee.paymentFees as any;
    if (fees?.VOUCHER?.active && fees.VOUCHER.brands) {
      const activeBrands = fees.VOUCHER.brands.filter((b: any) => b.active);
      if (activeBrands.length > 0) {
        activeBrands.forEach((b: any) => {
          base.push({ k: `VOUCHER_${b.name}`, l: `🎫 ${b.name}` });
        });
      } else {
        base.push({ k: "VOUCHER", l: "🎫 Voucher" });
      }
    } else {
      base.push({ k: "VOUCHER", l: "🎫 Voucher" });
    }
    return base;
  })();

  // Calculate delivery fee when neighborhood changes
  const calcDeliveryFee = (neighborhood: string) => {
    setCustomerNeighborhood(neighborhood);
    const zones = franchisee.deliveryZones as any[];
    if (!zones || !franchisee.deliveryZoneType || franchisee.deliveryZoneType !== "NEIGHBORHOOD") {
      setDeliveryFee(0); setDeliveryAvailable(true); return;
    }
    const found = zones.find((z: any) => z.name.toLowerCase() === neighborhood.toLowerCase());
    if (found) { setDeliveryFee(found.fee || 0); setDeliveryAvailable(true); }
    else { setDeliveryFee(0); setDeliveryAvailable(false); }
  };

  // Submit review
  const submitReview = async () => {
    if (!ratingOrderId || !customer) return;
    try {
      const res = await fetch("/api/store-reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: ratingOrderId, customerId: customer.id, rating: ratingValue, comment: ratingComment })
      });
      if (res.ok) { alert("Avaliação enviada! Obrigado! ⭐"); setShowRating(false); setRatingOrderId(null); setRatingComment(""); }
      else { const d = await res.json(); alert(d.error || "Erro"); }
    } catch { alert("Erro de conexão"); }
  };

  // Métodos que exigem pagamento online via Pagar.me
  const ONLINE_METHODS = ["PIX", "CREDITO", "DEBITO", "VOUCHER", "ALELO", "TICKET", "BEN", "SODEXO", "VR"];

  const handleCheckout = async () => {
    if (!customerName || !customerPhone) { alert("Preencha nome e telefone."); return; }
    if (deliveryType === "DELIVERY" && !customerAddress) { alert("Preencha o endereço."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/customer-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseeSlug: franchisee.slug, customerName, customerPhone,
          customerAddress: deliveryType === "DELIVERY" ? customerAddress : null,
          deliveryType, paymentMethod, notes,
          couponCode: couponApplied?.code || null,
          items: cart.map(i => ({ menuProductId: i.id.split("_")[0], quantity: i.quantity, comboSelections: i.comboSelections || null }))
        })
      });
      if (res.ok) {
        const d = await res.json();
        const isOnline = ONLINE_METHODS.includes((paymentMethod || "").toUpperCase());
        if (isOnline) {
          // Pagamento online: mostrar gateway Pagar.me antes de confirmar
          setPendingOrderId(d.orderId);
          setPendingAmount(finalTotal);
          setShowPayment(true);
          setIsCheckout(false);
          setMobileCartOpen(false);
          setCart([]);
        } else {
          // Dinheiro/maquininha: confirma direto
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

          {/* TRACKER STEPS */}
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
          
          {/* Link de rastreamento dedicado */}
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

  // ===== CART SIDEBAR CONTENT =====
  const cartContentJSX = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="cart-header">
        <h3>{isCheckout ? "Finalizar Pedido" : `Sua Sacola (${cartCount})`}</h3>
        <button className="mob-close-btn" onClick={() => setMobileCartOpen(false)} style={{ cursor: "pointer", background: "none", border: "none" }}><X size={22} /></button>
      </div>
      <div className="cart-body">
        {!isCheckout ? (
          cart.length === 0 ? (
            <div className="cart-empty"><ShoppingCart size={40} /><p>Sacola vazia</p><p style={{ fontSize: "0.8rem" }}>Adicione itens do cardápio</p></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {cart.map(item => (
                <div key={item.id} className="cart-item">
                  <div style={{ flex: 1 }}>
                    <p className="cart-item-name">{item.name}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "4px" }}>
                      <button onClick={() => removeFromCart(item.id)} className="qty-btn-minus" style={{ width: 24, height: 24 }}><Minus size={12} /></button>
                      <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{item.quantity}</span>
                      <button onClick={() => addToCart(item)} className="qty-btn-plus" style={{ width: 24, height: 24 }}><Plus size={12} /></button>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p className="cart-item-price">R$ {(item.price * item.quantity).toFixed(2)}</p>
                    <button onClick={() => deleteFromCart(item.id)} className="cart-item-remove">remover</button>
                  </div>
                </div>
              ))}
              {/* COUPON */}
              <div style={{ marginTop: "0.5rem" }}>
                <div className="coupon-row">
                  <input className="coupon-input" placeholder="Cupom de desconto" value={couponCode} onChange={e => setCouponCode(e.target.value)} />
                  <button className="coupon-btn" onClick={applyCoupon}>Aplicar</button>
                </div>
                {couponApplied && <p style={{ fontSize: "0.78rem", color: "#16A34A", fontWeight: 600 }}>✅ Cupom "{couponApplied.code}" aplicado! -R$ {couponApplied.discount.toFixed(2)}</p>}
              </div>
            </div>
          )
        ) : (
          <div className="checkout-form">
            <div><label className="checkout-label">Seu Nome *</label><input className="checkout-input" value={customerName} onChange={e => setCustomerName(e.target.value)} /></div>
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
                <label className="checkout-label">Endereço de Entrega *</label>
                <input className="checkout-input" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} />
                {franchisee.deliveryZoneType === "NEIGHBORHOOD" && franchisee.deliveryZones && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <label className="checkout-label">Bairro *</label>
                    <select className="checkout-input" value={customerNeighborhood} onChange={e => calcDeliveryFee(e.target.value)} style={{ cursor: "pointer" }}>
                      <option value="">Selecione seu bairro</option>
                      {(franchisee.deliveryZones as any[]).map((z: any, i: number) => (
                        <option key={i} value={z.name}>{z.name} — R$ {(z.fee || 0).toFixed(2)}</option>
                      ))}
                    </select>
                    {!deliveryAvailable && customerNeighborhood && <p style={{ color: "#EF4444", fontSize: "0.78rem", fontWeight: 600, marginTop: "4px" }}>❌ Bairro fora da área de entrega</p>}
                    {deliveryAvailable && deliveryFee > 0 && <p style={{ color: "#16A34A", fontSize: "0.78rem", fontWeight: 600, marginTop: "4px" }}>🛵 Taxa de entrega: R$ {deliveryFee.toFixed(2)}</p>}
                  </div>
                )}
                {franchisee.deliveryZoneType === "RADIUS" && deliveryFee > 0 && (
                  <p style={{ color: "#16A34A", fontSize: "0.78rem", fontWeight: 600, marginTop: "4px" }}>🛵 Taxa de entrega: R$ {deliveryFee.toFixed(2)}</p>
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
            <div><label className="checkout-label">Observações</label><textarea rows={2} className="checkout-input" style={{ resize: "vertical" }} value={notes} onChange={e => setNotes(e.target.value)} /></div>
            <div className="checkout-summary">
              {cart.map(i => <div key={i.id} className="checkout-summary-item"><span>{i.quantity}x {i.name}</span><span>R$ {(i.price * i.quantity).toFixed(2)}</span></div>)}
              {couponApplied && <div className="checkout-summary-item" style={{ color: "#16A34A" }}><span>Cupom ({couponApplied.code})</span><span>-R$ {couponApplied.discount.toFixed(2)}</span></div>}
              {deliveryType === "DELIVERY" && deliveryFee > 0 && <div className="checkout-summary-item" style={{ color: "#E67E22" }}><span>🛵 Taxa de Entrega</span><span>R$ {deliveryFee.toFixed(2)}</span></div>}
            </div>
          </div>
        )}
      </div>
      {cart.length > 0 && (
        <div className="cart-footer">
          <div className="cart-total-row"><span className="cart-total-label">Total</span><span className="cart-total-value">R$ {finalTotal.toFixed(2)}</span></div>
          {!isCheckout ? (
            <button onClick={() => setIsCheckout(true)} className="cart-checkout-btn">Continuar</button>
          ) : (
            <>
              <button onClick={handleCheckout} disabled={loading} className="cart-checkout-btn">{loading ? "Enviando..." : `Enviar Pedido • R$ ${finalTotal.toFixed(2)}`}</button>
              <button onClick={() => setIsCheckout(false)} className="cart-back-btn">← Voltar à Sacola</button>
            </>
          )}
        </div>
      )}
    </div>
  );

  // ===== MAIN RENDER =====
  return (
    <div className="saipos-store">
      {/* FACEBOOK PIXEL — rastreamento automático por loja */}
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
      {/* BANNER */}
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
              {storeRating && storeRating.count > 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "0.78rem", fontWeight: 700, color: "#F59E0B" }}>
                  <Star size={13} fill="#F59E0B" /> {storeRating.average.toFixed(1)} <span style={{ fontWeight: 400, color: "#94A3B8" }}>({storeRating.count})</span>
                </span>
              )}
              {franchisee.storeDeliveryOnly && (
                <span className="store-delivery-tag">• Somente Delivery</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {customer ? (
              <button onClick={() => setShowHistory(!showHistory)} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "10px", padding: "6px 12px", cursor: "pointer", color: "white", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "4px" }}>
                <User size={14} /> {customer.name.split(" ")[0]}
              </button>
            ) : (
              <button onClick={() => setShowAuth(true)} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "10px", padding: "6px 12px", cursor: "pointer", color: "white", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "4px" }}>
                <LogIn size={14} /> Entrar
              </button>
            )}
            <button className="header-cart-btn" onClick={() => setMobileCartOpen(true)}>
              <ShoppingCart size={18} />{cartCount > 0 && <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{cartCount}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* SEARCH */}
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
        {categories.map(c => (
          <button key={c} onClick={() => scrollToCategory(c)} className={`store-cat-btn ${selectedCategory === c ? "active" : ""}`}>{c}</button>
        ))}
      </div>

      {/* CONTENT */}
      <div className="store-content">
        <div className="store-products">
          {Object.keys(grouped).length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "#94A3B8" }}>Nenhum item encontrado.</div>
          ) : Object.entries(grouped).map(([cat, prods]) => (
            <div key={cat} className="store-section" ref={el => { sectionRefs.current[cat] = el; }}>
              <h2 className="store-section-title">{cat}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {prods.map(p => { const q = getQty(p.id); return (
                  <div key={p.id} className={`product-card ${q > 0 ? "in-cart" : ""}`} onClick={() => p.isCombo ? setComboProduct(p) : q === 0 && addToCart(p)}>
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="product-img" />}
                    <div className="product-info">
                      <div className="product-name">
                        {p.name}
                        {p.isCombo && <span className="product-combo-tag">COMBO</span>}
                      </div>
                      {p.description && <p className="product-desc">{p.description}</p>}
                      {/* Tags do produto */}
                      {(p as any).tags && (() => { try { const t = JSON.parse((p as any).tags); return t.length > 0 ? (
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
                      ) : null; } catch { return null; } })()}

                      {/* Dias Disponíveis */}
                      {(p as any).availableDays && (() => {
                        try {
                          const days = typeof (p as any).availableDays === "string" ? JSON.parse((p as any).availableDays) : (p as any).availableDays;
                          if (Array.isArray(days) && days.length > 0) {
                            const labels: Record<string, string> = { SEG: "Seg", TER: "Ter", QUA: "Qua", QUI: "Qui", SEX: "Sex", SAB: "Sáb", DOM: "Dom" };
                            const dayStr = days.map((d: string) => labels[d] || d).join(", ");
                            return (
                              <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: "12px", background: "#FEF3C7", color: "#92400E", display: "inline-flex", alignItems: "center", gap: "3px", marginTop: "2px" }}>
                                📅 Válido: {dayStr}
                              </span>
                            );
                          }
                        } catch {}
                        return null;
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
                ); })}
              </div>
            </div>
          ))}
        </div>

        {/* ===== SEÇÃO DE AVALIAÇÕES ===== */}
        {storeRating && storeRating.reviews && storeRating.reviews.length > 0 && (
          <div style={{ marginTop: "2rem", paddingBottom: "2rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
              <h2 style={{ fontWeight: 800, fontSize: "1.1rem", margin: 0 }}>⭐ Avaliações dos clientes</h2>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "#FFF7ED", border: "1px solid #FCD34D", borderRadius: "20px", padding: "3px 12px", fontSize: "0.82rem", fontWeight: 700, color: "#92400E" }}>
                <Star size={12} fill="#F59E0B" color="#F59E0B" />
                {storeRating.average.toFixed(1)} ({storeRating.count} avaliações)
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
              {storeRating.reviews.map((r, i) => (
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
                      {[1,2,3,4,5].map(n => <Star key={n} size={11} fill={n <= r.rating ? "#F59E0B" : "none"} color={n <= r.rating ? "#F59E0B" : "#CBD5E1"} />)}
                    </div>
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "#475569", margin: 0, lineHeight: 1.5 }}>"{r.comment}"</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DESKTOP CART SIDEBAR */}
        <div className="desk-cart">{cartContentJSX}</div>
      </div>

      {/* MOBILE BOTTOM BAR */}
      {cartCount > 0 && !mobileCartOpen && (
        <div className="mob-bar">
          <button className="mob-bar-btn" onClick={() => setMobileCartOpen(true)}>
            <span>🛒 Sacola ({cartCount})</span>
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

      {/* COMBO MODAL */}
      {comboProduct && comboProduct.isCombo && (comboProduct.comboGroups?.length || comboProduct.comboConfig) && (
        <ComboModal product={{ id: comboProduct.id, name: comboProduct.name, price: comboProduct.price, imageUrl: comboProduct.imageUrl, comboGroups: comboProduct.comboGroups || [] }} onClose={() => setComboProduct(null)} onConfirm={s => { addToCart(comboProduct, s); setComboProduct(null); }} />
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
            <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: "0.75rem", marginBottom: "0.75rem" }}>
              <h4 style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.5rem" }}><History size={14} style={{ marginRight: "4px" }} /> Meus Pedidos</h4>
              {customer.orders?.length > 0 ? customer.orders.slice(0, 8).map((o: any) => {
                const statusColors: Record<string, string> = { NOVO: "#3B82F6", ACEITO: "#16A34A", PREPARANDO: "#F59E0B", SAIU_ENTREGA: "#8B5CF6", ENTREGUE: "#22C55E", CANCELADO: "#EF4444" };
                const statusLabels: Record<string, string> = { NOVO: "Enviado", ACEITO: "Aceito", PREPARANDO: "Preparando", SAIU_ENTREGA: "A caminho", ENTREGUE: "Entregue", CANCELADO: "Cancelado" };
                return (
                  <div key={o.id} style={{ padding: "0.6rem", background: "#F7F7F7", borderRadius: "10px", marginBottom: "6px", fontSize: "0.78rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600 }}>#{o.id.slice(-6).toUpperCase()}</span>
                      <span style={{ padding: "2px 8px", borderRadius: "6px", fontWeight: 700, fontSize: "0.68rem", color: "white", background: statusColors[o.status] || "#94A3B8" }}>
                        {statusLabels[o.status] || o.status}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                      <span style={{ color: "#999", fontSize: "0.7rem" }}>{new Date(o.createdAt).toLocaleDateString("pt-BR")}</span>
                      <span style={{ fontWeight: 700, color: "#E63946" }}>R$ {o.totalAmount.toFixed(2)}</span>
                    </div>
                    <p style={{ color: "#999", fontSize: "0.68rem", marginTop: "2px" }}>{o.items?.map((i: any) => i.menuProduct?.name).join(", ")}</p>
                    <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                      {o.status !== "ENTREGUE" && o.status !== "CANCELADO" && (
                        <button onClick={() => { setOrderSuccess(o.id); setTrackingStatus(o.status); setShowHistory(false); }} style={{ flex: 1, padding: "4px 8px", borderRadius: "6px", border: "1px solid #3B82F6", background: "none", color: "#3B82F6", fontSize: "0.7rem", fontWeight: 600, cursor: "pointer" }}>
                          📦 Acompanhar
                        </button>
                      )}
                      {o.status === "ENTREGUE" && !o.rating && (
                        <button onClick={() => { setRatingOrderId(o.id); setShowRating(true); setShowHistory(false); }} style={{ flex: 1, padding: "4px 8px", borderRadius: "6px", border: "1px solid #F59E0B", background: "none", color: "#F59E0B", fontSize: "0.7rem", fontWeight: 600, cursor: "pointer" }}>
                          ⭐ Avaliar
                        </button>
                      )}
                      {o.rating && (
                        <span style={{ fontSize: "0.7rem", color: "#F59E0B", fontWeight: 600 }}>{"⭐".repeat(o.rating)}</span>
                      )}
                    </div>
                  </div>
                );
              }) : <p style={{ fontSize: "0.78rem", color: "#999" }}>Nenhum pedido ainda.</p>}
            </div>
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
            <p style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.75rem" }}>
              {ratingValue === 1 ? "😞 Ruim" : ratingValue === 2 ? "😐 Regular" : ratingValue === 3 ? "🙂 Bom" : ratingValue === 4 ? "😄 Ótimo" : "🤩 Excelente!"}
            </p>
            <textarea value={ratingComment} onChange={e => setRatingComment(e.target.value)} placeholder="Deixe um comentário (opcional)..." rows={3} style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.85rem", boxSizing: "border-box", resize: "vertical", marginBottom: "1rem" }} />
            <button onClick={submitReview} style={{ width: "100%", padding: "12px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "white", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
              Enviar Avaliação
            </button>
          </div>
        </div>
      )}

      {/* PAYMENT GATEWAY MODAL — Pagar.me (PIX / Cartão / Voucher) */}
      {showPayment && pendingOrderId && (
        <div className="mob-cart-overlay" style={{ zIndex: 9999 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "white", borderRadius: "20px", padding: "1.75rem",
            maxWidth: "440px", width: "92%", margin: "auto",
            position: "relative", top: "50%", transform: "translateY(-50%)",
            maxHeight: "90vh", overflowY: "auto",
            boxShadow: "0 25px 60px rgba(0,0,0,0.25)"
          }}>
            <PaymentGateway
              orderId={pendingOrderId}
              amount={pendingAmount}
              onPaid={() => { setShowPayment(false); setOrderSuccess(pendingOrderId); }}
              onError={(msg) => { alert(`❌ ${msg}`); }}
              onCancel={() => { setShowPayment(false); setOrderSuccess(pendingOrderId); }}
            />
          </div>
        </div>
      )}

      {/* Per-store FloatingContactWidget with iFood chat support */}
      {franchisee.ifoodWidgetId && franchisee.ifoodMerchantId && (
        <FloatingContactWidget
          ifoodWidgetId={franchisee.ifoodWidgetId}
          ifoodMerchantId={franchisee.ifoodMerchantId}
        />
      )}
    </div>
  );
}
