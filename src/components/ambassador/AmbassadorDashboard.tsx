"use client";
import { useState, useMemo } from "react";
import { signOut } from "next-auth/react";

export interface ReferredStoreItem {
  id: string;
  name: string;
  storeName: string;
  storePhone: string | null;
  email: string | null;
  slug: string | null;
  city: string | null;
  createdAt: string;
  trialEndsAt: string | null;
  trialDaysRemaining: number;
  status: "TRIAL" | "ACTIVE" | "INACTIVE";
  monthSales: number;
  monthOrdersCount: number;
  platformFee: number;
  ambassadorProfit: number;
}

interface AmbassadorDashboardProps {
  ambassador: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    code: string;
    commissionPercent: number;
    asaasWalletId: string | null;
    active: boolean;
  };
  stores: ReferredStoreItem[];
  currentMonthIncome: number;
  totalPortfolioSales: number;
  totalPlatformFees: number;
}

export default function AmbassadorDashboard({
  ambassador,
  stores,
  currentMonthIncome,
  totalPortfolioSales,
  totalPlatformFees,
}: AmbassadorDashboardProps) {
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "TRIAL" | "INACTIVE">("ALL");

  const inviteLink = `https://firehubfood.com.br/cadastro?ref=${ambassador.code}`;

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const activeCount = stores.filter((s) => s.status === "ACTIVE").length;
  const trialCount = stores.filter((s) => s.status === "TRIAL").length;
  const inactiveCount = stores.filter((s) => s.status === "INACTIVE").length;
  const totalOrdersCount = stores.reduce((acc, s) => acc + s.monthOrdersCount, 0);

  const filteredStores = useMemo(() => {
    return stores.filter((store) => {
      const matchesStatus = statusFilter === "ALL" || store.status === statusFilter;
      const search = searchTerm.toLowerCase();
      const matchesSearch =
        !searchTerm ||
        store.storeName.toLowerCase().includes(search) ||
        store.name.toLowerCase().includes(search) ||
        (store.email && store.email.toLowerCase().includes(search)) ||
        (store.city && store.city.toLowerCase().includes(search)) ||
        (store.storePhone && store.storePhone.includes(search));
      return matchesStatus && matchesSearch;
    });
  }, [stores, statusFilter, searchTerm]);

  const formatBRL = (value: number) => {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0F172A", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#F8FAFC" }}>
      <style>{`
        * { box-sizing: border-box; }
        .amb-table-row:hover {
          background: #1E293B !important;
        }
        .amb-btn-copy:hover {
          opacity: 0.92;
          transform: translateY(-1px);
        }
        .amb-filter-pill {
          cursor: pointer;
          transition: all 0.2s;
        }
        .amb-filter-pill:hover {
          border-color: #EF4444 !important;
        }
      `}</style>

      {/* HEADER */}
      <header
        style={{
          background: "#1E293B",
          borderBottom: "1px solid #334155",
          padding: "16px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/firehub-flame.png" alt="FireHub" style={{ width: 34, height: 34, borderRadius: "8px" }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 900, fontSize: "1.25rem", letterSpacing: "-0.5px" }}>
                <span style={{ color: "#EF4444" }}>FIRE</span>HUB
              </span>
              <span
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "#FCA5A5",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                Embaixador
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0F172A", padding: "6px 12px", borderRadius: "8px", border: "1px solid #334155" }}>
            <span style={{ fontSize: "0.85rem", color: "#94A3B8" }}>Comissão:</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "#10B981" }}>{ambassador.commissionPercent}% Recorrente</span>
          </div>

          <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#E2E8F0" }}>
            Olá, <strong style={{ color: "#FFF" }}>{ambassador.name}</strong>
          </div>

          <button
            onClick={() => signOut({ callbackUrl: "/embaixador" })}
            style={{
              background: "#334155",
              border: "1px solid #475569",
              color: "#F1F5F9",
              padding: "7px 14px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "0.82rem",
              fontWeight: 600,
              transition: "all 0.2s",
            }}
          >
            Sair
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
        
        {/* TOP METRICS CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 18, marginBottom: 28 }}>
          
          {/* Card 1: Lucro Previsto */}
          <div style={{ background: "#1E293B", border: "1px solid #334155", padding: "22px", borderRadius: "16px", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "#94A3B8", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                💰 Seu Lucro no Mês
              </span>
              <span style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34D399", padding: "3px 8px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 800 }}>
                {ambassador.commissionPercent}%
              </span>
            </div>
            <div style={{ fontSize: "2.1rem", fontWeight: 900, color: "#10B981", letterSpacing: "-0.5px" }}>
              {formatBRL(currentMonthIncome)}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 6 }}>
              Baseado nas mensalidades geradas pelas lojas da sua carteira
            </div>
          </div>

          {/* Card 2: Lojas na Carteira */}
          <div style={{ background: "#1E293B", border: "1px solid #334155", padding: "22px", borderRadius: "16px", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.3)" }}>
            <div style={{ color: "#94A3B8", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
              🏪 Lojas na Carteira
            </div>
            <div style={{ fontSize: "2.1rem", fontWeight: 900, color: "#F8FAFC", letterSpacing: "-0.5px" }}>
              {stores.length}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#94A3B8", marginTop: 6, display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ color: "#34D399", fontWeight: 600 }}>● {activeCount} ativas</span>
              <span style={{ color: "#FBBF24", fontWeight: 600 }}>● {trialCount} em teste</span>
              <span style={{ color: "#F87171", fontWeight: 600 }}>● {inactiveCount} inativas</span>
            </div>
          </div>

          {/* Card 3: Faturamento Total das Lojas */}
          <div style={{ background: "#1E293B", border: "1px solid #334155", padding: "22px", borderRadius: "16px", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.3)" }}>
            <div style={{ color: "#94A3B8", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
              📈 Faturamento das Lojas (Mês)
            </div>
            <div style={{ fontSize: "2.1rem", fontWeight: 900, color: "#38BDF8", letterSpacing: "-0.5px" }}>
              {formatBRL(totalPortfolioSales)}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 6 }}>
              {totalOrdersCount} pedidos movimentados nas lojas indicadas
            </div>
          </div>

          {/* Card 4: Link de Convite Oficial */}
          <div style={{ background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)", border: "1.5px solid #EF4444", padding: "22px", borderRadius: "16px", boxShadow: "0 10px 25px -5px rgba(239,68,68,0.2)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: "#FCA5A5", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  🔗 Seu Link de Indicação
                </span>
                <span style={{ background: "rgba(239,68,68,0.2)", color: "#FCA5A5", padding: "2px 6px", borderRadius: "4px", fontSize: "0.72rem", fontWeight: 700 }}>
                  {ambassador.code}
                </span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "#94A3B8", margin: "4px 0 12px 0" }}>
                Compartilhe com donos de restaurantes para cadastrá-los na sua carteira
              </p>
            </div>
            <button
              onClick={copyLink}
              className="amb-btn-copy"
              style={{
                width: "100%",
                padding: "12px",
                background: copied ? "#10B981" : "linear-gradient(135deg, #EF4444, #DC2626)",
                color: "#FFF",
                border: "none",
                borderRadius: "10px",
                fontWeight: 800,
                fontSize: "0.9rem",
                cursor: "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
            >
              {copied ? "✅ Link Copiado!" : "📋 Copiar Link de Indicação"}
            </button>
          </div>

        </div>

        {/* DEMONSTRATION & PROSPECTING HELPER */}
        <div
          style={{
            background: "#1E293B",
            border: "1px solid #334155",
            borderRadius: "14px",
            padding: "20px 24px",
            marginBottom: "28px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div style={{ maxWidth: 750 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: "1.1rem" }}>💡</span>
              <strong style={{ fontSize: "0.98rem", color: "#FFF" }}>
                Apresentando o FireHub para novos clientes?
              </strong>
            </div>
            <p style={{ fontSize: "0.85rem", color: "#94A3B8", margin: 0, lineHeight: 1.5 }}>
              Mostre a agilidade do cardápio digital, o painel do garçom e o fechamento automático de caixa. Para cadastrar um novo cliente, envie sempre o seu link com <strong>15 dias de teste grátis</strong> para vinculá-lo automaticamente à sua carteira de comissões.
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <a
              href="https://firehubfood.com.br"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: "#0F172A",
                border: "1px solid #475569",
                color: "#F8FAFC",
                padding: "10px 16px",
                borderRadius: "8px",
                textDecoration: "none",
                fontSize: "0.85rem",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              🌐 Abrir Site Oficial
            </a>
          </div>
        </div>

        {/* STORES SECTION */}
        <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: "16px", overflow: "hidden", boxShadow: "0 10px 25px -5px rgba(0,0,0,0.3)" }}>
          
          {/* Header Controls */}
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#FFF", margin: 0 }}>
                Lojas na sua Carteira
              </h2>
              <p style={{ fontSize: "0.82rem", color: "#94A3B8", margin: "4px 0 0 0" }}>
                Acompanhe o faturamento, status e lucro estimado de cada restaurante indicado
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              {/* Search input */}
              <input
                type="text"
                placeholder="Buscar por loja, telefone, cidade..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  background: "#0F172A",
                  border: "1px solid #475569",
                  borderRadius: "8px",
                  padding: "8px 14px",
                  color: "#FFF",
                  fontSize: "0.85rem",
                  outline: "none",
                  width: "240px",
                }}
              />

              {/* Status Filter Tabs */}
              <div style={{ display: "flex", background: "#0F172A", padding: "3px", borderRadius: "8px", border: "1px solid #334155" }}>
                <button
                  onClick={() => setStatusFilter("ALL")}
                  className="amb-filter-pill"
                  style={{
                    background: statusFilter === "ALL" ? "#334155" : "transparent",
                    color: statusFilter === "ALL" ? "#FFF" : "#94A3B8",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                  }}
                >
                  Todas ({stores.length})
                </button>
                <button
                  onClick={() => setStatusFilter("ACTIVE")}
                  className="amb-filter-pill"
                  style={{
                    background: statusFilter === "ACTIVE" ? "#334155" : "transparent",
                    color: statusFilter === "ACTIVE" ? "#34D399" : "#94A3B8",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                  }}
                >
                  Ativas ({activeCount})
                </button>
                <button
                  onClick={() => setStatusFilter("TRIAL")}
                  className="amb-filter-pill"
                  style={{
                    background: statusFilter === "TRIAL" ? "#334155" : "transparent",
                    color: statusFilter === "TRIAL" ? "#FBBF24" : "#94A3B8",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                  }}
                >
                  Em Teste ({trialCount})
                </button>
                <button
                  onClick={() => setStatusFilter("INACTIVE")}
                  className="amb-filter-pill"
                  style={{
                    background: statusFilter === "INACTIVE" ? "#334155" : "transparent",
                    color: statusFilter === "INACTIVE" ? "#F87171" : "#94A3B8",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                  }}
                >
                  Inativas ({inactiveCount})
                </button>
              </div>
            </div>
          </div>

          {/* Stores Table */}
          {filteredStores.length === 0 ? (
            <div style={{ padding: "48px 20px", textAlign: "center", color: "#94A3B8" }}>
              <div style={{ fontSize: "2rem", marginBottom: "12px" }}>🏪</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#FFF", marginBottom: "6px" }}>
                {stores.length === 0 ? "Nenhuma loja indicada ainda" : "Nenhuma loja encontrada com esse filtro"}
              </h3>
              <p style={{ fontSize: "0.85rem", maxWidth: 450, margin: "0 auto 18px auto" }}>
                {stores.length === 0
                  ? "Envie seu link de indicação para os donos de restaurantes para começar a construir sua carteira de comissões recorrentes!"
                  : "Tente buscar por outro termo ou selecione outro filtro de status."}
              </p>
              {stores.length === 0 && (
                <button
                  onClick={copyLink}
                  style={{
                    background: "#EF4444",
                    color: "#FFF",
                    border: "none",
                    borderRadius: "8px",
                    padding: "10px 20px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Copiar Meu Link de Indicação
                </button>
              )}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.88rem" }}>
                <thead>
                  <tr style={{ background: "#0F172A", borderBottom: "1px solid #334155", color: "#94A3B8", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    <th style={{ padding: "14px 20px" }}>Restaurante / Lojista</th>
                    <th style={{ padding: "14px 16px" }}>Status</th>
                    <th style={{ padding: "14px 16px" }}>Faturamento no Mês</th>
                    <th style={{ padding: "14px 16px" }}>Mensalidade FireHub</th>
                    <th style={{ padding: "14px 16px" }}>Seu Lucro (Mês)</th>
                    <th style={{ padding: "14px 20px", textAlign: "right" }}>Contato</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStores.map((store) => {
                    const cleanPhone = store.storePhone ? store.storePhone.replace(/\D/g, "") : "";
                    const whatsappLink = cleanPhone
                      ? `https://wa.me/55${cleanPhone}?text=Ol%C3%A1%20${encodeURIComponent(store.name)}!%20Tudo%20bem?%20Sou%20o%20${encodeURIComponent(ambassador.name.split(" ")[0])}%20do%20FireHub.`
                      : null;

                    return (
                      <tr
                        key={store.id}
                        className="amb-table-row"
                        style={{
                          borderBottom: "1px solid #334155",
                          background: "#1E293B",
                          transition: "background 0.15s",
                        }}
                      >
                        {/* Store Info */}
                        <td style={{ padding: "16px 20px" }}>
                          <div style={{ fontWeight: 800, color: "#FFF", fontSize: "0.95rem" }}>
                            {store.storeName}
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "#94A3B8", marginTop: 2 }}>
                            {store.name} {store.city ? `· ${store.city}` : ""}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 2 }}>
                            Cadastrado em {new Date(store.createdAt).toLocaleDateString("pt-BR")}
                          </div>
                          {store.slug && (
                            <a
                              href={`/loja/${store.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                color: "#38BDF8",
                                fontSize: "0.75rem",
                                marginTop: 4,
                                textDecoration: "none",
                                fontWeight: 600,
                              }}
                            >
                              ↗ Ver Cardápio Digital
                            </a>
                          )}
                        </td>

                        {/* Status */}
                        <td style={{ padding: "16px 16px" }}>
                          {store.status === "ACTIVE" && (
                            <span
                              style={{
                                background: "rgba(16, 185, 129, 0.15)",
                                color: "#34D399",
                                border: "1px solid rgba(16, 185, 129, 0.3)",
                                padding: "4px 10px",
                                borderRadius: "20px",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              ● Ativa
                            </span>
                          )}
                          {store.status === "TRIAL" && (
                            <div>
                              <span
                                style={{
                                  background: "rgba(245, 158, 11, 0.15)",
                                  color: "#FBBF24",
                                  border: "1px solid rgba(245, 158, 11, 0.3)",
                                  padding: "4px 10px",
                                  borderRadius: "20px",
                                  fontSize: "0.75rem",
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                ⏳ Em Teste (Trial)
                              </span>
                              <div style={{ fontSize: "0.72rem", color: "#FBBF24", marginTop: 4 }}>
                                {store.trialDaysRemaining > 0 ? `${store.trialDaysRemaining} dias restantes` : "Último dia"}
                              </div>
                            </div>
                          )}
                          {store.status === "INACTIVE" && (
                            <span
                              style={{
                                background: "rgba(239, 68, 68, 0.15)",
                                color: "#F87171",
                                border: "1px solid rgba(239, 68, 68, 0.3)",
                                padding: "4px 10px",
                                borderRadius: "20px",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              ● Inativa
                            </span>
                          )}
                        </td>

                        {/* Month Sales */}
                        <td style={{ padding: "16px 16px" }}>
                          <div style={{ fontWeight: 700, color: "#F8FAFC", fontSize: "0.95rem" }}>
                            {formatBRL(store.monthSales)}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 2 }}>
                            {store.monthOrdersCount} pedidos no mês
                          </div>
                        </td>

                        {/* Platform Fee */}
                        <td style={{ padding: "16px 16px" }}>
                          <div style={{ fontWeight: 600, color: "#CBD5E1" }}>
                            {formatBRL(store.platformFee)}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 2 }}>
                            1% faturamento (mín R$ 100)
                          </div>
                        </td>

                        {/* Ambassador Profit */}
                        <td style={{ padding: "16px 16px" }}>
                          <div style={{ fontWeight: 900, color: "#10B981", fontSize: "1.05rem" }}>
                            {formatBRL(store.ambassadorProfit)}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "#34D399", marginTop: 2 }}>
                            {ambassador.commissionPercent}% da mensalidade
                          </div>
                        </td>

                        {/* Contact Action */}
                        <td style={{ padding: "16px 20px", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
                            {whatsappLink ? (
                              <a
                                href={whatsappLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  background: "#25D366",
                                  color: "#FFF",
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  textDecoration: "none",
                                  fontSize: "0.78rem",
                                  fontWeight: 700,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  boxShadow: "0 2px 6px rgba(37, 211, 102, 0.3)",
                                }}
                              >
                                💬 WhatsApp
                              </a>
                            ) : (
                              <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Sem telefone</span>
                            )}
                            {store.email && (
                              <a
                                href={`mailto:${store.email}`}
                                style={{ fontSize: "0.72rem", color: "#94A3B8", textDecoration: "none" }}
                              >
                                {store.email}
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ASAAS SPLIT INFO */}
        <div
          style={{
            marginTop: "24px",
            background: "#0F172A",
            border: "1px solid #334155",
            borderRadius: "12px",
            padding: "16px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>
            🔒 <strong style={{ color: "#E2E8F0" }}>Repasse Automático via Asaas:</strong> Suas comissões de {ambassador.commissionPercent}% são processadas e divididas automaticamente pelo Asaas a cada fechamento de ciclo dos seus restaurantes parceiros.
          </div>
          {ambassador.asaasWalletId ? (
            <span style={{ fontSize: "0.75rem", color: "#34D399", fontWeight: 700, background: "rgba(16, 185, 129, 0.15)", padding: "4px 8px", borderRadius: "6px" }}>
              ✓ Carteira Asaas Conectada
            </span>
          ) : (
            <span style={{ fontSize: "0.75rem", color: "#94A3B8", background: "#1E293B", padding: "4px 8px", borderRadius: "6px" }}>
              Repasse via Chave PIX cadastrada
            </span>
          )}
        </div>

      </main>
    </div>
  );
}
