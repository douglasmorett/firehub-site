"use client";

import { useState, useEffect } from "react";
import {
  Users, UserPlus, Shield, CheckSquare, Square, Trash2, Edit, Lock, Eye, EyeOff, Save, Key, CheckCircle, AlertCircle
} from "lucide-react";

export const STORE_MODULES = [
  { key: "orders",           label: "📊 Painel de Pedidos (Kanban)",       desc: "Acesso ao fluxo Kanban e gerenciamento de pedidos" },
  { key: "kds",              label: "👨‍🍳 Tela da Cozinha (KDS)",            desc: "Visualização e controle de preparo na cozinha" },
  { key: "venda_presencial", label: "🛒 Venda Balcão (PDV / Caixa)",       desc: "Lançamento de pedidos presenciais e fechamento de caixa" },
  { key: "cardapio",         label: "📖 Cardápio & Produtos",              desc: "Cadastro e alteração de preços e itens" },
  { key: "estoque",          label: "📦 Controle de Estoque",             desc: "Insumos, fichas técnicas e entradas/saídas" },
  { key: "motoboys",         label: "🛵 Gestão de Motoboys",              desc: "Atribuição e cadastro de motoboys próprios" },
  { key: "financeiro",       label: "💰 Relatórios Financeiros & DRE",    desc: "Acesso a faturamento, custos fixos e fluxo de caixa" },
  { key: "ifood",            label: "⚡ Integrações (iFood / Jotajá)",     desc: "Conexão e status das plataformas de delivery" },
  { key: "impressoras",      label: "🖨️ Configuração de Impressoras",     desc: "Vínculo e vias de impressão de cupons" },
  { key: "minha_loja",       label: "🏪 Configurações da Loja",            desc: "Horários, dados da loja e cadastro de equipe" },
];

export default function StoreTeamManager() {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingMember, setEditingMember] = useState<any | null>(null);

  // Form de novo funcionário
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(
    STORE_MODULES.map(m => m.key) // Por padrão, tudo vem ativado (igual ao dono)
  );

  // Form de edição
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [toastMsg, setToastMsg] = useState<{ text: string; bg: string } | null>(null);

  function showToast(text: string, bg: string = "#10B981") {
    setToastMsg({ text, bg });
    setTimeout(() => setToastMsg(null), 4000);
  }

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/store/team");
      if (res.ok) {
        const data = await res.json();
        setMembers(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const toggleNewPermission = (key: string) => {
    setSelectedPermissions(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const toggleAllNewPermissions = (enableAll: boolean) => {
    if (enableAll) {
      setSelectedPermissions(STORE_MODULES.map(m => m.key));
    } else {
      setSelectedPermissions([]);
    }
  };

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      showToast("Preencha nome, e-mail e senha do funcionário.", "#EF4444");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/store/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password: password.trim(),
          permissions: selectedPermissions,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao cadastrar funcionário");
      }

      showToast(`🎉 Funcionário "${name}" cadastrado com sucesso!`);
      setName("");
      setEmail("");
      setPassword("");
      setSelectedPermissions(STORE_MODULES.map(m => m.key));
      setShowAddForm(false);
      fetchMembers();
    } catch (err: any) {
      showToast(err.message || "Erro ao salvar funcionário.", "#EF4444");
    } finally {
      setSubmitting(false);
    }
  };

  const openEditMember = (m: any) => {
    setEditingMember(m);
    const existingPerms = m.permissions ? m.permissions.split(",") : STORE_MODULES.map(item => item.key);
    setEditPermissions(existingPerms);
    setNewPassword("");
  };

  const toggleEditPermission = (key: string) => {
    setEditPermissions(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSaveEdit = async () => {
    if (!editingMember) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/store/team", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingMember.id,
          permissions: editPermissions,
          password: newPassword ? newPassword.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao atualizar permissões");

      showToast(`✅ Permissões de "${editingMember.name}" atualizadas!`);
      setEditingMember(null);
      fetchMembers();
    } catch (err: any) {
      showToast(err.message || "Erro ao atualizar.", "#EF4444");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMember = async (id: string, nameStr: string) => {
    if (!confirm(`Tem certeza que deseja remover o funcionário "${nameStr}" da equipe?`)) return;

    try {
      const res = await fetch(`/api/store/team?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erro ao remover");
      showToast(`🗑️ Funcionário "${nameStr}" removido.`);
      fetchMembers();
    } catch (err: any) {
      showToast(err.message || "Erro ao remover.", "#EF4444");
    }
  };

  return (
    <div style={{ maxWidth: 850, margin: "0 auto" }}>
      {/* Toast Alert */}
      {toastMsg && (
        <div style={{
          position: "fixed", bottom: "24px", right: "24px", zIndex: 99999,
          background: toastMsg.bg, color: "#fff", padding: "12px 20px", borderRadius: "10px",
          fontWeight: 700, fontSize: "0.9rem", boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
        }}>
          {toastMsg.text}
        </div>
      )}

      {/* Main Container Card */}
      <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", border: "1px solid #E2E8F0", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
        
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ fontSize: "1.35rem", fontWeight: 800, color: "#0F172A", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <Users size={22} color="#3B82F6" /> Equipe da Loja & Permissões
            </h2>
            <p style={{ fontSize: "0.85rem", color: "#64748B", margin: "4px 0 0" }}>
              Crie contas de login e senha para seus funcionários e escolha quais módulos cada um pode acessar.
            </p>
          </div>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "9px 18px", borderRadius: "10px", border: "none",
              background: showAddForm ? "#64748B" : "linear-gradient(135deg, #3B82F6, #1D4ED8)",
              color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
              boxShadow: "0 4px 12px rgba(59, 130, 246, 0.25)"
            }}
          >
            <UserPlus size={16} />
            {showAddForm ? "Cancelar" : "➕ Cadastrar Novo Membro"}
          </button>
        </div>

        {/* Form para Cadastrar Novo Membro */}
        {showAddForm && (
          <form onSubmit={handleCreateMember} style={{ background: "#F8FAFC", borderRadius: "14px", padding: "20px", border: "1.5px solid #CBD5E1", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#1E293B", margin: "0 0 16px", display: "flex", alignItems: "center", gap: "6px" }}>
              <UserPlus size={18} color="#3B82F6" /> Novo Login de Funcionário
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                  Nome do Funcionário *
                </label>
                <input
                  type="text"
                  placeholder="Ex: Carlos - Operador de Caixa"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.875rem", outline: "none", background: "#fff" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                  E-mail de Login *
                </label>
                <input
                  type="email"
                  placeholder="exemplo@sualoja.com.br"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.875rem", outline: "none", background: "#fff" }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "20px", maxWidth: "340px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                Senha de Acesso *
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 4 caracteres"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  style={{ width: "100%", padding: "9px 40px 9px 12px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.875rem", outline: "none", background: "#fff" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748B", cursor: "pointer" }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Configuração de Permissões (Caixinhas) */}
            <div style={{ background: "#fff", padding: "16px", borderRadius: "10px", border: "1px solid #E2E8F0", marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "#0F172A", display: "flex", alignItems: "center", gap: "6px" }}>
                    <Shield size={16} color="#059669" /> Módulos Liberados para este Funcionário:
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#64748B" }}>
                    (Por padrão, vem tudo liberado igual ao dono. Desmarque as caixinhas para tirar acesso)
                  </span>
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => toggleAllNewPermissions(true)}
                    style={{ padding: "3px 8px", fontSize: "0.72rem", fontWeight: 700, borderRadius: "6px", border: "1px solid #CBD5E1", background: "#EFF6FF", color: "#1D4ED8", cursor: "pointer" }}
                  >
                    Marcar Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAllNewPermissions(false)}
                    style={{ padding: "3px 8px", fontSize: "0.72rem", fontWeight: 700, borderRadius: "6px", border: "1px solid #CBD5E1", background: "#FEF2F2", color: "#DC2626", cursor: "pointer" }}
                  >
                    Desmarcar Todos
                  </button>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
                {STORE_MODULES.map(m => {
                  const isChecked = selectedPermissions.includes(m.key);
                  return (
                    <div
                      key={m.key}
                      onClick={() => toggleNewPermission(m.key)}
                      style={{
                        padding: "10px 12px", borderRadius: "8px", cursor: "pointer",
                        border: isChecked ? "1.5px solid #10B981" : "1px solid #E2E8F0",
                        background: isChecked ? "#ECFDF5" : "#F8FAFC",
                        transition: "all 0.15s ease", display: "flex", alignItems: "flex-start", gap: "10px"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}} // tratado no onClick pai
                        style={{ width: 17, height: 17, marginTop: "2px", accentColor: "#10B981", cursor: "pointer" }}
                      />
                      <div>
                        <div style={{ fontSize: "0.82rem", fontWeight: 700, color: isChecked ? "#065F46" : "#475569" }}>
                          {m.label}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: "1px" }}>
                          {m.desc}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%", padding: "11px", borderRadius: "10px", border: "none",
                background: "linear-gradient(135deg, #059669, #047857)", color: "#fff",
                fontWeight: 800, fontSize: "0.9rem", cursor: submitting ? "not-allowed" : "pointer"
              }}
            >
              {submitting ? "Cadastrando..." : "💾 Salvar e Criar Acesso do Funcionário"}
            </button>
          </form>
        )}

        {/* Tabela / Lista de Funcionários Existentes */}
        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#64748B", fontSize: "0.9rem" }}>
            Carregando membros da equipe...
          </div>
        ) : members.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", background: "#F8FAFC", borderRadius: "12px", border: "1px dashed #CBD5E1" }}>
            <Users size={36} color="#94A3B8" style={{ marginBottom: "8px" }} />
            <h4 style={{ margin: "0 0 4px", fontSize: "1rem", color: "#334155" }}>Nenhum funcionário cadastrado ainda</h4>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748B" }}>
              Clique no botão <strong>"➕ Cadastrar Novo Membro"</strong> para dar acesso aos seus funcionários com controle de permissões.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {members.map((m: any) => {
              const activePermsList = m.permissions ? m.permissions.split(",").filter(Boolean) : STORE_MODULES.map(x => x.key);
              const permsPct = Math.round((activePermsList.length / STORE_MODULES.length) * 100);

              return (
                <div
                  key={m.id}
                  style={{
                    background: "#F8FAFC", borderRadius: "12px", padding: "16px",
                    border: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between",
                    alignItems: "center", flexWrap: "wrap", gap: "12px"
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontWeight: 800, fontSize: "0.98rem", color: "#0F172A" }}>
                        {m.name}
                      </span>
                      <span style={{ padding: "2px 8px", borderRadius: "10px", fontSize: "0.68rem", fontWeight: 700, background: "#DBEAFE", color: "#1D4ED8" }}>
                        Funcionário
                      </span>
                    </div>

                    <div style={{ fontSize: "0.82rem", color: "#64748B", marginTop: "2px" }}>
                      ✉️ {m.email}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px" }}>
                      <Shield size={14} color="#059669" />
                      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#334155" }}>
                        {activePermsList.length} de {STORE_MODULES.length} módulos liberados ({permsPct}%)
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      onClick={() => openEditMember(m)}
                      style={{
                        display: "flex", alignItems: "center", gap: "5px", padding: "7px 14px",
                        borderRadius: "8px", border: "1px solid #CBD5E1", background: "#fff",
                        color: "#1E293B", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer"
                      }}
                    >
                      <Edit size={14} color="#3B82F6" />
                      Configurar Permissões
                    </button>

                    <button
                      onClick={() => handleDeleteMember(m.id, m.name)}
                      title="Excluir funcionário"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
                        borderRadius: "8px", border: "1px solid #FECACA", background: "#FEF2F2",
                        color: "#DC2626", cursor: "pointer"
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal / Painel de Edição de Permissões */}
      {editingMember && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10005, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "600px", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 50px rgba(0,0,0,0.25)" }}>
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", borderBottom: "1px solid #E2E8F0", paddingBottom: "12px" }}>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0, color: "#0F172A" }}>
                  ⚙️ Permissões de {editingMember.name}
                </h3>
                <span style={{ fontSize: "0.8rem", color: "#64748B" }}>{editingMember.email}</span>
              </div>
              <button onClick={() => setEditingMember(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#64748B" }}>✕</button>
            </div>

            {/* Troca de Senha (opcional) */}
            <div style={{ background: "#F8FAFC", padding: "12px", borderRadius: "8px", border: "1px solid #E2E8F0", marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginBottom: "4px" }}>
                🔑 Nova Senha (deixe em branco se não quiser alterar):
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Nova senha..."
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  style={{ width: "100%", padding: "7px 35px 7px 10px", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.82rem", outline: "none" }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748B", cursor: "pointer" }}
                >
                  {showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Checkboxes de módulos */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1E293B", marginBottom: "10px" }}>
                Marque para liberar ou desmarque para bloquear o acesso do funcionário:
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {STORE_MODULES.map(m => {
                  const isChecked = editPermissions.includes(m.key);
                  return (
                    <div
                      key={m.key}
                      onClick={() => toggleEditPermission(m.key)}
                      style={{
                        padding: "10px 14px", borderRadius: "8px", cursor: "pointer",
                        border: isChecked ? "1.5px solid #10B981" : "1px solid #CBD5E1",
                        background: isChecked ? "#ECFDF5" : "#F8FAFC",
                        display: "flex", alignItems: "center", justifyContent: "space-between"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          style={{ width: 18, height: 18, accentColor: "#10B981", cursor: "pointer" }}
                        />
                        <div>
                          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: isChecked ? "#065F46" : "#334155" }}>
                            {m.label}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "#64748B" }}>
                            {m.desc}
                          </div>
                        </div>
                      </div>

                      <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: "6px", background: isChecked ? "#D1FAE5" : "#F1F5F9", color: isChecked ? "#047857" : "#64748B" }}>
                        {isChecked ? "LIBERADO" : "BLOQUEADO"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setEditingMember(null)}
                style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={submitting}
                style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none", background: "#10B981", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: submitting ? "not-allowed" : "pointer" }}
              >
                {submitting ? "Salvando..." : "💾 Salvar Alterações"}
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
