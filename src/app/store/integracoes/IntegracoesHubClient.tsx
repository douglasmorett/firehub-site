"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, ShieldCheck, Zap, Key, Store, Save, ExternalLink, RefreshCw, X, ArrowRight, Activity, CreditCard, Radio, Plus, Trash2, Loader2 } from "lucide-react";

export default function IntegracoesHubClient({
  ifoodMerchantId,
  ifoodClientId,
  ifoodWidgetId,
  ifoodConnected: initialIfoodConnected,
  userEmail,
  facebookPixelId: initialFacebookPixelId,
  pagarmeRecipientId,
  mpConnected,
  initialIfoodIntegrations,
}: {
  ifoodMerchantId?: string;
  ifoodClientId?: string;
  ifoodWidgetId?: string;
  ifoodConnected?: boolean;
  userEmail: string;
  facebookPixelId?: string;
  pagarmeRecipientId?: string;
  mpConnected?: boolean;
  initialIfoodIntegrations?: {id:string;label:string;merchantId:string;connected:boolean;active:boolean;widgetId?:string|null;createdAt:string}[];
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
  const [jjHasSecret, setJjHasSecret] = useState(false);
  const [jjLoading, setJjLoading] = useState(true);
  const [jjSaving, setJjSaving] = useState(false);

  // 99Food state
  const [food99MerchantId, setFood99MerchantId] = useState("");
  const [food99AppId, setFood99AppId] = useState("");
  const [food99SecretKey, setFood99SecretKey] = useState("");
  const [food99Connected, setFood99Connected] = useState(false);
  const [food99Loading, setFood99Loading] = useState(true);
  const [food99Saving, setFood99Saving] = useState(false);

  // iFood multi-integration state
  const [ifMerchant, setIfMerchant] = useState(ifoodMerchantId || "");
  const [ifWidget, setIfWidget] = useState(ifoodWidgetId || "");
  const [ifSaving, setIfSaving] = useState(false);
  const [ifoodIntegrations, setIfoodIntegrations] = useState<{id:string;label:string;merchantId:string;connected:boolean;active:boolean;widgetId?:string|null;createdAt:string}[]>(initialIfoodIntegrations || []);
  const [ifoodLoading, setIfoodLoading] = useState(!initialIfoodIntegrations || initialIfoodIntegrations.length === 0);
  const [newIfLabel, setNewIfLabel] = useState("");
  const [newIfMerchantId, setNewIfMerchantId] = useState("");
  const [newIfWidgetId, setNewIfWidgetId] = useState("");
  const [ifAdding, setIfAdding] = useState(false);
  const [userCodeData, setUserCodeData] = useState<{ userCode: string; verificationUrl?: string } | null>(null);
  const [loadingUserCode, setLoadingUserCode] = useState(false);
  const [showAddIfoodForm, setShowAddIfoodForm] = useState(false);
  const [authCodeInput, setAuthCodeInput] = useState("");
  const [connectingAuthCode, setConnectingAuthCode] = useState(false);

  // Toast alert
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const showToast = (msg: string, color = "#10B981") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  };

  // Auto-descobrir merchantId quando conectado mas sem merchantId
  useEffect(() => {
    if (initialIfoodConnected && !ifMerchant && ifoodIntegrations.length === 0) {
      fetch("/api/ifood/auth?step=discover-merchant")
        .then(r => r.json())
        .then(data => {
          if (data.success && data.merchantId) {
            setIfMerchant(data.merchantId);
            showToast(`🔍 Loja iFood descoberta: ${data.storeName || data.merchantId}${data.importedOrders > 0 ? ` — ${data.importedOrders} pedido(s) importado(s)!` : ""}`, "#10B981");
            setTimeout(() => window.location.reload(), 1500);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Carregar dados da integração JotaJá
  useEffect(() => {
    fetch("/api/store/integracoes/jotaja")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setJjClientId(data.clientId || "");
          setJjClientSecret(""); // o secret nunca volta do servidor
          setJjHasSecret(!!data.hasSecret);
          setJjMerchantId(data.merchantId || "");
          setJjConnected(!!data.connected);
        }
      })
      .catch(() => {})
      .finally(() => setJjLoading(false));

    // Carregar dados da integração 99Food
    fetch("/api/store/integracoes/99food")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setFood99MerchantId(data.merchantId || "");
          setFood99AppId(data.appId || "");
          setFood99SecretKey(data.secretKey || "");
          setFood99Connected(!!data.connected);
        }
      })
      .catch(() => {})
      .finally(() => setFood99Loading(false));

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
          connected: true,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setJjConnected(true);
        showToast("✅ Integração JotaJá salva e ativada!", "#10B981");
        setOpenModal(null);
      } else {
        showToast(`⚠️ ${data.error || "Erro ao salvar JotaJá"}`, "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar JotaJá", "#EF4444");
    } finally {
      setJjSaving(false);
    }
  };

  const handleSave99Food = async () => {
    setFood99Saving(true);
    try {
      const res = await fetch("/api/99food/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchantId: food99MerchantId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setFood99Connected(true);
        showToast("✅ Integração 99Food ativada com sucesso!", "#10B981");
        setOpenModal(null);
      } else {
        showToast(`⚠️ ${data.error || "Erro ao conectar 99Food"}`, "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão ao salvar 99Food", "#EF4444");
    } finally {
      setFood99Saving(false);
    }
  };

  const handleDisconnect99Food = async () => {
    if (!confirm("Tem certeza que deseja desconectar o 99Food desta loja?")) return;
    setFood99Saving(true);
    try {
      const res = await fetch("/api/99food/auth?step=disconnect");
      if (res.ok) {
        setFood99Connected(false);
        setFood99MerchantId("");
        showToast("✅ 99Food desconectado com sucesso", "#10B981");
        setOpenModal(null);
      }
    } catch {
      showToast("⚠️ Erro de conexão", "#EF4444");
    } finally {
      setFood99Saving(false);
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

  // Carregar integrações iFood
  useEffect(() => {
    fetch("/api/ifood/integration/list")
      .then(r => r.json())
      .then(d => { if (d.integrations) setIfoodIntegrations(d.integrations); })
      .catch(() => {})
      .finally(() => setIfoodLoading(false));
  }, []);

  const handleConnectIfoodOAuth = () => {
    const clientId = "cabc4064-8d01-4bb0-bb5b-ed93963f9a7a";
    const redirectUri = encodeURIComponent("https://firehubfood.com.br/api/ifood/auth/callback");
    const authUrl = `https://developer.ifood.com.br/oauth/userAuthorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}`;
    window.open(authUrl, "_blank");
  };

  const handleGenerateUserCode = async () => {
    setLoadingUserCode(true);
    try {
      const res = await fetch("/api/ifood/auth/code", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.userCode) {
        const targetUrl = data.verificationUrl || `https://portal.ifood.com.br/apps/code?c=${data.userCode}`;
        setUserCodeData({ userCode: data.userCode, verificationUrl: targetUrl });
        try { navigator.clipboard.writeText(data.userCode); } catch {}
        showToast("📋 Código copiado! Redirecionando para o iFood...", "#10B981");
        window.open(targetUrl, "_blank");
      } else {
        showToast(data.error || "Erro ao gerar código iFood", "#EF4444");
      }
    } catch {
      showToast("Erro ao conectar com o iFood", "#EF4444");
    } finally {
      setLoadingUserCode(false);
    }
  };

  const [needsMerchantId, setNeedsMerchantId] = useState(false);
  const [merchantIdInput, setMerchantIdInput] = useState("");

  const handleLinkAuthorizationCode = async () => {
    if (!authCodeInput.trim()) {
      showToast("⚠️ Digite o código de autorização gerado no iFood", "#EF4444");
      return;
    }
    setConnectingAuthCode(true);
    try {
      const res = await fetch("/api/ifood/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorizationCode: authCodeInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("🎉 Loja iFood vinculada com sucesso!", "#10B981");
        const linkedMerchantId = data.merchantId || authCodeInput.trim();
        setIfMerchant(linkedMerchantId);
        setIfoodIntegrations(prev => [
          { id: "main", label: "Loja Principal", merchantId: linkedMerchantId, connected: true, active: true, createdAt: new Date().toISOString() },
          ...prev.filter(i => i.merchantId !== linkedMerchantId)
        ]);
        setOpenModal(null);
        setTimeout(() => { window.location.reload(); }, 600);
      } else if (data.hasToken) {
        // Token obtido mas merchantId não detectado — pedir UUID manualmente
        setNeedsMerchantId(true);
        showToast("✅ Autorização OK! Agora cole o Merchant ID da sua loja.", "#F59E0B");
      } else {
        showToast(data.error || "Código de autorização inválido ou expirado", "#EF4444");
      }
    } catch {
      showToast("Erro ao conectar com o iFood", "#EF4444");
    } finally {
      setConnectingAuthCode(false);
    }
  };

  const handleSubmitMerchantId = async () => {
    const uuid = merchantIdInput.trim();
    if (!uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      showToast("⚠️ Cole o Merchant ID no formato UUID (ex: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)", "#EF4444");
      return;
    }
    setConnectingAuthCode(true);
    try {
      const res = await fetch("/api/ifood/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: uuid }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("🎉 Loja iFood vinculada com sucesso!", "#10B981");
        setIfMerchant(uuid);
        setIfoodIntegrations(prev => [
          { id: "main", label: "Loja Principal", merchantId: uuid, connected: true, active: true, createdAt: new Date().toISOString() },
          ...prev.filter(i => i.merchantId !== uuid)
        ]);
        setNeedsMerchantId(false);
        setOpenModal(null);
        setTimeout(() => { window.location.reload(); }, 600);
      } else {
        showToast(data.error || "Erro ao vincular Merchant ID", "#EF4444");
      }
    } catch {
      showToast("Erro ao conectar com o iFood", "#EF4444");
    } finally {
      setConnectingAuthCode(false);
    }
  };

  const handleAddIfoodIntegration = async () => {
    if (!newIfLabel.trim() || !newIfMerchantId.trim()) {
      showToast("⚠️ Nome e Merchant ID são obrigatórios", "#EF4444");
      return;
    }
    setIfAdding(true);
    try {
      const res = await fetch("/api/ifood/integration/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newIfLabel, merchantId: newIfMerchantId, widgetId: newIfWidgetId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(data.billingNotice || "✅ Integração iFood adicionada!", "#10B981");
        setIfoodIntegrations(prev => [...prev, data.integration]);
        setNewIfLabel(""); setNewIfMerchantId(""); setNewIfWidgetId("");
        setShowAddIfoodForm(false);
      } else {
        showToast(`⚠️ ${data.error || "Erro ao adicionar"}`, "#EF4444");
      }
    } catch { showToast("⚠️ Erro de conexão", "#EF4444"); }
    finally { setIfAdding(false); }
  };

  const handleRemoveIfoodIntegration = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover esta integração iFood?")) return;
    try {
      const res = await fetch(`/api/ifood/integration/delete?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setIfoodIntegrations(prev => prev.filter(i => i.id !== id));
        showToast("✅ Integração removida", "#10B981");
      } else {
        showToast("⚠️ Erro ao remover", "#EF4444");
      }
    } catch { showToast("⚠️ Erro de conexão", "#EF4444"); }
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
      badge: (ifoodIntegrations.length > 0 || ifMerchant || initialIfoodConnected) ? { text: `🟢 ${ifoodIntegrations.length || 1} Integração(ões)`, bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Conectado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
      description: "Gerencie suas integrações iFood. Conecte múltiplas lojas e acompanhe o status.",
    },
    {
      id: "pagarme" as const,
      category: "payments",
      title: "Mercado Pago / Mercado Livre",
      subtitle: "PIX Instantâneo & Cartão Online",
      icon: "💙",
      gradient: "linear-gradient(135deg, #009EE3, #0072B1)",
      badge: mpConnected || pagarmeRecipientId ? { text: "🟢 Mercado Pago Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "🟢 PIX / Cartão Ativos", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" },
      description: "Processamento seguro de PIX instantâneo e Cartão de Crédito via Mercado Pago / Mercado Livre com repasse para sua conta.",
    },
    {
      id: "99food" as const,
      category: "channels",
      title: "99Food Delivery",
      subtitle: "Integração Open Delivery",
      icon: "🟡",
      gradient: "linear-gradient(135deg, #F59E0B, #D97706)",
      badge: food99Connected ? { text: "🟢 Conectado & Ativo", bg: "#F0FDF4", color: "#15803D", border: "#BBF7D0" } : { text: "⚪ Não Conectado", bg: "#F8FAFC", color: "#64748B", border: "#E2E8F0" },
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
                      placeholder="Cole aqui o Client ID que o JotaJá forneceu"
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
                      placeholder={jjHasSecret ? "•••••••• já configurado — deixe em branco para manter" : "Cole aqui o Client Secret do JotaJá"}
                      value={jjClientSecret}
                      onChange={e => setJjClientSecret(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                    {jjHasSecret && (
                      <p style={{ fontSize: "0.72rem", color: "#64748B", margin: "4px 0 0" }}>
                        Campo em branco mantém o segredo atual — ele nunca é devolvido para o navegador.
                      </p>
                    )}
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
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Integrações iFood</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Gerencie suas lojas iFood conectadas</span>
                  </div>
                </div>

                {/* Lista de integrações existentes */}
                {ifoodLoading ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: "#64748B" }}>
                    <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} /> Carregando...
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                    {ifoodIntegrations.length === 0 && !ifMerchant && !initialIfoodConnected && (
                      <div style={{ padding: "1.5rem", textAlign: "center", background: "#F8FAFC", borderRadius: 12, color: "#64748B", fontSize: "0.85rem" }}>
                        Nenhuma integração iFood cadastrada ainda.
                      </div>
                    )}

                    {/* Integração conectada (do banco User.ifoodConnected / ifoodMerchantId) */}
                    {(ifMerchant || initialIfoodConnected) && (
                      <div style={{
                        padding: "14px 16px", borderRadius: 14, border: "1.5px solid #BBF7D0",
                        background: "#F0FDF4", display: "flex", alignItems: "center", gap: 12,
                      }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <CheckCircle2 size={18} color="#16A34A" />
                        </div>
                        <div style={{ flex: 1 }}>
                          {/* Mostra o NOME da loja no iFood em vez de um rótulo
                              genérico. O nome vem da IfoodIntegration.label, que
                              recebe o merchantName na hora da conexão. Só cai no
                              texto genérico quando a label ainda é um
                              placeholder ("Loja Principal") ou não existe. */}
                          {(() => {
                            const rotulo = (ifoodIntegrations?.[0] as any)?.label?.trim();
                            const generico = !rotulo || /^loja principal$/i.test(rotulo) || /^loja ifood/i.test(rotulo);
                            const titulo = generico
                              ? (ifMerchant ? "Integração Principal" : "Loja iFood Conectada")
                              : rotulo;
                            return (
                              <>
                                <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A" }}>
                                  {titulo}
                                </div>
                                <div style={{ fontSize: "0.72rem", color: "#64748B", fontFamily: "monospace" }}>
                                  {ifMerchant || userEmail}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                        <span style={{ fontSize: "0.7rem", background: "#DCFCE7", color: "#15803D", padding: "3px 8px", borderRadius: 6, fontWeight: 700 }}>🟢 Ativa</span>
                        <button
                          onClick={async () => {
                            if (!confirm("Deseja desconectar a integração iFood desta loja?")) return;
                            try {
                              const r = await fetch("/api/ifood/auth?step=disconnect");
                              if (r.ok) {
                                showToast("🔌 iFood desconectado com sucesso", "#F59E0B");
                                setTimeout(() => window.location.reload(), 500);
                              }
                            } catch { showToast("Erro ao desconectar", "#EF4444"); }
                          }}
                          style={{ background: "none", border: "1px solid #FCA5A5", cursor: "pointer", padding: "4px 8px", borderRadius: 8, color: "#EF4444", fontSize: "0.72rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}
                          title="Desconectar iFood"
                        >
                          <X size={14} /> Desconectar
                        </button>
                      </div>
                    )}

                    {/* Integrações adicionais (do modelo multi-loja IfoodIntegration) */}
                    {ifoodIntegrations.filter(i => i.merchantId !== ifMerchant).map((integ, idx) => (
                      <div key={integ.id} style={{
                        padding: "14px 16px", borderRadius: 14,
                        border: integ.active ? "1.5px solid #BBF7D0" : "1.5px solid #E2E8F0",
                        background: integ.active ? "#F0FDF4" : "#F8FAFC",
                        display: "flex", alignItems: "center", gap: 12,
                      }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: integ.active ? "#DCFCE7" : "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {integ.active ? <CheckCircle2 size={18} color="#16A34A" /> : <X size={18} color="#94A3B8" />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A" }}>{integ.label || `Loja iFood (${integ.merchantId.slice(0, 6)})`}</div>
                          <div style={{ fontSize: "0.72rem", color: "#64748B", fontFamily: "monospace" }}>{integ.merchantId}</div>
                        </div>
                        <span style={{
                          fontSize: "0.7rem", padding: "3px 8px", borderRadius: 6, fontWeight: 700,
                          background: "#FEF3C7", color: "#92400E",
                        }}>
                          💰 +R$50/mês
                        </span>
                        <button
                          onClick={() => handleRemoveIfoodIntegration(integ.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "#EF4444" }}
                          title="Remover integração"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Formulário para adicionar nova integração */}
                {showAddIfoodForm ? (
                  <div style={{ padding: "16px", borderRadius: 14, border: "1.5px dashed #CBD5E1", background: "#F8FAFC", marginBottom: "16px" }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#334155", marginBottom: 12 }}>Nova Integração iFood</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: 3, display: "block" }}>Nome da Loja iFood *</label>
                        <input
                          type="text" placeholder="Ex: Hakim Praia, Loja Shopping..."
                          value={newIfLabel} onChange={e => setNewIfLabel(e.target.value)}
                          style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "inherit", outline: "none" }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: 3, display: "block" }}>Merchant ID (iFood) *</label>
                        <input
                          type="text" placeholder="Ex: 6a5fb96d-68bd-46af-ada4-456a9a160787"
                          value={newIfMerchantId} onChange={e => setNewIfMerchantId(e.target.value)}
                          style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", marginBottom: 3, display: "block" }}>Widget ID (Chat) — opcional</label>
                        <input
                          type="text" placeholder="Cole o ID do widget..."
                          value={newIfWidgetId} onChange={e => setNewIfWidgetId(e.target.value)}
                          style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                        />
                      </div>
                    </div>

                    {/* Aviso de cobrança */}
                    {(ifoodIntegrations.length > 0 || ifMerchant) && (
                      <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "#FFF7ED", border: "1px solid #FDBA74", fontSize: "0.78rem", color: "#92400E" }}>
                        💰 <strong>+R$50,00/mês</strong> — Cada integração iFood adicional é cobrada R$50,00 por mês na sua fatura.
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      <button
                        onClick={() => setShowAddIfoodForm(false)}
                        style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}
                      >Cancelar</button>
                      <button
                        onClick={handleAddIfoodIntegration} disabled={ifAdding}
                        style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "linear-gradient(135deg, #EA580C, #C2410C)", color: "#fff", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", opacity: ifAdding ? 0.7 : 1, display: "flex", alignItems: "center", gap: 6 }}
                      >
                        {ifAdding ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Adicionando...</> : <><Plus size={14} /> Adicionar</>}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Botão Principal de Conexão com 1-Clique */
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                    <button
                      onClick={handleGenerateUserCode}
                      disabled={loadingUserCode}
                      style={{
                        width: "100%", padding: "14px", borderRadius: 14,
                        border: "none", background: "linear-gradient(135deg, #EA580C 0%, #C2410C 100%)",
                        color: "#fff", fontWeight: 800, fontSize: "0.9rem",
                        cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        boxShadow: "0 4px 14px rgba(234, 88, 12, 0.35)",
                        opacity: loadingUserCode ? 0.7 : 1,
                      }}
                    >
                      {loadingUserCode ? (
                        <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Abrindo iFood...</>
                      ) : (
                        <><Zap size={18} /> 1. Conectar e Autorizar no Portal iFood &rarr;</>
                      )}
                    </button>
                  </div>
                )}

                {/* Campo para colar o Código de Autorização ou Merchant UUID */}
                <div style={{ padding: "16px", borderRadius: 14, background: "#F0FDF4", border: "1.5px solid #86EFAC", marginBottom: "16px" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#166534", marginBottom: 4 }}>
                    🔑 2. Cole o Código de Autorização OU Merchant ID do iFood:
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#15803D", marginBottom: 10 }}>
                    Cole o código gerado na janela <strong>"Aplicativo Autorizado"</strong> ou o <strong>Merchant UUID</strong> da sua loja no iFood (ex: <code>xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</code>).
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Ex: TMFG-KNLN ou ID da Loja (UUID)"
                      value={authCodeInput}
                      onChange={e => setAuthCodeInput(e.target.value.trim())}
                      style={{
                        flex: 1, padding: "10px 14px", borderRadius: 10,
                        border: "1.5px solid #86EFAC", fontSize: "0.88rem",
                        fontWeight: 700, fontFamily: "monospace",
                        outline: "none"
                      }}
                    />
                    <button
                      onClick={handleLinkAuthorizationCode}
                      disabled={connectingAuthCode}
                      style={{
                        padding: "10px 18px", borderRadius: 10, border: "none",
                        background: "linear-gradient(135deg, #16A34A, #15803D)",
                        color: "#fff", fontWeight: 800, fontSize: "0.85rem",
                        cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 6,
                        opacity: connectingAuthCode ? 0.7 : 1,
                        whiteSpace: "nowrap"
                      }}
                    >
                      {connectingAuthCode ? (
                        <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Vinculando...</>
                      ) : (
                        <><CheckCircle2 size={16} /> Concluir Vinculação</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Passo 3: Merchant ID manual (aparece quando auth OK mas merchantId não detectado) */}
                {needsMerchantId && (
                  <div style={{ padding: "16px", borderRadius: 14, background: "#FFFBEB", border: "2px solid #F59E0B", marginBottom: "16px", animation: "fadeIn 0.3s ease-in" }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#92400E", marginBottom: 4 }}>
                      🆔 3. Cole o Merchant ID (UUID) da sua loja no iFood:
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#B45309", marginBottom: 10 }}>
                      A autorização foi concedida! Agora cole o <strong>ID da loja</strong> do seu Portal do Parceiro iFood.
                      Acesse <strong>portal.ifood.com.br</strong> → Configurações → copie o <strong>ID do restaurante</strong> (formato UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        placeholder="Ex: a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                        value={merchantIdInput}
                        onChange={e => setMerchantIdInput(e.target.value.trim())}
                        style={{
                          flex: 1, padding: "10px 14px", borderRadius: 10,
                          border: "2px solid #F59E0B", fontSize: "0.88rem",
                          fontWeight: 700, fontFamily: "monospace",
                          outline: "none", background: "#FFFEF5"
                        }}
                      />
                      <button
                        onClick={handleSubmitMerchantId}
                        disabled={connectingAuthCode}
                        style={{
                          padding: "10px 18px", borderRadius: 10, border: "none",
                          background: "linear-gradient(135deg, #F59E0B, #D97706)",
                          color: "#fff", fontWeight: 800, fontSize: "0.85rem",
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", gap: 6,
                          opacity: connectingAuthCode ? 0.7 : 1,
                          whiteSpace: "nowrap"
                        }}
                      >
                        {connectingAuthCode ? (
                          <><Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Vinculando...</>
                        ) : (
                          <><CheckCircle2 size={16} /> Vincular Loja</>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Info de cobrança */}
                <div style={{ padding: "12px 14px", borderRadius: 12, background: "#EFF6FF", border: "1px solid #BFDBFE", fontSize: "0.78rem", color: "#1E40AF", lineHeight: 1.5, marginBottom: 16 }}>
                  ℹ️ A <strong>1ª integração iFood é gratuita</strong> e já está inclusa no seu plano FireHub.
                  Cada integração adicional custa <strong>+R$50,00/mês</strong> na sua fatura mensal.
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setOpenModal(null); setShowAddIfoodForm(false); }}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Fechar
                  </button>
                </div>
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {/* 💳 MODAL: MERCADO PAGO */}
            {openModal === "pagarme" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #009EE3, #0072B1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.5rem" }}>
                    💙
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>Mercado Pago / Mercado Livre</h2>
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Processamento de Pagamento Online no Cardápio</span>
                  </div>
                </div>

                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                  <div style={{ fontSize: "0.75rem", color: "#15803D" }}>Status da Integração:</div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "#15803D" }}>
                    🟢 Recebimento PIX Instantâneo e Cartão de Crédito Ativos no Cardápio
                  </div>
                </div>

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "24px" }}>
                  Os pagamentos efetuados pelos seus clientes via PIX instantâneo e Cartão de Crédito no cardápio online do FireHub são processados com total segurança através do <strong>Mercado Pago / Mercado Livre</strong> com repasse direto para a sua conta.
                </p>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #009EE3, #0072B1)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Entendido
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
                    <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Integração Oficial 99Food</span>
                  </div>
                </div>

                {food99Connected ? (
                  <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "0.75rem", color: "#15803D" }}>Status da Conexão:</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "#15803D" }}>
                      🟢 Loja Conectada e Sincronizada com 99Food
                    </div>
                  </div>
                ) : (
                  <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", padding: "14px", borderRadius: "14px", marginBottom: "20px" }}>
                    <div style={{ fontSize: "0.75rem", color: "#B45309" }}>Status da Conexão:</div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 900, color: "#B45309" }}>
                      ⚪ Integração Pendente — Insira o ID da sua Loja 99Food
                    </div>
                  </div>
                )}

                <p style={{ fontSize: "0.84rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                  Conecte sua loja do 99Food para capturar pedidos automaticamente, sincronizar prazos e aceitar entregas diretamente no painel do FireHub.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                      <Store size={14} color="#D97706" /> Merchant ID / ID da Loja (99Food)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 99f_store_88231"
                      value={food99MerchantId}
                      onChange={(e) => setFood99MerchantId(e.target.value)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", fontFamily: "monospace", outline: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  {food99Connected && (
                    <button
                      onClick={handleDisconnect99Food}
                      disabled={food99Saving}
                      style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#991B1B", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                    >
                      Desconectar 99Food
                    </button>
                  )}
                  <button
                    onClick={() => setOpenModal(null)}
                    style={{ padding: "10px 18px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
                  >
                    Fechar
                  </button>
                  <button
                    onClick={handleSave99Food}
                    disabled={food99Saving}
                    style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 12px rgba(245,158,11,0.3)", opacity: food99Saving ? 0.7 : 1 }}
                  >
                    <Save size={16} /> {food99Saving ? "Conectando..." : "Conectar & Ativar 99Food"}
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
