"use client";
import { useState, useEffect } from "react";
import { Copy, CheckCircle, Wallet, Users } from "lucide-react";
import { useRouter } from "next/navigation";

interface Referral {
  id: string;
  storeName: string | null;
  storePhone: string | null;
  createdAt: string;
  status: "TRIAL" | "ACTIVE" | "INACTIVE";
}

interface Props {
  userId: string;
  userSlug: string | null;
  asaasWalletId: string | null;
  referrals: Referral[];
}

export default function IndiqueEGanheClient({ userId, userSlug, asaasWalletId, referrals }: Props) {
  const router = useRouter();
  const [walletInput, setWalletInput] = useState(asaasWalletId || "");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const activeCount = referrals.filter(r => r.status === "ACTIVE" || r.status === "TRIAL").length;
  const isencao = activeCount >= 10;
  
  // O link joga pro cadastro passando ?ref=userSlug
  const referralLink = `${origin}/cadastro?ref=${userSlug || userId}`;

  const handleSaveWallet = async () => {
    if (!walletInput) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/store/${userId}/affiliate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asaasWalletId: walletInput })
      });
      if (res.ok) {
        alert("Wallet conectada com sucesso!");
        router.refresh();
      } else {
        alert("Erro ao salvar.");
      }
    } catch (e) {
      console.error(e);
      alert("Erro de conexão.");
    } finally {
      setSaving(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!asaasWalletId) {
    return (
      <div className="container" style={{ padding: "2rem", maxWidth: 800, margin: "0 auto" }}>
        <div style={{ background: "#FFF", borderRadius: 16, padding: 40, border: "1px solid var(--border-color)", boxShadow: "0 10px 25px rgba(0,0,0,0.05)", textAlign: "center" }}>
          <div style={{ width: 80, height: 80, borderRadius: 40, background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <Wallet size={40} color="#10B981" />
          </div>
          <h1 style={{ fontSize: "2rem", fontWeight: 900, color: "#0F172A", marginBottom: 16 }}>Ative sua Conta de Parceiro</h1>
          <p style={{ fontSize: "1.1rem", color: "#64748B", marginBottom: 32, lineHeight: 1.6 }}>
            Para gerar seu link e começar a ganhar até <strong>20% de comissão recorrente</strong>, você precisa ter uma conta no Asaas para receber os pagamentos via Split Automático.
          </p>
          
          <div style={{ background: "#F8FAFC", borderRadius: 12, padding: 24, textAlign: "left", marginBottom: 32, border: "1px solid #E2E8F0" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: 16, color: "#334155" }}>Como conectar?</h3>
            <ol style={{ paddingLeft: 20, color: "#475569", margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              <li>Crie uma conta gratuita no <a href="https://asaas.com" target="_blank" rel="noreferrer" style={{color:"var(--primary)", fontWeight:600}}>Asaas</a> (se ainda não tiver).</li>
              <li>No painel do Asaas, vá em <strong>Minha Conta {">"} Integrações</strong> e copie o seu <strong>Wallet ID</strong>.</li>
              <li>Cole o Wallet ID no campo abaixo.</li>
            </ol>
          </div>

          <div style={{ display: "flex", gap: 12, flexDirection: "column" }}>
            <label style={{ textAlign: "left", fontWeight: 600, color: "#334155" }}>Seu Asaas Wallet ID</label>
            <div style={{ display: "flex", gap: 12 }}>
              <input 
                type="text" 
                placeholder="Ex: d7a8...c9f2" 
                className="input" 
                value={walletInput} 
                onChange={e => setWalletInput(e.target.value)} 
                style={{ flex: 1 }}
              />
              <button className="btn-primary" onClick={handleSaveWallet} disabled={saving || !walletInput} style={{ padding: "0 24px" }}>
                {saving ? "Salvando..." : "Conectar Conta"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: 900, color: "var(--text-color)", display: "flex", alignItems: "center", gap: 12 }}>
            🤝 Indique e Ganhe
          </h1>
          <p className="text-muted" style={{ marginTop: 8 }}>Compartilhe o sistema e zere sua mensalidade.</p>
        </div>
        <div style={{ background: "#F8FAFC", padding: "8px 16px", borderRadius: 20, border: "1px solid #E2E8F0", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 8, color: "#334155" }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: "#10B981" }}></div>
          Wallet Conectada: <strong>{asaasWalletId.substring(0, 8)}...</strong>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24, marginBottom: 32 }}>
        {/* Card Resumo Meta */}
        <div style={{ background: isencao ? "linear-gradient(135deg, #059669 0%, #10B981 100%)" : "#FFF", padding: 32, borderRadius: 16, border: isencao ? "none" : "1px solid var(--border-color)", color: isencao ? "#FFF" : "var(--text-color)", boxShadow: "0 10px 25px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ background: isencao ? "rgba(255,255,255,0.2)" : "rgba(239,68,68,0.1)", color: isencao ? "#FFF" : "#EF4444", padding: 12, borderRadius: 12 }}>
              <Users size={24} />
            </div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: 0 }}>Lojas Ativas</h2>
          </div>
          <div style={{ fontSize: "3rem", fontWeight: 900, marginBottom: 8, lineHeight: 1 }}>
            {activeCount} <span style={{ fontSize: "1.2rem", color: isencao ? "rgba(255,255,255,0.7)" : "#94A3B8" }}>/ 10</span>
          </div>
          <p style={{ fontSize: "0.95rem", color: isencao ? "rgba(255,255,255,0.9)" : "#64748B", margin: 0 }}>
            {isencao ? "🎉 Parabéns! Sua mensalidade está ISENTA." : `Faltam ${10 - activeCount} indicações ativas para isentar sua mensalidade.`}
          </p>
          
          <div style={{ background: isencao ? "rgba(0,0,0,0.2)" : "#F1F5F9", height: 8, borderRadius: 4, marginTop: 24, overflow: "hidden" }}>
            <div style={{ background: isencao ? "#FFF" : "#EF4444", height: "100%", width: `${Math.min(100, (activeCount / 10) * 100)}%`, transition: "width 1s ease" }}></div>
          </div>
        </div>

        {/* Card Link */}
        <div style={{ background: "#FFF", padding: 32, borderRadius: 16, border: "1px solid var(--border-color)", boxShadow: "0 10px 25px rgba(0,0,0,0.05)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 800, margin: "0 0 8px 0", color: "#0F172A" }}>Seu Link Exclusivo</h2>
          <p style={{ color: "#64748B", fontSize: "0.95rem", margin: "0 0 24px 0" }}>
            Envie este link para outros restaurantes. Toda mensalidade paga por eles será creditada (20%) na sua conta Asaas via split automático.
          </p>
          
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1, background: "#F8FAFC", border: "1px solid #E2E8F0", padding: "12px 16px", borderRadius: 8, fontFamily: "monospace", fontSize: "0.9rem", color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {origin ? referralLink : "Carregando..."}
            </div>
            <button onClick={copyToClipboard} className="btn-primary" style={{ padding: "0 24px" }} disabled={!origin}>
              {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
              {copied ? " Copiado!" : " Copiar"}
            </button>
          </div>
        </div>
      </div>

      {/* Tabela de Indicados */}
      <div style={{ background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border-color)", padding: 24 }}>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: 24, color: "var(--text-color)" }}>Suas Indicações ({referrals.length})</h2>
        
        {referrals.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94A3B8" }}>
            <Users size={48} style={{ opacity: 0.2, margin: "0 auto 16px" }} />
            <p>Você ainda não indicou nenhum restaurante.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="ct">
              <thead>
                <tr>
                  <th style={{textAlign: "left"}}>Restaurante</th>
                  <th style={{textAlign: "left"}}>Telefone</th>
                  <th style={{textAlign: "left"}}>Data de Cadastro</th>
                  <th style={{textAlign: "left"}}>Status</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.storeName || "Loja em configuração"}</td>
                    <td>{r.storePhone || "-"}</td>
                    <td>{new Date(r.createdAt).toLocaleDateString("pt-BR")}</td>
                    <td>
                      {r.status === "ACTIVE" && <span style={{ background: "rgba(16,185,129,0.15)", color: "#059669", padding: "4px 10px", borderRadius: 12, fontSize: "0.8rem", fontWeight: 700 }}>ATIVO</span>}
                      {r.status === "TRIAL" && <span style={{ background: "rgba(245,158,11,0.15)", color: "#D97706", padding: "4px 10px", borderRadius: 12, fontSize: "0.8rem", fontWeight: 700 }}>TESTE GRÁTIS</span>}
                      {r.status === "INACTIVE" && <span style={{ background: "rgba(239,68,68,0.15)", color: "#DC2626", padding: "4px 10px", borderRadius: 12, fontSize: "0.8rem", fontWeight: 700 }}>INATIVO / CANCELADO</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
