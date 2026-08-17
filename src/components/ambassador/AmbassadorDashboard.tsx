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
  isPaidByAsaas?: boolean;
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
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#0F172A" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        .amb-table-row:hover {
          background: #F1F5F9 !important;
        }
        .amb-btn-copy:hover {
          opacity: 0.95;
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(220, 38, 38, 0.3);
        }
        .amb-filter-pill {
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .amb-filter-pill:hover {
          border-color: #DC2626 !important;
        }
      `}</style>

      {/* HEADER (Tema Claro Limpo) */}
      <header
        style={{
          background: "#FFFFFF",
          borderBottom: "1px solid #E2E8F0",
          padding: "16px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/firehub-flame.png" alt="FireHub" style={{ width: 34, height: 34, borderRadius: "8px" }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 900, fontSize: "1.25rem", letterSpacing: "-0.5px" }}>
                <span style={{ color: "#DC2626" }}>FIRE</span><span style={{ color: "#0F172A" }}>HUB</span>
              </span>
              <span
                style={{
                  background: "#FEF2F2",
                  color: "#DC2626",
                  border: "1px solid #FECACA",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Embaixador
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F1F5F9", padding: "6px 14px", borderRadius: "8px", border: "1px solid #E2E8F0" }}>
            <span style={{ fontSize: "0.85rem", color: "#64748B", fontWeight: 600 }}>Comissão:</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "#059669" }}>{ambassador.commissionPercent}% Recorrente</span>
          </div>

          <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#475569" }}>
            Olá, <strong style={{ color: "#0F172A" }}>{ambassador.name}</strong>
          </div>

          <button
            onClick={() => signOut({ callbackUrl: "/embaixador" })}
            style={{
              background: "#F8FAFC",
              border: "1.5px solid #CBD5E1",
              color: "#475569",
              padding: "7px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "0.82rem",
              fontWeight: 700,
              transition: "all 0.2s",
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = "#F1F5F9";
              e.currentTarget.style.color = "#0F172A";
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = "#F8FAFC";
              e.currentTarget.style.color = "#475569";
            }}
          >
            Sair
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
        
        {/* TOP METRICS CARDS (Tema Claro) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 18, marginBottom: 28 }}>
          
          {/* Card 1: Lucro Real do Mês */}
          <div style={{ background: "#FFFFFF", border: "1.5px solid #E2E8F0", padding: "22px", borderRadius: "16px", boxShadow: "0 4px 16px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "#64748B", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                💰 Seu Lucro no Mês
              </span>
              <span style={{ background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0", padding: "3px 8px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 800 }}>
                {ambassador.commissionPercent}%
              </span>
            </div>
            <div style={{ fontSize: "2.1rem", fontWeight: 900, color: currentMonthIncome > 0 ? "#059669" : "#0F172A", letterSpacing: "-0.5px" }}>
              {formatBRL(currentMonthIncome)}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 6 }}>
              {currentMonthIncome > 0 ? "Comissões de mensalidades faturadas/pagas" : "Nenhuma comissão faturada no momento"}
            </div>
          </div>

          {/* Card 2: Lojas na Carteira */}
          <div style={{ background: "#FFFFFF", border: "1.5px solid #E2E8F0", padding: "22px", borderRadius: "16px", boxShadow: "0 4px 16px rgba(0,0,0,0.03)" }}>
            <div style={{ color: "#64748B", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
              🏪 Lojas na Carteira
            </div>
            <div style={{ fontSize: "2.1rem", fontWeight: 900, color: "#0F172A", letterSpacing: "-0.5px" }}>
              {stores.length}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 6, display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ color: "#059669", fontWeight: 700 }}>● {activeCount} ativa{activeCount !== 1 ? "s" : ""}</span>
              <span style={{ color: "#D97706", fontWeight: 700 }}>● {trialCount} em teste</span>
              <span style={{ color: "#475569", fontWeight: 700 }}>● {inactiveCount} inativa{inactiveCount !== 1 ? "s" : ""}</span>
            </div>
          </div>

          {/* Card 3: Faturamento Total das Lojas */}
          <div style={{ background: "#FFFFFF", border: "1.5px solid #E2E8F0", padding: "22px", borderRadius: "16px", boxShadow: "0 4px 16px rgba(0,0,0,0.03)" }}>
            <div style={{ color: "#64748B", fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
              📈 Faturamento das Lojas (Mês)
            </div>
            <div style={{ fontSize: "2.1rem", fontWeight: 900, color: "#2563EB", letterSpacing: "-0.5px" }}>
              {formatBRL(totalPortfolioSales)}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 6 }}>
              {totalOrdersCount} pedido{totalOrdersCount !== 1 ? "s" : ""} movimentado{totalOrdersCount !== 1 ? "s" : ""} nas lojas indicadas
            </div>
          </div>

          {/* Card 4: Link de Convite Oficial */}
          <div style={{ background: "#FFFFFF", border: "2px solid #DC2626", padding: "22px", borderRadius: "16px", boxShadow: "0 4px 16px rgba(220,38,38,0.08)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ color: "#DC2626", fontSize: "0.82rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  🔗 Seu Link de Indicação
                </span>
                <span style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", padding: "2px 8px", borderRadius: "4px", fontSize: "0.72rem", fontWeight: 800 }}>
                  {ambassador.code}
                </span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "4px 0 12px 0" }}>
                Cadastre novos restaurantes vinculados automaticamente à sua carteira
              </p>
            </div>
            <button
              onClick={copyLink}
              className="amb-btn-copy"
              style={{
                width: "100%",
                padding: "12px",
                background: copied ? "#059669" : "linear-gradient(135deg, #DC2626, #B91C1C)",
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
            background: "#EFF6FF",
            border: "1.5px solid #BFDBFE",
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
              <strong style={{ fontSize: "0.98rem", color: "#1E3A8A" }}>
                Apresentando o FireHub para novos clientes?
              </strong>
            </div>
            <p style={{ fontSize: "0.85rem", color: "#1E40AF", margin: 0, lineHeight: 1.5 }}>
              Mostre a agilidade do cardápio digital, o painel do garçom e o fechamento automático de caixa. Para cadastrar um novo cliente, envie sempre o seu link com <strong>15 dias de teste grátis</strong> para vinculá-lo automaticamente à sua carteira de comissões.
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <a
              href="https://firehubfood.com.br"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: "#FFFFFF",
                border: "1.5px solid #93C5FD",
                color: "#1D4ED8",
                padding: "10px 18px",
                borderRadius: "8px",
                textDecoration: "none",
                fontSize: "0.85rem",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
              }}
            >
              🌐 Abrir Site Oficial
            </a>
          </div>
        </div>

        {/* STORES SECTION (Tema Claro) */}
        <div style={{ background: "#FFFFFF", border: "1.5px solid #E2E8F0", borderRadius: "16px", overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.03)" }}>
          
          {/* Header Controls */}
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 900, color: "#0F172A", margin: 0 }}>
                Lojas na sua Carteira
              </h2>
              <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "4px 0 0 0" }}>
                Acompanhe o faturamento, status e comissões reais de cada restaurante indicado
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
                  background: "#F8FAFC",
                  border: "1.5px solid #CBD5E1",
                  borderRadius: "8px",
                  padding: "8px 14px",
                  color: "#0F172A",
                  fontSize: "0.85rem",
                  outline: "none",
                  width: "240px",
                }}
              />

              {/* Status Filter Tabs */}
              <div style={{ display: "flex", background: "#F1F5F9", padding: "3px", borderRadius: "8px", border: "1px solid #E2E8F0" }}>
                <button
                  onClick={() => setStatusFilter("ALL")}
                  className="amb-filter-pill"
                  style={{
                    background: statusFilter === "ALL" ? "#0F172A" : "transparent",
                    color: statusFilter === "ALL" ? "#FFFFFF" : "#64748B",
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
                    background: statusFilter === "ACTIVE" ? "#059669" : "transparent",
                    color: statusFilter === "ACTIVE" ? "#FFFFFF" : "#059669",
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
                    background: statusFilter === "TRIAL" ? "#D97706" : "transparent",
                    color: statusFilter === "TRIAL" ? "#FFFFFF" : "#D97706",
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
                    background: statusFilter === "INACTIVE" ? "#475569" : "transparent",
                    color: statusFilter === "INACTIVE" ? "#FFFFFF" : "#64748B",
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
            <div style={{ padding: "48px 20px", textAlign: "center", color: "#64748B" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>🏪</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#0F172A", marginBottom: "6px" }}>
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
                    background: "#DC2626",
                    color: "#FFF",
                    border: "none",
                    borderRadius: "8px",
                    padding: "10px 22px",
                    fontWeight: 800,
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
                  <tr style={{ background: "#F8FAFC", borderBottom: "1.5px solid #E2E8F0", color: "#475569", fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>
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

                    const isStoreActive = store.status === "ACTIVE";

                    return (
                      <tr
                        key={store.id}
                        className="amb-table-row"
                        style={{
                          borderBottom: "1px solid #E2E8F0",
                          background: "#FFFFFF",
                          transition: "background 0.15s",
                        }}
                      >
                        {/* Store Info com Bolinha Verde (Ativa) ou Preta (Inativa / Em Teste) */}
                        <td style={{ padding: "16px 20px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            {/* Bolinha Indicadora Ativa (Verde) / Inativa (Preta) */}
                            <span
                              title={isStoreActive ? "Loja Ativa" : (store.status === "TRIAL" ? "Loja em Teste (Trial)" : "Loja Inativa")}
                              style={{
                                display: "inline-block",
                                width: "12px",
                                height: "12px",
                                minWidth: "12px",
                                borderRadius: "50%",
                                background: isStoreActive ? "#10B981" : "#0F172A",
                                boxShadow: isStoreActive ? "0 0 0 3px rgba(16,185,129,0.25)" : "0 0 0 3px rgba(15,23,42,0.15)",
                              }}
                            />
                            <div>
                              <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.95rem" }}>
                                {store.storeName}
                              </div>
                              <div style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 2 }}>
                                {store.name} {store.city ? `· ${store.city}` : ""}
                              </div>
                              <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 2 }}>
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
                                    color: "#2563EB",
                                    fontSize: "0.75rem",
                                    marginTop: 4,
                                    textDecoration: "none",
                                    fontWeight: 700,
                                  }}
                                >
                                  ↗ Ver Cardápio Digital
                                </a>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td style={{ padding: "16px 16px" }}>
                          {store.status === "ACTIVE" && (
                            <span
                              style={{
                                background: "#ECFDF5",
                                color: "#059669",
                                border: "1px solid #A7F3D0",
                                padding: "4px 10px",
                                borderRadius: "20px",
                                fontSize: "0.75rem",
                                fontWeight: 800,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#059669" }} />
                              Ativa
                            </span>
                          )}
                          {store.status === "TRIAL" && (
                            <div>
                              <span
                                style={{
                                  background: "#FFFBEB",
                                  color: "#D97706",
                                  border: "1px solid #FDE68A",
                                  padding: "4px 10px",
                                  borderRadius: "20px",
                                  fontSize: "0.75rem",
                                  fontWeight: 800,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                ⏳ Em Teste (Trial)
                              </span>
                              <div style={{ fontSize: "0.72rem", color: "#B45309", fontWeight: 600, marginTop: 4 }}>
                                {store.trialDaysRemaining > 0 ? `${store.trialDaysRemaining} dias restantes` : "Último dia"}
                              </div>
                            </div>
                          )}
                          {store.status === "INACTIVE" && (
                            <span
                              style={{
                                background: "#F1F5F9",
                                color: "#475569",
                                border: "1px solid #CBD5E1",
                                padding: "4px 10px",
                                borderRadius: "20px",
                                fontSize: "0.75rem",
                                fontWeight: 800,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#475569" }} />
                              Inativa
                            </span>
                          )}
                        </td>

                        {/* Month Sales */}
                        <td style={{ padding: "16px 16px" }}>
                          <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.95rem" }}>
                            {formatBRL(store.monthSales)}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 2 }}>
                            {store.monthOrdersCount} pedido{store.monthOrdersCount !== 1 ? "s" : ""} no mês
                          </div>
                        </td>

                        {/* Platform Fee */}
                        <td style={{ padding: "16px 16px" }}>
                          <div style={{ fontWeight: 700, color: store.platformFee > 0 ? "#0F172A" : "#64748B" }}>
                            {formatBRL(store.platformFee)}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 2 }}>
                            {store.status === "TRIAL"
                              ? "Em teste grátis (sem cobrança)"
                              : (store.platformFee > 0 ? "1% faturamento (mín R$ 100)" : "Sem faturamento")}
                          </div>
                        </td>

                        {/* Ambassador Profit */}
                        <td style={{ padding: "16px 16px" }}>
                          <div style={{ fontWeight: 900, color: store.ambassadorProfit > 0 ? "#059669" : "#64748B", fontSize: "1.05rem" }}>
                            {formatBRL(store.ambassadorProfit)}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: store.ambassadorProfit > 0 ? "#059669" : "#94A3B8", marginTop: 2 }}>
                            {store.ambassadorProfit > 0 ? `${ambassador.commissionPercent}% da mensalidade` : "Aguardando pagamento"}
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
                                  padding: "6px 14px",
                                  borderRadius: "8px",
                                  textDecoration: "none",
                                  fontSize: "0.8rem",
                                  fontWeight: 800,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  boxShadow: "0 2px 6px rgba(37, 211, 102, 0.25)",
                                }}
                              >
                                💬 WhatsApp
                              </a>
                            ) : (
                              <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Sem telefone</span>
                            )}
                            {store.email && (
                              <a
                                href={`mailto:${store.email}`}
                                style={{ fontSize: "0.72rem", color: "#64748B", textDecoration: "none" }}
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

        {/* ASAAS SPLIT INFO (Tema Claro) */}
        <div
          style={{
            marginTop: "24px",
            background: "#F1F5F9",
            border: "1.5px solid #E2E8F0",
            borderRadius: "12px",
            padding: "16px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "#475569" }}>
            🔒 <strong style={{ color: "#0F172A" }}>Repasse Automático via Asaas:</strong> Suas comissões de {ambassador.commissionPercent}% são processadas e repassadas automaticamente pelo Asaas quando a loja parceira realiza o pagamento da mensalidade.
          </div>
          {ambassador.asaasWalletId ? (
            <span style={{ fontSize: "0.75rem", color: "#059669", fontWeight: 800, background: "#ECFDF5", border: "1px solid #A7F3D0", padding: "4px 10px", borderRadius: "6px" }}>
              ✓ Carteira Asaas Conectada
            </span>
          ) : (
            <span style={{ fontSize: "0.75rem", color: "#475569", background: "#FFFFFF", border: "1px solid #CBD5E1", padding: "4px 10px", borderRadius: "6px" }}>
              Repasse via Chave PIX cadastrada
            </span>
          )}
        </div>

      </main>
    </div>
  );
}
