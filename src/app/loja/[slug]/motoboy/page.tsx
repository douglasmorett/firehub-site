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
import { getBeveragesFromOrder } from "@/lib/beverage";

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
        setBevKeywords(data.customBeverageKeywords || "");
      }
      // O localStorage "firehub_created_routes" que era lido aqui só existia no
      // navegador da LOJA — no celular do motoboy estava sempre vazio. A rota
      // (nome, cor, sequência) agora vem do servidor, junto com cada pedido.
    } catch (err) {
      console.error("Erro ao carregar pedidos do motoboy:", err);
    } finally {
      setLoadingOrders(false);
    }
  };

  // GPS na tela: "ativo" é a loja conseguindo VER o entregador no mapa. Sem
  // este estado, GPS negado no celular era invisível — o motoboy achava que
  // estava sendo acompanhado e o mapa da roteirização ficava vazio.
  const [gpsStatus, setGpsStatus] = useState<"buscando" | "ativo" | "negado">("buscando");

  useEffect(() => {
    if (!session) return;

    fetchMotoboyOrders();
    const interval = setInterval(fetchMotoboyOrders, 10000); // Polling 10s

    // Real-Time HTML5 Geolocation Tracking for Motoboy
    let watchId: number | null = null;

    // O watchPosition dispara a cada ~1s andando de moto. Mandar tudo é uma
    // requisição por segundo por entregador — e o mapa da loja atualiza a cada
    // 10s, então o excesso é invisível para quem olha. 12s entre envios cobre.
    let ultimoEnvio = 0;
    const sendLocation = (lat: number, lng: number) => {
      const agora = Date.now();
      if (agora - ultimoEnvio < 12_000) return;
      ultimoEnvio = agora;
      fetch("/api/motoboys/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motoboyId: session.motoboyId, lat, lng })
      }).then(() => setGpsStatus("ativo"))
        .catch(e => console.warn("Erro enviando GPS do motoboy:", e));
    };

    if (typeof window !== "undefined" && "geolocation" in navigator) {
      // Immediate location update
      navigator.geolocation.getCurrentPosition(
        (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
        (err) => { console.warn("GPS motoboy:", err); if (err.code === err.PERMISSION_DENIED) setGpsStatus("negado"); },
        { enableHighAccuracy: true }
      );

      // Continuous tracking
      watchId = navigator.geolocation.watchPosition(
        (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
        (err) => { console.warn("Watch GPS error:", err); if (err.code === err.PERMISSION_DENIED) setGpsStatus("negado"); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    } else {
      setGpsStatus("negado");
    }

    // Celular no bolso suspende o JavaScript da aba — o watch para junto. Na
    // volta ao primeiro plano, manda a posição NA HORA (zerando o freio de
    // 12s): é o momento em que a loja mais precisa saber onde ele está.
    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      if ("geolocation" in navigator) {
        ultimoEnvio = 0;
        navigator.geolocation.getCurrentPosition(
          (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
          () => {},
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", aoVoltar);
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

      const motoboyId = data.motoboy?.id || data.motoboyId;
      const motoboyName = data.motoboy?.name || data.motoboyName;
      const storeId = data.store?.id || data.storeId;
      const storeName = data.store?.name || data.storeName;
      const storeAddress = data.store?.storeAddress || data.storeAddress || data.store?.city || "";

      if (!motoboyId || !storeId) {
        setLoginError(data.error || "Dados do motoboy/loja não encontrados.");
        return;
      }

      const sessObj = {
        motoboyId,
        motoboyName,
        storeId,
        storeName,
        storeAddress
      };

      setSession(sessObj);
      localStorage.setItem(`firehub_motoboy_session_${slug}`, JSON.stringify(sessObj));

    } catch (err: any) {
      console.error("Login motoboy erro:", err);
      setLoginError(err?.message || "Erro ao conectar ao servidor.");
    } finally {
      setLoadingLogin(false);
    }
  };

  // Logout
  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem(`firehub_motoboy_session_${slug}`);
  };

  // Beverage Confirmation Modal State
  const [beverageModalOrder, setBeverageModalOrder] = useState<any | null>(null);
  const [beveragesList, setBeveragesList] = useState<{ name: string; quantity: number }[]>([]);
  /** Palavras de bebida personalizadas da loja — vêm junto com os pedidos. */
  const [bevKeywords, setBevKeywords] = useState<string>("");

  // Initiate Delivery Flow (Checks for Beverages)
  const handleInitiateDelivery = (order: any) => {
    const bevList = getBeveragesFromOrder(order, bevKeywords);
    if (bevList && bevList.length > 0) {
      setBeveragesList(bevList);
      setBeverageModalOrder(order);
    } else {
      handleMarkDelivered(order.id);
    }
  };

  // Mark Order as Delivered
  //
  // Chamava `PATCH /api/customer-order/status` — rota que só tem GET e PUT, e
  // que exige a sessão do PAINEL, que o motoboy não tem. Todo toque devolvia
  // 405, e como só se tratava o `res.ok`, o entregador via o spinner rodar e
  // nada acontecia, sem mensagem nenhuma. A baixa acabava sendo feita à mão
  // por alguém da loja. A rota nova valida a amarração (pedido atribuído a
  // ESTE motoboy NESTA loja) e dispara os efeitos: parceiro, WhatsApp, fatura.
  const handleMarkDelivered = async (orderId: string) => {
    if (!session) return;
    setUpdatingOrderId(orderId);

    // A confirmação de entrega É uma posição conhecida: o motoboy está na
    // porta do cliente. Registrar aqui garante um "onde ele esteve por
    // último" no mapa mesmo quando o rastreio contínuo falhou o dia todo —
    // e sem esperar resposta, para não atrasar a baixa.
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          fetch("/api/motoboys/location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ motoboyId: session.motoboyId, lat: pos.coords.latitude, lng: pos.coords.longitude })
          }).then(() => setGpsStatus("ativo")).catch(() => {});
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    }

    try {
      const res = await fetch("/api/motoboys/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, motoboyId: session.motoboyId, storeId: session.storeId })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: "ENTREGUE" } : o));
        setToastMsg("✅ Entrega confirmada com sucesso!");
        setTimeout(() => setToastMsg(null), 3000);
      } else {
        // Falha SEM mensagem é o que escondeu este botão quebrado por meses.
        setToastMsg(`⚠️ ${data.error || "Não consegui confirmar. Tente de novo."}`);
        setTimeout(() => setToastMsg(null), 4500);
      }
    } catch (err) {
      setToastMsg("⚠️ Sem conexão — a entrega NÃO foi confirmada. Tente de novo.");
      setTimeout(() => setToastMsg(null), 4500);
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // Filter Active vs Completed Orders
  //
  // A ordem aqui é a ordem em que o motoboy RODA. Vinha por data de criação
  // DESC (mais novo primeiro) — o inverso de qualquer rota. Agora: primeiro a
  // sequência que a loja montou no mapa (routeSequence 1º, 2º, 3º…); quem não
  // tem sequência entra depois, do pedido mais antigo para o mais novo, que é
  // a ordem justa de atendimento.
  const activeOrders = orders
    .filter(o => o.status !== "ENTREGUE" && o.status !== "CANCELADO" && o.status !== "CANCELED")
    .sort((a, b) => {
      const sa = a.routeSequence ?? Infinity;
      const sb = b.routeSequence ?? Infinity;
      if (sa !== sb) return sa - sb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  const completedOrders = orders.filter(o => o.status === "ENTREGUE");

  // Change Password State
  const [showPassModal, setShowPassModal] = useState(false);
  const [currentPassInput, setCurrentPassInput] = useState("");
  const [newPassInput, setNewPassInput] = useState("");
  const [loadingPass, setLoadingPass] = useState(false);
  const [passMsg, setPassMsg] = useState("");

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (!currentPassInput || !newPassInput) {
      setPassMsg("❌ Preencha todos os campos");
      return;
    }
    setLoadingPass(true);
    setPassMsg("");
    try {
      const res = await fetch("/api/motoboys/login", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motoboyId: session.motoboyId,
          currentPassword: currentPassInput,
          newPassword: newPassInput
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao alterar senha");
      setPassMsg("✅ Senha alterada com sucesso!");
      setTimeout(() => {
        setShowPassModal(false);
        setCurrentPassInput("");
        setNewPassInput("");
        setPassMsg("");
      }, 1500);
    } catch (err: any) {
      setPassMsg(`❌ ${err.message}`);
    } finally {
      setLoadingPass(false);
    }
  };

  // ── LOGIN VIEW ──
  if (!session) {
    return (
      <div style={{
        minHeight: "100vh", background: "linear-gradient(135deg, #0F172A, #1E293B)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1.25rem", fontFamily: "sans-serif",
        width: "100%", maxWidth: "100vw", overflowX: "hidden", touchAction: "pan-y",
        position: "relative", boxSizing: "border-box"
      }}>
        <div style={{
          background: "#FFFFFF", borderRadius: "20px", width: "100%", maxWidth: "420px",
          padding: "2rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)", boxSizing: "border-box"
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
                placeholder="Senha (Padrão: 123456)"
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
            🔒 Acesso restrito e isolado para motoboys cadastrados da loja.<br />
            💡 <b>Senha padrão:</b> 123456
          </div>
        </div>
      </div>
    );
  }

  // ── MOTOBOY APP DASHBOARD VIEW ──
  return (
    <div style={{
      minHeight: "100vh", background: "#F1F5F9", fontFamily: "sans-serif", paddingBottom: "3rem",
      width: "100%", maxWidth: "100vw", overflowX: "hidden", touchAction: "pan-y",
      position: "relative", boxSizing: "border-box"
    }}>

      {/* Top Header */}
      <div style={{
        background: "#0F172A", color: "#FFFFFF", padding: "1rem 1.25rem",
        position: "sticky", top: 0, zIndex: 100, boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
      }}>
        <div style={{ maxWidth: "600px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                background: gpsStatus === "ativo" ? "#22C55E" : gpsStatus === "negado" ? "#EF4444" : "#F59E0B",
                width: "8px", height: "8px", borderRadius: "50%"
              }} />
              <span style={{ fontWeight: 900, fontSize: "1.05rem" }}>🛵 {session.motoboyName}</span>
            </div>
            <p style={{ margin: "2px 0 0 0", fontSize: "0.78rem", color: "#94A3B8" }}>
              Loja: <b>{session.storeName}</b>
              {" · "}
              <b style={{ color: gpsStatus === "ativo" ? "#4ADE80" : gpsStatus === "negado" ? "#F87171" : "#FBBF24" }}>
                {gpsStatus === "ativo" ? "GPS ativo" : gpsStatus === "negado" ? "GPS desligado" : "GPS…"}
              </b>
            </p>
            {/* GPS negado não pode ser silencioso: a loja monta rota olhando o
                mapa, e um entregador invisível ali parece entregador parado. */}
            {gpsStatus === "negado" && (
              <p style={{ margin: "4px 0 0 0", fontSize: "0.72rem", color: "#FCA5A5", fontWeight: 700 }}>
                ⚠️ Ative a localização do celular para a loja te ver no mapa.
              </p>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setShowPassModal(true)}
              style={{ background: "#334155", color: "#F8FAFC", border: "none", padding: "8px 10px", borderRadius: "8px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              title="Alterar Senha"
            >
              <Lock size={14} /> Senha
            </button>
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

            const displayRef = (order as any).ifoodReference || (order as any).openDeliveryReference || order.displayId;
            const num = displayRef ? displayRef : ((order as any).dailyOrderNumber || order.orderNumber || order.id.replace(/\D/g, "").slice(-2) || "#");
            const cleanPhone = (order.customerPhone || "").replace(/\D/g, "");
            const waLink = cleanPhone ? `https://wa.me/55${cleanPhone}?text=Olá!%20Sou%20o%20entregador%20da%20loja%20e%20estou%20a%20caminho%20do%20seu%20endereço!` : null;

            // ── O QUE VAI PARA O NAVEGADOR DE MAPA NÃO É O QUE O HUMANO LÊ ──
            //
            // O endereço do pedido carrega "Comp: Esquina Com Sn17" e
            // "Ref: Em Frente A Uninter" — ótimos para o entregador, veneno
            // para o geocodificador: o Google Maps abria com esse texto,
            // não resolvia o destino e NÃO GERAVA A ROTA (reclamação da
            // Ragnar em 03/09/2026). Para o mapa vai só o que geocodifica:
            // rua, número, bairro e cidade. Complemento e referência ficam
            // no card, onde sempre estiveram.
            // O corte é em " - " COM espaços dos dois lados, que é o separador
            // do iFood. Hífen colado é nome de rua — "Tv. WE-34", "Rod. BR-101"
            // — e cortá-lo mandaria "Tv. WE, 34" para o geocodificador.
            const addrParaMapa = addr
              .split(/\s+[-|]\s+/)
              .filter((parte: string) => !/^\s*(comp(lemento)?|ref(er[êe]ncia)?|obs)\s*[:.]/i.test(parte.trim()))
              .join(", ")
              // \s+ e não \s{2,}: há endereço em produção com QUEBRA DE LINHA no
              // meio ("Rua Gertrudes..., 1001\n1001 - Comp: ..."), e um \n
              // sozinho vira %0A na URL — mais um jeito de o mapa abrir sem rota.
              .replace(/\s+/g, " ")
              .trim();
            const temDestino = addrParaMapa && addrParaMapa !== "Endereço a confirmar";
            const mapsNavUrl = temDestino
              ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addrParaMapa)}&travelmode=driving&dir_action=navigate`
              : null;
            const wazeNavUrl = temDestino
              ? `https://waze.com/ul?q=${encodeURIComponent(addrParaMapa)}&navigate=yes`
              : null;

            const changeAmount = (order as any).changeAmount;
            const rawNotes = order.notes || "";
            const cleanNotes = rawNotes
              .replace(/Pedido iFood #[A-Za-z0-9_-]+/gi, "")
              .replace(/Pedido Jotajá #[A-Za-z0-9_-]+/gi, "")
              .replace(/^(\s*\|\s*)+|(\s*\|\s*)+$/g, "")
              .trim();

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

                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {/* A mesma rota, com o mesmo nome e a mesma cor que a loja
                        vê no mapa — motoboy e loja falando da mesma coisa. */}
                    {order.routeSchedule?.routeNumber && (
                      <span style={{
                        background: order.routeSchedule.color || "#3B82F6", color: "#fff",
                        fontSize: "0.72rem", fontWeight: 900, padding: "3px 8px", borderRadius: "6px",
                        border: "1px solid rgba(255,255,255,0.4)"
                      }}>
                        🗺️ {order.routeSchedule.routeNumber}
                      </span>
                    )}
                    <span style={{ background: "#EFF6FF", color: "#1D4ED8", fontSize: "0.75rem", fontWeight: 800, padding: "3px 8px", borderRadius: "6px" }}>
                      {order.source || order.platform || "Direto"}
                    </span>
                  </div>
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

                    {(changeAmount || cleanNotes.toLowerCase().includes("troco")) && (
                      <div style={{ background: "#FEF3C7", color: "#92400E", padding: "4px 8px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content" }}>
                        💵 {changeAmount ? `Levar Troco para R$ ${Number(changeAmount).toFixed(2).replace(".", ",")}` : `Atenção: ${cleanNotes}`}
                      </div>
                    )}
                  </div>

                  {/* Notes / Reference Point */}
                  {cleanNotes && !cleanNotes.toLowerCase().includes("troco") && (
                    <div style={{ background: "#F1F5F9", padding: "6px 10px", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 700, color: "#475569" }}>
                      📌 <b>Obs/Ref:</b> {cleanNotes}
                    </div>
                  )}
                </div>

                {/* Quick Navigation Buttons (Google Maps + Waze + WhatsApp).
                    Sem destino geocodificável os botões nem aparecem: um link
                    para "Endereço a confirmar" abre o mapa sem rota nenhuma e
                    o entregador perde tempo achando que o app quebrou. */}
                {mapsNavUrl && wazeNavUrl && (
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
                )}

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
                  onClick={() => handleInitiateDelivery(order)}
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

      {/* Modal Alterar Senha */}
      {showPassModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 10000
        }}>
          <div style={{
            background: "#FFFFFF", borderRadius: "18px", width: "100%", maxWidth: "380px",
            padding: "1.5rem", boxShadow: "0 20px 40px rgba(0,0,0,0.3)"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 900, color: "#0F172A", display: "flex", alignItems: "center", gap: 6 }}>
                🔑 Alterar Minha Senha
              </h3>
              <button onClick={() => setShowPassModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B" }}>
                ✕
              </button>
            </div>

            {passMsg && (
              <div style={{ padding: "8px 12px", borderRadius: "8px", fontSize: "0.82rem", fontWeight: 700, marginBottom: "1rem", background: passMsg.includes("✅") ? "#DCFCE7" : "#FEF2F2", color: passMsg.includes("✅") ? "#15803D" : "#DC2626" }}>
                {passMsg}
              </div>
            )}

            <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                  SENHA ATUAL:
                </label>
                <input
                  type="password"
                  placeholder="Sua senha atual (Padrão: 123456)"
                  value={currentPassInput}
                  onChange={(e) => setCurrentPassInput(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1.5px solid #CBD5E1", fontSize: "0.9rem", boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                  NOVA SENHA:
                </label>
                <input
                  type="password"
                  placeholder="Digite sua nova senha"
                  value={newPassInput}
                  onChange={(e) => setNewPassInput(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1.5px solid #CBD5E1", fontSize: "0.9rem", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: "0.5rem" }}>
                <button
                  type="submit"
                  disabled={loadingPass}
                  style={{ flex: 1, padding: "12px", background: "#2563EB", color: "#FFFFFF", border: "none", borderRadius: "10px", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer" }}
                >
                  {loadingPass ? "Salvando..." : "Salvar Nova Senha"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPassModal(false)}
                  style={{ padding: "12px 16px", background: "#F1F5F9", color: "#475569", border: "none", borderRadius: "10px", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer" }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Bebidas
          Clicar FORA fecha sem finalizar — igual ao "Ainda não". O toque fora é
          o gesto natural de quem abriu sem querer, e a única coisa que nunca
          pode acontecer aqui é fechar o modal E dar baixa junto. */}
      {beverageModalOrder && (
        <div
          onClick={() => setBeverageModalOrder(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.8)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", zIndex: 10000
          }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#FFFFFF", borderRadius: "20px", width: "100%", maxWidth: "400px",
              padding: "1.5rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)", textAlign: "center",
              boxSizing: "border-box"
            }}>
            <div style={{
              width: "60px", height: "60px", borderRadius: "50%", background: "#EFF6FF",
              color: "#2563EB", display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: "1rem", fontSize: "2.2rem", boxShadow: "0 4px 12px rgba(37,99,235,0.2)"
            }}>
              🥤
            </div>

            <h3 style={{ fontSize: "1.25rem", fontWeight: 900, color: "#0F172A", margin: "0 0 6px 0" }}>
              Atenção às Bebidas!
            </h3>

            <p style={{ fontSize: "0.85rem", color: "#64748B", margin: "0 0 1rem 0" }}>
              Este pedido contém as seguintes bebidas:
            </p>

            <div style={{
              background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: "12px",
              padding: "0.75rem 1rem", marginBottom: "1.25rem", textAlign: "left",
              maxHeight: "180px", overflowY: "auto"
            }}>
              {beveragesList.map((bev, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  fontSize: "0.92rem", fontWeight: 800, color: "#0F172A", padding: "6px 0",
                  borderBottom: i < beveragesList.length - 1 ? "1px dashed #CBD5E1" : "none"
                }}>
                  <span>🥤 {bev.name}</span>
                  <span style={{
                    background: "#2563EB", color: "#FFFFFF", padding: "2px 8px",
                    borderRadius: "6px", fontSize: "0.8rem", fontWeight: 900, marginLeft: "8px"
                  }}>
                    {bev.quantity}x
                  </span>
                </div>
              ))}
            </div>

            <p style={{ fontSize: "0.95rem", fontWeight: 900, color: "#1E293B", marginBottom: "1.25rem" }}>
              Você entregou {beveragesList.length === 1
                ? <>a bebida <b style={{ color: "#2563EB" }}>{beveragesList[0].quantity}x {beveragesList[0].name}</b>?</>
                : <>TODAS essas {beveragesList.reduce((s, b) => s + b.quantity, 0)} bebidas?</>}
            </p>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              {/* "Ainda não" fecha SEM dar baixa: o pedido continua pendente
                  para o motoboy voltar, pegar a bebida e confirmar depois. */}
              <button
                type="button"
                onClick={() => setBeverageModalOrder(null)}
                style={{
                  flex: 1, padding: "12px", background: "#FEF2F2", color: "#B91C1C",
                  border: "1.5px solid #FCA5A5", borderRadius: "12px", fontWeight: 800, cursor: "pointer", fontSize: "0.9rem"
                }}
              >
                ✋ Ainda não
              </button>

              <button
                type="button"
                onClick={() => {
                  const targetId = beverageModalOrder.id;
                  setBeverageModalOrder(null);
                  handleMarkDelivered(targetId);
                }}
                style={{
                  flex: 1.5, padding: "12px", background: "#16A34A", color: "#FFFFFF",
                  border: "none", borderRadius: "12px", fontWeight: 900, cursor: "pointer",
                  fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 6, boxShadow: "0 4px 14px rgba(22,163,74,0.4)"
                }}
              >
                <CheckCircle2 size={18} /> Sim, entreguei
              </button>
            </div>

            <p style={{ fontSize: "0.74rem", color: "#94A3B8", margin: "10px 0 0" }}>
              "Ainda não" mantém o pedido pendente — nada é finalizado.
            </p>
          </div>
        </div>
      )}

      {/* Toast Feedback */}
      {toastMsg && (
        <div style={{
          position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)",
          // Erro em vermelho: o toast verde para tudo escondia falha de entrega.
          background: toastMsg.startsWith("⚠️") ? "#DC2626" : "#16A34A",
          color: "#fff", padding: "12px 24px", borderRadius: "30px",
          fontWeight: 800, fontSize: "0.9rem", boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
          zIndex: 99999, maxWidth: "92vw", textAlign: "center"
        }}>
          {toastMsg}
        </div>
      )}

    </div>
  );
}
