"use client";
import { useState } from "react";
import { Plus, Edit2, Trash2, Bike, Check, X, Phone, DollarSign } from "lucide-react";

type Motoboy = {
  id: string; name: string; phone?: string; active: boolean;
  paymentType: string; dailyRate?: number; perDeliveryRate?: number; perKmRate?: number; notes?: string;
  todayDeliveryCount?: number; todayDeliveryFees?: number; todayDailyRate?: number; todayTotalEarnings?: number;
};

const PAYMENT_TYPES = [
  { value: "PER_DELIVERY", label: "Por Entrega (fixo por corrida)" },
  { value: "DAILY_RATE", label: "Diária Fixa" },
  { value: "BOTH", label: "Diária + Por Entrega" },
  { value: "DAILY_PLUS_FEE", label: "Diária + Taxa do Pedido" },
  { value: "PER_KM", label: "Por KM Percorrido" },
];

const empty = (): Partial<Motoboy> => ({ name: "", phone: "", paymentType: "PER_DELIVERY", active: true, dailyRate: undefined, perDeliveryRate: undefined, perKmRate: undefined, notes: "" });

export default function MotoboyManager({ initialMotoboys }: { initialMotoboys: Motoboy[] }) {
  const [motoboys, setMotoboys] = useState<Motoboy[]>(initialMotoboys);
  const [editing, setEditing] = useState<Partial<Motoboy> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const openNew = () => { setEditing(empty()); setEditingId(null); };
  const openEdit = (mb: Motoboy) => { setEditing({ ...mb }); setEditingId(mb.id); };
  const cancel = () => { setEditing(null); setEditingId(null); };

  const save = async () => {
    if (!editing?.name?.trim()) { setMsg("❌ Nome obrigatório"); return; }
    setSaving(true); setMsg("");
    try {
      const method = editingId ? "PUT" : "POST";
      const url = editingId ? `/api/motoboys/${editingId}` : "/api/motoboys";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing) });
      if (!res.ok) throw new Error();
      const saved: Motoboy = await res.json();
      if (editingId) setMotoboys(prev => prev.map(m => m.id === editingId ? saved : m));
      else setMotoboys(prev => [...prev, saved]);
      setMsg("✅ Salvo!");
      cancel();
    } catch { setMsg("❌ Erro ao salvar."); } finally { setSaving(false); }
  };

  const toggle = async (mb: Motoboy) => {
    const res = await fetch(`/api/motoboys/${mb.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !mb.active }) });
    if (res.ok) { const saved = await res.json(); setMotoboys(prev => prev.map(m => m.id === mb.id ? saved : m)); }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover motoboy?")) return;
    const res = await fetch(`/api/motoboys/${id}`, { method: "DELETE" });
    if (res.ok) setMotoboys(prev => prev.filter(m => m.id !== id));
  };

  const payLabel = (pt: string) => PAYMENT_TYPES.find(p => p.value === pt)?.label || pt;

  const renderForm = () => {
    if (!editing) return null;
    return (
      <div style={{ background: "#fff", border: "1.5px solid #C62828", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "0 4px 12px rgba(198, 40, 40, 0.08)" }}>
        <h3 style={{ fontWeight: 800, marginBottom: 16, color: "#C62828", display: "flex", alignItems: "center", gap: 8 }}>
          {editingId ? "✏️ Editar Motoboy" : "➕ Novo Motoboy"}
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Nome *</label>
            <input className="input-field" value={editing.name || ""} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} placeholder="Nome completo" />
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Telefone</label>
            <input className="input-field" value={editing.phone || ""} onChange={e => setEditing(p => ({ ...p, phone: e.target.value }))} placeholder="(22) 99999-9999" />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Tipo de Pagamento</label>
          <select className="input-field" value={editing.paymentType || "PER_DELIVERY"} onChange={e => setEditing(p => ({ ...p, paymentType: e.target.value }))}>
            {PAYMENT_TYPES.map(pt => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          {(editing.paymentType === "DAILY_RATE" || editing.paymentType === "BOTH" || editing.paymentType === "DAILY_PLUS_FEE") && (
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Diária (R$)</label>
              <input className="input-field" type="number" step="0.5" min="0" value={editing.dailyRate ?? ""} onChange={e => setEditing(p => ({ ...p, dailyRate: e.target.value ? Number(e.target.value) : undefined }))} placeholder="Ex: 60" />
            </div>
          )}
          {(editing.paymentType === "PER_DELIVERY" || editing.paymentType === "BOTH") && (
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Por entrega (R$)</label>
              <input className="input-field" type="number" step="0.5" min="0" value={editing.perDeliveryRate ?? ""} onChange={e => setEditing(p => ({ ...p, perDeliveryRate: e.target.value ? Number(e.target.value) : undefined }))} placeholder="Ex: 5" />
            </div>
          )}
          {(editing.paymentType === "PER_KM" || editing.paymentType === "BOTH") && (
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Por KM (R$)</label>
              <input className="input-field" type="number" step="0.1" min="0" value={editing.perKmRate ?? ""} onChange={e => setEditing(p => ({ ...p, perKmRate: e.target.value ? Number(e.target.value) : undefined }))} placeholder="Ex: 1.50" />
            </div>
          )}
        </div>
        {editing.paymentType === "DAILY_PLUS_FEE" && (
          <div style={{ margin: "0 0 12px", padding: "10px 14px", background: "#EFF6FF", borderRadius: 10, border: "1.5px solid #93C5FD", fontSize: "0.82rem", color: "#1D4ED8" }}>
            💡 <strong>Diária + Taxa:</strong> O motoboy recebe a diária fixa + o valor da taxa de entrega de cada pedido (iFood ou site). As taxas são somadas automaticamente.
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Observações</label>
          <input className="input-field" value={editing.notes || ""} onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))} placeholder="Opcional..." />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ flex: 1 }}>
            <Check size={15} style={{ marginRight: 6 }} />{saving ? "Salvando..." : "Salvar"}
          </button>
          <button onClick={cancel} className="btn btn-outline" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <X size={15} /> Cancelar
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 700 }}>
      {msg && <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 12, background: msg.startsWith("✅") ? "#f0fdf4" : "#fef2f2", color: msg.startsWith("✅") ? "#16a34a" : "#dc2626", border: `1px solid ${msg.startsWith("✅") ? "#bbf7d0" : "#fecaca"}`, fontSize: "0.85rem" }}>{msg}</div>}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>🏍️ Motoboys Cadastrados ({motoboys.length})</h3>
        {!editing && <button onClick={openNew} className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}><Plus size={15} style={{ marginRight: 6 }} />Novo Motoboy</button>}
      </div>

      {/* New Motoboy Form at top if editingId is null */}
      {editing && editingId === null && renderForm()}

      {motoboys.length === 0 && !editing && (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem", background: "#F8FAFC", borderRadius: 16, border: "1.5px dashed #E2E8F0" }}>
          <Bike size={40} color="#CBD5E1" style={{ margin: "0 auto 12px" }} />
          <p style={{ color: "#94A3B8", fontWeight: 600 }}>Nenhum motoboy cadastrado ainda.</p>
          <button onClick={openNew} className="btn btn-primary" style={{ marginTop: 12 }}>+ Cadastrar Primeiro Motoboy</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {motoboys.map(mb => {
          if (editingId === mb.id) {
            return <div key={mb.id}>{renderForm()}</div>;
          }

          return (
            <div key={mb.id} style={{ background: "#fff", border: `1.5px solid ${mb.active ? "#E2E8F0" : "#FEE2E2"}`, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, opacity: mb.active ? 1 : 0.7 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: mb.active ? "#FEF3E2" : "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Bike size={20} color={mb.active ? "#C62828" : "#EF4444"} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>{mb.name}
                  {!mb.active && <span style={{ marginLeft: 8, fontSize: "0.7rem", background: "#FEE2E2", color: "#EF4444", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>Inativo</span>}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#64748B", display: "flex", gap: 12, marginTop: 2, flexWrap: "wrap" }}>
                  {mb.phone && <span><Phone size={11} style={{ marginRight: 3 }} />{mb.phone}</span>}
                  <span><DollarSign size={11} style={{ marginRight: 3 }} />{payLabel(mb.paymentType)}</span>
                  {mb.dailyRate ? <span>Diária: R${mb.dailyRate.toFixed(2)}</span> : null}
                  {mb.perDeliveryRate ? <span>R${mb.perDeliveryRate.toFixed(2)}/entrega</span> : null}
                  {mb.perKmRate ? <span>R${mb.perKmRate.toFixed(2)}/km</span> : null}
                  {mb.paymentType === "DAILY_PLUS_FEE" && <span style={{ color: "#0369A1" }}>💰 Recebe taxa do pedido</span>}
                </div>
                {/* Resumo do dia */}
                {mb.active && (mb.todayDeliveryCount ?? 0) >= 0 && (
                  <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: "0.75rem", flexWrap: "wrap" }}>
                    <span style={{ background: "#ECFDF5", color: "#059669", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>📦 Hoje: {mb.todayDeliveryCount ?? 0} entregas</span>
                    {(mb.todayDailyRate ?? 0) > 0 && <span style={{ background: "#EFF6FF", color: "#2563EB", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>📅 Diária: R${(mb.todayDailyRate ?? 0).toFixed(2)}</span>}
                    {(mb.todayDeliveryFees ?? 0) > 0 && <span style={{ background: "#FFF7ED", color: "#D97706", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>🛵 Taxas: R${(mb.todayDeliveryFees ?? 0).toFixed(2)}</span>}
                    <span style={{ background: "#F0FDF4", color: "#16A34A", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>💰 Total: R${(mb.todayTotalEarnings ?? 0).toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => toggle(mb)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, color: mb.active ? "#EF4444" : "#16A34A" }}>{mb.active ? "Pausar" : "Ativar"}</button>
                <button onClick={() => openEdit(mb)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Edit2 size={14} color="#3B82F6" /></button>
                <button onClick={() => remove(mb.id)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #FCA5A5", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={14} color="#EF4444" /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
