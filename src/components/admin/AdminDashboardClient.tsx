"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import ToggleFranqueadoHakim from "@/components/ToggleFranqueadoHakim";

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString("pt-BR");

type Lojista = {
  id: string; name: string | null; email: string; slug: string | null;
  storeName: string | null; city: string | null; createdAt: string;
  storeOpen: boolean; isFranqueadoHakim: boolean; storeLogo: string | null;
  storePhone: string | null; diasCadastro: number; emTrial: boolean;
  diasRestantesTrial?: number; trialEndsAt?: string | null;
  pendente: number; temMP: boolean; temCelcoin: boolean;
};

type KPIs = {
  totalLojistas: number; emTrial: number; assinantes: number;
  novosMes: number; novosSemana: number;
  mrr: number; totalArrecadado: number; totalPendente: number; comPendencia: number;
};

export default function AdminDashboardClient({
  adminName, kpis, monthlyGrowth, lojistas: initialLojistas,
}: {
  adminName: string;
  kpis: KPIs;
  monthlyGrowth: { label: string; count: number }[];
  lojistas: Lojista[];
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"overview" | "lojistas" | "financeiro">("overview");
  const [lojistas, setLojistas] = useState<Lojista[]>(initialLojistas);

  // Modal de concessão de dias
  const [grantModalUser, setGrantModalUser] = useState<Lojista | null>(null);
  const [customDays, setCustomDays] = useState<string>("15");
  const [granting, setGranting] = useState(false);

  // Impersonação
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  const filtered = lojistas.filter(l =>
    [l.name, l.storeName, l.email, l.city].some(v =>
      v?.toLowerCase().includes(search.toLowerCase())
    )
  );

  const maxGrowth = Math.max(...monthlyGrowth.map(m => m.count), 1);

  const handleImpersonate = async (l: Lojista) => {
    const storeLabel = l.storeName || l.name || l.email;
    if (!confirm(`Deseja acessar o sistema como "${storeLabel}" para prestar suporte?`)) return;
    setImpersonatingId(l.id);
    try {
      await signIn("credentials", {
        impersonateId: l.id,
        callbackUrl: "/store",
      });
    } catch (e) {
      alert("Erro ao impersonar conta. Tente novamente.");
      setImpersonatingId(null);
    }
  };

  const handleGrantDays = async (daysToGrant: number) => {
    if (!grantModalUser) return;
    setGranting(true);
    try {
      const res = await fetch("/api/admin/grant-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: grantModalUser.id, days: daysToGrant }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert(data.message);
        // Atualiza estado local do lojista
        setLojistas(prev => prev.map(item => {
          if (item.id === grantModalUser.id) {
            const currentRestantes = item.diasRestantesTrial || 0;
            return {
              ...item,
              emTrial: true,
              diasRestantesTrial: currentRestantes + daysToGrant,
              trialEndsAt: data.trialEndsAt,
            };
          }
          return item;
        }));
        setGrantModalUser(null);
      } else {
        alert(data.error || "Erro ao conceder dias.");
      }
    } catch (err) {
      alert("Erro de conexão ao salvar dias.");
    } finally {
      setGranting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", fontFamily: "'Inter', sans-serif", background: "#0F172A" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        .fha-sidebar { width: 240px; background: #1E293B; border-right: 1px solid #334155; display: flex; flex-direction: column; position: fixed; top: 0; left: 0; height: 100vh; z-index: 100; }
        .fha-main { margin-left: 240px; flex: 1; min-height: 100vh; background: #0F172A; }
        .fha-topbar { background: #1E293B; border-bottom: 1px solid #334155; padding: 16px 28px; display: flex; align-items: center; justify-content: space-between; }
        .fha-nav-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 10px; cursor: pointer; font-size: 0.875rem; font-weight: 500; color: #94A3B8; transition: all 0.15s; text-decoration: none; margin: 2px 0; }
        .fha-nav-item:hover { background: rgba(255,255,255,0.06); color: #F1F5F9; }
        .fha-nav-item.active { background: rgba(239,68,68,0.15); color: #F87171; font-weight: 700; }
        .fha-kpi { background: #1E293B; border: 1px solid #334155; border-radius: 14px; padding: 20px 22px; }
        .fha-kpi-val { font-size: 2rem; font-weight: 900; color: #F1F5F9; margin: 4px 0 2px; }
        .fha-kpi-lbl { font-size: 0.75rem; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .fha-kpi-sub { font-size: 0.78rem; color: #94A3B8; margin-top: 4px; }
        .fha-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        .fha-table th { padding: 11px 14px; text-align: left; color: #64748B; font-weight: 700; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #334155; background: #1E293B; }
        .fha-table td { padding: 12px 14px; border-bottom: 1px solid #1E293B; color: #CBD5E1; vertical-align: middle; }
        .fha-table tr:hover td { background: rgba(255,255,255,0.02); }
        .fha-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 20px; font-size: 0.7rem; font-weight: 700; }
        .fha-badge-trial { background: rgba(245,158,11,0.15); color: #FCD34D; border: 1px solid rgba(245,158,11,0.25); }
        .fha-badge-active { background: rgba(16,185,129,0.15); color: #34D399; border: 1px solid rgba(16,185,129,0.25); }
        .fha-badge-pending { background: rgba(239,68,68,0.15); color: #F87171; border: 1px solid rgba(239,68,68,0.25); }
        .fha-badge-exempt { background: rgba(99,102,241,0.15); color: #818CF8; border: 1px solid rgba(99,102,241,0.25); }
        .fha-input { background: #1E293B; border: 1px solid #334155; border-radius: 10px; padding: 10px 14px; color: #F1F5F9; font-size: 0.875rem; font-family: inherit; outline: none; transition: border-color 0.2s; }
        .fha-input:focus { border-color: #EF4444; }
        .fha-input::placeholder { color: #475569; }
        .fha-section { background: #1E293B; border: 1px solid #334155; border-radius: 16px; overflow: hidden; }
        .fha-bar { background: linear-gradient(180deg, #EF4444, #DC2626); border-radius: 4px 4px 0 0; transition: height 0.5s ease; min-height: 3px; }
        .fha-btn-action { background: #334155; color: #F1F5F9; border: 1px solid #475569; padding: 5px 10px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
        .fha-btn-action:hover { background: #475569; border-color: #64748B; }
        .fha-btn-impersonate { background: rgba(37,99,235,0.15); color: #60A5FA; border: 1px solid rgba(37,99,235,0.3); }
        .fha-btn-impersonate:hover { background: rgba(37,99,235,0.25); color: #93C5FD; }
        .fha-btn-grant { background: rgba(16,185,129,0.15); color: #34D399; border: 1px solid rgba(16,185,129,0.3); }
        .fha-btn-grant:hover { background: rgba(16,185,129,0.25); color: #6EE7B7; }
      `}</style>

      {/* ── SIDEBAR ── */}
      <aside className="fha-sidebar">
        <div style={{ padding: "20px 16px", borderBottom: "1px solid #334155" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#EF4444,#DC2626)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem" }}>🔥</div>
            <div>
              <div style={{ color: "#F1F5F9", fontWeight: 900, fontSize: "1rem", letterSpacing: "-0.5px" }}>FireHub</div>
              <div style={{ color: "#64748B", fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.5px" }}>Admin Panel</div>
            </div>
          </div>
        </div>

        <nav style={{ padding: "12px 10px", flex: 1 }}>
          <p style={{ fontSize: "0.6rem", color: "#475569", textTransform: "uppercase", letterSpacing: "1px", padding: "6px 8px 4px", fontWeight: 700 }}>Gestão</p>
          <button onClick={() => setTab("overview")} className={`fha-nav-item${tab === "overview" ? " active" : ""}`} style={{ width: "100%", border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
            📊 Visão Geral
          </button>
          <button onClick={() => setTab("lojistas")} className={`fha-nav-item${tab === "lojistas" ? " active" : ""}`} style={{ width: "100%", border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
            🏪 Lojistas
          </button>
          <button onClick={() => setTab("financeiro")} className={`fha-nav-item${tab === "financeiro" ? " active" : ""}`} style={{ width: "100%", border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
            💰 Financeiro
          </button>

          <p style={{ fontSize: "0.6rem", color: "#475569", textTransform: "uppercase", letterSpacing: "1px", padding: "14px 8px 4px", fontWeight: 700 }}>Ações</p>
          <a href="/store/admin/lojistas" className="fha-nav-item">🔧 Painel Completo</a>
          <a href="/store" className="fha-nav-item">🔗 Ver App (Loja)</a>
        </nav>

        <div style={{ padding: "12px 10px", borderTop: "1px solid #334155" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#EF4444,#B91C1C)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem" }}>👤</div>
            <div>
              <div style={{ color: "#F1F5F9", fontSize: "0.8rem", fontWeight: 700 }}>{adminName}</div>
              <div style={{ color: "#64748B", fontSize: "0.65rem" }}>Administrador</div>
            </div>
          </div>
          <a href="/api/auth/signout" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginTop: 4, borderRadius: 10, color: "#64748B", fontSize: "0.8rem", textDecoration: "none" }}>
            🚪 Sair
          </a>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="fha-main">
        {/* Topbar */}
        <div className="fha-topbar">
          <div>
            <h1 style={{ color: "#F1F5F9", fontWeight: 800, fontSize: "1.15rem", margin: 0 }}>
              {tab === "overview" && "📊 Visão Geral"}
              {tab === "lojistas" && "🏪 Gestão de Lojistas"}
              {tab === "financeiro" && "💰 Financeiro"}
            </h1>
            <p style={{ color: "#64748B", fontSize: "0.78rem", margin: "2px 0 0" }}>
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {tab === "lojistas" && (
              <input
                className="fha-input"
                placeholder="🔍  Buscar lojista..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: 220 }}
              />
            )}
          </div>
        </div>

        <div style={{ padding: "24px 28px" }}>

          {/* ══════════════════════ OVERVIEW ══════════════════════ */}
          {tab === "overview" && (
            <>
              {/* KPI Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
                {[
                  { icon: "🏪", label: "Total de Lojistas", val: kpis.totalLojistas, sub: `${kpis.emTrial} em trial · ${kpis.assinantes} assinantes`, color: "#60A5FA" },
                  { icon: "🆕", label: "Novos este mês", val: kpis.novosMes, sub: `${kpis.novosSemana} esta semana`, color: "#34D399" },
                  { icon: "💵", label: "MRR Estimado", val: fmt(kpis.mrr), sub: "Receita recorrente mensal", color: "#A78BFA" },
                  { icon: "💰", label: "Total Arrecadado", val: fmt(kpis.totalArrecadado), sub: "Histórico de pagamentos", color: "#F59E0B" },
                  { icon: "⚠️", label: "Pendências", val: fmt(kpis.totalPendente), sub: `${kpis.comPendencia} lojistas com débito`, color: "#F87171" },
                  { icon: "🎁", label: "Em Trial / Benefício", val: kpis.emTrial, sub: `${kpis.assinantes} já são assinantes`, color: "#FCD34D" },
                ].map(k => (
                  <div key={k.label} className="fha-kpi">
                    <div style={{ fontSize: "1.4rem" }}>{k.icon}</div>
                    <div className="fha-kpi-val" style={{ color: k.color }}>{k.val}</div>
                    <div className="fha-kpi-lbl">{k.label}</div>
                    <div className="fha-kpi-sub">{k.sub}</div>
                  </div>
                ))}
              </div>

              {/* Growth Chart */}
              <div className="fha-section" style={{ padding: "20px 24px", marginBottom: 24 }}>
                <h3 style={{ color: "#F1F5F9", fontWeight: 700, margin: "0 0 20px", fontSize: "0.95rem" }}>📈 Crescimento de Cadastros (últimos 6 meses)</h3>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 120 }}>
                  {monthlyGrowth.map(m => (
                    <div key={m.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#94A3B8", fontSize: "0.75rem", fontWeight: 700 }}>{m.count}</span>
                      <div style={{ width: "100%", height: Math.max((m.count / maxGrowth) * 90, 4) }} className="fha-bar" />
                      <span style={{ color: "#475569", fontSize: "0.65rem", textTransform: "uppercase" }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Últimos cadastros */}
              <div className="fha-section">
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#F1F5F9", fontWeight: 700, margin: 0, fontSize: "0.9rem" }}>🕐 Últimos Cadastros</h3>
                </div>
                <table className="fha-table">
                  <thead>
                    <tr>
                      <th>Lojista</th><th>Cidade</th><th>Cadastro</th><th>Status</th><th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lojistas.slice(0, 8).map(l => (
                      <tr key={l.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: "#F1F5F9" }}>{l.storeName || l.name}</div>
                          <div style={{ color: "#475569", fontSize: "0.72rem" }}>{l.email}</div>
                        </td>
                        <td style={{ color: "#94A3B8" }}>{l.city || "—"}</td>
                        <td style={{ color: "#64748B" }}>{fmtDate(l.createdAt)}</td>
                        <td>
                          {l.isFranqueadoHakim ? (
                            <span className="fha-badge fha-badge-exempt">🛡️ Isento (Hakim)</span>
                          ) : l.pendente > 0 ? (
                            <span className="fha-badge fha-badge-pending">⚠️ {fmt(l.pendente)}</span>
                          ) : l.emTrial ? (
                            <span className="fha-badge fha-badge-trial">🎁 Trial {l.diasRestantesTrial ?? 0}d</span>
                          ) : (
                            <span className="fha-badge fha-badge-active">✅ Ativo</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => handleImpersonate(l)}
                              disabled={impersonatingId === l.id}
                              className="fha-btn-action fha-btn-impersonate"
                              title="Acessar conta para dar suporte"
                            >
                              🔑 {impersonatingId === l.id ? "Entrando..." : "Acessar"}
                            </button>
                            <button
                              onClick={() => setGrantModalUser(l)}
                              className="fha-btn-action fha-btn-grant"
                              title="Liberar dias de benefício"
                            >
                              🎁 +Dias
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ══════════════════════ LOJISTAS ══════════════════════ */}
          {tab === "lojistas" && (
            <div className="fha-section">
              <div style={{ padding: "14px 18px", borderBottom: "1px solid #334155", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ color: "#F1F5F9", fontWeight: 700, margin: 0, fontSize: "0.9rem" }}>
                  Todos os Lojistas <span style={{ color: "#64748B", fontWeight: 400 }}>({filtered.length})</span>
                </h3>
                <a href="/store/admin/lojistas" style={{ background: "rgba(239,68,68,0.15)", color: "#F87171", border: "1px solid rgba(239,68,68,0.3)", padding: "6px 14px", borderRadius: 8, fontWeight: 700, fontSize: "0.78rem", textDecoration: "none" }}>
                  + Novo Lojista
                </a>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="fha-table">
                  <thead>
                    <tr>
                      <th>Lojista</th><th>Cidade</th><th>Cadastro</th><th>Status</th><th>Hakim</th><th>Pagamento</th><th>Ações Suporte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(l => (
                      <tr key={l.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {l.storeLogo
                              ? <img src={l.storeLogo} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover" }} />
                              : <div style={{ width: 32, height: 32, borderRadius: 8, background: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem" }}>🏪</div>}
                            <div>
                              <div style={{ fontWeight: 600, color: "#F1F5F9" }}>{l.storeName || l.name}</div>
                              <div style={{ color: "#475569", fontSize: "0.7rem" }}>{l.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ color: "#94A3B8" }}>{l.city || "—"}</td>
                        <td style={{ color: "#64748B", whiteSpace: "nowrap" }}>{fmtDate(l.createdAt)}</td>
                        <td>
                          {l.isFranqueadoHakim ? (
                            <span className="fha-badge fha-badge-exempt">🛡️ Isento (Hakim)</span>
                          ) : l.pendente > 0 ? (
                            <span className="fha-badge fha-badge-pending">⚠️ {fmt(l.pendente)}</span>
                          ) : l.emTrial ? (
                            <span className="fha-badge fha-badge-trial">🎁 Trial {l.diasRestantesTrial ?? 0}d restantes</span>
                          ) : (
                            <span className="fha-badge fha-badge-active">✅ Ativo</span>
                          )}
                        </td>
                        <td><ToggleFranqueadoHakim userId={l.id} initialValue={l.isFranqueadoHakim} /></td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <span style={{ padding: "2px 7px", borderRadius: 5, fontSize: "0.68rem", fontWeight: 700, background: l.temMP ? "rgba(16,185,129,0.15)" : "rgba(100,116,139,0.15)", color: l.temMP ? "#34D399" : "#64748B", border: `1px solid ${l.temMP ? "rgba(16,185,129,0.3)" : "#334155"}` }}>MP {l.temMP ? "✓" : "✗"}</span>
                            <span style={{ padding: "2px 7px", borderRadius: 5, fontSize: "0.68rem", fontWeight: 700, background: l.temCelcoin ? "rgba(16,185,129,0.15)" : "rgba(100,116,139,0.15)", color: l.temCelcoin ? "#34D399" : "#64748B", border: `1px solid ${l.temCelcoin ? "rgba(16,185,129,0.3)" : "#334155"}` }}>PIX {l.temCelcoin ? "✓" : "✗"}</span>
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {l.slug && (
                              <a href={`/loja/${l.slug}`} target="_blank" className="fha-btn-action" title="Ver Cardápio Online">
                                🔗 Cardápio
                              </a>
                            )}
                            <button
                              onClick={() => handleImpersonate(l)}
                              disabled={impersonatingId === l.id}
                              className="fha-btn-action fha-btn-impersonate"
                              title="Acessar conta para dar suporte"
                            >
                              🔑 {impersonatingId === l.id ? "Acessando..." : "Acessar Conta"}
                            </button>
                            <button
                              onClick={() => setGrantModalUser(l)}
                              className="fha-btn-action fha-btn-grant"
                              title="Liberar dias de benefício"
                            >
                              🎁 Liberar Dias
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════════ FINANCEIRO ══════════════════════ */}
          {tab === "financeiro" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
                {[
                  { icon: "💵", label: "MRR Estimado", val: fmt(kpis.mrr), color: "#A78BFA" },
                  { icon: "💰", label: "Total Arrecadado", val: fmt(kpis.totalArrecadado), color: "#34D399" },
                  { icon: "⚠️", label: "Total Pendente", val: fmt(kpis.totalPendente), color: "#F87171" },
                  { icon: "👥", label: "Com Pendência", val: `${kpis.comPendencia} lojistas`, color: "#FCD34D" },
                ].map(k => (
                  <div key={k.label} className="fha-kpi">
                    <div style={{ fontSize: "1.4rem" }}>{k.icon}</div>
                    <div className="fha-kpi-val" style={{ color: k.color }}>{k.val}</div>
                    <div className="fha-kpi-lbl">{k.label}</div>
                  </div>
                ))}
              </div>
              <div className="fha-section">
                <div style={{ padding: "14px 18px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#F1F5F9", fontWeight: 700, margin: 0, fontSize: "0.9rem" }}>💳 Lojistas com Pendências</h3>
                </div>
                <table className="fha-table">
                  <thead>
                    <tr><th>Lojista</th><th>Valor Pendente</th><th>Status</th><th>Ação</th></tr>
                  </thead>
                  <tbody>
                    {lojistas.filter(l => !l.isFranqueadoHakim && l.pendente > 0).map(l => (
                      <tr key={l.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: "#F1F5F9" }}>{l.storeName || l.name}</div>
                          <div style={{ color: "#475569", fontSize: "0.72rem" }}>{l.email}</div>
                        </td>
                        <td style={{ color: "#F87171", fontWeight: 700 }}>{fmt(l.pendente)}</td>
                        <td><span className="fha-badge fha-badge-pending">⚠️ Em aberto</span></td>
                        <td>
                          <button
                            onClick={() => handleImpersonate(l)}
                            className="fha-btn-action fha-btn-impersonate"
                          >
                            🔑 Acessar Conta
                          </button>
                        </td>
                      </tr>
                    ))}
                    {lojistas.filter(l => !l.isFranqueadoHakim && l.pendente > 0).length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#475569" }}>✅ Nenhuma pendência no momento</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </div>
      </main>

      {/* ── MODAL LIBERAR DIAS DE BENEFÍCIO ── */}
      {grantModalUser && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.8)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16,
        }}>
          <div style={{
            background: "#1E293B", border: "1px solid #334155", borderRadius: 16,
            width: "100%", maxWidth: 440, padding: 24, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ color: "#F1F5F9", margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>
                🎁 Liberar Benefício / Dias Gratis
              </h3>
              <button
                onClick={() => setGrantModalUser(null)}
                style={{ background: "none", border: "none", color: "#64748B", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <p style={{ color: "#94A3B8", fontSize: "0.85rem", margin: "0 0 16px" }}>
              Conceder dias adicionais de trial/acesso sem cobrança para <strong>{grantModalUser.storeName || grantModalUser.name}</strong> ({grantModalUser.email}).
            </p>

            <div style={{ background: "rgba(255,255,255,0.03)", padding: "12px 14px", borderRadius: 10, border: "1px solid #334155", marginBottom: 20 }}>
              <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Status atual de Trial:</div>
              <div style={{ color: grantModalUser.emTrial ? "#34D399" : "#F87171", fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>
                {grantModalUser.emTrial
                  ? `🎁 Ativo — ${grantModalUser.diasRestantesTrial ?? 0} dias restantes`
                  : "⏹️ Encerrado"}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#CBD5E1", marginBottom: 8 }}>
                Escolha a quantidade de dias para liberar:
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => handleGrantDays(15)}
                  disabled={granting}
                  style={{
                    background: "linear-gradient(135deg, #10B981, #059669)", color: "#fff",
                    border: "none", padding: "12px", borderRadius: 10, fontWeight: 800,
                    cursor: "pointer", fontSize: "0.9rem", transition: "transform 0.1s",
                  }}
                >
                  ⚡ +15 Dias
                </button>
                <button
                  type="button"
                  onClick={() => handleGrantDays(30)}
                  disabled={granting}
                  style={{
                    background: "linear-gradient(135deg, #2563EB, #1D4ED8)", color: "#fff",
                    border: "none", padding: "12px", borderRadius: 10, fontWeight: 800,
                    cursor: "pointer", fontSize: "0.9rem", transition: "transform 0.1s",
                  }}
                >
                  🚀 +30 Dias
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  min="1"
                  className="fha-input"
                  placeholder="Ou digite o nº de dias (ex: 45)"
                  value={customDays}
                  onChange={e => setCustomDays(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const num = parseInt(customDays, 10);
                    if (num > 0) handleGrantDays(num);
                    else alert("Digite um número válido de dias.");
                  }}
                  disabled={granting || !customDays}
                  style={{
                    background: "#334155", color: "#F1F5F9", border: "1px solid #475569",
                    padding: "10px 16px", borderRadius: 10, fontWeight: 700, cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  {granting ? "Salvando..." : "Confirmar"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setGrantModalUser(null)}
                style={{
                  background: "none", border: "none", color: "#64748B",
                  fontWeight: 600, fontSize: "0.85rem", cursor: "pointer",
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
