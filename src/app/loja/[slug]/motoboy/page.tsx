"use client";

import { useState, useEffect, use } from "react";
import {
  MapPin,
  Phone,
  CheckCircle2,
  Navigation,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  LogOut,
  Lock,
  Loader2,
  Clock,
  DollarSign,
  PackageCheck,
  ChevronRight
} from "lucide-react";

export default function MotoboyPortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = use(params);
  const slug = resolvedParams.slug;

  const [session, setSession] = useState<{
    motoboyId: string;
    motoboyName: string;
    storeId: string;
    storeName: string;
    storeAddress?: string;
  } | null>(null);

  // Login Form State
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Orders & Routes State
  const [orders, setOrders] = useState<any[]>([]);
  const [createdRoutes, setCreatedRoutes] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Load Saved Motoboy Session from Cookie / localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`firehub_motoboy_session_${slug}`);
      if (saved) {
        setSession(JSON.parse(saved));
      }
    } catch (e) {}
  }, [slug]);

  // Fetch Orders for Authenticated Motoboy
  const fetchMotoboyOrders = async () => {
    if (!session) return;
    setLoadingOrders(true);
    try {
      const res = await fetch(`/api/motoboys/orders?motoboyId=${session.motoboyId}&storeId=${session.storeId}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }

      // Load routes from localStorage
      const savedRoutes = localStorage.getItem("firehub_created_routes");
      if (savedRoutes) {
        const allRoutes = JSON.parse(savedRoutes);
        const myRoutes = allRoutes.filter((r: any) =>
          r.motoboyName.toLowerCase().includes(session.motoboyName.toLowerCase()) ||
          session.motoboyName.toLowerCase().includes(r.motoboyName.toLowerCase())
        );
        setCreatedRoutes(myRoutes);
      }
    } catch (err) {
      console.error("Erro ao carregar pedidos do motoboy:", err);
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    if (!session) return;

    fetchMotoboyOrders();
    const interval = setInterval(fetchMotoboyOrders, 10000); // Polling 10s

    // Real-Time HTML5 Geolocation Tracking for Motoboy
    let watchId: number | null = null;

    const sendLocation = (lat: number, lng: number) => {
      fetch("/api/motoboys/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motoboyId: session.motoboyId, lat, lng })
      }).catch(e => console.warn("Erro enviando GPS do motoboy:", e));
    };

    if (typeof window !== "undefined" && "geolocation" in navigator) {
      // Immediate location update
      navigator.geolocation.getCurrentPosition(
        (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
        (err) => console.warn("GPS motoboy:", err),
        { enableHighAccuracy: true }
      );

      // Continuous tracking
      watchId = navigator.geolocation.watchPosition(
        (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
        (err) => console.warn("Watch GPS error:", err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    }

    return () => {
      clearInterval(interval);
      if (watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [session]);

  // Handle Login Submit
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || !password) {
      setLoginError("Informe o telefone e a senha de acesso!");
      return;
    }

    setLoadingLogin(true);
    setLoginError("");

    try {
      const res = await fetch("/api/motoboys/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeSlug: slug, phone, password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setLoginError(data.error || "Login inválido para esta loja");
        return;
      }

      const sessObj = {
        motoboyId: data.motoboy.id,
        motoboyName: data.motoboy.name,
        storeId: data.store.id,
        storeName: data.store.name,
        storeAddress: data.store.storeAddress || data.store.city
      };

      setSession(sessObj);
      localStorage.setItem(`firehub_motoboy_session_${slug}`, JSON.stringify(sessObj));

    } catch (err: any) {
      setLoginError("Erro ao conectar ao servidor.");
    } finally {
      setLoadingLogin(false);
    }
  };

  // Logout
  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem(`firehub_motoboy_session_${slug}`);
  };

  // Mark Order as Delivered
  const handleMarkDelivered = async (orderId: string) => {
    setUpdatingOrderId(orderId);
    try {
      const res = await fetch("/api/customer-order/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: "ENTREGUE" })
      });

      if (res.ok) {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: "ENTREGUE" } : o));
        setToastMsg("✅ Entrega confirmada com sucesso!");
        setTimeout(() => setToastMsg(null), 3000);
      }
    } catch (err) {
      alert("Erro ao confirmar entrega!");
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // Filter Active vs Completed Orders
  const activeOrders = orders.filter(o => o.status !== "ENTREGUE" && o.status !== "CANCELADO" && o.status !== "CANCELED");
  const completedOrders = orders.filter(o => o.status === "ENTREGUE");

  // ── LOGIN VIEW ──
  if (!session) {
    return (
      <div style={{
        minHeight: "100vh", background: "linear-[#0F172A, #1E293B]",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1.25rem", fontFamily: "sans-serif"
      }}>
        <div style={{
          background: "#FFFFFF", borderRadius: "20px", width: "100%", maxWidth: "420px",
          padding: "2rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)"
        }}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <div style={{
              width: "60px", height: "60px", borderRadius: "50%", background: "#EFF6FF",
              color: "#2563EB", display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: "0.75rem", boxShadow: "0 4px 12px rgba(37,99,235,0.2)"
            }}>
              <Navigation size={32} />
            </div>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 900, color: "#0F172A", margin: "0 0 4px 0" }}>
              Portal do Entregador
            </h1>
            <p style={{ fontSize: "0.85rem", color: "#64748B", margin: 0, textTransform: "capitalize" }}>
              Loja: <b>{slug.replace(/-/g, " ")}</b>
            </p>
          </div>

          {loginError && (
            <div style={{
              background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5",
              padding: "10px 14px", borderRadius: "10px", fontSize: "0.82rem",
              fontWeight: 700, marginBottom: "1.25rem", textAlign: "center"
            }}>
              ⚠️ {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                TELEFONE / NOME CADASTRADO:
              </label>
              <input
                type="text"
                placeholder="Seu telefone ou nome"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: "10px",
                  border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 600,
                  outline: "none", boxSizing: "border-box"
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                SENHA DE ACESSO:
              </label>
              <input
                type="password"
                placeholder="Digite sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: "10px",
                  border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontWeight: 600,
                  outline: "none", boxSizing: "border-box"
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loadingLogin}
              style={{
                width: "100%", padding: "14px", background: "#2563EB", color: "#FFFFFF",
                border: "none", borderRadius: "12px", fontSize: "1rem", fontWeight: 900,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, marginTop: "0.5rem", boxShadow: "0 4px 14px rgba(37,99,235,0.4)"
              }}
            >
              {loadingLogin ? <Loader2 size={20} className="animate-spin" /> : <Lock size={18} />}
              Entrar no aplicativo
            </button>
          </form>

          <div style={{ marginTop: "1.5rem", padding: "10px", background: "#F8FAFC", borderRadius: "10px", textAlign: "center", fontSize: "0.76rem", color: "#64748B" }}>
            🔒 Acesso restrito e isolado para motoboys cadastrados da loja.
          </div>
        </div>
      </div>
    );
  }

  // ── MOTOBOY APP DASHBOARD VIEW ──
  return (
    <div style={{ minHeight: "100vh", background: "#F1F5F9", fontFamily: "sans-serif", paddingBottom: "3rem" }}>

      {/* Top Header */}
      <div style={{
        background: "#0F172A", color: "#FFFFFF", padding: "1rem 1.25rem",
        position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
      }}>
        <div style={{ maxWidth: "600px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ background: "#22C55E", width: "8px", height: "8px", borderRadius: "50%" }} />
              <span style={{ fontWeight: 900, fontSize: "1.05rem" }}>🛵 {session.motoboyName}</span>
            </div>
            <p style={{ margin: "2px 0 0 0", fontSize: "0.78rem", color: "#94A3B8" }}>
              Loja: <b>{session.storeName}</b>
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={fetchMotoboyOrders}
              style={{ background: "#334155", color: "#fff", border: "none", padding: "8px 12px", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
            >
              <RefreshCw size={14} className={loadingOrders ? "animate-spin" : ""} /> Sync
            </button>

            <button
              onClick={handleLogout}
              style={{ background: "#FEF2F2", color: "#DC2626", border: "none", padding: "8px 12px", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 800, cursor: "pointer" }}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: "600px", margin: "0 auto", padding: "1rem" }}>

        {/* Status Card */}
        <div style={{
          background: "#FFFFFF", borderRadius: "14px", padding: "1rem", marginBottom: "1rem",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", border: "1px solid #E2E8F0",
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
        }}>
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 700 }}>ENTREGAS PENDENTES</span>
            <p style={{ margin: "4px 0 0 0", fontSize: "1.6rem", fontWeight: 900, color: "#2563EB" }}>
              {activeOrders.length}
            </p>
          </div>

          <div style={{ textAlign: "center", borderLeft: "1px solid #E2E8F0" }}>
            <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 700 }}>CONCLUÍDAS HOJE</span>
            <p style={{ margin: "4px 0 0 0", fontSize: "1.6rem", fontWeight: 900, color: "#16A34A" }}>
              {completedOrders.length}
            </p>
          </div>
        </div>

        {/* Section: ACTIVE ROUTES */}
        <h2 style={{ fontSize: "1.05rem", fontWeight: 900, color: "#0F172A", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
          <MapPin size={18} color="#2563EB" /> Minhas Entregas Pendentes ({activeOrders.length})
        </h2>

        {activeOrders.length === 0 ? (
          <div style={{ background: "#FFFFFF", borderRadius: "14px", padding: "2.5rem 1rem", textAlign: "center", color: "#94A3B8", border: "1px solid #E2E8F0" }}>
            <PackageCheck size={48} style={{ margin: "0 auto 0.5rem", opacity: 0.5 }} />
            <p style={{ fontWeight: 800, fontSize: "0.95rem", color: "#334155", margin: "0 0 4px 0" }}>
              Nenhuma entrega pendente!
            </p>
            <p style={{ fontSize: "0.8rem", margin: 0 }}>
              Aguarde a loja despachar uma nova rota para você.
            </p>
          </div>
        ) : (
          activeOrders.map((order, index) => {
            const rawAddr = (order.customerAddress || order.address || "").trim();
            const addr = rawAddr || [order.street, order.number ? `nº ${order.number}` : "", order.neighborhood ? `Bairro: ${order.neighborhood}` : ""].filter(Boolean).join(", ") || "Endereço a confirmar";

            const num = (order as any).dailyOrderNumber || order.orderNumber || order.displayId || order.id.replace(/\D/g, "").slice(-2) || "#";
            const cleanPhone = (order.customerPhone || "").replace(/\D/g, "");
            const waLink = cleanPhone ? `https://wa.me/55${cleanPhone}?text=Olá!%20Sou%20o%20entregador%20da%20loja%20e%20estou%20a%20caminho%20do%20seu%20endereço!` : null;

            const mapsNavUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${addr}`)}`;
            const wazeNavUrl = `https://waze.com/ul?q=${encodeURIComponent(addr)}&navigate=yes`;

            const changeAmount = (order as any).changeAmount;
            const notesText = order.notes || "";

            return (
              <div
                key={order.id}
                style={{
                  background: "#FFFFFF", borderRadius: "16px", padding: "1.1rem", marginBottom: "1rem",
                  border: "2px solid #2563EB", boxShadow: "0 4px 12px rgba(37,99,235,0.15)",
                  position: "relative"
                }}
              >
                {/* Stop Sequence Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem", borderBottom: "1px solid #F1F5F9", paddingBottom: "0.6rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      background: "#2563EB", color: "#fff", width: "26px", height: "26px", borderRadius: "50%",
                      fontSize: "0.85rem", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center"
                    }}>
                      {index + 1}º
                    </span>
                    <span style={{ fontWeight: 900, fontSize: "1.15rem", color: "#0F172A" }}>
                      Pedido #{num}
                    </span>
                  </div>

                  <span style={{ background: "#EFF6FF", color: "#1D4ED8", fontSize: "0.75rem", fontWeight: 800, padding: "3px 8px", borderRadius: "6px" }}>
                    {order.source || order.platform || "Direto"}
                  </span>
                </div>

                {/* Customer Details */}
                <div style={{ marginBottom: "0.85rem", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: "0.98rem", color: "#1E293B" }}>
                    👤 {order.customerName}
                  </p>
                  
                  <div style={{ background: "#EFF6FF", padding: "8px 12px", borderRadius: "10px", border: "1px solid #BFDBFE" }}>
                    <p style={{ margin: 0, fontWeight: 800, fontSize: "0.92rem", color: "#1D4ED8", lineHeight: "1.4" }}>
                      📍 {addr}
                    </p>
                  </div>

                  {/* Payment & Change Info */}
                  <div style={{ background: "#F8FAFC", padding: "8px 12px", borderRadius: "10px", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", fontWeight: 800, color: "#334155" }}>
                      <DollarSign size={16} color="#16A34A" />
                      <span>Pagamento: <b style={{ color: "#0F172A" }}>{order.paymentMethod || "Na entrega"}</b> — R$ {Number(order.totalAmount || 0).toFixed(2).replace(".", ",")}</span>
                    </div>

                    {(changeAmount || notesText.toLowerCase().includes("troco")) && (
                      <div style={{ background: "#FEF3C7", color: "#92400E", padding: "4px 8px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content" }}>
                        💵 {changeAmount ? `Levar Troco para R$ ${Number(changeAmount).toFixed(2).replace(".", ",")}` : `Atenção: ${notesText}`}
                      </div>
                    )}
                  </div>

                  {/* Notes / Reference Point */}
                  {notesText && !notesText.toLowerCase().includes("troco") && (
                    <div style={{ background: "#F1F5F9", padding: "6px 10px", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 700, color: "#475569" }}>
                      📌 <b>Obs/Ref:</b> {notesText}
                    </div>
                  )}
                </div>

                {/* Quick Navigation Buttons (Google Maps + Waze + WhatsApp) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.85rem" }}>
                  <a
                    href={mapsNavUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: "#EA4335", color: "#FFFFFF", padding: "10px", borderRadius: "10px",
                      textDecoration: "none", fontSize: "0.82rem", fontWeight: 900, textAlign: "center",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6
                    }}
                  >
                    🗺️ Google Maps
                  </a>

                  <a
                    href={wazeNavUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: "#33CCFF", color: "#0F172A", padding: "10px", borderRadius: "10px",
                      textDecoration: "none", fontSize: "0.82rem", fontWeight: 900, textAlign: "center",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6
                    }}
                  >
                    🧭 Waze
                  </a>
                </div>

                {waLink && (
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      background: "#25D366", color: "#FFFFFF", padding: "8px", borderRadius: "10px",
                      textDecoration: "none", fontSize: "0.82rem", fontWeight: 800, marginBottom: "0.85rem"
                    }}
                  >
                    <MessageCircle size={16} /> Falar com Cliente no WhatsApp
                  </a>
                )}

                {/* Confirm Delivery Button */}
                <button
                  onClick={() => handleMarkDelivered(order.id)}
                  disabled={updatingOrderId === order.id}
                  style={{
                    width: "100%", padding: "12px", background: "#16A34A", color: "#FFFFFF",
                    border: "none", borderRadius: "12px", fontSize: "0.95rem", fontWeight: 900,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 6, boxShadow: "0 4px 12px rgba(22,163,74,0.3)"
                  }}
                >
                  {updatingOrderId === order.id ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  Confirmar Entrega Realizada
                </button>

              </div>
            );
          })
        )}

      </div>

      {/* Toast Feedback */}
      {toastMsg && (
        <div style={{
          position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)",
          background: "#16A34A", color: "#fff", padding: "12px 24px", borderRadius: "30px",
          fontWeight: 800, fontSize: "0.9rem", boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
          zIndex: 9999
        }}>
          {toastMsg}
        </div>
      )}

    </div>
  );
}
