"use client";

import { useState } from "react";
import { createStaffUser, updateStaffPermissions, deleteStaffUser } from "@/app/actions/team";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { UserPlus, Trash2, Shield, ShieldCheck } from "lucide-react";

const PERM_COLORS: Record<string, string> = {
  dashboard: "#6366f1",
  products: "#0ea5e9",
  franchisees: "#f59e0b",
  orders: "#10b981",
  routes: "#8b5cf6",
  finance: "#ef4444",
  payables: "#f97316",
  invoices: "#14b8a6", // Teal
};

export default function TeamClient({ staffUsers }: { staffUsers: any[] }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", permissions: [] as string[] });
  const [loading, setLoading] = useState(false);

  const togglePerm = (key: string) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter(p => p !== key)
        : [...f.permissions, key]
    }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.permissions.length === 0) { alert("Selecione pelo menos uma permissão."); return; }
    setLoading(true);
    try {
      await createStaffUser(form);
      setForm({ name: "", email: "", password: "", permissions: [] });
      setShowForm(false);
    } catch { alert("Erro ao criar usuário."); }
    finally { setLoading(false); }
  };

  const handleTogglePermission = async (userId: string, currentPerms: string, key: string) => {
    const arr = currentPerms ? currentPerms.split(",") : [];
    const next = arr.includes(key) ? arr.filter(p => p !== key) : [...arr, key];
    await updateStaffPermissions(userId, next);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Excluir o acesso de ${name}?`)) return;
    await deleteStaffUser(id);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 className="font-bold" style={{ fontSize: "1.75rem" }}>Equipe / Controle de Acessos</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Somente o Super Admin vê esta tela.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <UserPlus size={18} /> Novo Acesso
        </button>
      </div>

      {/* Formulário de novo usuário */}
      {showForm && (
        <div className="card mb-8">
          <h2 className="font-bold mb-4">Criar Novo Acesso</h2>
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: "bold", fontSize: "0.85rem" }}>Nome Completo</label>
                <input required className="input" placeholder="Ex: Victor Henriques" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: "bold", fontSize: "0.85rem" }}>E-mail</label>
                <input required type="email" className="input" placeholder="email@empresa.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.4rem", fontWeight: "bold", fontSize: "0.85rem" }}>Senha de acesso</label>
              <input required type="password" className="input" placeholder="Senha para login" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: "bold", fontSize: "0.85rem" }}>Permissões</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {ALL_PERMISSIONS.map(p => {
                  const active = form.permissions.includes(p.key);
                  return (
                    <button key={p.key} type="button" onClick={() => togglePerm(p.key)}
                      style={{
                        padding: "0.4rem 0.85rem", borderRadius: "20px", fontSize: "0.8rem", fontWeight: "bold", cursor: "pointer", border: `2px solid ${PERM_COLORS[p.key] || "#888"}`,
                        backgroundColor: active ? PERM_COLORS[p.key] : "transparent",
                        color: active ? "white" : PERM_COLORS[p.key] || "#888",
                        transition: "all 0.2s"
                      }}>
                      {active ? "✓ " : ""}{p.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", gap: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "Salvando..." : "Criar Acesso"}</button>
              <button type="button" className="btn btn-outline" onClick={() => setShowForm(false)}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* Lista de usuários da equipe */}
      {staffUsers.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <Shield size={48} style={{ color: "var(--text-muted)", margin: "0 auto 1rem" }} />
          <p className="text-muted">Nenhum membro da equipe cadastrado ainda.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {staffUsers.map(user => {
            const userPerms = user.permissions ? user.permissions.split(",") : [];
            return (
              <div key={user.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <ShieldCheck size={20} style={{ color: "#6366f1" }} />
                      <h3 className="font-bold" style={{ fontSize: "1.1rem" }}>{user.name}</h3>
                    </div>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{user.email}</p>
                  </div>
                  <button onClick={() => handleDelete(user.id, user.name)} className="btn btn-outline" style={{ color: "var(--danger)", padding: "0.4rem 0.75rem", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <Trash2 size={14} /> Remover acesso
                  </button>
                </div>

                <p style={{ fontSize: "0.8rem", fontWeight: "bold", marginBottom: "0.5rem", color: "var(--text-muted)" }}>CLIQUE PARA ATIVAR / DESATIVAR:</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                  {ALL_PERMISSIONS.map(p => {
                    const active = userPerms.includes(p.key);
                    return (
                      <button key={p.key} type="button"
                        onClick={() => handleTogglePermission(user.id, user.permissions, p.key)}
                        style={{
                          padding: "0.35rem 0.75rem", borderRadius: "20px", fontSize: "0.78rem", fontWeight: "bold", cursor: "pointer",
                          border: `2px solid ${PERM_COLORS[p.key] || "#888"}`,
                          backgroundColor: active ? PERM_COLORS[p.key] : "transparent",
                          color: active ? "white" : PERM_COLORS[p.key] || "#888",
                          transition: "all 0.2s"
                        }}>
                        {active ? "✓ " : "○ "}{p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
