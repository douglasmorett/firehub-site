"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, ShieldCheck, Zap, Key, Store, Save, ExternalLink, RefreshCw, X, ArrowRight, Activity, CreditCard, Radio } from "lucide-react";

export default function IntegracoesHubClient({
  ifoodMerchantId,
  ifoodClientId,
  ifoodWidgetId,
  userEmail,
  facebookPixelId: initialFacebookPixelId,
  pagarmeRecipientId,
}: {
  ifoodMerchantId?: string;
  ifoodClientId?: string;
  ifoodWidgetId?: string;
  userEmail: string;
  facebookPixelId?: string;
  pagarmeRecipientId?: string;
}) {
  const [activeTab, setActiveTab] = useState<"all" | "channels" | "marketing" | "payments">("all");
  const [openModal, setOpenModal] = useState<"pixel" | "whatsapp" | "jotaja" | "ifood" | "pagarme" | "99food" | null>(null);

  // Meta Pixel state
  const [pixelId, setPixelId] = useState(initialFacebookPixelId || "");
  const [pixelSaving, setPixelSaving] = useState(false);

  // WhatsApp state
  const [waConnected, setWaConnected] = useState(false);
  const [waPhone, setWaPhone] = useState("");

  // JotaJá credentials state
  const [jjClientId, setJjClientId] = useState("");
  const [jjClientSecret, setJjClientSecret] = useState("");
  const [jjMerchantId, setJjMerchantId] = useState("");
  const [jjConnected, setJjConnected] = useState(false);
  const [jjLoading, setJjLoading] = useState(true);
  const [jjSaving, setJjSaving] = useState(false);

  // iFood state
  const [ifMerchant, setIfMerchant] = useState(ifoodMerchantId || "");
  const [ifWidget, setIfWidget] = useState(ifoodWidgetId || "");
  const [ifSaving, setIfSaving] = useState(false);

  // Toast alert
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const showToast = (msg: string, color = "#10B981") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    fetch("/api/store/integracoes/jotaja")
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setJjClientId(d.clientId || "");
          setJjClientSecret(d.clientSecret || "");
          setJjMerchantId(d.merchantId || "");
          setJjConnected(d.connected || false);
        }
      })
      .catch(() => {})
      .finally(() => setJjLoading(false));

    fetch("/api/chatbot/config")
      .then(r => r.json())
      .then(d => {
        if (d.config) {
          setWaConnected(d.config.connected || false);
          setWaPhone(d.config.phone || "");
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveJotaja = async () => {
    setJjSaving(true);
    try {
      const res = await fetch("/api/store/integracoes/jotaja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: jjClientId,
          clientSecret: jjClientSecret,
          merchantId: jjMerchantId,
          connected: true
        })
      });
      const data = await res.json();
      if (data.ok) {
        setJjConnected(true);
        showToast("✅ Integração JotaJá salva e ativada com sucesso!", "#10B981");
        setOpenModal(null);
      } else {
        showToast("⚠️ " + (data.error || "Erro ao salvar credenciais JotaJá"), "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar JotaJá", "#EF4444");
    } finally {
      setJjSaving(false);
    }
  };

  const handleSaveIfood = async () => {
    setIfSaving(true);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ifoodMerchantId: ifMerchant,
          ifoodWidgetId: ifWidget
        })
      });
      if (res.ok) {
        showToast("✅ Configurações do iFood salvas!", "#10B981");
        setOpenModal(null);
      } else {
        showToast("⚠️ Erro ao salvar configurações iFood", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão", "#EF4444");
    } finally {
      setIfSaving(false);
    }
  };

  const handleSavePixel = async () => {
    setPixelSaving(true);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facebookPixelId: pixelId,
          metaPixelId: pixelId,
        })
      });
      if (res.ok) {
        showToast("✅ Pixel do Meta configurado com sucesso!", "#10B981");
        setOpenModal(null);
      } else {
        showToast("⚠️ Erro ao salvar Pixel do Meta", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar Pixel", "#EF4444");
    } finally {
      setPixelSaving(false);
    }
  };

  // Modern Integration Card Data
  const INTEGRATIONS = [
    {
      id: "pixel" as const,
      category: "marketing",
      title: "Meta Pixel & Conversões",
      subtitle: "Facebook / Instagram Ads",
      icon: "🎯",
      gradient: "linear-gradient(135deg, #1877F2, #0052CC)",
      badge: pixelId ? { text: `🟢 Pixel Ativo (${pixelId})`, bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Configurado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Rastreie PageView, Adicionar ao Carrinho e Vendas no seu cardápio via Pixel do Meta.",
    },
    {
      id: "whatsapp" as const,
      category: "marketing",
      title: "WhatsApp IA & Notificações",
      subtitle: "Robô Atendente 24/7 & Avisos",
      icon: "💬",
      gradient: "linear-gradient(135deg, #10B981, #059669)",
      badge: waConnected ? { text: `🟢 Conectado (${waPhone || "Ativo"})`, bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚡ Pendente QR Code", bg: "#FEF3C7", color: "#B45309", border: "#FDE68A" },
      description: "Robô inteligente com Gemini IA, envia avisos de entrega e aceita pedidos automaticamente.",
    },
    {
      id: "jotaja" as const,
      category: "channels",
      title: "JotaJá (Open Delivery)",
      subtitle: "API Oficial OpenDelivery",
      icon: "🛵",
      gradient: "linear-gradient(135deg, #2563EB, #1D4ED8)",
      badge: jjConnected ? { text: "🟢 Conectado & Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Conectado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Sincronização de pedidos e cardápio direto do seu painel JotaJá para o FireHub.",
    },
    {
      id: "ifood" as const,
      category: "channels",
      title: "iFood Merchant API",
      subtitle: "Loja Oficial iFood",
      icon: "🔴",
      gradient: "linear-gradient(135deg, #EA580C, #C2410C)",
      badge: ifMerchant ? { text: "🟢 Conectado & Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Conectado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Receba pedidos do iFood automaticamente e despache entregas pelo nosso sistema.",
    },
    {
      id: "pagarme" as const,
      category: "payments",
      title: "Pagar.me / Cartão & PIX",
      subtitle: "Pagamentos Online no Site",
      icon: "💳",
      gradient: "linear-gradient(135deg, #6366F1, #4F46E5)",
      badge: pagarmeRecipientId ? { text: "🟢 Recebimento Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "🟢 PIX / Cartão Ativos", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" },
      description: "Processamento seguro de PIX instantâneo e Cartão de Crédito com repasse para sua loja.",
    },
    {
      id: "99food" as const,
      category: "channels",
      title: "99Food Delivery",
      subtitle: "Integração Open Delivery",
      icon: "🟡",
      gradient: "linear-gradient(135deg, #F59E0B, #D97706)",
      badge: { text: "⚡ Em Breve", bg: "#FFFBEB", color: "#B45309", border: "#FDE68A" },
      description: "Integração direta com o 99Food para captura e gerenciamento automático de pedidos.",
    },
  ];

  const filteredIntegrations = INTEGRATIONS.filter(item => {
    if (activeTab === "all") return true;
    return item.category === activeTab;
  });

  return (
    <div style={{ maxWidth: "1150px", margin: "0 auto", padding: "24px 16px", fontFamily: "inherit" }}>
      {/* Toast alert */}
      {toast && (
        <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999, background: toast.color, color: "#fff", padding: "12px 20px", borderRadius: "10px", fontWeight: 700, boxShadow: "0 10px 25px rgba(0,0,0,0.2)", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.msg}
        </div>
      )}

      {/* Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #0F172A, #1E293B)", borderRadius: "24px", padding: "32px", color: "#fff", marginBottom: "28px", boxShadow: "0 12px 32px rgba(15,23,42,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, color: "#38BDF8", marginBottom: "12px" }}>
              🔌 Central de Integrações
            </div>
            <h1 style={{ fontSize: "1.85rem", fontWeight: 900, margin: "0 0 8px 0" }}>
              Conecte Seus Canais & Ferramentas
            </h1>
            <p style={{ margin: 0, opacity: 0.8, fontSize: "0.9rem", maxWidth: "650px", lineHeight: 1.5 }}>
              Clique na integração desejada para configurar credenciais, sincronizar pedidos e ativar rastreamento de tráfego.
            </p>
          </div>

          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", padding: "12px 18px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <ShieldCheck size={26} color="#10B981" />
            <div>
              <div style={{ fontSize: "0.72rem", opacity: 0.7 }}>Conta Registrada</div>
              <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#38BDF8" }}>{userEmail}</div>
            </div>
          </div>
        </div>

        {/* Tab Filters */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("all")}
            style={{ padding: "9px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "all" ? "#38BDF8" : "rgba(255,255,255,0.08)", color: activeTab === "all" ? "#0F172A" : "#fff", transition: "all 0.2s" }}
          >
            Todas as Integrações ({INTEGRATIONS.length})
          </button>
          <button
            onClick={() => setActiveTab("channels")}
            style={{ padding: "9px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "channels" ? "#3B82F6" : "rgba(255,255,255,0.08)", color: "#fff", transition: "all 0.2s" }}
          >
            🛵 Canais de Venda & Delivery
          </button>
          <button
            onClick={() => setActiveTab("marketing")}
            style={{ padding: "9px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "marketing" ? "#10B981" : "rgba(255,255,255,0.08)", color: "#fff", transition: "all 0.2s" }}
          >
            🎯 Marketing & Tráfego
          </button>
          <button
            onClick={() => setActiveTab("payments")}
            style={{ padding: "9px 18px", borderRadius: "12px", border: "none", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "payments" ? "#8B5CF6" : "rgba(255,255,255,0.08)", color: "#fff", transition: "all 0.2s" }}
          >
            💳 Pagamentos & PIX
          </button>
        </div>
      </div>

      {/* Grid of Compact Integration Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "20px" }}>
        {filteredIntegrations.map((item) => (
          <div
            key={item.id}
            onClick={() => setOpenModal(item.id)}
            style={{
              background: "#fff",
              borderRadius: "20px",
              border: "1.5px solid #E2E8F0",
              padding: "20px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.03)",
              cursor: "pointer",
              transition: "all 0.2s ease-in-out",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              position: "relative",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.borderColor = "#94A3B8";
              e.currentTarget.style.boxShadow = "0 12px 28px rgba(0,0,0,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.borderColor = "#E2E8F0";
              e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.03)";
            }}
          >
            {/* Top row: Logo + Status Badge */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                <div style={{ width: "52px", height: "52px", borderRadius: "16px", background: item.gradient, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.6rem", boxShadow: "0 6px 16px rgba(0,0,0,0.12)" }}>
                  {item.icon}
                </div>

                <span style={{ background: item.badge.bg, border: `1px solid ${item.badge.border}`, color: item.badge.color, padding: "4px 10px", borderRadius: "20px", fontSize: "0.72rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "4px" }}>
                  {item.badge.text}
                </span>
              </div>

              {/* Title & Subtitle */}
              <h3 style={{ margin: "0 0 4px 0", fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>
                {item.title}
              </h3>
              <div style={{ fontSize: "0.76rem", fontWeight: 700, color: "#64748B", marginBottom: "10px" }}>
                {item.subtitle}
              </div>

              {/* Description */}
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#475569", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {item.description}
              </p>
            </div>

            {/* Action Footer */}
            <div style={{ marginTop: "18px", paddingTop: "14px", borderTop: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.74rem", color: "#94A3B8", fontWeight: 600 }}>Clique para configurar</span>
              <button
                type="button"
                style={{ background: "#F1F5F9", color: "#0F172A", border: "none", padding: "6px 12px", borderRadius: "10px", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px" }}
              >
                Configurar <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ================= MODAL DE CONFIGURAÇÃO DEDICADA ================= */}
      {openModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15,23,42,0.65)", backdropFilter: "blur(6px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "24px", width: "100%", maxWidth: "560px", padding: "28px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", position: "relative", animation: "modalIn 0.2s ease-out" }}>
            
            {/* Close Button */}
            <button
              onClick={() => setOpenModal(null)}
              style={{ position: "absolute", top: "20px", right: "20px", background: "#F1F5F9", border: "none", borderRadius: "50%", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#475569" }}
            >
              <X size={18} />
            </button>

            {/* 🎯 MODAL: META PIXEL */}
            {openModal === "pixel" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #1877F2, #0052CC)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🎯
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Pixel do Meta (Facebook/Instagram)</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Rastreie conversões de tráfego pago no seu cardápio</span>
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                  Insira o ID do seu Pixel do Meta abaixo. Nosso sistema injetará automaticamente o Pixel no seu cardápio digital para registrar eventos de <strong>PageView</strong>, <strong>AddToCart</strong> (Adicionar ao Carrinho), <strong>InitiateCheckout</strong> e <strong>Purchase</strong> (Venda Concluída).
                </p>

                <div style={{ background: "#F8FAFC", borderRadius: "14px", padding: "16px", border: "1px solid #E2E8F0", marginBottom: "20px" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 800, color: "#1E293B", display: "block", marginBottom: "6px" }}>
                    ID do Pixel do Meta (somente números):
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 123456789012345"
                    value={pixelId}
                    onChange={(e) => setPixelId(e.target.value.replace(/\D/g, ""))}
                    style={{ width: "100%", padding: "11px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontFamily: "monospace", outline: "none" }}
                  />
                  <span style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "6px", display: "block" }}>
                    Você encontra este ID no Gerenciador de Negócios da Meta em <em>Gerenciador de Eventos &rarr; Fontes de Dados</em>.
                  </span>
                </div>

                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "12px", padding: "12px", fontSize: "0.78rem", color: "#1E40AF", marginBottom: "24px" }}>
                  <strong>💡 Eventos Rastreados Automáticos:</strong>
                  <ul style={{ margin: "4px 0 0 0", paddingLeft: "16px" }}>
                    <li><code>PageView</code>: Sempre que alguém abre seu cardápio</li>
                    <li><code>AddToCart</code>: Quando o cliente escolhe um produto</li>
                    <li><code>Purchase</code>: Quando o pedido é finalizado</li>
                  </ul>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSavePixel}
                    disabled={pixelSaving}
                    style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #1877F2, #0052CC)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(24,119,242,0.3)", opacity: pixelSaving ? 0.7 : 1 }}
                  >
                    <Save size={16} /> {pixelSaving ? "Salvando..." : "Salvar Pixel do Meta"}
                  </button>
                </div>
              </div>
            )}

            {/* 💬 MODAL: WHATSAPP IA */}
            {openModal === "whatsapp" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #10B981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    💬
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>WhatsApp IA & Notificações</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Conexão 1-Clique e Atendimento Automático</span>
                  </div>
                </div>

                <div style={{ background: waConnected ? "#F0FDF4" : "#FEF3C7", border: `1px solid ${waConnected ? "#BBF7D0" : "#FDE68A"}`, padding: "14px", borderRadius: "14px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.8, color: waConnected ? "#15803D" : "#B45309" }}>Status da Conexão:</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 900, color: waConnected ? "#15803D" : "#B45309" }}>
                      {waConnected ? `🟢 Conectado (${waPhone || "Ativo"})` : "⚡ Aguardando QR Code"}
                    </div>
                  </div>
                  <a
                    href="/store/chatbot"
                    style={{ padding: "8px 14px", background: "#10B981", color: "#fff", textDecoration: "none", borderRadius: "10px", fontWeight: 800, fontSize: "0.8rem" }}
                  >
                    Abrir QR Code / Robô &rarr;
                  </a>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                  O módulo de WhatsApp sincroniza diretamente com a inteligência artificial do Gemini para responder aos clientes, informar taxa de entrega por bairro, confirmar pedidos do Jotajá/iFood e enviar notificações automáticas de status.
                </p>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Fechar
                  </button>
                  <a
                    href="/store/chatbot"
                    style={{ padding: "10px 20px", borderRadius: "10px", background: "linear-gradient(135deg, #10B981, #059669)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", textDecoration: "none", display: "flex", alignItems: "center", gap: "6px" }}
                  >
                    Configurar Robô no Chatbot &rarr;
                  </a>
                </div>
              </div>
            )}

            {/* 🛵 MODAL: JOTAJA */}
            {openModal === "jotaja" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #2563EB, #1D4ED8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🛵
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>JotaJá (Open Delivery)</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Integração oficial via API OpenDelivery</span>
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                  Insira abaixo as credenciais fornecidas no seu painel JotaJá (em <strong>Configurações &rarr; Integrações / API OpenDelivery</strong>) para receber pedidos automaticamente no FireHub.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <Key size={14} color="#2563EB" /> Client ID (JotaJá)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 92c66502-57ce-4563-a9e3-0df07dda5a38"
                      value={jjClientId}
                      onChange={e => setJjClientId(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <ShieldCheck size={14} color="#2563EB" /> Client Secret (JotaJá)
                    </label>
                    <input
                      type="password"
                      placeholder="Ex: bf6798ba-5abe-43b8-a5d7-adca54643492"
                      value={jjClientSecret}
                      onChange={e => setJjClientSecret(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <Store size={14} color="#2563EB" /> Store ID / Merchant ID (Código da Loja)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 22238"
                      value={jjMerchantId}
                      onChange={e => setJjMerchantId(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveJotaja}
                    disabled={jjSaving}
                    style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #2563EB, #1D4ED8)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(37,99,235,0.3)", opacity: jjSaving ? 0.7 : 1 }}
                  >
                    <Save size={16} /> {jjSaving ? "Salvando..." : "Salvar e Ativar JotaJá"}
                  </button>
                </div>
              </div>
            )}

            {/* 🔴 MODAL: IFOOD */}
            {openModal === "ifood" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #EA580C, #C2410C)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🔴
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>iFood Merchant API</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Integração de pedidos e loja oficial iFood</span>
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                  Conecte a sua loja do iFood via Código de Autorização para aceitar pedidos, despachar entregas e sincronizar status automaticamente.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <Store size={14} color="#EA580C" /> Merchant ID (iFood)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 6a5fb96d-68bd-46af-ada4-456a9a160787"
                      value={ifMerchant}
                      onChange={e => setIfMerchant(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      💬 Widget ID (Chat iFood)
                    </label>
                    <input
                      type="text"
                      placeholder="Cole o ID do widget do Portal iFood..."
                      value={ifWidget}
                      onChange={e => setIfWidget(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveIfood}
                    disabled={ifSaving}
                    style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #EA580C, #C2410C)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(234,88,12,0.3)", opacity: ifSaving ? 0.7 : 1 }}
                  >
                    <Save size={16} /> {ifSaving ? "Salvando..." : "Salvar Configurações iFood"}
                  </button>
                </div>
              </div>
            )}

            {/* 💳 MODAL: PAGAR.ME */}
            {openModal === "pagarme" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #6366F1, #4F46E5)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    💳
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Pagar.me / Cartão & PIX Online</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Processamento seguro de pagamento online</span>
                  </div>
                </div>

                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                  <div style={{ fontSize: "0.75rem", color: "#15803D" }}>Status do Recebimento:</div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "#15803D" }}>
                    🟢 Recebimento PIX e Cartão de Crédito Ativos no Cardápio
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "24px" }}>
                  Os pagamentos efetuados via PIX instantâneo e Cartão de Crédito no cardápio online do seu restaurante são processados de forma automática com repasse direto para a sua conta.
                </p>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Fechar
                  </button>
                </div>
              </div>
            )}

            {/* 🟡 MODAL: 99FOOD */}
            {openModal === "99food" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #F59E0B, #D97706)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    🟡
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>99Food Delivery</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Integração Open Delivery</span>
                  </div>
                </div>

                <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#B45309" }}>
                    ⚡ Integração em Fase Final de Desenvolvimento
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "24px" }}>
                  A integração oficial com o 99Food via protocolo OpenDelivery permitirá receber e despachar pedidos diretamente no FireHub. Em breve estará disponível para ativação!
                </p>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Entendido
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
