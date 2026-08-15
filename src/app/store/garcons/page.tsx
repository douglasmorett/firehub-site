"use client";

import { useEffect, useState, useMemo } from "react";
import { Plus, Edit2, Trash2, Users, DollarSign, Loader2, ArrowLeft, Calendar, FileText, CheckCircle2, XCircle } from "lucide-react";
import { useSession } from "next-auth/react";

interface Waiter {
  id: string;
  name: string;
  phone: string | null;
  commissionRate: number;
  active: boolean;
}

interface TableSessionData {
  id: string;
  tableNumber: number;
  tableLabel: string | null;
  openedAt: string;
  closedAt: string;
  totalPaid: number;
  serviceFee: number;
  waiterTip: number;
  waiterCommission: number;
}

export default function GarconsPage() {
  const { data: session } = useSession();
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", phone: "", commissionRate: 10, active: true });

  // Report states
  const [viewingWaiter, setViewingWaiter] = useState<Waiter | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSessions, setReportSessions] = useState<TableSessionData[]>([]);
  const [dateFilter, setDateFilter] = useState("hoje"); // hoje, ontem, periodo
  const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

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

  const fetchReport = async (waiterId: string, filter: string, start: string, end: string) => {
    setReportLoading(true);
    try {
      let queryStart = "";
      let queryEnd = "";

      if (filter === "hoje") {
        const today = new Date();
        today.setHours(0,0,0,0);
        queryStart = today.toISOString();
        const endOfDay = new Date(today);
        endOfDay.setHours(23,59,59,999);
        queryEnd = endOfDay.toISOString();
      } else if (filter === "ontem") {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0,0,0,0);
        queryStart = yesterday.toISOString();
        const endOfDay = new Date(yesterday);
        endOfDay.setHours(23,59,59,999);
        queryEnd = endOfDay.toISOString();
      } else if (filter === "periodo") {
        const sd = new Date(start);
        sd.setHours(0,0,0,0);
        queryStart = sd.toISOString();
        const ed = new Date(end);
        ed.setHours(23,59,59,999);
        queryEnd = ed.toISOString();
      }

      const res = await fetch(`/api/store/waiters/${waiterId}/report?startDate=${queryStart}&endDate=${queryEnd}`);
      if (res.ok) {
        const data = await res.json();
        setReportSessions(data.sessions || []);
      }
    } catch {
      setReportSessions([]);
    } finally {
      setReportLoading(false);
    }
  };

  const openReport = (w: Waiter) => {
    setViewingWaiter(w);
    setDateFilter("hoje");
    fetchReport(w.id, "hoje", startDate, endDate);
  };

  useEffect(() => {
    if (viewingWaiter) {
      fetchReport(viewingWaiter.id, dateFilter, startDate, endDate);
    }
  }, [dateFilter, startDate, endDate]);

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

  const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  const fmtDate = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  const reportTotals = useMemo(() => {
    return reportSessions.reduce((acc, curr) => {
      acc.totalTables++;
      acc.totalPaid += curr.totalPaid;
      acc.totalServiceFee += curr.serviceFee;
      acc.totalTip += curr.waiterTip;
      acc.totalCommission += curr.waiterCommission;
      return acc;
    }, { totalTables: 0, totalPaid: 0, totalServiceFee: 0, totalTip: 0, totalCommission: 0 });
  }, [reportSessions]);

  return (
    <div style={{ padding: 20, maxWidth: viewingWaiter ? 1200 : 1000, margin: "0 auto" }}>
      
      {/* ─── LIST VIEW ─── */}
      {!viewingWaiter ? (
        <>
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
            <div style={{ textAlign: "center", padding: 40, color: "#94A3B8" }}><Loader2 className="animate-spin mx-auto" size={32} /></div>
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
                    <tr key={w.id} style={{ borderBottom: "1px solid #E2E8F0", cursor: "pointer" }} onClick={() => openReport(w)}>
                      <td style={{ padding: "14px 16px", fontWeight: 600, color: "#1E293B" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#F0EDFF", color: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>
                            {w.name.charAt(0).toUpperCase()}
                          </div>
                          {w.name}
                        </div>
                      </td>
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
                      <td style={{ padding: "14px 16px", textAlign: "right" }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => openReport(w)} style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", padding: "6px 12px", borderRadius: 8, color: "#1E293B", fontWeight: 600, cursor: "pointer", marginRight: 8, fontSize: 12 }}>
                          <FileText size={14} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                          Relatório
                        </button>
                        <button onClick={() => openEdit(w)} style={{ background: "none", border: "none", color: "#3B82F6", cursor: "pointer", marginRight: 8 }}><Edit2 size={18} /></button>
                        <button onClick={() => handleDelete(w.id)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer" }}><Trash2 size={18} /></button>
                      </td>
                    </tr>
                  ))}
                  {waiters.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Nenhum garçom cadastrado</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        /* ─── REPORT VIEW ─── */
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button onClick={() => setViewingWaiter(null)} style={{ background: "#F1F5F9", border: "none", padding: 10, borderRadius: 8, cursor: "pointer", display: "flex" }}>
              <ArrowLeft size={20} color="#475569" />
            </button>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1E293B", display: "flex", alignItems: "center", gap: 10 }}>
              Desempenho: <span style={{ color: "#7C3AED" }}>{viewingWaiter.name}</span>
            </h1>
          </div>

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", padding: 24, marginBottom: 24 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 24 }}>
              <div style={{ display: "flex", gap: 8, background: "#F8FAFC", padding: 4, borderRadius: 10, border: "1px solid #E2E8F0" }}>
                <button onClick={() => setDateFilter("hoje")} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: dateFilter === "hoje" ? "#fff" : "transparent", color: dateFilter === "hoje" ? "#7C3AED" : "#64748B", fontWeight: 700, cursor: "pointer", boxShadow: dateFilter === "hoje" ? "0 2px 4px rgba(0,0,0,0.05)" : "none" }}>Hoje</button>
                <button onClick={() => setDateFilter("ontem")} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: dateFilter === "ontem" ? "#fff" : "transparent", color: dateFilter === "ontem" ? "#7C3AED" : "#64748B", fontWeight: 700, cursor: "pointer", boxShadow: dateFilter === "ontem" ? "0 2px 4px rgba(0,0,0,0.05)" : "none" }}>Ontem</button>
                <button onClick={() => setDateFilter("periodo")} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: dateFilter === "periodo" ? "#fff" : "transparent", color: dateFilter === "periodo" ? "#7C3AED" : "#64748B", fontWeight: 700, cursor: "pointer", boxShadow: dateFilter === "periodo" ? "0 2px 4px rgba(0,0,0,0.05)" : "none" }}>Período</button>
              </div>

              {dateFilter === "periodo" && (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#1E293B" }} />
                  <span style={{ color: "#94A3B8" }}>até</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#1E293B" }} />
                </div>
              )}
            </div>

            {/* Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
              <div style={{ background: "#F0EDFF", padding: 20, borderRadius: 12, border: "1px solid #E0D4FF" }}>
                <div style={{ fontSize: 13, color: "#6D28D9", fontWeight: 700, marginBottom: 4 }}>Mesas Atendidas</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#4C1D95" }}>{reportTotals.totalTables}</div>
              </div>
              <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Total Gasto nas Mesas</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{fmt(reportTotals.totalPaid)}</div>
              </div>
              <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Taxa de Serviço (10%)</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{fmt(reportTotals.totalServiceFee)}</div>
              </div>
              <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Gorjetas Extras</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{fmt(reportTotals.totalTip)}</div>
              </div>
              <div style={{ background: "#ECFDF5", padding: 20, borderRadius: 12, border: "1px solid #A7F3D0" }}>
                <div style={{ fontSize: 13, color: "#047857", fontWeight: 900, marginBottom: 4 }}>Comissão Final (A Receber)</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: "#065F46" }}>{fmt(reportTotals.totalCommission)}</div>
              </div>
            </div>
          </div>

          <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", marginBottom: 16 }}>Histórico de Mesas Atendidas</h3>
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Mesa</th>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Data / Fechamento</th>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Total da Conta</th>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Serviço (10%)</th>
                  <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Gorjeta Extra</th>
                  <th style={{ padding: "14px 16px", color: "#1E293B", fontWeight: 800, fontSize: 13 }}>Comissão</th>
                </tr>
              </thead>
              <tbody>
                {reportLoading ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: "center" }}><Loader2 className="animate-spin mx-auto text-slate-400" size={32} /></td></tr>
                ) : reportSessions.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Nenhuma mesa atendida no período selecionado.</td></tr>
                ) : (
                  reportSessions.map(s => (
                    <tr key={s.id} style={{ borderBottom: "1px solid #E2E8F0" }}>
                      <td style={{ padding: "14px 16px", fontWeight: 800, color: "#1E293B" }}>
                        Mesa {s.tableNumber}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#64748B", fontSize: 14 }}>{fmtDate(s.closedAt)}</td>
                      <td style={{ padding: "14px 16px", fontWeight: 600, color: "#1E293B" }}>{fmt(s.totalPaid)}</td>
                      <td style={{ padding: "14px 16px" }}>
                        {s.serviceFee > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#16A34A", fontWeight: 700, fontSize: 14 }}>
                            <CheckCircle2 size={16} /> {fmt(s.serviceFee)}
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#EF4444", fontWeight: 600, fontSize: 14 }}>
                            <XCircle size={16} /> Não pagou
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#D97706", fontWeight: 700 }}>
                        {s.waiterTip > 0 ? `+ ${fmt(s.waiterTip)}` : "-"}
                      </td>
                      <td style={{ padding: "14px 16px", fontWeight: 800, color: "#059669" }}>
                        {fmt(s.waiterCommission)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* MODAL DE CADASTRO/EDIÇÃO */}
      {showModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: "#fff", padding: 24, borderRadius: 16, width: "90%", maxWidth: 400, boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <h2 style={{ margin: "0 0 20px 0", fontSize: 20 }}>{editingId ? "Editar Garçom" : "Novo Garçom"}</h2>
            
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>Nome</label>
                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 14, fontFamily: "inherit" }} />
              </div>
              
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>Telefone</label>
                <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 14, fontFamily: "inherit" }} />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={formData.active} onChange={e => setFormData({ ...formData, active: e.target.checked })} style={{ width: 18, height: 18, accentColor: "#7C3AED" }} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Ativo no sistema</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#F8FAFC", cursor: "pointer", fontWeight: 700, color: "#64748B" }}>
                  Cancelar
                </button>
                <button type="submit"
                  style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: "#7C3AED", color: "#fff", cursor: "pointer", fontWeight: 800 }}>
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
