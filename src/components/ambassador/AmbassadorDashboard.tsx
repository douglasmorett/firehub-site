"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";

interface StoreData {
  id: string;
  storeName: string | null;
  storePhone: string | null;
  email: string | null;
  createdAt: string;
  status: "TRIAL" | "ACTIVE" | "INACTIVE";
}

interface AmbassadorDashboardProps {
  ambassador: {
    id: string;
    name: string;
    code: string;
    commissionPercent: number;
    active: boolean;
  };
  stores: StoreData[];
  currentMonthIncome: number;
}

export default function AmbassadorDashboard({ ambassador, stores, currentMonthIncome }: AmbassadorDashboardProps) {
  const [copied, setCopied] = useState(false);
  
  const inviteLink = `https://firehubfood.com.br/cadastro?ref=${ambassador.code}`;

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeCount = stores.filter(s => s.status === "ACTIVE").length;
  const trialCount = stores.filter(s => s.status === "TRIAL").length;

  return (
    <div style={{ minHeight: "100vh", background: "#F1F5F9", fontFamily: "'Inter', sans-serif" }}>
      {/* HEADER */}
      <header style={{ background: "#1E293B", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#FFF" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/firehub-flame.png" alt="" style={{ width: 32, height: 32 }} />
          <span style={{ fontWeight: 800, fontSize: "1.2rem", letterSpacing: "-0.5px" }}>
            <span style={{ color: "#EF4444" }}>FIRE</span>HUB <span style={{ fontWeight: 400, color: "#94A3B8" }}>| Embaixador</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Olá, {ambassador.name.split(" ")[0]}</span>
          <button 
            onClick={() => signOut({ callbackUrl: "/login" })}
            style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#FFF", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}
          >
            Sair
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 20px" }}>
        
        {/* CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginBottom: 32 }}>
          
          <div style={{ background: "#FFF", padding: 24, borderRadius: 12, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)", border: "1px solid #E2E8F0" }}>
            <div style={{ color: "#64748B", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8, textTransform: "uppercase" }}>Rendimento Previsto</div>
            <div style={{ fontSize: "2rem", fontWeight: 800, color: "#10B981" }}>
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(currentMonthIncome)}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#94A3B8", marginTop: 4 }}>Comissão de {ambassador.commissionPercent}%</div>
          </div>

          <div style={{ background: "#FFF", padding: 24, borderRadius: 12, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)", border: "1px solid #E2E8F0" }}>
            <div style={{ color: "#64748B", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8, textTransform: "uppercase" }}>Total de Lojas</div>
            <div style={{ fontSize: "2rem", fontWeight: 800, color: "#1E293B" }}>{stores.length}</div>
            <div style={{ fontSize: "0.8rem", color: "#94A3B8", marginTop: 4 }}>{activeCount} ativas · {trialCount} em teste</div>
          </div>

          <div style={{ background: "#FFF", padding: 24, borderRadius: 12, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ color: "#64748B", fontSize: "0.85rem", fontWeight: 600, marginBottom: 12, textTransform: "uppercase" }}>Seu Link de Convite</div>
            <button 
              onClick={copyLink}
              style={{ width: "100%", padding: "12px", background: copied ? "#10B981" : "#EF4444", color: "#FFF", border: "none", borderRadius: "8px", fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}
            >
              {copied ? "✅ Link Copiado!" : "🔗 Copiar Link de Indicação"}
            </button>
          </div>

        </div>

        {/* STORES TABLE */}
        <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#1E293B", marginBottom: 16 }}>Suas Lojas Indicadas</h2>
        
        <div style={{ background: "#FFF", borderRadius: 12, boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)", border: "1px solid #E2E8F0", overflow: "hidden" }}>
          {stores.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#64748B" }}>
              Nenhuma loja indicada ainda. Use seu link para começar a ganhar!
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
                  <tr>
                    <th style={{ padding: "14px 20px", fontSize: "0.8rem", color: "#64748B", textTransform: "uppercase" }}>Loja</th>
                    <th style={{ padding: "14px 20px", fontSize: "0.8rem", color: "#64748B", textTransform: "uppercase" }}>Data de Cadastro</th>
                    <th style={{ padding: "14px 20px", fontSize: "0.8rem", color: "#64748B", textTransform: "uppercase" }}>Status</th>
                    <th style={{ padding: "14px 20px", fontSize: "0.8rem", color: "#64748B", textTransform: "uppercase" }}>Contato</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map(store => (
                    <tr key={store.id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                      <td style={{ padding: "16px 20px" }}>
                        <div style={{ fontWeight: 700, color: "#1E293B" }}>{store.storeName || "Loja sem nome"}</div>
                        <div style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 4 }}>{store.email}</div>
                      </td>
                      <td style={{ padding: "16px 20px", fontSize: "0.9rem", color: "#475569" }}>
                        {new Date(store.createdAt).toLocaleDateString('pt-BR')}
                      </td>
                      <td style={{ padding: "16px 20px" }}>
                        {store.status === "ACTIVE" && <span style={{ background: "#DCFCE7", color: "#166534", padding: "4px 8px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}>Ativo</span>}
                        {store.status === "TRIAL" && <span style={{ background: "#FEF9C3", color: "#854D0E", padding: "4px 8px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}>Em Teste</span>}
                        {store.status === "INACTIVE" && <span style={{ background: "#FEE2E2", color: "#991B1B", padding: "4px 8px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700 }}>Inativo</span>}
                      </td>
                      <td style={{ padding: "16px 20px" }}>
                        {store.storePhone ? (
                          <a 
                            href={`https://wa.me/55${store.storePhone.replace(/\D/g, "")}?text=Olá! Tudo bem? Sou o ${ambassador.name.split(" ")[0]} do FireHub.`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#25D366", color: "#FFF", padding: "6px 12px", borderRadius: "6px", textDecoration: "none", fontSize: "0.85rem", fontWeight: 600 }}
                          >
                            WhatsApp
                          </a>
                        ) : (
                          <span style={{ fontSize: "0.85rem", color: "#94A3B8" }}>Sem telefone</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
