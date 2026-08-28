"use client";
import React, { useState, useEffect } from "react";
import { Ambassador } from "@prisma/client";

// Define the extended interface locally so TypeScript knows about referredStores
type LojaIndicada = {
  id: string;
  storeName: string | null;
  storePhone: string | null;
  email: string | null;
  createdAt: Date;
  ambassadorAccount?: { id: string; code: string; active?: boolean } | null;
};

/** Loja como vem de /api/admin/users — a lista para escolher quem promover. */
type LojaDoPainel = {
  id: string;
  name: string;
  email: string | null;
  storeName: string | null;
  storePhone: string | null;
  city: string | null;
  createdAt: string;
  ambassadorId: string | null;
  ambassadorAccount?: { id: string; code: string } | null;
};

type SubEmbaixador = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  commissionPercent: number;
  _count?: { referredStores: number };
};

type AmbassadorWithStores = Ambassador & {
  _count?: { referredStores: number, subAmbassadors: number },
  referredStores?: LojaIndicada[],
  parentAmbassador?: { id: string, name: string, code: string, level2Percent: number } | null,
  subAmbassadors?: SubEmbaixador[]
};

export default function AmbassadorsTab() {
  const [ambassadors, setAmbassadors] = useState<AmbassadorWithStores[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [commissionPercent, setCommissionPercent] = useState(20);
  const [asaasWalletId, setAsaasWalletId] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [parentAmbassadorId, setParentAmbassadorId] = useState("");
  const [level2Percent, setLevel2Percent] = useState(3);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Promoção de lojista a embaixador
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lojas, setLojas] = useState<LojaDoPainel[]>([]);
  const [buscaLoja, setBuscaLoja] = useState("");
  const [promoteStore, setPromoteStore] = useState<{ loja: LojaIndicada; indicadaPor: AmbassadorWithStores | null } | null>(null);
  const [promoteWallet, setPromoteWallet] = useState("");
  const [promoteCommission, setPromoteCommission] = useState(20);
  const [promoting, setPromoting] = useState(false);
  const [promoteResult, setPromoteResult] = useState<{ nome: string; code: string; senha: string; link: string; pai: string | null } | null>(null);

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
    setParentAmbassadorId(""); setLevel2Percent(3);
    setIsModalOpen(true);
  }

  function openEditModal(amb: AmbassadorWithStores) {
    setEditingId(amb.id);
    setName(amb.name); setEmail(amb.email); setPhone(amb.phone || ""); setCode(amb.code);
    setCommissionPercent(amb.commissionPercent); setAsaasWalletId(amb.asaasWalletId || ""); setPixKey(amb.pixKey || "");
    setParentAmbassadorId(amb.parentAmbassadorId || ""); setLevel2Percent(amb.level2Percent ?? 3);
    setIsModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name, email, phone, code, commissionPercent, asaasWalletId, pixKey,
      level2Percent,
      parentAmbassadorId: parentAmbassadorId || null,
    };
    
    try {
      // A resposta era descartada: com a validação de percentual no servidor,
      // um 400 fechava o modal como se tivesse salvado.
      const res = editingId
        ? await fetch(`/api/admin/ambassadors/${editingId}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          })
        : await fetch("/api/admin/ambassadors", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

      if (!res.ok) {
        const erro = await res.json().catch(() => ({}));
        alert(erro.error || "Erro ao salvar embaixador");
        return;
      }

      setIsModalOpen(false);
      fetchAmbassadors();
    } catch (err) {
      alert("Erro ao salvar embaixador");
    }
  }

  async function openPicker() {
    setBuscaLoja("");
    setPickerOpen(true);
    if (lojas.length === 0) {
      try {
        const res = await fetch("/api/admin/users");
        if (res.ok) {
          const data = await res.json();
          setLojas(data.users || []);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }

  function escolherLoja(loja: LojaDoPainel) {
    setPickerOpen(false);
    openPromoteModal(
      {
        id: loja.id,
        storeName: loja.storeName || loja.name,
        storePhone: loja.storePhone,
        email: loja.email,
        createdAt: new Date(loja.createdAt),
        ambassadorAccount: loja.ambassadorAccount || null,
      },
      // A loja pode não ter vindo de embaixador nenhum: aí a promoção entra sem
      // indicador e ninguém recebe nível 2 sobre a rede dela.
      ambassadors.find(a => a.id === loja.ambassadorId) || null
    );
  }

  function openPromoteModal(loja: LojaIndicada, indicadaPor: AmbassadorWithStores | null) {
    setPromoteStore({ loja, indicadaPor });
    setPromoteWallet("");
    setPromoteCommission(20);
    setPromoteResult(null);
  }

  async function handlePromote(e: React.FormEvent) {
    e.preventDefault();
    if (!promoteStore) return;

    setPromoting(true);
    try {
      const res = await fetch("/api/admin/ambassadors/promote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: promoteStore.loja.id,
          asaasWalletId: promoteWallet,
          commissionPercent: promoteCommission,
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erro ao promover a embaixador");
        return;
      }
      // A senha temporária só existe nesta resposta — daqui em diante é só hash.
      setPromoteResult({
        nome: data.ambassador.name,
        code: data.ambassador.code,
        senha: data.senhaTemporaria,
        link: data.inviteLink,
        pai: data.ambassador.parentAmbassador?.name || null,
      });
      fetchAmbassadors();
    } catch (err) {
      alert("Erro ao promover a embaixador");
    } finally {
      setPromoting(false);
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
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={openPicker}
            style={{ background: "#F5F3FF", color: "#6D28D9", padding: "8px 16px", borderRadius: "8px", border: "1px solid #DDD6FE", fontWeight: 700, cursor: "pointer" }}
          >
            Promover lojista
          </button>
          <button
            onClick={openNewModal}
            style={{ background: "#EA1D2C", color: "#FFF", padding: "8px 16px", borderRadius: "8px", border: "none", fontWeight: 700, cursor: "pointer" }}
          >
            + Novo Embaixador
          </button>
        </div>
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
                <React.Fragment key={amb.id}>
                <tr style={{ borderBottom: "1px solid #E2E8F0" }}>
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
                    {amb.parentAmbassador && (
                      <div style={{ fontSize:"0.75rem", color:"#7C3AED", marginTop:4 }}>
                        Indicado por <strong>{amb.parentAmbassador.name}</strong> · leva {amb.parentAmbassador.level2Percent}%
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", fontWeight: 700, color: "#1E293B", cursor: "pointer" }} onClick={() => setExpandedId(expandedId === amb.id ? null : amb.id)}>
                    {amb._count?.referredStores || 0} lojas
                    <span style={{ marginLeft: 4, fontSize: "0.7rem", color: "#64748B" }}>{expandedId === amb.id ? "▲" : "▼"}</span>
                    {!!amb._count?.subAmbassadors && (
                      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7C3AED", marginTop: 4 }}>
                        + {amb._count.subAmbassadors} embaixador{amb._count.subAmbassadors > 1 ? "es" : ""} na rede
                      </div>
                    )}
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
                {expandedId === amb.id && ((amb.referredStores?.length ?? 0) > 0 || (amb.subAmbassadors?.length ?? 0) > 0) && (
                  <tr key={`${amb.id}-stores`} style={{ background: "#F8FAFC" }}>
                    <td colSpan={6} style={{ padding: "16px 24px", borderBottom: "1px solid #E2E8F0" }}>
                      {(amb.subAmbassadors?.length ?? 0) > 0 && (
                        <div style={{ marginBottom: "16px" }}>
                          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#5B21B6", marginBottom: "8px" }}>
                            Rede — nível 2 ({amb.level2Percent ?? 3}% das lojas destes embaixadores):
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {amb.subAmbassadors!.map((sub) => (
                              <div key={sub.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FFF", padding: "10px 16px", borderRadius: "8px", border: "1px solid #DDD6FE" }}>
                                <div>
                                  <div style={{ fontWeight: 600, color: "#334155" }}>
                                    {sub.name} {!sub.active && <span style={{ fontSize: "0.7rem", color: "#991B1B" }}>(inativo)</span>}
                                  </div>
                                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                                    Código: <strong style={{ color: "#7C3AED" }}>{sub.code}</strong> · leva {sub.commissionPercent}% das lojas dele
                                  </div>
                                </div>
                                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#5B21B6" }}>
                                  {sub._count?.referredStores || 0} lojas
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1E293B", marginBottom: "8px" }}>Lojas Indicadas:</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {(amb.referredStores ?? []).map((store: any) => (
                          <div key={store.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FFF", padding: "10px 16px", borderRadius: "8px", border: "1px solid #E2E8F0" }}>
                            <div>
                              <div style={{ fontWeight: 600, color: "#334155" }}>{store.storeName || "Sem Nome"}</div>
                              <div style={{ fontSize: "0.75rem", color: "#64748B" }}>Desde: {new Date(store.createdAt).toLocaleDateString('pt-BR')}</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              {store.ambassadorAccount ? (
                                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#5B21B6", background: "#F5F3FF", border: "1px solid #DDD6FE", padding: "4px 10px", borderRadius: "6px" }}>
                                  Embaixador · {store.ambassadorAccount.code}
                                </span>
                              ) : (
                                <button
                                  onClick={() => openPromoteModal(store, amb)}
                                  style={{ background: "#F5F3FF", color: "#6D28D9", border: "1px solid #DDD6FE", padding: "4px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "0.75rem", fontWeight: 700 }}
                                >
                                  Promover a embaixador
                                </button>
                              )}
                              {store.storePhone ? (
                                <a
                                  href={`https://wa.me/55${store.storePhone.replace(/\D/g, "")}?text=Olá`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ background: "#25D366", color: "#FFF", padding: "4px 10px", borderRadius: "6px", textDecoration: "none", fontSize: "0.75rem", fontWeight: 700 }}
                                >
                                  WhatsApp
                                </a>
                              ) : (
                                <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Sem telefone</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
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

              <div style={{ background: "#F5F3FF", padding: "12px", borderRadius: "8px", border: "1px solid #DDD6FE" }}>
                <h4 style={{ fontSize: "0.9rem", fontWeight: 700, color: "#5B21B6", marginBottom: "10px" }}>Rede (nível 2)</h4>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "12px", alignItems: "end" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>Indicado por</label>
                    <select
                      value={parentAmbassadorId}
                      onChange={e => setParentAmbassadorId(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px", background: "#FFF" }}
                    >
                      <option value="">Ninguém (entrou direto)</option>
                      {ambassadors
                        .filter(a => a.id !== editingId)
                        .map(a => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>Nível 2 %</label>
                    <input type="number" step="0.1" min="0" max="40" value={level2Percent} onChange={e=>setLevel2Percent(parseFloat(e.target.value))} style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px", fontWeight: 700 }} />
                  </div>
                </div>
                <p style={{ fontSize: "0.75rem", color: "#64748B", marginTop: "8px", lineHeight: "1.4" }}>
                  <strong>Indicado por</strong>: quem trouxe este embaixador — recebe o nível 2 das lojas que ele indicar.
                  <strong> Nível 2 %</strong>: o que ESTE embaixador recebe das lojas dos embaixadores que ele trouxer (padrão 3%).
                  O programa para aqui — não existe terceiro nível.
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

      {/* Seletor de loja para promover */}
      {pickerOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#FFF", width: "100%", maxWidth: "560px", maxHeight: "80vh", borderRadius: "12px", padding: "24px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "4px", color: "#1E293B" }}>Promover lojista a embaixador</h3>
            <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "0 0 12px 0" }}>
              Escolha a loja. Quem indicou ela vira o indicador dele e passa a receber o nível 2.
            </p>
            <input
              autoFocus
              value={buscaLoja}
              onChange={e => setBuscaLoja(e.target.value)}
              placeholder="Buscar por nome da loja, e-mail ou cidade"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px", marginBottom: "12px" }}
            />
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
              {lojas
                .filter(l => {
                  const q = buscaLoja.toLowerCase().trim();
                  if (!q) return true;
                  return [l.storeName, l.name, l.email, l.city].some(v => (v || "").toLowerCase().includes(q));
                })
                .slice(0, 60)
                .map(l => {
                  const jaEh = !!l.ambassadorAccount;
                  const indicador = ambassadors.find(a => a.id === l.ambassadorId);
                  return (
                    <button
                      key={l.id}
                      disabled={jaEh}
                      onClick={() => escolherLoja(l)}
                      style={{
                        textAlign: "left", background: jaEh ? "#F8FAFC" : "#FFF", border: "1px solid #E2E8F0",
                        borderRadius: "8px", padding: "10px 14px", cursor: jaEh ? "default" : "pointer",
                        opacity: jaEh ? 0.6 : 1,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "#1E293B" }}>{l.storeName || l.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                        {l.email}{l.city ? ` · ${l.city}` : ""}
                        {indicador ? ` · indicada por ${indicador.name}` : " · sem indicador"}
                        {jaEh ? ` · JÁ É EMBAIXADOR (${l.ambassadorAccount!.code})` : ""}
                      </div>
                    </button>
                  );
                })}
              {lojas.length === 0 && <p style={{ color: "#64748B", fontSize: "0.85rem" }}>Carregando lojas...</p>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
              <button type="button" onClick={() => setPickerOpen(false)} style={{ padding: "8px 16px", border: "1px solid #CBD5E1", background: "#FFF", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Promover lojista a embaixador */}
      {promoteStore && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#FFF", width: "100%", maxWidth: "520px", borderRadius: "12px", padding: "24px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            {promoteResult ? (
              <>
                <h3 style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: "8px", color: "#166534" }}>
                  {promoteResult.nome} agora é embaixador
                </h3>
                <p style={{ fontSize: "0.85rem", color: "#475569", marginBottom: "16px", lineHeight: 1.5 }}>
                  {promoteResult.pai
                    ? <>Continua na linha de <strong>{promoteResult.pai}</strong>, que passa a receber o nível 2 das lojas que ele indicar.</>
                    : <>Entrou sem indicador — ninguém recebe nível 2 sobre a rede dele.</>}
                </p>

                <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "8px", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>LINK DE CONVITE</div>
                    <div style={{ fontSize: "0.85rem", color: "#1E293B", wordBreak: "break-all" }}>{promoteResult.link}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>PORTAL</div>
                    <div style={{ fontSize: "0.85rem", color: "#1E293B" }}>firehubfood.com.br/embaixador</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>SENHA TEMPORÁRIA</div>
                    <div style={{ fontSize: "1rem", fontWeight: 800, color: "#EA1D2C", letterSpacing: "1px" }}>{promoteResult.senha}</div>
                    <div style={{ fontSize: "0.75rem", color: "#B91C1C", marginTop: 4 }}>
                      Anote agora — esta senha não aparece de novo em lugar nenhum.
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "16px" }}>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(`Portal: https://firehubfood.com.br/embaixador
Senha: ${promoteResult.senha}
Seu link: ${promoteResult.link}`); }}
                    style={{ padding: "8px 16px", border: "1px solid #CBD5E1", background: "#FFF", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}
                  >
                    Copiar tudo
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPromoteStore(null); setPromoteResult(null); }}
                    style={{ padding: "8px 16px", border: "none", background: "#EA1D2C", color: "#FFF", borderRadius: "6px", cursor: "pointer", fontWeight: 700 }}
                  >
                    Pronto
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handlePromote} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#1E293B" }}>
                  Promover {promoteStore.loja.storeName || "loja"} a embaixador
                </h3>
                <p style={{ fontSize: "0.85rem", color: "#475569", lineHeight: 1.5, margin: 0 }}>
                  {promoteStore.indicadaPor ? (
                    <>
                      A loja <strong>continua na linha de {promoteStore.indicadaPor.name}</strong>: ele segue recebendo
                      {" "}{promoteStore.indicadaPor.commissionPercent}% da mensalidade dela e passa a receber
                      {" "}{promoteStore.indicadaPor.level2Percent ?? 3}% das lojas que ela indicar.
                    </>
                  ) : (
                    <>Esta loja não veio de embaixador nenhum — ninguém recebe nível 2 sobre a rede dela.</>
                  )}
                </p>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
                    Asaas Wallet ID da conta dele
                  </label>
                  <input
                    required
                    value={promoteWallet}
                    onChange={e => setPromoteWallet(e.target.value)}
                    placeholder="wal_XXXXXXXXXXXXXXXX"
                    style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px" }}
                  />
                  <p style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 4 }}>
                    Sem carteira o Asaas não repassa nada — peça para ele abrir a conta antes.
                  </p>
                </div>

                <div style={{ width: "140px" }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>Comissão dele %</label>
                  <input type="number" step="0.1" min="0" max="40" required value={promoteCommission} onChange={e => setPromoteCommission(parseFloat(e.target.value))} style={{ width: "100%", padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "6px", fontWeight: 700 }} />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "8px" }}>
                  <button type="button" onClick={() => setPromoteStore(null)} style={{ padding: "8px 16px", border: "1px solid #CBD5E1", background: "#FFF", borderRadius: "6px", cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
                  <button type="submit" disabled={promoting} style={{ padding: "8px 16px", border: "none", background: promoting ? "#94A3B8" : "#6D28D9", color: "#FFF", borderRadius: "6px", cursor: promoting ? "default" : "pointer", fontWeight: 700 }}>
                    {promoting ? "Promovendo..." : "Promover"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
