"use client";
import { useState, useEffect, useMemo } from "react";
import { ShoppingCart, Plus, Minus, Trash2, Check, Bike, UtensilsCrossed, Users, Search, ChevronRight } from "lucide-react";
import ComboModal from "@/components/customer/ComboModal";

const PAYMENT_METHODS = ["Dinheiro", "PIX", "Cartão Débito", "Cartão Crédito", "Voucher/Vale"];
const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

type CartItem = { product: any; qty: number; unitPrice?: number; notes?: string; comboSelections?: { name: string; quantity: number }[] };
type OrderType = "BALCAO" | "MESA" | "DELIVERY";

const getEffectiveComboGroups = (prod: any) => {
  if (prod?.comboGroups && Array.isArray(prod.comboGroups) && prod.comboGroups.length > 0) {
    return prod.comboGroups;
  }
  if (!prod?.comboConfig) return [];
  try {
    const config = typeof prod.comboConfig === "string" ? JSON.parse(prod.comboConfig) : prod.comboConfig;
    if (Array.isArray(config)) return config;
    if (config.groups && Array.isArray(config.groups)) return config.groups;
    if (config.comboGroups && Array.isArray(config.comboGroups)) return config.comboGroups;
  } catch {}
  return [];
};

export default function VendaPresencialPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [paymentConfig, setPaymentConfig] = useState<any>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("BALCAO");
  const [tableNum, setTableNum] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Dinheiro");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [change, setChange] = useState(""); // troco
  const [comboProduct, setComboProduct] = useState<any>(null);
  const [employeeAccountEnabled, setEmployeeAccountEnabled] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedEmployeeName, setSelectedEmployeeName] = useState("");

  useEffect(() => {
    fetch("/api/admin/menu-products").then(r => r.json()).then(d => Array.isArray(d) && setProducts(d));
    fetch("/api/store-settings/payment").then(r => r.ok ? r.json() : null).then(d => d && setPaymentConfig(d.paymentFees));
    fetch("/api/store-settings/employee-account").then(r => r.ok ? r.json() : null).then(d => d && setEmployeeAccountEnabled(Boolean(d.employeeAccountEnabled)));
    fetch("/api/store/employees").then(r => r.ok ? r.json() : null).then(d => d?.employees && setEmployees(d.employees));
  }, []);

  const getDisplayPrice = (p: any) => {
    if (p.price && p.price > 0) return fmt(p.price);
    const groups = getEffectiveComboGroups(p);
    if (groups && groups.length > 0) {
      let minPrice = Infinity;
      groups.forEach((g: any) => {
        (g.items || []).forEach((it: any) => {
          const pr = (Number(it.additionalPrice) || 0) + (it.menuProduct?.price || 0);
          if (pr > 0 && pr < minPrice) minPrice = pr;
        });
      });
      if (minPrice !== Infinity) return `a partir de ${fmt(minPrice)}`;
    }
    return fmt(0);
  };

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

  const categories = useMemo(() => {
    const activeTodayProducts = products.filter(p => {
      if (!p.active || p.activePDV === false) return false;
      if (!isAvailableToday(p, currentDayCode)) return false;
      return true;
    });
    const cats = Array.from(new Set(activeTodayProducts.map(p => p.isCombo ? "Combos" : (p.category || "Outros"))));
    return ["Todos", ...cats.sort()];
  }, [products, currentDayCode]);

  const filtered = products.filter(p => {
    if (!p.active) return false;
    if (p.activePDV === false) return false;
    if (!isAvailableToday(p, currentDayCode)) return false;
    const cat = p.isCombo ? "Combos" : (p.category || "Outros");
    if (selectedCategory !== "Todos" && cat !== selectedCategory) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const voucherRate = useMemo(() => {
    if (!paymentConfig?.VOUCHER?.active) return 0;
    const brands: any[] = paymentConfig.VOUCHER.brands || [];
    if (brands.length === 0) return paymentConfig.VOUCHER.rate || 0;
    const activeBrands = brands.filter((b: any) => b.active);
    if (activeBrands.length === 0) return 0;
    return activeBrands.reduce((s: number, b: any) => s + b.rate, 0) / activeBrands.length;
  }, [paymentConfig]);

  const isVoucher = paymentMethod === "Voucher/Vale";
  const subtotal = cart.reduce((s, i) => s + (i.unitPrice ?? i.product.price) * i.qty, 0);
  const voucherFee = isVoucher ? subtotal * (voucherRate / 100) : 0;
  const total = subtotal + voucherFee;

  const handleProductClick = (product: any) => {
    const groups = getEffectiveComboGroups(product);
    if ((product.isCombo || groups.length > 0) && groups.length > 0) {
      setComboProduct({ ...product, comboGroups: groups });
    } else {
      addToCart(product);
    }
  };

  const addToCart = (product: any, comboSelections?: { name: string; quantity: number }[], extraSum: number = 0) => {
    const unitPrice = product.price + extraSum;
    setCart(prev => {
      if (comboSelections && comboSelections.length > 0) {
        return [...prev, { product, qty: 1, comboSelections, unitPrice }];
      }
      const ex = prev.find(i => i.product.id === product.id && !i.comboSelections);
      if (ex) return prev.map(i => (i.product.id === product.id && !i.comboSelections) ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product, qty: 1, unitPrice }];
    });
  };

  const updateQtyByIndex = (index: number, newQty: number) => {
    setCart(prev => {
      if (newQty <= 0) return prev.filter((_, idx) => idx !== index);
      return prev.map((item, idx) => idx === index ? { ...item, qty: newQty } : item);
    });
  };

  const handleSubmit = async () => {
    if (cart.length === 0) return setMsg("❌ Adicione pelo menos um produto.");
    if (orderType === "MESA" && !tableNum) return setMsg("❌ Informe o número da mesa.");
    if (orderType === "DELIVERY" && !address) return setMsg("❌ Informe o endereço de entrega.");
    if (paymentMethod === "Conta Funcionário" && !selectedEmployeeId) {
      return setMsg("❌ Selecione o funcionário responsável pela conta.");
    }

    setLoading(true); setMsg("");
    const body = {
      customerName: paymentMethod === "Conta Funcionário" && selectedEmployeeName
        ? `Func. ${selectedEmployeeName}`
        : customerName || (orderType === "MESA" ? `Mesa ${tableNum}` : orderType === "BALCAO" ? "Balcão" : "Cliente"),
      customerPhone: customerPhone || "00000000000",
      customerAddress: orderType === "DELIVERY" ? address : orderType === "MESA" ? `Mesa ${tableNum}` : "Balcão",
      deliveryType: orderType === "BALCAO" ? "RETIRADA" : orderType,
      paymentMethod,
      employeeId: selectedEmployeeId || null,
      employeeName: selectedEmployeeName || null,
      notes,
      totalAmount: total,
      deliveryFee: 0,
      items: cart.map(i => ({
        menuProductId: i.product.id,
        quantity: i.qty,
        price: i.unitPrice ?? i.product.price,
        comboSelections: i.comboSelections ? JSON.stringify(i.comboSelections) : null
      })),
    };

    const res = await fetch("/api/store/orders/presencial", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setLoading(false);
    if (res.ok) {
      setMsg("✅ Pedido registrado!");
      setCart([]); setCustomerName(""); setCustomerPhone(""); setAddress(""); setTableNum(""); setNotes(""); setChange("");
    } else {
      const err = await res.json();
      setMsg("❌ " + (err.error || "Erro ao registrar pedido."));
    }
  };

  const cartQty = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", display: "grid", gridTemplateColumns: "1fr 380px", height: "calc(100vh - 145px)", maxHeight: "calc(100vh - 145px)", overflow: "hidden", position: "relative" }}>
      <style>{`
        #floating-contact-widget, .fcw-container, .fcw-backdrop, #contact-widget-fab,
        #hubspot-messages-iframe-container, iframe[src*="chat"], .crisp-client, div[class*="chat"], #chat-widget-container, div[class*="widget"], div[id*="chat"] {
          display: none !important;
          pointer-events: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
        button[data-btn="finalizar"] {
          position: relative !important;
          z-index: 9999999 !important;
          pointer-events: auto !important;
          cursor: pointer !important;
        }
        button[data-btn="finalizar"] * {
          pointer-events: none !important;
        }
      `}</style>

      {/* ===== LEFT: CARDÁPIO ===== */}
      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #E2E8F0" }}>
        {/* Header */}
        <div style={{ padding: "12px 16px", background: "#fff", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar produto..."
                style={{ width: "100%", padding: "8px 12px 8px 32px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none" }} />
            </div>
            <div style={{ background: "#C62828", color: "#fff", borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 6 }}>
              <ShoppingCart size={15} /> {cartQty} {cartQty === 1 ? "item" : "itens"}
            </div>
          </div>
          {/* Categorias */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setSelectedCategory(cat)}
                style={{ padding: "5px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, fontSize: "0.78rem", whiteSpace: "nowrap", fontFamily: "inherit",
                  background: selectedCategory === cat ? "#C62828" : "#F1F5F9",
                  color: selectedCategory === cat ? "#fff" : "#64748B" }}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid de produtos */}
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
            {filtered.map(p => {
              const inCart = cart.find(i => i.product.id === p.id);
              return (
                <div key={p.id} onClick={() => handleProductClick(p)}
                  style={{ background: "#fff", border: `2px solid ${inCart ? "#C62828" : "#E2E8F0"}`, borderRadius: 14, padding: 10, cursor: "pointer", transition: "all 0.15s", position: "relative", userSelect: "none" }}
                  onMouseEnter={e => { if (!inCart) e.currentTarget.style.borderColor = "#FCA5A5"; }}
                  onMouseLeave={e => { if (!inCart) e.currentTarget.style.borderColor = "#E2E8F0"; }}>
                  {inCart && (
                    <div style={{ position: "absolute", top: 6, right: 6, width: 20, height: 20, background: "#C62828", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ color: "#fff", fontSize: "0.65rem", fontWeight: 900 }}>{inCart.qty}</span>
                    </div>
                  )}
                  {p.imageUrl
                    ? <img src={p.imageUrl} alt={p.name} style={{ width: "100%", height: 75, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
                    : <div style={{ width: "100%", height: 75, background: "#F1F5F9", borderRadius: 8, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                        {p.isCombo ? "🍱" : "🍔"}
                      </div>
                  }
                  <div style={{ fontWeight: 700, fontSize: "0.8rem", marginBottom: 2, lineHeight: 1.2 }}>{p.name}</div>
                  <div style={{ fontSize: "0.7rem", color: "#94A3B8", marginBottom: 4 }}>{p.isCombo ? "Combo" : p.category}</div>
                  <div style={{ color: "#C62828", fontWeight: 800, fontSize: "0.88rem" }}>{getDisplayPrice(p)}</div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "2rem", color: "#94A3B8" }}>Nenhum produto encontrado.</div>
            )}
          </div>
        </div>
      </div>

      {/* ===== RIGHT: PEDIDO ===== */}
      <div style={{ display: "flex", flexDirection: "column", background: "#fff", overflow: "hidden" }}>
        {/* Tipo de pedido */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
            {([
              { value: "BALCAO", label: "Balcão", icon: "🏠", color: "#3B82F6" },
              { value: "MESA", label: "Mesa", icon: "🍽️", color: "#8B5CF6" },
              { value: "DELIVERY", label: "Delivery", icon: "🛵", color: "#C62828" },
            ] as const).map(t => (
              <button key={t.value} onClick={() => setOrderType(t.value)}
                style={{ padding: "10px 4px", borderRadius: 10, border: `2px solid ${orderType === t.value ? t.color : "#E2E8F0"}`,
                  background: orderType === t.value ? t.color : "#F8FAFC",
                  color: orderType === t.value ? "#fff" : "#64748B",
                  fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 2 }}>{t.icon}</div>
                {t.label}
              </button>
            ))}
          </div>

          {/* Campos por tipo */}
          {orderType === "MESA" && (
            <input placeholder="Número da mesa *" value={tableNum} onChange={e => setTableNum(e.target.value)}
              style={{ width: "100%", marginBottom: 6, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #8B5CF6", fontSize: "0.9rem", outline: "none", fontFamily: "inherit" }} />
          )}
          {orderType === "DELIVERY" && (
            <input placeholder="Endereço de entrega *" value={address} onChange={e => setAddress(e.target.value)}
              style={{ width: "100%", marginBottom: 6, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #C62828", fontSize: "0.9rem", outline: "none", fontFamily: "inherit" }} />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input placeholder={orderType === "BALCAO" ? "Nome (opcional)" : "Nome do cliente"} value={customerName} onChange={e => setCustomerName(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" }} />
            <input placeholder="Telefone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", outline: "none", fontFamily: "inherit" }} />
          </div>
        </div>

        {/* Carrinho */}
        <div style={{ flex: 1, overflow: "auto", padding: "10px 16px" }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "#CBD5E1" }}>
              <ShoppingCart size={40} style={{ margin: "0 auto 10px" }} />
              <p style={{ fontSize: "0.85rem" }}>Clique nos produtos para adicionar</p>
            </div>
          ) : cart.map((item, index) => (
            <div key={index} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{item.product.name}</div>
                {item.comboSelections && item.comboSelections.length > 0 && (
                  <div style={{ fontSize: "0.74rem", color: "#475569", marginTop: 2, background: "#F8FAFC", padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0" }}>
                    {item.comboSelections.map((s, sIdx) => (
                      <div key={sIdx}>• {s.quantity}x {s.name}</div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: "0.78rem", color: "#C62828", fontWeight: 700, marginTop: 2 }}>{fmt((item.unitPrice ?? item.product.price) * item.qty)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => updateQtyByIndex(index, item.qty - 1)}
                  style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #E2E8F0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {item.qty === 1 ? <Trash2 size={12} color="#EF4444" /> : <Minus size={12} />}
                </button>
                <span style={{ width: 22, textAlign: "center", fontWeight: 800, fontSize: "0.9rem" }}>{item.qty}</span>
                <button onClick={() => updateQtyByIndex(index, item.qty + 1)}
                  style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid #C62828", background: "#C62828", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Plus size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer: pagamento + total */}
        <div style={{ padding: "10px 14px 75px 14px", borderTop: "1px solid #E2E8F0", background: "#FAFAFA", position: "relative", zIndex: 50, flexShrink: 0 }}>
          {/* Forma de pagamento */}
          <div style={{ marginBottom: 6 }}>
            <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.4px", display: "block", marginBottom: 3 }}>Pagamento</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {[...PAYMENT_METHODS, ...(employeeAccountEnabled ? ["Conta Funcionário"] : [])].map(m => (
                <button key={m} type="button" onClick={() => setPaymentMethod(m)}
                  style={{ padding: "4px 9px", borderRadius: 8, border: `1.5px solid ${paymentMethod === m ? "#C62828" : "#CBD5E1"}`,
                    background: paymentMethod === m ? "#C62828" : "#fff",
                    color: paymentMethod === m ? "#fff" : "#334155",
                    fontWeight: 700, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}>
                  {m === "Conta Funcionário" ? "👤 Conta Funcionário" : m}
                </button>
              ))}
            </div>
          </div>

          {/* Seleção do Funcionário quando forma for Conta Funcionário */}
          {paymentMethod === "Conta Funcionário" && (
            <div style={{ marginBottom: 6, background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 8, padding: "8px" }}>
              <label style={{ fontSize: "0.72rem", fontWeight: 800, color: "#991B1B", display: "block", marginBottom: 4 }}>
                Selecione o Funcionário *
              </label>
              {employees.length === 0 ? (
                <div style={{ fontSize: "0.75rem", color: "#7F1D1D" }}>
                  Nenhum funcionário cadastrado. Cadastre em <a href="/store/funcionarios" style={{ color: "#C62828", fontWeight: 700 }}>Funcionários</a>.
                </div>
              ) : (
                <select
                  value={selectedEmployeeId}
                  onChange={e => {
                    const empId = e.target.value;
                    setSelectedEmployeeId(empId);
                    const found = employees.find(emp => emp.id === empId);
                    setSelectedEmployeeName(found ? found.name : "");
                  }}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1.5px solid #C62828", fontSize: "0.85rem", fontWeight: 700, color: "#1E293B", outline: "none" }}
                >
                  <option value="">-- Escolha um colaborador --</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.role || "Funcionário"}) — Dívida: R$ {(emp.currentDebt || 0).toFixed(2).replace(".", ",")}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Acréscimo voucher */}
          {isVoucher && (
            <div style={{ marginBottom: 6, fontSize: "0.72rem", color: "#D97706", background: "#FFFBEB", padding: "4px 8px", borderRadius: 6, border: "1px solid #FDE68A" }}>
              Taxa de vale ({voucherRate}%): <strong>+{fmt(voucherFee)}</strong>
            </div>
          )}

          {/* Troco (só Dinheiro) */}
          {paymentMethod === "Dinheiro" && (
            <input type="number" placeholder="Troco para... (opcional)" value={change} onChange={e => setChange(e.target.value)}
              style={{ width: "100%", marginBottom: 6, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.82rem", outline: "none", fontFamily: "inherit" }} />
          )}
          {paymentMethod === "Dinheiro" && change && Number(change) > 0 && (
            <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "4px 8px", marginBottom: 6, fontSize: "0.75rem", color: "#16A34A", fontWeight: 700 }}>
              💵 Troco: {fmt(Math.max(0, Number(change) - total))}
            </div>
          )}

          {/* Obs */}
          <input placeholder="Observações do pedido (opcional)..." value={notes} onChange={e => setNotes(e.target.value)}
            style={{ width: "100%", marginBottom: 6, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.82rem", outline: "none", fontFamily: "inherit" }} />

          {/* Total */}
          {cart.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {isVoucher && voucherRate > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", color: "#64748B", marginBottom: 2 }}>
                  <span>Subtotal</span><span>{fmt(subtotal)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "1.05rem" }}>
                <span>TOTAL</span><span style={{ color: "#C62828" }}>{fmt(total)}</span>
              </div>
            </div>
          )}

          {msg && <div style={{ padding: "6px 10px", borderRadius: 8, marginBottom: 6, background: msg.startsWith("✅") ? "#f0fdf4" : "#fef2f2", color: msg.startsWith("✅") ? "#16a34a" : "#dc2626", fontSize: "0.8rem", fontWeight: 700 }}>{msg}</div>}

          <button type="button" data-btn="finalizar" onClick={handleSubmit} disabled={loading || cart.length === 0}
            style={{ width: "100%", padding: "14px", background: cart.length === 0 ? "#CBD5E1" : "linear-gradient(135deg, #C62828, #E53935)", color: cart.length === 0 ? "#64748B" : "#fff", border: "none", borderRadius: 14, fontWeight: 900, fontSize: "1.05rem", cursor: cart.length === 0 ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: cart.length > 0 ? "0 4px 14px rgba(198,40,40,0.4)" : "none", position: "relative", zIndex: 9999 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "none" }}>
              {loading ? "Registrando..." : <><Check size={20} style={{ pointerEvents: "none" }} /> Finalizar Pedido</>}
            </span>
          </button>
        </div>
      </div>

      {/* COMBO SELECTION MODAL */}
      {comboProduct && (
        <ComboModal
          product={{
            id: comboProduct.id,
            name: comboProduct.name,
            price: comboProduct.price,
            imageUrl: comboProduct.imageUrl,
            comboGroups: comboProduct.comboGroups || []
          }}
          onClose={() => setComboProduct(null)}
          onConfirm={(selections, extraSum) => {
            const formatted: { name: string; quantity: number }[] = [];
            Object.values(selections).forEach(groupObj => {
              Object.entries(groupObj).forEach(([itemName, qty]) => {
                if (qty > 0) formatted.push({ name: itemName, quantity: qty });
              });
            });
            addToCart(comboProduct, formatted, extraSum);
            setComboProduct(null);
          }}
        />
      )}
    </div>
  );
}
