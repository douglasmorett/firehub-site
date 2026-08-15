"use client";

import { useEffect, useState, useMemo } from "react";
import { Plus, Edit2, Trash2, Users, DollarSign, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";

interface Waiter {
  id: string;
  name: string;
  phone: string | null;
  commissionRate: number;
  active: boolean;
}

export default function GarconsPage() {
  const { data: session } = useSession();
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", phone: "", commissionRate: 10, active: true });

  // Load waiters
  useEffect(() => {
    if (!session) return;
    fetchWaiters();
  }, [session]);

  const fetchWaiters = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/store/waiters");
      if (res.ok) {
        setWaiters(await res.json());
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const method = editingId ? "PUT" : "POST";
    const body = editingId ? { id: editingId, ...formData } : formData;

    const res = await fetch("/api/store/waiters", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setShowModal(false);
      fetchWaiters();
    } else {
      alert("Erro ao salvar garçom");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja remover este garçom?")) return;
    const res = await fetch(`/api/store/waiters?id=${id}`, { method: "DELETE" });
    if (res.ok) fetchWaiters();
  };

  const openNew = () => {
    setEditingId(null);
    setFormData({ name: "", phone: "", commissionRate: 10, active: true });
    setShowModal(true);
  };

  const openEdit = (w: Waiter) => {
    setEditingId(w.id);
    setFormData({ name: w.name, phone: w.phone || "", commissionRate: w.commissionRate || 10, active: w.active });
    setShowModal(true);
  };

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1E293B", display: "flex", alignItems: "center", gap: 10 }}>
          <Users size={28} color="#7C3AED" /> Gestão de Garçons
        </h1>
        <button onClick={openNew} style={{
          background: "#7C3AED", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 8,
          fontWeight: 700, display: "flex", alignItems: "center", gap: 6, cursor: "pointer"
        }}>
          <Plus size={18} /> Novo Garçom
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}><Loader2 className="animate-spin mx-auto" /></div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
                <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Nome</th>
                <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Telefone</th>
                <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Status</th>
                <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {waiters.map(w => (
                <tr key={w.id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                  <td style={{ padding: "14px 16px", fontWeight: 600, color: "#1E293B" }}>{w.name}</td>
                  <td style={{ padding: "14px 16px", color: "#64748B" }}>{w.phone || "-"}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{
                      background: w.active ? "#DCFCE7" : "#FEE2E2",
                      color: w.active ? "#16A34A" : "#EF4444",
                      padding: "4px 8px", borderRadius: 20, fontSize: 12, fontWeight: 700
                    }}>
                      {w.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td style={{ padding: "14px 16px", textAlign: "right" }}>
                    <button onClick={() => openEdit(w)} style={{ background: "none", border: "none", color: "#3B82F6", cursor: "pointer", marginRight: 12 }}><Edit2 size={18} /></button>
                    <button onClick={() => handleDelete(w.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer" }}><Trash2 size={18} /></button>
                  </td>
                </tr>
              ))}
              {waiters.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 30, textAlign: "center", color: "#94A3B8" }}>Nenhum garçom cadastrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL */}
      {showModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: "#fff", padding: 24, borderRadius: 16, width: 400, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <h2 style={{ margin: "0 0 20px 0", fontSize: 20 }}>{editingId ? "Editar Garçom" : "Novo Garçom"}</h2>
            
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>Nome</label>
                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 14 }} />
              </div>
              
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>Telefone</label>
                <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #CBD5E1", fontSize: 14 }} />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={formData.active} onChange={e => setFormData({ ...formData, active: e.target.checked })} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Ativo no sistema</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #CBD5E1", background: "#F8FAFC", cursor: "pointer", fontWeight: 600 }}>
                  Cancelar
                </button>
                <button type="submit"
                  style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", background: "#7C3AED", color: "#fff", cursor: "pointer", fontWeight: 700 }}>
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
