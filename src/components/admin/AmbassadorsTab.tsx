"use client";
import { useState, useEffect } from "react";
import { Ambassador } from "@prisma/client";

export default function AmbassadorsTab() {
  const [ambassadors, setAmbassadors] = useState<(Ambassador & { _count?: { referredStores: number } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [commissionPercent, setCommissionPercent] = useState(20);
  const [asaasWalletId, setAsaasWalletId] = useState("");
  const [pixKey, setPixKey] = useState("");
  
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    fetchAmbassadors();
  }, []);

  async function fetchAmbassadors() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ambassadors");
      if (res.ok) {
        const data = await res.json();
        setAmbassadors(data);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  function openNewModal() {
    setEditingId(null);
    setName(""); setEmail(""); setPhone(""); setCode("");
    setCommissionPercent(20); setAsaasWalletId(""); setPixKey("");
    setIsModalOpen(true);
  }

  function openEditModal(amb: Ambassador) {
    setEditingId(amb.id);
    setName(amb.name); setEmail(amb.email); setPhone(amb.phone || ""); setCode(amb.code);
    setCommissionPercent(amb.commissionPercent); setAsaasWalletId(amb.asaasWalletId || ""); setPixKey(amb.pixKey || "");
    setIsModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const payload = { name, email, phone, code, commissionPercent, asaasWalletId, pixKey };
    
    try {
      if (editingId) {
        await fetch(`/api/admin/ambassadors/${editingId}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        await fetch("/api/admin/ambassadors", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      setIsModalOpen(false);
      fetchAmbassadors();
    } catch (err) {
      alert("Erro ao salvar embaixador");
    }
  }

  async function toggleStatus(amb: Ambassador) {
    if (!confirm(`Deseja ${amb.active ? "desativar" : "ativar"} o embaixador ${amb.name}?`)) return;
    try {
      await fetch(`/api/admin/ambassadors/${amb.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !amb.active })
      });
      fetchAmbassadors();
    } catch (e) {
      alert("Erro ao alterar status");
    }
  }

  function copyInviteLink(ambCode: string) {
    const link = `https://firehubfood.com.br/cadastro?ref=${ambCode}`;
    navigator.clipboard.writeText(link);
    setCopiedCode(ambCode);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  return (
    <div style={{ padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1E293B" }}>🤝 Gestão de Embaixadores</h2>
        <button 
          onClick={openNewModal}
          style={{ background: "#EA1D2C", color: "#FFF", padding: "8px 16px", borderRadius: "8px", border: "none", fontWeight: 700, cursor: "pointer" }}
        >
          + Novo Embaixador
        </button>
      </div>

      {loading ? (
        <p>Carregando...</p>
      ) : (
        <div style={{ background: "#FFF", borderRadius: "12px", border: "1px solid #E2E8F0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
              <tr>
                <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Nome</th>
                <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Contato</th>
                <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Comissão</th>
                <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Indicações</th>
                <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Status</th>
                <th style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#64748B" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {ambassadors.map(amb => (
                <tr key={amb.id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ fontWeight: 700, color: "#1E293B" }}>{amb.name}</div>
                    <div style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 4 }}>Código: <strong style={{color:"#EA1D2C"}}>{amb.code}</strong></div>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: "0.85rem", color: "#475569" }}>
                    <div>{amb.email}</div>
                    <div>{amb.phone}</div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ background: "#DCFCE7", color: "#166534", padding: "4px 8px", borderRadius: "6px", fontWeight: 700, fontSize: "0.85rem" }}>
                      {amb.commissionPercent}% recorrente
                    </span>
                    {amb.asaasWalletId && <div style={{ fontSize:"0.75rem", color:"#3B82F6", marginTop:4 }}>Asaas Split Ativo</div>}
                  </td>
                  <td style={{ padding: "12px 16px", fontWeight: 700, color: "#1E293B" }}>
                    {amb._count?.referredStores || 0} lojas
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ 
                      background: amb.active ? "#DCFCE7" : "#FEE2E2", 
                      color: amb.active ? "#166534" : "#991B1B", 
                      padding: "4px 8px", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 700 
                    }}>
                      {amb.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button 
                      onClick={() => copyInviteLink(amb.code)}
                      style={{ background: copiedCode === amb.code ? "#10B981" : "#F1F5F9", color: copiedCode === amb.code ? "#FFF" : "#334155", border: "1px solid #CBD5E1", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                    >
                      {copiedCode === amb.code ? "Copiado!" : "Copiar Link"}
                    </button>
                    <button 
                      onClick={() => openEditModal(amb)}
                      style={{ background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                    >
                      Editar
                    </button>
                    <button 
                      onClick={() => toggleStatus(amb)}
                      style={{ background: "#FFF", color: "#64748B", border: "1px solid #E2E8F0", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                    >
                      {amb.active ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              ))}
              {ambassadors.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "24px", textAlign: "center", color: "#64748B" }}>Nenhum embaixador cadastrado ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Novo/Editar */}
      {isModalOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#FFF", width: "100%", maxWidth: "500px", borderRadius: "12px", padding: "24px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "16px", color: "#1E293B" }}>
              {editingId ? "Editar Embaixador" : "Novo Embaixador"}
            </h3>
            
            <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>Nome</label>
                  <input required value={name} onChange={e=>setName(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px" }} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>E-mail</label>
                  <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>WhatsApp</label>
                  <input value={phone} onChange={e=>setPhone(e.target.value)} style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px" }} />
                </div>
              </div>

              <div style={{ background: "#F8FAFC", padding: "12px", borderRadius: "8px", border: "1px solid #E2E8F0", marginTop: "8px" }}>
                <h4 style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1E293B", marginBottom: "10px" }}>Comissionamento (Split Asaas)</h4>
                
                <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "12px", alignItems: "end" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>Comissão %</label>
                    <input type="number" step="0.1" required value={commissionPercent} onChange={e=>setCommissionPercent(parseFloat(e.target.value))} style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px", fontWeight: 700 }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>Asaas Wallet ID (Conta do Embaixador)</label>
                    <input value={asaasWalletId} onChange={e=>setAsaasWalletId(e.target.value)} placeholder="wal_XXXXXXXXXXXXXXXX" style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px" }} />
                  </div>
                </div>
                <p style={{ fontSize: "0.75rem", color: "#64748B", marginTop: "8px", lineHeight: "1.4" }}>
                  Se o <strong>Asaas Wallet ID</strong> for preenchido, o Asaas dividirá automaticamente {commissionPercent}% da mensalidade enviando direto para a conta deste embaixador a cada pagamento.
                </p>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "16px" }}>
                <button type="button" onClick={() => setIsModalOpen(false)} style={{ padding: "8px 16px", border: "1px solid #CBD5E1", background: "#FFF", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
                <button type="submit" style={{ padding: "8px 16px", border: "none", background: "#EA1D2C", color: "#FFF", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}>Salvar Embaixador</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
