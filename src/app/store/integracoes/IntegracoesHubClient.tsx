"use client";
import { useState, useEffect } from "react";
import { CheckCircle2, ShieldCheck, Zap, Key, Store, Save, ExternalLink, RefreshCw } from "lucide-react";

export default function IntegracoesHubClient({
  ifoodMerchantId,
  ifoodClientId,
  ifoodWidgetId,
  userEmail
}: {
  ifoodMerchantId?: string;
  ifoodClientId?: string;
  ifoodWidgetId?: string;
  userEmail: string;
}) {
  const [activeTab, setActiveTab] = useState<"all" | "whatsapp" | "jotaja" | "ifood">("all");

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
      } else {
        showToast("⚠️ Erro ao salvar configurações iFood", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de conexão", "#EF4444");
    } finally {
      setIfSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px 16px", fontFamily: "inherit" }}>
      {/* Toast alert */}
      {toast && (
        <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999, background: toast.color, color: "#fff", padding: "12px 20px", borderRadius: "10px", fontWeight: 700, boxShadow: "0 10px 25px rgba(0,0,0,0.2)", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "8px" }}>
          {toast.msg}
        </div>
      )}

      {/* Header Banner */}
      <div style={{ background: "linear-gradient(135deg, #1E293B, #0F172A)", borderRadius: "20px", padding: "32px", color: "#fff", marginBottom: "28px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.1)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700, color: "#38BDF8", marginBottom: "12px" }}>
              🔌 Central de Integrações
            </div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 900, margin: "0 0 8px 0" }}>
              Integrações & Canais de Venda
            </h1>
            <p style={{ margin: 0, opacity: 0.8, fontSize: "0.9rem", maxWidth: "650px", lineHeight: 1.5 }}>
              Conecte suas plataformas parceiras para receber pedidos automaticamente no FireHub, sincronizar cardápio e gerenciar entregas num só lugar.
            </p>
          </div>

          <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: "12px 18px", borderRadius: "14px", display: "flex", alignItems: "center", gap: "12px" }}>
            <ShieldCheck size={28} color="#10B981" />
            <div>
              <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Conta Vinculada</div>
              <div style={{ fontSize: "0.85rem", fontWeight: 800, color: "#38BDF8" }}>{userEmail}</div>
            </div>
          </div>
        </div>

        {/* Tab Filters */}
        <div style={{ display: "flex", gap: "8px", marginTop: "24px", flexWrap: "wrap" }}>
          <button
            onClick={() => setActiveTab("all")}
            style={{ padding: "8px 16px", borderRadius: "10px", border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "all" ? "#38BDF8" : "rgba(255,255,255,0.1)", color: activeTab === "all" ? "#0F172A" : "#fff" }}
          >
            Todas as Integrações
          </button>
          <button
            onClick={() => setActiveTab("whatsapp")}
            style={{ padding: "8px 16px", borderRadius: "10px", border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "whatsapp" ? "#10B981" : "rgba(255,255,255,0.1)", color: "#fff" }}
          >
            💬 WhatsApp IA & Notificações
          </button>
          <button
            onClick={() => setActiveTab("jotaja")}
            style={{ padding: "8px 16px", borderRadius: "10px", border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "jotaja" ? "#3B82F6" : "rgba(255,255,255,0.1)", color: "#fff" }}
          >
            🛵 JotaJá (Open Delivery)
          </button>
          <button
            onClick={() => setActiveTab("ifood")}
            style={{ padding: "8px 16px", borderRadius: "10px", border: "none", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", background: activeTab === "ifood" ? "#EA580C" : "rgba(255,255,255,0.1)", color: "#fff" }}
          >
            🔴 iFood Merchant API
          </button>
        </div>
      </div>

      {/* Grid of Integration Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: "24px" }}>

        {/* ================= CARD 0: WHATSAPP IA ================= */}
        {(activeTab === "all" || activeTab === "whatsapp") && (
          <div style={{ background: "#fff", borderRadius: "20px", border: "1.5px solid #E2E8F0", padding: "24px", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              {/* Card Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #10B981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.4rem", fontWeight: 900 }}>
                    💬
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.15rem", color: "#0F172A" }}>WhatsApp IA & Notificações</h3>
                    <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Conexão 1-Clique por QR Code e Robô Atendente 24/7</span>
                  </div>
                </div>

                {waConnected ? (
                  <span style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#15803D", padding: "4px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "4px" }}>
                    <CheckCircle2 size={14} /> {waPhone || "Conectado & Ativo"}
                  </span>
                ) : (
                  <span style={{ background: "#FEF3C7", border: "1px solid #FDE68A", color: "#B45309", padding: "4px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800 }}>
                    ⚡ Aguardando Leitura
                  </span>
                )}
              </div>

              <p style={{ fontSize: "0.83rem", color: "#475569", lineHeight: 1.5, marginBottom: "16px" }}>
                Conecte o celular da sua loja lendo o QR Code pelo WhatsApp sem nenhuma configuração técnica. Envie status automáticos dos pedidos e deixe a Inteligência Artificial atender seus clientes com o cardápio atualizado.
              </p>

              <div style={{ background: "#F8FAFC", borderRadius: "12px", padding: "14px", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.8rem", color: "#334155" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <CheckCircle2 size={14} color="#10B981" /> <strong>Conexão Simples:</strong> Apenas escaneie o QR Code no celular da loja.
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <CheckCircle2 size={14} color="#10B981" /> <strong>Notificações Automáticas:</strong> Envia avisos de "Pedido Aceito" e "Saiu para Entrega".
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <CheckCircle2 size={14} color="#10B981" /> <strong>Robô Inteligente:</strong> Gemini 2.5 responde dúvidas de produtos e links do cardápio.
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748B" }}>
                Status: <strong style={{ color: waConnected ? "#16A34A" : "#D97706" }}>{waConnected ? "Conectado" : "Pendente QR Code"}</strong>
              </span>
              <a
                href="/store/chatbot"
                style={{ padding: "10px 18px", borderRadius: "10px", background: "linear-gradient(135deg, #10B981, #059669)", color: "#fff", fontWeight: 700, fontSize: "0.85rem", textDecoration: "none", display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 4px 12px rgba(16,185,129,0.25)" }}
              >
                ⚙️ Configurar e Conectar WhatsApp
              </a>
            </div>
          </div>
        )}

        {/* ================= CARD 1: JOTAJA ================= */}
        {(activeTab === "all" || activeTab === "jotaja") && (
          <div style={{ background: "#fff", borderRadius: "20px", border: "1.5px solid #E2E8F0", padding: "24px", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              {/* Card Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #2563EB, #1D4ED8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.4rem", fontWeight: 900 }}>
                    🛵
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.15rem", color: "#0F172A" }}>JotaJá (Open Delivery)</h3>
                    <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Integração de pedidos via API Open Delivery</span>
                  </div>
                </div>

                {jjConnected ? (
                  <span style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#15803D", padding: "4px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "4px" }}>
                    <CheckCircle2 size={14} /> Conectado & Ativo
                  </span>
                ) : (
                  <span style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#64748B", padding: "4px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700 }}>
                    ⚪ Não Conectado
                  </span>
                )}
              </div>

              <p style={{ fontSize: "0.83rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                Insira abaixo as credenciais fornecidas no seu painel JotaJá (em <strong>Configurações &rarr; Integrações / API OpenDelivery</strong>) para receber pedidos automaticamente no FireHub.
              </p>

              {/* Form inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
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
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
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
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
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
            </div>

            {/* Save Button */}
            <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748B" }}>
                Status: <strong style={{ color: jjConnected ? "#16A34A" : "#64748B" }}>{jjConnected ? "Ativo" : "Inativo"}</strong>
              </span>
              <button
                type="button"
                onClick={handleSaveJotaja}
                disabled={jjSaving}
                style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #2563EB, #1D4ED8)", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 4px 12px rgba(37,99,235,0.25)", opacity: jjSaving ? 0.7 : 1 }}
              >
                <Save size={16} /> {jjSaving ? "Salvando..." : "Salvar e Ativar Integração JotaJá"}
              </button>
            </div>
          </div>
        )}

        {/* ================= CARD 2: IFOOD ================= */}
        {(activeTab === "all" || activeTab === "ifood") && (
          <div style={{ background: "#fff", borderRadius: "20px", border: "1.5px solid #E2E8F0", padding: "24px", boxShadow: "0 4px 16px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              {/* Card Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, #EA580C, #C2410C)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.4rem", fontWeight: 900 }}>
                    🔴
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.15rem", color: "#0F172A" }}>iFood Merchant API</h3>
                    <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Integração de pedidos e loja oficial iFood</span>
                  </div>
                </div>

                <span style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", color: "#15803D", padding: "4px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, display: "flex", alignItems: "center", gap: "4px" }}>
                  <CheckCircle2 size={14} /> Ativo
                </span>
              </div>

              <p style={{ fontSize: "0.83rem", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
                Conecte a sua loja do iFood via Código de Autorização para aceitar pedidos, despachar entregas e sincronizar status automaticamente.
              </p>

              {/* Form inputs */}
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
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
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
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
            </div>

            {/* Save Button */}
            <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748B" }}>
                Status: <strong style={{ color: "#16A34A" }}>Conectado</strong>
              </span>
              <button
                type="button"
                onClick={handleSaveIfood}
                disabled={ifSaving}
                style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #EA580C, #C2410C)", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 4px 12px rgba(234,88,12,0.25)", opacity: ifSaving ? 0.7 : 1 }}
              >
                <Save size={16} /> {ifSaving ? "Salvando..." : "Salvar Configurações iFood"}
              </button>
            </div>
          </div>
        )}

        {/* ================= CARD 3: 99FOOD (EM BREVE) ================= */}
        {activeTab === "all" && (
          <div style={{ background: "#F8FAFC", borderRadius: "20px", border: "1.5px dashed #CBD5E1", padding: "24px", opacity: 0.8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "1.3rem", fontWeight: 900 }}>
                  🟡
                </div>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#334155" }}>99Food Delivery</h3>
                  <span style={{ fontSize: "0.72rem", color: "#64748B" }}>Integração Open Delivery</span>
                </div>
              </div>
              <span style={{ background: "#FEF3C7", color: "#92400E", padding: "4px 10px", borderRadius: "20px", fontSize: "0.72rem", fontWeight: 800 }}>
                🚀 Em Breve
              </span>
            </div>
            <p style={{ fontSize: "0.8rem", color: "#64748B", margin: 0 }}>
              Integração direta com o 99Food para captura e gerenciamento automático de pedidos.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
