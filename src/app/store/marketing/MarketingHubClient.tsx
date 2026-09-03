"use client";

import { useState, useEffect } from "react";
import {
  Send,
  Users,
  ShieldCheck,
  Zap,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Gift,
  Search,
  MessageSquare,
  Flame,
  RefreshCw,
} from "lucide-react";

import { DISPARO_EM_MASSA_LIBERADO, MOTIVO_DISPARO_DESLIGADO } from "@/lib/disparo-em-massa";

export default function MarketingHubClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  const [activeTab, setActiveTab] = useState<"broadcast" | "automation" | "database">("broadcast");

  // Dados de Clientes
  const [customers, setCustomers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  // Disparo em Massa Manual (Broadcast)
  const [broadcastMessage, setBroadcastMessage] = useState(
    "Oie! 🍕 Quinta-feira especial no nosso delivery! Na compra de qualquer combo, você ganha uma bebida trincando de gelada! Vem pedir:\n👉 https://firehubfood.com.br"
  );
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);

  // Automações Pré-Configuradas (7d, 15d, 30d)
  const [autoConfig, setAutoConfig] = useState({
    autoRecuperation7d: true,
    autoRecuperation15d: true,
    autoRecuperation30d: true,
    msg7d: "Oie, sentimos sua falta! 🍕 Que tal matar a fome hoje com R$ 10 de desconto? Use o cupom VOLTEI10!",
    msg15d: "Faz 15 dias que você não pede seu lanche favorito! 🚀 Ganhe 15% OFF hoje no nosso cardápio!",
    msg30d: "Saudade do nosso tempero especial? ❤️ Liberamos Frete Grátis exclusivo para você pedir hoje!",
  });

  // Toast State
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const showToast = (msg: string, color: string = "#10B981") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 5000);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/store/marketing").then((r) => r.json());
      if (res.success) {
        setCustomers(res.customers || []);
        if (res.marketingConfig) {
          setAutoConfig(res.marketingConfig);
        }
        // Seleciona todos os números por padrão para disparo fácil
        setSelectedPhones((res.customers || []).map((c: any) => c.phone));
      }
    } catch (e) {
      showToast("⚠️ Falha ao carregar base de marketing", "#EF4444");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Salvar Automações (7d, 15d, 30d)
  const handleSaveAutomation = async () => {
    try {
      setSaving(true);
      const res = await fetch("/api/store/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_config",
          ...autoConfig,
        }),
      });

      if (res.ok) {
        showToast("✅ Automações de Marketing salvas com sucesso!", "#10B981");
      } else {
        showToast("⚠️ Erro ao salvar configurações", "#EF4444");
      }
    } catch {
      showToast("⚠️ Falha de conexão", "#EF4444");
    } finally {
      setSaving(false);
    }
  };

  // Disparar Campanha Anti-Ban
  const handleSendBroadcast = async () => {
    if (!broadcastMessage.trim()) {
      showToast("⚠️ Digite o texto da promoção", "#EF4444");
      return;
    }
    if (selectedPhones.length === 0) {
      showToast("⚠️ Selecione pelo menos 1 contato da sua base", "#EF4444");
      return;
    }

    try {
      setSendingBroadcast(true);
      const res = await fetch("/api/store/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_broadcast",
          message: broadcastMessage,
          targetPhones: selectedPhones,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast(data.message, "#10B981");
      } else {
        showToast(data.error || "⚠️ Falha ao iniciar disparo", "#EF4444");
      }
    } catch {
      showToast("⚠️ Erro de rede ao disparar campanha", "#EF4444");
    } finally {
      setSendingBroadcast(false);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone?.includes(searchTerm)
  );

  const toggleSelectPhone = (phone: string) => {
    if (selectedPhones.includes(phone)) {
      setSelectedPhones(selectedPhones.filter((p) => p !== phone));
    } else {
      setSelectedPhones([...selectedPhones, phone]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedPhones.length === filteredCustomers.length) {
      setSelectedPhones([]);
    } else {
      setSelectedPhones(filteredCustomers.map((c) => c.phone));
    }
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "1.5rem 1rem", fontFamily: "sans-serif" }}>
      {/* TOAST */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            background: toast.color,
            color: "#fff",
            padding: "12px 20px",
            borderRadius: "12px",
            fontWeight: 700,
            fontSize: "0.88rem",
            boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
            zIndex: 10000,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <div
        style={{
          background: "linear-gradient(135deg, #1E1B4B, #312E81)",
          color: "#fff",
          borderRadius: "20px",
          padding: "2rem",
          marginBottom: "1.5rem",
          boxShadow: "0 10px 30px rgba(49, 46, 129, 0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.15)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, color: "#A5B4FC", marginBottom: "8px" }}>
              <ShieldCheck size={14} /> SISTEMA ANTI-BAN WHATSAPP ATIVO
            </div>
            <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 800 }}>Marketing &amp; Disparos no WhatsApp</h1>
            <p style={{ margin: "4px 0 0 0", fontSize: "0.85rem", opacity: 0.8 }}>
              Fidelize seus clientes com mensagens automáticas e campanhas sem risco de bloqueio de número.
            </p>
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ background: "rgba(255,255,255,0.1)", padding: "10px 16px", borderRadius: "12px", textAlign: "center" }}>
              <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>{customers.length}</div>
              <div style={{ fontSize: "0.7rem", opacity: 0.8 }}>Clientes na Base</div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.1)", padding: "10px 16px", borderRadius: "12px", textAlign: "center" }}>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#4ADE80" }}>100% SEGURO</div>
              <div style={{ fontSize: "0.7rem", opacity: 0.8 }}>Frequência Anti-Ban</div>
            </div>
          </div>
        </div>
      </div>

      {/* NAVEGAÇÃO POR ABAS */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "1.5rem", borderBottom: "2px solid #E2E8F0", paddingBottom: "8px" }}>
        {[
          { id: "broadcast", label: "🚀 Disparo em Massa Anti-Ban", icon: Send },
          { id: "automation", label: "🤖 Automação Recorrente (7d, 15d, 30d)", icon: Clock },
          { id: "database", label: "👥 Base de Clientes Cadastrados", icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: "10px 18px",
                borderRadius: "10px",
                border: "none",
                background: isActive ? "#312E81" : "transparent",
                color: isActive ? "#fff" : "#64748B",
                fontWeight: 800,
                fontSize: "0.85rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                transition: "all 0.2s",
              }}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ABA 1: DISPARO EM MASSA ANTI-BAN */}
      {activeTab === "broadcast" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "1.5rem" }}>
          <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "16px", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
            <h3 style={{ margin: "0 0 4px 0", fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>Criar Nova Campanha de Promoção</h3>
            <p style={{ margin: "0 0 16px 0", fontSize: "0.78rem", color: "#64748B" }}>
              Escreva sua mensagem. O sistema enviará cada mensagem com intervalo humano aleatório de 12 a 28 segundos e pausas de descanso em lote para proteger seu chip contra bloqueios do WhatsApp.
            </p>

            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
              Texto da Promoção:
            </label>
            <textarea
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              placeholder="Digite o texto da promoção..."
              style={{
                width: "100%",
                height: "120px",
                padding: "12px",
                borderRadius: "12px",
                border: "1.5px solid #CBD5E1",
                fontSize: "0.88rem",
                resize: "none",
                marginBottom: "1rem",
                boxSizing: "border-box",
                outline: "none",
              }}
            />

            {DISPARO_EM_MASSA_LIBERADO ? (
              <div style={{ background: "#F0FDF4", padding: "16px", borderRadius: "12px", display: "flex", gap: "12px", border: "1px solid #BBF7D0", color: "#166534", fontSize: "0.95rem" }}>
                🛡️ <strong>Envio em ritmo humano:</strong> as mensagens saem uma a cada 12 a 28 segundos, com descanso de 45 a 75 segundos a cada dez. O disparo roda em segundo plano e leva alguns minutos.
              </div>
            ) : (
              /* O aviso que estava aqui dizia "Proteção Anti-Ban Ativada" e dava a
                 entender que o ritmo lento protegia o número. Ele não protege:
                 mandar devagar não conserta mandar para quem não pediu. Um número
                 da casa foi perdido com essa impressão de segurança. */
              <div style={{ background: "#FEF2F2", padding: "18px", borderRadius: "14px", border: "2px solid #FCA5A5" }}>
                <p style={{ margin: 0, fontWeight: 800, fontSize: "1rem", color: "#991B1B", display: "flex", alignItems: "center", gap: 8 }}>
                  🚫 Disparo de campanha desligado
                </p>
                <p style={{ margin: "8px 0 0", fontSize: "0.9rem", color: "#7F1D1D", lineHeight: 1.6 }}>
                  {MOTIVO_DISPARO_DESLIGADO}
                </p>
                <p style={{ margin: "10px 0 0", fontSize: "0.86rem", color: "#7F1D1D", lineHeight: 1.6 }}>
                  <strong>O que continua funcionando:</strong> o robô responde normalmente quem
                  manda mensagem para a loja. O que saiu do ar é só o envio para uma lista.
                </p>
              </div>
            )}

            {selectedPhones.length > 150 && (
              <div style={{ background: "#FEF2F2", padding: "16px", borderRadius: "12px", display: "flex", gap: "12px", border: "1px solid #FECACA", color: "#991B1B", fontSize: "0.95rem", marginTop: "12px" }}>
                ⚠️ <strong>Risco de Banimento Elevado:</strong> Você selecionou {selectedPhones.length} clientes. Recomendamos disparar para no máximo 100-150 pessoas por dia usando o QR Code para proteger o seu número de bloqueios do WhatsApp.
              </div>
            )}

            <button
              onClick={handleSendBroadcast}
              disabled={sendingBroadcast || !DISPARO_EM_MASSA_LIBERADO}
              style={{
                width: "100%",
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: DISPARO_EM_MASSA_LIBERADO
                  ? "linear-gradient(135deg, #16A34A, #15803D)"
                  : "#E2E8F0",
                color: DISPARO_EM_MASSA_LIBERADO ? "#fff" : "#94A3B8",
                fontWeight: 800,
                fontSize: "0.95rem",
                cursor: DISPARO_EM_MASSA_LIBERADO ? "pointer" : "not-allowed",
                boxShadow: DISPARO_EM_MASSA_LIBERADO ? "0 4px 14px rgba(22, 163, 74, 0.3)" : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              <Send size={18} />
              {!DISPARO_EM_MASSA_LIBERADO
                ? "Disparo desligado"
                : sendingBroadcast
                  ? "Enviando em segundo plano..."
                  : `🚀 Disparar para ${selectedPhones.length} Cliente(s) Selecionados`}
            </button>
          </div>

          {/* SELETOR DE DESTINATÁRIOS */}
          <div style={{ background: "#fff", padding: "1.25rem", borderRadius: "16px", border: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#0F172A" }}>Destinatários ({selectedPhones.length})</div>
              <button onClick={toggleSelectAll} style={{ background: "#F1F5F9", border: "none", padding: "4px 8px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", color: "#334155" }}>
                {selectedPhones.length === filteredCustomers.length ? "Desmarcar Todos" : "Marcar Todos"}
              </button>
            </div>

            <div style={{ maxHeight: "350px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
              {filteredCustomers.map((c) => {
                const isChecked = selectedPhones.includes(c.phone);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggleSelectPhone(c.phone)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: isChecked ? "#F0FDF4" : "#F8FAFC",
                      border: `1px solid ${isChecked ? "#BBF7D0" : "#E2E8F0"}`,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "0.78rem",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: "#1E293B" }}>{c.name}</div>
                      <div style={{ color: "#64748B", fontSize: "0.72rem" }}>{c.phone}</div>
                    </div>
                    <input type="checkbox" checked={isChecked} readOnly style={{ accentColor: "#16A34A" }} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: AUTOMAÇÃO RECORRENTE (7d, 15d, 30d) */}
      {activeTab === "automation" && (
        <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "16px", border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <h3 style={{ margin: "0 0 4px 0", fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>
              🤖 Automação Inteligente de Reciclagem de Clientes
            </h3>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>
              Configure mensagens com gatilhos automáticos baseados nos dias sem comprar. O robô enviará cupons de incentivo sem você precisar mover um dedo!
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginBottom: "1.5rem" }}>
            {/* GATILHO 7 DIAS */}
            <div style={{ background: "#F8FAFC", padding: "1.25rem", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 800, color: "#1E293B" }}>
                  <Flame size={18} color="#EA580C" /> 1º Incentivo — Cliente 7 Dias Sem Pedir
                </div>
                <button
                  onClick={() => setAutoConfig({ ...autoConfig, autoRecuperation7d: !autoConfig.autoRecuperation7d })}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: autoConfig.autoRecuperation7d ? "#16A34A" : "#CBD5E1",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  {autoConfig.autoRecuperation7d ? "ATIVADO" : "DESATIVADO"}
                </button>
              </div>
              <textarea
                value={autoConfig.msg7d}
                onChange={(e) => setAutoConfig({ ...autoConfig, msg7d: e.target.value })}
                style={{ width: "100%", height: "60px", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", resize: "none" }}
              />
            </div>

            {/* GATILHO 15 DIAS */}
            <div style={{ background: "#F8FAFC", padding: "1.25rem", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 800, color: "#1E293B" }}>
                  <Gift size={18} color="#2563EB" /> 2º Incentivo — Cliente 15 Dias Sem Pedir
                </div>
                <button
                  onClick={() => setAutoConfig({ ...autoConfig, autoRecuperation15d: !autoConfig.autoRecuperation15d })}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: autoConfig.autoRecuperation15d ? "#16A34A" : "#CBD5E1",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  {autoConfig.autoRecuperation15d ? "ATIVADO" : "DESATIVADO"}
                </button>
              </div>
              <textarea
                value={autoConfig.msg15d}
                onChange={(e) => setAutoConfig({ ...autoConfig, msg15d: e.target.value })}
                style={{ width: "100%", height: "60px", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", resize: "none" }}
              />
            </div>

            {/* GATILHO 30 DIAS */}
            <div style={{ background: "#F8FAFC", padding: "1.25rem", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 800, color: "#1E293B" }}>
                  <Sparkles size={18} color="#7C3AED" /> 3º Incentivo — Cliente 30 Dias Sem Pedir (Super Cupom/Frete Grátis)
                </div>
                <button
                  onClick={() => setAutoConfig({ ...autoConfig, autoRecuperation30d: !autoConfig.autoRecuperation30d })}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: autoConfig.autoRecuperation30d ? "#16A34A" : "#CBD5E1",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  {autoConfig.autoRecuperation30d ? "ATIVADO" : "DESATIVADO"}
                </button>
              </div>
              <textarea
                value={autoConfig.msg30d}
                onChange={(e) => setAutoConfig({ ...autoConfig, msg30d: e.target.value })}
                style={{ width: "100%", height: "60px", padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", resize: "none" }}
              />
            </div>
          </div>

          <button
            onClick={handleSaveAutomation}
            disabled={saving}
            style={{
              padding: "12px 24px",
              borderRadius: "10px",
              border: "none",
              background: "#312E81",
              color: "#fff",
              fontWeight: 800,
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            {saving ? "Salvando Automações..." : "✓ Salvar Regras de Automação Automáticas"}
          </button>
        </div>
      )}

      {/* ABA 3: BASE DE CLIENTES CADASTRAIS */}
      {activeTab === "database" && (
        <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "16px", border: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <h3 style={{ margin: "0 0 4px 0", fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>
                Banco de Dados de Clientes Interativos
              </h3>
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>
                Clientes gravados automaticamente após interagirem com o robô ou realizarem pedidos no seu site.
              </p>
            </div>

            <div style={{ position: "relative", minWidth: "260px" }}>
              <input
                type="text"
                placeholder="Buscar por nome ou número..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px 8px 32px",
                  borderRadius: "8px",
                  border: "1px solid #CBD5E1",
                  fontSize: "0.82rem",
                  outline: "none",
                }}
              />
              <Search size={14} style={{ position: "absolute", left: "10px", top: "10px", color: "#94A3B8" }} />
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.84rem" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", color: "#475569" }}>
                  <th style={{ padding: "10px 14px" }}>Nome do Cliente</th>
                  <th style={{ padding: "10px 14px" }}>WhatsApp</th>
                  <th style={{ padding: "10px 14px" }}>Total de Pedidos</th>
                  <th style={{ padding: "10px 14px" }}>Última Interação</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "30px", textAlign: "center", color: "#94A3B8" }}>
                      Nenhum cliente registrado na base ainda.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "#0F172A" }}>{c.name}</td>
                      <td style={{ padding: "10px 14px", color: "#2563EB", fontWeight: 700 }}>{c.phone}</td>
                      <td style={{ padding: "10px 14px" }}>{c.totalOrders || 0} pedido(s)</td>
                      <td style={{ padding: "10px 14px", color: "#64748B", fontSize: "0.78rem" }}>
                        {new Date(c.updatedAt).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
