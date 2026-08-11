"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  ShoppingCart, Plus, Minus, Trash2, ArrowLeft, 
  CreditCard, QrCode, Check, RefreshCw, X, Search, ChefHat, 
  AlertCircle, ChevronRight
} from "lucide-react";

type Screen = "LOADING" | "ERROR" | "WELCOME" | "MENU" | "CART" | "CUSTOMER_NAME" | "PAYMENT" | "CONFIRMATION";

type StoreInfo = {
  id: string;
  name: string;
  logoUrl: string | null;
  totemWelcomeMessage: string | null;
};

type MenuProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  categoryId: string;
  isCombo: boolean;
  comboGroups?: ComboGroup[];
};

type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

type ComboGroup = {
  id: string;
  name: string;
  required: boolean;
  minItems: number;
  maxItems: number;
  items: ComboItem[];
};

type ComboItem = {
  id: string;
  name: string;
  price: number;
  productId: string;
};

type CartItem = {
  id: string; // unique cart item id
  product: MenuProduct;
  quantity: number;
  comboSelections?: {
    groupId: string;
    groupName: string;
    items: {
      itemId: string;
      name: string;
      price: number;
      quantity: number;
    }[];
  }[];
  totalPrice: number;
  notes?: string;
};

export default function TotemApp({ slug, token }: { slug: string; token: string }) {
  const [screen, setScreen] = useState<Screen>("LOADING");
  const [errorMsg, setErrorMsg] = useState("");
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<MenuProduct[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  
  // Combo modal state
  const [selectedComboProduct, setSelectedComboProduct] = useState<MenuProduct | null>(null);
  const [comboSelections, setComboSelections] = useState<Record<string, Record<string, number>>>({});

  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    
    // Only set timer if not on WELCOME, LOADING, ERROR, CONFIRMATION
    if (!["WELCOME", "LOADING", "ERROR", "CONFIRMATION"].includes(screen)) {
      inactivityTimerRef.current = setTimeout(() => {
        resetSession();
      }, 90000); // 90s
    }
  }, [screen]);

  useEffect(() => {
    // Track interactions
    const handleInteraction = () => resetInactivityTimer();
    window.addEventListener("touchstart", handleInteraction);
    window.addEventListener("click", handleInteraction);
    
    return () => {
      window.removeEventListener("touchstart", handleInteraction);
      window.removeEventListener("click", handleInteraction);
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [resetInactivityTimer]);

  useEffect(() => {
    resetInactivityTimer();
  }, [screen, cart, resetInactivityTimer]);

  useEffect(() => {
    async function init() {
      if (!token) {
        setErrorMsg("Token não fornecido");
        setScreen("ERROR");
        return;
      }
      
      try {
        // Generate Fingerprint
        const fpComponents = [
          window.screen.width,
          window.screen.height,
          navigator.userAgent,
          navigator.hardwareConcurrency || 1,
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          navigator.language,
          navigator.platform
        ].join("|");
        
        const encoder = new TextEncoder();
        const data = encoder.encode(fpComponents);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        setFingerprint(hashHex);

        // Validate Token & Load Menu
        // Mock API Call due to no backend available here yet
        // In real life: await fetch('/api/totem/auth', ...) & '/api/totem/menu'
        
        setTimeout(() => {
          setStore({
            id: "store123",
            name: "Fire Hub Burger",
            logoUrl: null,
            totemWelcomeMessage: "Bem-vindo ao Fire Hub!"
          });
          
          setCategories([
            { id: "c1", name: "Lanches", sortOrder: 1 },
            { id: "c2", name: "Bebidas", sortOrder: 2 },
            { id: "c3", name: "Sobremesas", sortOrder: 3 },
          ]);
          
          setProducts([
            {
              id: "p1", name: "Smash Burger", description: "Pão, carne e queijo.", price: 25.9, imageUrl: null, categoryId: "c1", isCombo: false
            },
            {
              id: "p2", name: "Combo Smash", description: "Smash + Fritas + Refri", price: 39.9, imageUrl: null, categoryId: "c1", isCombo: true,
              comboGroups: [
                { id: "g1", name: "Escolha sua bebida", required: true, minItems: 1, maxItems: 1, items: [{ id: "i1", name: "Coca Cola", price: 0, productId: "prod_coca" }, { id: "i2", name: "Guaraná", price: 0, productId: "prod_guarana" }] },
                { id: "g2", name: "Adicionais", required: false, minItems: 0, maxItems: 5, items: [{ id: "i3", name: "Bacon", price: 4.5, productId: "prod_bacon" }] }
              ]
            }
          ]);
          
          setActiveCategory("c1");
          setScreen("WELCOME");
        }, 1000);
        
      } catch (err) {
        console.error(err);
        setErrorMsg("Falha ao inicializar o terminal.");
        setScreen("ERROR");
      }
    }
    
    init();
    
    // Wakelock
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch (err) {
        console.log("WakeLock error:", err);
      }
    };
    requestWakeLock();
    
    return () => {
      if (wakeLock) wakeLock.release();
    };
  }, [slug, token]);

  useEffect(() => {
    // Heartbeat
    if (fingerprint && token) {
      heartbeatTimerRef.current = setInterval(() => {
        // fetch('/api/totem/heartbeat', { method: 'POST', body: JSON.stringify({ token, fingerprint }) })
      }, 60000);
    }
    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    };
  }, [fingerprint, token]);

  const resetSession = () => {
    setCart([]);
    setCustomerName("");
    setSearchQuery("");
    setScreen("WELCOME");
    if (categories.length > 0) setActiveCategory(categories[0].id);
  };

  const playBeep = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 800;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.log("Audio not supported");
    }
  };

  const formatPrice = (price: number) => {
    return `R$ ${price.toFixed(2).replace('.', ',')}`;
  };

  const handleAddToCart = (product: MenuProduct) => {
    if (product.isCombo) {
      setSelectedComboProduct(product);
      setComboSelections({});
      return;
    }
    
    const newItem: CartItem = {
      id: Math.random().toString(36).substring(7),
      product,
      quantity: 1,
      totalPrice: product.price
    };
    setCart([...cart, newItem]);
    playBeep();
  };

  const handleAddComboToCart = () => {
    if (!selectedComboProduct) return;
    
    // Validate required groups
    const groups = selectedComboProduct.comboGroups || [];
    for (const g of groups) {
      const selectedCount = Object.values(comboSelections[g.id] || {}).reduce((sum, qty) => sum + qty, 0);
      if (g.required && selectedCount < g.minItems) {
        alert("Por favor, selecione ao menos " + g.minItems + " item(s) em " + g.name);
        return;
      }
    }
    
    // Calculate price
    let additionalPrice = 0;
    const comboSelectionsFormatted: CartItem['comboSelections'] = [];
    
    for (const g of groups) {
      const itemsSelected = comboSelections[g.id] || {};
      const formattedItems = [];
      for (const itemId in itemsSelected) {
        const qty = itemsSelected[itemId];
        if (qty > 0) {
          const item = g.items.find(i => i.id === itemId);
          if (item) {
            additionalPrice += item.price * qty;
            formattedItems.push({
              itemId: item.id,
              name: item.name,
              price: item.price,
              quantity: qty
            });
          }
        }
      }
      if (formattedItems.length > 0) {
        comboSelectionsFormatted.push({
          groupId: g.id,
          groupName: g.name,
          items: formattedItems
        });
      }
    }
    
    const newItem: CartItem = {
      id: Math.random().toString(36).substring(7),
      product: selectedComboProduct,
      quantity: 1,
      comboSelections: comboSelectionsFormatted,
      totalPrice: selectedComboProduct.price + additionalPrice
    };
    
    setCart([...cart, newItem]);
    setSelectedComboProduct(null);
    setComboSelections({});
    playBeep();
  };

  const updateCartItemQty = (id: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.id === id) {
        const newQty = item.quantity + delta;
        if (newQty <= 0) return item;
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const removeCartItem = (id: string) => {
    setCart(cart.filter(item => item.id !== id));
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.totalPrice * item.quantity), 0);
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setScreen("CUSTOMER_NAME");
  };

  const handleConfirmOrder = async (paymentMethod: "MAQUININHA" | "PIX") => {
    setScreen("LOADING");
    // Mock order creation
    setTimeout(() => {
      setOrderNumber(Math.floor(100 + Math.random() * 900).toString());
      setScreen("CONFIRMATION");
      
      // Auto reset after 15s
      setTimeout(() => {
        resetSession();
      }, 15000);
    }, 1500);
  };

  // ---------------------------------------------------------
  // RENDER: LOADING
  // ---------------------------------------------------------
  if (screen === "LOADING") {
    return (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column", 
        alignItems: "center", justifyContent: "center", background: "#0F172A", color: "white"
      }}>
        <RefreshCw size={64} color="#E53935" style={{ animation: "spin 2s linear infinite" }} />
        <h2 style={{ marginTop: 24, fontSize: 24, fontWeight: 600 }}>Aguarde um momento...</h2>
        <style dangerouslySetInnerHTML={{ __html: "@keyframes spin { 100% { transform: rotate(360deg); } }" }} />
      </div>
    );
  }

  // ---------------------------------------------------------
  // RENDER: ERROR
  // ---------------------------------------------------------
  if (screen === "ERROR") {
    return (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column", 
        alignItems: "center", justifyContent: "center", background: "#0F172A", color: "white", padding: 32, textAlign: "center"
      }}>
        <AlertCircle size={80} color="#E53935" />
        <h1 style={{ marginTop: 24, fontSize: 32, fontWeight: 700, color: "#F87171" }}>Terminal Indisponível</h1>
        <p style={{ marginTop: 16, fontSize: 20, color: "#94A3B8" }}>{errorMsg}</p>
        <button 
          onClick={() => window.location.reload()}
          style={{
            marginTop: 48, padding: "20px 40px", fontSize: 20, fontWeight: 700, 
            background: "#E53935", color: "white", border: "none", borderRadius: 16, cursor: "pointer"
          }}
        >
          Tentar Novamente
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------
  // RENDER: WELCOME
  // ---------------------------------------------------------
  if (screen === "WELCOME") {
    return (
      <div 
        onClick={() => setScreen("MENU")}
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", 
          alignItems: "center", justifyContent: "center", 
          background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)", color: "white",
          cursor: "pointer"
        }}
      >
        {store?.logoUrl ? (
          <img src={store.logoUrl} alt="Logo" style={{ width: 300, height: 300, objectFit: "contain", marginBottom: 40 }} />
        ) : (
          <div style={{ width: 240, height: 240, background: "rgba(255,255,255,0.05)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 40 }}>
            <ChefHat size={120} color="#E53935" />
          </div>
        )}
        
        <h1 style={{ fontSize: 48, fontWeight: 800, marginBottom: 16, textAlign: "center", padding: "0 20px" }}>
          {store?.totemWelcomeMessage || "Faça seu pedido aqui!"}
        </h1>
        
        <div style={{
          marginTop: 60, padding: "24px 64px", background: "linear-gradient(90deg, #C62828, #E53935)",
          borderRadius: 32, fontSize: 32, fontWeight: 700, boxShadow: "0 10px 25px -5px rgba(229, 57, 53, 0.5)",
          animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite"
        }}>
          TOQUE PARA COMEÇAR
        </div>
        <style dangerouslySetInnerHTML={{ __html: "@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .8; transform: scale(0.95); } }" }} />
      </div>
    );
  }

  // ---------------------------------------------------------
  // COMMON STYLES
  // ---------------------------------------------------------
  const glassStyle = {
    background: "rgba(30, 41, 59, 0.7)",
    backdropFilter: "blur(16px)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 16,
  };

  const btnStyle = {
    background: "linear-gradient(135deg, #C62828, #E53935)",
    color: "white", border: "none", borderRadius: 12, padding: "16px 24px",
    fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8
  };

  // ---------------------------------------------------------
  // RENDER: MENU
  // ---------------------------------------------------------
  if (screen === "MENU") {
    const filteredProducts = products.filter(p => {
      if (searchQuery) return p.name.toLowerCase().includes(searchQuery.toLowerCase());
      return p.categoryId === activeCategory;
    });

    return (
      <div style={{ width: "100%", height: "100%", background: "#0F172A", display: "flex", flexDirection: "column", color: "white" }}>
        {/* HEADER */}
        <div style={{ padding: "24px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={() => setScreen("WELCOME")} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
              <ArrowLeft size={28} />
            </button>
            <h1 style={{ fontSize: 28, fontWeight: 700 }}>Cardápio</h1>
          </div>
          
          <div style={{ display: "flex", background: "rgba(255,255,255,0.1)", borderRadius: 16, padding: "8px 16px", alignItems: "center", width: 300 }}>
            <Search size={24} color="#94A3B8" />
            <input 
              type="text" 
              placeholder="Buscar..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ background: "transparent", border: "none", color: "white", fontSize: 20, padding: "8px 12px", width: "100%", outline: "none" }}
            />
          </div>
        </div>

        {/* CATEGORIES */}
        {!searchQuery && (
          <div style={{ padding: "24px 32px", display: "flex", gap: 16, overflowX: "auto", whiteSpace: "nowrap", flexShrink: 0 }}>
            {categories.sort((a,b) => a.sortOrder - b.sortOrder).map(cat => (
              <button 
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  padding: "16px 32px", fontSize: 22, fontWeight: 700, borderRadius: 30, border: "none",
                  background: activeCategory === cat.id ? "#E53935" : "rgba(255,255,255,0.1)",
                  color: activeCategory === cat.id ? "white" : "#94A3B8",
                  transition: "all 0.2s"
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* PRODUCTS GRID */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24, alignContent: "start" }}>
          {filteredProducts.map(prod => (
            <div 
              key={prod.id} 
              onClick={() => handleAddToCart(prod)}
              style={{ ...glassStyle, padding: 24, display: "flex", flexDirection: "column", cursor: "pointer", position: "relative", overflow: "hidden" }}
            >
              <div style={{ width: "100%", height: 180, background: "rgba(0,0,0,0.2)", borderRadius: 12, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {prod.imageUrl ? (
                  <img src={prod.imageUrl} alt={prod.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }} />
                ) : (
                  <ChefHat size={64} color="#475569" />
                )}
              </div>
              <h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, lineHeight: 1.2 }}>{prod.name}</h3>
              <p style={{ fontSize: 16, color: "#94A3B8", flex: 1, marginBottom: 16 }}>{prod.description}</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto" }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: "#16A34A" }}>{formatPrice(prod.price)}</span>
                <div style={{ background: "#E53935", borderRadius: "50%", width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Plus size={24} color="white" />
                </div>
              </div>
            </div>
          ))}
          {filteredProducts.length === 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 64, color: "#94A3B8", fontSize: 24 }}>
              Nenhum produto encontrado.
            </div>
          )}
        </div>

        {/* FLOATING CART BUTTON */}
        {cartItemCount > 0 && (
          <div style={{ position: "absolute", bottom: 32, right: 32, zIndex: 10 }}>
            <button 
              onClick={() => setScreen("CART")}
              style={{
                ...btnStyle, padding: "24px 40px", fontSize: 24, borderRadius: 32,
                boxShadow: "0 10px 25px rgba(229, 57, 53, 0.4)",
              }}
            >
              <ShoppingCart size={32} />
              <span>Ver Carrinho ({cartItemCount})</span>
              <span style={{ marginLeft: 16, fontWeight: 800 }}>{formatPrice(cartTotal)}</span>
            </button>
          </div>
        )}

        {/* COMBO MODAL */}
        {selectedComboProduct && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 100, display: "flex", alignItems: "flex-end" }}>
            <div style={{ width: "100%", height: "90%", background: "#1E293B", borderTopLeftRadius: 32, borderTopRightRadius: 32, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                <h2 style={{ fontSize: 32, fontWeight: 700, color: "white" }}>Montar {selectedComboProduct.name}</h2>
                <button onClick={() => setSelectedComboProduct(null)} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
                  <X size={28} />
                </button>
              </div>
              
              <div style={{ flex: 1, overflowY: "auto", padding: 32 }}>
                {selectedComboProduct.comboGroups?.map(group => {
                  const itemsSelected = comboSelections[group.id] || {};
                  const totalSelectedInGroup = Object.values(itemsSelected).reduce((sum, qty) => sum + qty, 0);
                  
                  return (
                    <div key={group.id} style={{ marginBottom: 40 }}>
                      <div style={{ background: "rgba(255,255,255,0.05)", padding: 24, borderRadius: 16, marginBottom: 16 }}>
                        <h3 style={{ fontSize: 24, fontWeight: 700, color: "white", marginBottom: 8 }}>{group.name}</h3>
                        <p style={{ fontSize: 18, color: "#94A3B8" }}>
                          {group.required ? "Obrigatório" : "Opcional"} • Escolha {group.minItems === group.maxItems ? group.maxItems : "de " + group.minItems + " a " + group.maxItems} opções
                        </p>
                      </div>
                      
                      <div style={{ display: "grid", gap: 16 }}>
                        {group.items.map(item => {
                          const qty = itemsSelected[item.id] || 0;
                          return (
                            <div key={item.id} style={{ ...glassStyle, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <h4 style={{ fontSize: 22, fontWeight: 600, color: "white" }}>{item.name}</h4>
                                {item.price > 0 && <span style={{ fontSize: 18, color: "#16A34A", fontWeight: 700 }}>+ {formatPrice(item.price)}</span>}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                                <button 
                                  onClick={() => {
                                    if (qty > 0) {
                                      setComboSelections({
                                        ...comboSelections,
                                        [group.id]: { ...itemsSelected, [item.id]: qty - 1 }
                                      });
                                    }
                                  }}
                                  style={{ background: "rgba(255,255,255,0.1)", border: "none", width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: qty > 0 ? "white" : "#475569" }}
                                >
                                  <Minus size={24} />
                                </button>
                                <span style={{ fontSize: 24, fontWeight: 700, color: "white", width: 24, textAlign: "center" }}>{qty}</span>
                                <button 
                                  onClick={() => {
                                    if (totalSelectedInGroup < group.maxItems) {
                                      setComboSelections({
                                        ...comboSelections,
                                        [group.id]: { ...itemsSelected, [item.id]: qty + 1 }
                                      });
                                    }
                                  }}
                                  style={{ background: totalSelectedInGroup < group.maxItems ? "#E53935" : "rgba(255,255,255,0.1)", border: "none", width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: totalSelectedInGroup < group.maxItems ? "white" : "#475569" }}
                                >
                                  <Plus size={24} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div style={{ padding: 32, borderTop: "1px solid rgba(255,255,255,0.1)", background: "#0F172A" }}>
                <button 
                  onClick={handleAddComboToCart}
                  style={{ ...btnStyle, width: "100%", padding: 24, fontSize: 24, borderRadius: 16 }}
                >
                  Adicionar ao Carrinho
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------
  // RENDER: CART
  // ---------------------------------------------------------
  if (screen === "CART") {
    return (
      <div style={{ width: "100%", height: "100%", background: "#0F172A", display: "flex", flexDirection: "column", color: "white" }}>
        <div style={{ padding: "24px 32px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <button onClick={() => setScreen("MENU")} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
            <ArrowLeft size={28} />
          </button>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>Seu Pedido</h1>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 32 }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", padding: 64, color: "#94A3B8" }}>
              <ShoppingCart size={80} style={{ margin: "0 auto", opacity: 0.5, marginBottom: 24 }} />
              <h2 style={{ fontSize: 32 }}>Seu carrinho está vazio</h2>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 24 }}>
              {cart.map(item => (
                <div key={item.id} style={{ ...glassStyle, padding: 24, display: "flex", alignItems: "center", gap: 24 }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{item.product.name}</h3>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#16A34A", marginBottom: 16 }}>{formatPrice(item.totalPrice)}</div>
                    
                    {item.comboSelections && item.comboSelections.length > 0 && (
                      <div style={{ background: "rgba(0,0,0,0.2)", padding: 16, borderRadius: 12 }}>
                        {item.comboSelections.map(g => (
                          <div key={g.groupId} style={{ marginBottom: 8 }}>
                            <strong style={{ fontSize: 16, color: "#94A3B8" }}>{g.groupName}:</strong>
                            {g.items.map(i => (
                              <div key={i.itemId} style={{ fontSize: 16, marginLeft: 16 }}>
                                • {i.quantity}x {i.name} {i.price > 0 ? " (+" + formatPrice(i.price) + ")" : ""}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.3)", borderRadius: 32, padding: 8 }}>
                      <button onClick={() => updateCartItemQty(item.id, -1)} style={{ background: "transparent", border: "none", width: 48, height: 48, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Minus size={24} />
                      </button>
                      <span style={{ fontSize: 24, fontWeight: 700, width: 48, textAlign: "center" }}>{item.quantity}</span>
                      <button onClick={() => updateCartItemQty(item.id, 1)} style={{ background: "transparent", border: "none", width: 48, height: 48, color: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Plus size={24} />
                      </button>
                    </div>
                    <button onClick={() => removeCartItem(item.id)} style={{ background: "transparent", border: "none", color: "#F87171", display: "flex", alignItems: "center", gap: 8, fontSize: 18 }}>
                      <Trash2 size={20} /> Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div style={{ padding: 32, background: "#1E293B", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <span style={{ fontSize: 24, color: "#94A3B8" }}>Total a pagar</span>
              <span style={{ fontSize: 40, fontWeight: 800, color: "white" }}>{formatPrice(cartTotal)}</span>
            </div>
            <button 
              onClick={handleCheckout}
              style={{ ...btnStyle, width: "100%", padding: 24, fontSize: 28, borderRadius: 16, height: 80 }}
            >
              Continuar <ChevronRight size={32} />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------
  // RENDER: CUSTOMER NAME
  // ---------------------------------------------------------
  if (screen === "CUSTOMER_NAME") {
    const keyboard = [
      ["Q","W","E","R","T","Y","U","I","O","P"],
      ["A","S","D","F","G","H","J","K","L"],
      ["Z","X","C","V","B","N","M"]
    ];
    
    return (
      <div style={{ width: "100%", height: "100%", background: "#0F172A", display: "flex", flexDirection: "column", color: "white" }}>
        <div style={{ padding: "24px 32px", display: "flex", alignItems: "center", gap: 16 }}>
          <button onClick={() => setScreen("CART")} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
            <ArrowLeft size={28} />
          </button>
        </div>
        
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
          <h2 style={{ fontSize: 40, fontWeight: 700, marginBottom: 16 }}>Como podemos te chamar?</h2>
          <p style={{ fontSize: 20, color: "#94A3B8", marginBottom: 40 }}>Seu nome será chamado quando o pedido estiver pronto.</p>
          
          <div style={{ width: "100%", maxWidth: 600, background: "rgba(255,255,255,0.05)", borderRadius: 16, padding: "24px 32px", fontSize: 40, fontWeight: 700, textAlign: "center", marginBottom: 48, minHeight: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {customerName || <span style={{ color: "rgba(255,255,255,0.2)" }}>Digite seu nome</span>}
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", width: "100%", maxWidth: 800 }}>
            {keyboard.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                {row.map(key => (
                  <button 
                    key={key} 
                    onClick={() => setCustomerName(prev => prev.length < 15 ? prev + key : prev)}
                    style={{ width: 64, height: 72, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 12, color: "white", fontSize: 28, fontWeight: 600 }}
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 12 }}>
              <button 
                onClick={() => setCustomerName("")}
                style={{ width: 140, height: 72, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 12, color: "white", fontSize: 24, fontWeight: 600 }}
              >
                Limpar
              </button>
              <button 
                onClick={() => setCustomerName(prev => prev + " ")}
                style={{ width: 300, height: 72, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 12, color: "white", fontSize: 24, fontWeight: 600 }}
              >
                Espaço
              </button>
              <button 
                onClick={() => setCustomerName(prev => prev.slice(0, -1))}
                style={{ width: 140, height: 72, background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 12, color: "white", fontSize: 24, fontWeight: 600 }}
              >
                Apagar
              </button>
            </div>
          </div>
        </div>
        
        <div style={{ padding: 32, background: "#1E293B" }}>
          <button 
            disabled={!customerName.trim()}
            onClick={() => setScreen("PAYMENT")}
            style={{ ...btnStyle, width: "100%", padding: 24, fontSize: 28, borderRadius: 16, height: 80, opacity: customerName.trim() ? 1 : 0.5 }}
          >
            Ir para Pagamento <ChevronRight size={32} />
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // RENDER: PAYMENT
  // ---------------------------------------------------------
  if (screen === "PAYMENT") {
    return (
      <div style={{ width: "100%", height: "100%", background: "#0F172A", display: "flex", flexDirection: "column", color: "white" }}>
        <div style={{ padding: "24px 32px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <button onClick={() => setScreen("CUSTOMER_NAME")} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
            <ArrowLeft size={28} />
          </button>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>Como deseja pagar?</h1>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 32 }}>
          <div style={{ fontSize: 48, fontWeight: 800, marginBottom: 48 }}>{formatPrice(cartTotal)}</div>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, width: "100%", maxWidth: 1000 }}>
            {/* PIX Option */}
            <div 
              onClick={() => handleConfirmOrder("PIX")}
              style={{ ...glassStyle, padding: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "2px solid #16A34A", transition: "transform 0.2s" }}
            >
              <QrCode size={80} color="#16A34A" style={{ marginBottom: 24 }} />
              <h2 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>PIX</h2>
              <p style={{ fontSize: 18, color: "#94A3B8", textAlign: "center" }}>Escaneie o QR Code no próximo passo</p>
            </div>
            
            {/* Maquininha Option */}
            <div 
              onClick={() => handleConfirmOrder("MAQUININHA")}
              style={{ ...glassStyle, padding: 48, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "2px solid #3B82F6" }}
            >
              <CreditCard size={80} color="#3B82F6" style={{ marginBottom: 24 }} />
              <h2 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Cartão</h2>
              <p style={{ fontSize: 18, color: "#94A3B8", textAlign: "center" }}>Pague na maquininha ao lado</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // RENDER: CONFIRMATION
  // ---------------------------------------------------------
  if (screen === "CONFIRMATION") {
    return (
      <div style={{ width: "100%", height: "100%", background: "#0F172A", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "white", padding: 32, textAlign: "center" }}>
        <div style={{ width: 160, height: 160, borderRadius: "50%", background: "#16A34A", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 40, animation: "popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)" }}>
          <Check size={80} color="white" strokeWidth={3} />
        </div>
        
        <h1 style={{ fontSize: 48, fontWeight: 800, marginBottom: 16 }}>Pedido Confirmado!</h1>
        <p style={{ fontSize: 24, color: "#94A3B8", marginBottom: 48 }}>Aguarde, logo chamaremos seu nome: <strong style={{ color: "white" }}>{customerName}</strong></p>
        
        <div style={{ background: "rgba(255,255,255,0.05)", padding: "40px 80px", borderRadius: 32, border: "2px dashed rgba(255,255,255,0.2)" }}>
          <div style={{ fontSize: 20, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Senha do Pedido</div>
          <div style={{ fontSize: 96, fontWeight: 900, color: "#E53935", lineHeight: 1 }}>{orderNumber}</div>
        </div>
        
        <style dangerouslySetInnerHTML={{ __html: "@keyframes popIn { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }" }} />
      </div>
    );
  }

  return null;
}
