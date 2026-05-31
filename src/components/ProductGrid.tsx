"use client";

import { useCart } from "./CartProvider";
import { Plus, Minus, Info, Clock, Search, ShoppingCart, Trash2, X, AlertCircle } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ProductGrid({ products, deliveryInfo, isLoggedIn = true, isIcebox = false }: { products: any[], deliveryInfo: { limitStr: string, deliveryStr: string, limitDateIso?: string }, isLoggedIn?: boolean, isIcebox?: boolean }) {
  const loginUrl = isIcebox ? "/icebox/login" : "/login?callbackUrl=/store/compras";
  const { items, addToCart, removeFromCart, total } = useCart();
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Todos");
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [showMinError, setShowMinError] = useState(false);
  const router = useRouter();
  const MIN_ORDER = 300;
  
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const limitDate = deliveryInfo.limitDateIso ? new Date(deliveryInfo.limitDateIso) : null;
  const remainingMs = limitDate && now ? limitDate.getTime() - now.getTime() : 0;
  const isWarning = remainingMs > 0 && remainingMs <= 5 * 60 * 1000;
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);

  const handleAdd = (product: any) => {
    if (!isLoggedIn) {
      router.push(loginUrl);
      return;
    }
    addToCart(product, 1);
    setAddedIds(prev => ({ ...prev, [product.id]: true }));
    setTimeout(() => {
      setAddedIds(prev => ({ ...prev, [product.id]: false }));
    }, 1000);
  };

  const categories = ["Todos", "Congelados", "Resfriados", "Doces", "Embalagens", "Outros"];

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === "Todos" || (p.category === selectedCategory) || (!p.category && selectedCategory === "Outros");
      return matchesSearch && matchesCategory;
    });
  }, [products, searchQuery, selectedCategory]);

  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  const handleFinalizarPedido = () => {
    if (!isLoggedIn) {
      router.push(loginUrl);
      return;
    }
    if (total < MIN_ORDER) {
      setShowMinError(true);
      return;
    }
    setShowMinError(false);
    router.push(isIcebox ? "/icebox/cart" : "/store/cart");
  };

  const cartSidebarJSX = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontWeight: 700, fontSize: "1.05rem", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
          <ShoppingCart size={18} /> Carrinho
          {itemCount > 0 && <span style={{ background: "#1565C0", color: "#fff", borderRadius: "20px", padding: "1px 8px", fontSize: "0.75rem" }}>{itemCount}</span>}
        </h3>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "0.75rem", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" as any }}>
        {items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
            <ShoppingCart size={36} style={{ opacity: 0.25, marginBottom: "0.75rem" }} />
            <p style={{ fontSize: "0.88rem" }}>Seu carrinho está vazio</p>
            <p style={{ fontSize: "0.78rem" }}>Adicione produtos para começar</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {items.map(item => (
              <div key={item.id} style={{ background: "#fff", borderRadius: "10px", padding: "0.75rem", border: "1px solid #F1F5F9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.85rem", flex: 1 }}>{item.name}</span>
                  <button onClick={() => removeFromCart(item.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "#EF4444" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <button onClick={() => { if (item.quantity > 1) addToCart({ id: item.id, name: item.name, price: item.price }, -1); else removeFromCart(item.id); }} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1.5px solid #E2E8F0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Minus size={13} />
                    </button>
                    <span style={{ fontWeight: 700, fontSize: "0.9rem", minWidth: "24px", textAlign: "center" }}>{item.quantity}</span>
                    <button onClick={() => addToCart({ id: item.id, name: item.name, price: item.price }, 1)} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1.5px solid #1565C0", background: "#1565C010", color: "#1565C0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Plus size={13} />
                    </button>
                  </div>
                  <span style={{ fontWeight: 700, color: "#1565C0", fontSize: "0.9rem" }}>R$ {(item.price * item.quantity).toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div style={{ borderTop: "2px solid #E2E8F0", padding: "1rem 1.25rem" }}>
          {/* Progress bar + alerta de mínimo */}
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontWeight: 600, color: "#64748B", fontSize: "0.82rem" }}>Total</span>
              <span style={{ fontWeight: 800, fontSize: "1.05rem", color: total >= MIN_ORDER ? "#16A34A" : "#1565C0" }}>
                R$ {total.toFixed(2)}
              </span>
            </div>

            {/* Barra de progresso em relação ao mínimo */}
            {total < MIN_ORDER && (
              <>
                <div style={{ width: "100%", height: "6px", background: "#E2E8F0", borderRadius: "3px", overflow: "hidden", marginBottom: "6px" }}>
                  <div style={{ width: `${Math.min((total / MIN_ORDER) * 100, 100)}%`, height: "100%", background: "linear-gradient(90deg, #F59E0B, #EF4444)", borderRadius: "3px", transition: "width 0.3s" }} />
                </div>
                <p style={{ fontSize: "0.75rem", color: "#B45309", margin: 0, textAlign: "center" }}>
                  Faltam <strong>R$ {(MIN_ORDER - total).toFixed(2)}</strong> para o mínimo de R$ {MIN_ORDER},00
                </p>
              </>
            )}

            {total >= MIN_ORDER && (
              <div style={{ background: "#F0FDF4", borderRadius: 8, padding: "6px 10px", textAlign: "center" }}>
                <span style={{ fontSize: "0.78rem", color: "#16A34A", fontWeight: 700 }}>✅ Pedido mínimo atingido!</span>
              </div>
            )}
          </div>

          {/* Alerta vermelho ao tentar finalizar sem atingir o mínimo */}
          {showMinError && total < MIN_ORDER && (
            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 10, padding: "10px 12px", marginBottom: "0.75rem", display: "flex", gap: 8, alignItems: "flex-start", animation: "shake 0.4s ease" }}>
              <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontWeight: 700, fontSize: "0.82rem", color: "#DC2626", margin: "0 0 2px" }}>Pedido mínimo não atingido</p>
                <p style={{ fontSize: "0.75rem", color: "#B91C1C", margin: 0 }}>Adicione mais <strong>R$ {(MIN_ORDER - total).toFixed(2)}</strong> em produtos para finalizar.</p>
              </div>
            </div>
          )}

          <button
            onClick={handleFinalizarPedido}
            style={{
              display: "block", width: "100%", padding: "0.7rem", borderRadius: "10px",
              background: total >= MIN_ORDER
                ? "linear-gradient(135deg, #1565C0, #1976D2)"
                : "linear-gradient(135deg, #94A3B8, #64748B)",
              color: "#fff", fontWeight: 700, fontSize: "0.92rem", textAlign: "center",
              border: "none", cursor: "pointer",
              boxShadow: total >= MIN_ORDER ? "0 4px 12px rgba(21,101,192,0.3)" : "none",
              fontFamily: "inherit"
            }}
          >
            {total >= MIN_ORDER ? "Finalizar Pedido" : `Faltam R$ ${(MIN_ORDER - total).toFixed(2)}`}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="container" style={{ display: "flex", gap: "1.5rem", maxWidth: "1400px" }}>
        {/* LEFT: Products */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Action Buttons — só mostra quando NÃO é Icebox independente */}
          {!isIcebox && isLoggedIn && (
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
              <Link href="/store/orders" style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem",
                background: "linear-gradient(135deg, #1565C0, #1976D2)", color: "#fff",
                textDecoration: "none", boxShadow: "0 3px 10px rgba(21,101,192,0.25)",
                transition: "opacity 0.2s", whiteSpace: "nowrap",
              }}>
                📋 Meus Pedidos
              </Link>
              <Link href="/store/perfil" style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem",
                background: "#fff", color: "#475569", border: "1.5px solid #E2E8F0",
                textDecoration: "none", transition: "all 0.2s", whiteSpace: "nowrap",
              }}>
                👤 Meu Perfil
              </Link>
              <Link href="/store" style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem",
                background: "#fff", color: "#475569", border: "1.5px solid #E2E8F0",
                textDecoration: "none", transition: "all 0.2s", whiteSpace: "nowrap",
              }}>
                ← Voltar
              </Link>
            </div>
          )}

          {/* Banner de Entrega */}
          <div style={{
            backgroundColor: "var(--primary-light)",
            borderLeft: "4px solid var(--primary)",
            padding: "1rem 1.5rem",
            borderRadius: "var(--radius-md)",
            marginBottom: "2rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem"
          }}>
            <Clock color="var(--primary)" size={24} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <h3 style={{ color: "var(--primary)", fontWeight: "bold", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    Atenção ao prazo de entrega
                  </h3>
                  <p style={{ color: "var(--text-main)", fontSize: "0.95rem" }}>
                    Fechando o pedido até <strong>{deliveryInfo.limitStr}</strong>, sua entrega será feita na <strong>{deliveryInfo.deliveryStr}</strong>.
                  </p>
                </div>
                {now && (
                  <div style={{ backgroundColor: "white", padding: "0.5rem 1rem", borderRadius: "8px", fontWeight: "bold", color: "var(--primary)", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
                    Hora Atual: {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                )}
              </div>
              
              {isWarning && (
                <div style={{ 
                  marginTop: "1rem", padding: "0.8rem", backgroundColor: "var(--danger)", 
                  color: "white", borderRadius: "8px", fontWeight: "bold", animation: "pulse 1.5s infinite"
                }}>
                  🚨 Faltam apenas {minutes}m e {seconds}s! Faça seu pedido rápido!
                </div>
              )}
            </div>
          </div>
          <style>{`@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.8; } 100% { opacity: 1; } }`}</style>

          {/* Filtros */}
          <div style={{ marginBottom: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ position: "relative" }}>
              <Search size={20} style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }} />
              <input type="text" placeholder="Buscar produtos por nome ou descrição..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input-field" style={{ paddingLeft: "3rem", backgroundColor: "var(--surface-1)" }} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {categories.map(cat => (
                <button key={cat} onClick={() => setSelectedCategory(cat)} style={{
                  padding: "0.4rem 1rem", borderRadius: "20px", fontSize: "0.9rem", fontWeight: "600", cursor: "pointer",
                  border: "1px solid", borderColor: selectedCategory === cat ? "var(--primary)" : "var(--border-color)",
                  backgroundColor: selectedCategory === cat ? "var(--primary)" : "transparent",
                  color: selectedCategory === cat ? "white" : "var(--text-main)", transition: "all 0.2s"
                }}>{cat}</button>
              ))}
            </div>
          </div>

          {filteredProducts.length === 0 && (
            <div style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--text-muted)" }}>Nenhum produto encontrado para sua busca.</div>
          )}

          <div className="product-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
            {filteredProducts.map(product => (
              <div key={product.id} className="card" style={{ display: "flex", flexDirection: "column", padding: "1rem" }}>
                {product.imageUrl ? (
                  <div style={{ position: "relative", width: "100%", height: "180px", marginBottom: "0.75rem" }}>
                    <Image src={product.imageUrl} alt={product.name} fill style={{ objectFit: "cover", borderRadius: "var(--radius-sm)" }} sizes="(max-width: 768px) 50vw, 300px" />
                  </div>
                ) : (
                  <div style={{ width: "100%", height: "200px", backgroundColor: "#f1f5f9", borderRadius: "var(--radius-sm)", marginBottom: "1rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <PackageIcon />
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                  <h3 className="font-bold" style={{ fontSize: "1.1rem" }}>{product.name}</h3>
                  {product.category && (
                    <span style={{ fontSize: "0.7rem", backgroundColor: "var(--surface-2)", color: "var(--text-muted)", padding: "0.2rem 0.5rem", borderRadius: "10px", fontWeight: "bold" }}>{product.category}</span>
                  )}
                </div>
                <p className="text-muted" style={{ fontSize: "0.85rem", flex: 1, marginBottom: "1rem" }}>{product.description}</p>
                <div className="flex justify-between items-center mt-auto" style={{ borderTop: "1px solid var(--border-color)", paddingTop: "1rem" }}>
                  <span className="font-extrabold gradient-text" style={{ fontSize: "1.25rem" }}>R$ {product.price.toFixed(2)}</span>
                  <button className="btn btn-primary" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }} onClick={() => handleAdd(product)}>
                    {addedIds[product.id] ? "✓ Adicionado!" : <><Plus size={16} /> Adicionar</>}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Cart Sidebar (Desktop) */}
        <div style={{ width: "340px", flexShrink: 0, position: "sticky", top: "70px", height: "calc(100vh - 90px)", background: "#FAFAFA", borderRadius: "14px", border: "1px solid #E2E8F0", overflow: "hidden", display: "none", flexDirection: "column" }} className="cart-sidebar-desktop">
          {cartSidebarJSX}
        </div>
      </div>

      {/* Mobile: floating cart button */}
      {itemCount > 0 && (
        <button onClick={() => setShowMobileCart(true)} className="cart-mobile-btn" style={{
          position: "fixed", bottom: "1.25rem", right: "1.25rem", width: "60px", height: "60px",
          borderRadius: "50%", background: "linear-gradient(135deg, #1565C0, #1976D2)", color: "#fff",
          border: "none", cursor: "pointer", boxShadow: "0 6px 20px rgba(21,101,192,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100
        }}>
          <ShoppingCart size={24} />
          <span style={{ position: "absolute", top: "-4px", right: "-4px", background: "#FF8A00", color: "#fff", borderRadius: "50%", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.72rem", fontWeight: 800 }}>{itemCount}</span>
        </button>
      )}

      {/* Mobile cart bottom sheet */}
      {showMobileCart && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200 }}>
          <div onClick={() => setShowMobileCart(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "75vh", background: "#fff", borderRadius: "20px 20px 0 0", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "0.75rem", textAlign: "center", flexShrink: 0 }}>
              <div style={{ width: "40px", height: "4px", background: "#CBD5E1", borderRadius: "2px", margin: "0 auto" }} />
            </div>
            {cartSidebarJSX}
          </div>
        </div>
      )}

      <style>{`
        @media(min-width: 1024px) {
          .cart-sidebar-desktop { display: flex !important; flex-direction: column !important; }
          .cart-mobile-btn { display: none !important; }
        }
        @media(max-width: 480px) {
          .product-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 0.5rem !important; }
          .product-grid .card { padding: 0.65rem !important; }
          .product-grid .card h3 { font-size: 0.85rem !important; }
          .product-grid .card .btn { padding: 0.4rem 0.6rem !important; font-size: 0.75rem !important; }
          .container { padding-left: 0.5rem !important; padding-right: 0.5rem !important; }
        }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
      `}</style>
    </>
  );
}

function PackageIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

