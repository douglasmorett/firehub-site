"use client";
import { useState, useEffect, useMemo } from "react";
import {
  Users, UserPlus, DollarSign, Calendar, Filter, FileText, CheckCircle2,
  AlertTriangle, Search, Trash2, Edit, CreditCard, RefreshCw, X, ShieldAlert
} from "lucide-react";

type Employee = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  cpf: string | null;
  creditLimit: number | null;
  active: boolean;
  currentDebt: number;
  totalOrdersAmount: number;
  totalPaymentsAmount: number;
  totalOrdersCount: number;
  periodOrdersAmount: number;
  periodPaymentsAmount: number;
  periodOrdersCount: number;
};

type StatementItem = {
  id: string;
  type: "ORDER" | "PAYMENT";
  title: string;
  amount: number;
  date: string;
  notes: string | null;
  itemsSummary: string | null;
};

export default function FuncionariosPage() {
  const [enabled, setEnabled] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all" | "custom">("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Modais
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);
  const [empForm, setEmpForm] = useState({ name: "", role: "", phone: "", cpf: "", creditLimit: "" });
  const [savingEmp, setSavingEmp] = useState(false);

  const [abateEmp, setAbateEmp] = useState<Employee | null>(null);
  const [abateAmount, setAbateAmount] = useState("");
  const [abateNotes, setAbateNotes] = useState("");
  const [savingAbate, setSavingAbate] = useState(false);

  const [statementEmp, setStatementEmp] = useState<Employee | null>(null);
  const [statementData, setStatementData] = useState<StatementItem[]>([]);
  const [loadingStatement, setLoadingStatement] = useState(false);

  // Carregar status do recurso
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/store-settings/employee-account");
      if (res.ok) {
        const data = await res.json();
        setEnabled(Boolean(data.employeeAccountEnabled));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Carregar funcionários
  const fetchEmployees = async () => {
    setLoading(true);
    try {
      let query = "";
      const now = new Date();
      if (dateRange === "today") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        query = `?fromDate=${start}`;
      } else if (dateRange === "week") {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        query = `?fromDate=${start}`;
      } else if (dateRange === "month") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        query = `?fromDate=${start}`;
      } else if (dateRange === "custom" && fromDate && toDate) {
        query = `?fromDate=${new Date(fromDate).toISOString()}&toDate=${new Date(toDate).toISOString()}`;
      }

      const res = await fetch(`/api/store/employees${query}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [dateRange, fromDate, toDate]);

  // Toggle do recurso
  const handleToggle = async (newVal: boolean) => {
    setEnabled(newVal);
    try {
      await fetch("/api/store-settings/employee-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newVal }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Salvar/Editar funcionário
  const handleSaveEmployee = async () => {
    if (!empForm.name.trim()) return alert("Informe o nome do funcionário");
    setSavingEmp(true);
    try {
      if (editingEmp) {
        await fetch(`/api/store/employees/${editingEmp.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: empForm.name,
            role: empForm.role,
            phone: empForm.phone,
            cpf: empForm.cpf,
            creditLimit: empForm.creditLimit ? parseFloat(empForm.creditLimit) : null,
          }),
        });
      } else {
        await fetch("/api/store/employees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: empForm.name,
            role: empForm.role,
            phone: empForm.phone,
            cpf: empForm.cpf,
            creditLimit: empForm.creditLimit ? parseFloat(empForm.creditLimit) : null,
          }),
        });
      }
      setShowAddModal(false);
      setEditingEmp(null);
      setEmpForm({ name: "", role: "", phone: "", cpf: "", creditLimit: "" });
      fetchEmployees();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingEmp(false);
    }
  };

  // Salvar Abatimento (Dar Baixa na Dívida)
  const handleAbate = async () => {
    if (!abateEmp) return;
    const amount = parseFloat(abateAmount);
    if (isNaN(amount) || amount <= 0) return alert("Informe um valor válido para o abatimento");
    setSavingAbate(true);
    try {
      const res = await fetch(`/api/store/employees/${abateEmp.id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, notes: abateNotes }),
      });
      if (res.ok) {
        setAbateEmp(null);
        setAbateAmount("");
        setAbateNotes("");
        fetchEmployees();
      } else {
        const err = await res.json();
        alert(err.error || "Erro ao registrar abatimento");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingAbate(false);
    }
  };

  // Abrir Extrato
  const handleOpenStatement = async (emp: Employee) => {
    setStatementEmp(emp);
    setLoadingStatement(true);
    try {
      const res = await fetch(`/api/store/employees/${emp.id}/statement`);
      if (res.ok) {
        const data = await res.json();
        setStatementData(data.statement || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStatement(false);
    }
  };

  // Desativar funcionário
  const handleDeleteEmp = async (id: string, name: string) => {
    if (!confirm(`Tem certeza que deseja desativar o funcionário ${name}?`)) return;
    try {
      await fetch(`/api/store/employees/${id}`, { method: "DELETE" });
      fetchEmployees();
    } catch (e) {
      console.error(e);
    }
  };

  // Métricas gerais
  const totalDebtSum = useMemo(() => {
    return employees.reduce((sum, e) => sum + (e.currentDebt || 0), 0);
  }, [employees]);

  const debtorCount = useMemo(() => {
    return employees.filter((e) => (e.currentDebt || 0) > 0).length;
  }, [employees]);

  const periodAbatedSum = useMemo(() => {
    return employees.reduce((sum, e) => sum + (e.periodPaymentsAmount || 0), 0);
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(s) ||
        (e.role && e.role.toLowerCase().includes(s)) ||
        (e.cpf && e.cpf.includes(s))
    );
  }, [employees, search]);

  const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

  return (
    <div style={{ padding: "20px", maxWidth: 1200, margin: "0 auto", fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#0F172A", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={28} color="#EA1D2C" />
            Conta Funcionário (Fiado)
          </h1>
          <p style={{ color: "#64748B", fontSize: "0.88rem", margin: "4px 0 0" }}>
            Gerencie débitos de funcionários, vendas presenciais fiadas e registro de baixas/abatimentos.
          </p>
        </div>

        {/* Toggle Ativação do Módulo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: enabled ? "#F0FDF4" : "#F8FAFC",
            border: `1.5px solid ${enabled ? "#BBF7D0" : "#E2E8F0"}`,
            padding: "8px 16px",
            borderRadius: 12,
          }}
        >
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: enabled ? "#15803D" : "#64748B" }}>
            {enabled ? "🟢 Módulo Ativo no Balcão" : "⚪ Módulo Desativado"}
          </span>
          <button
            onClick={() => handleToggle(!enabled)}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              background: enabled ? "#16A34A" : "#CBD5E1",
              border: "none",
              cursor: "pointer",
              position: "relative",
              transition: "0.2s",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#fff",
                position: "absolute",
                top: 3,
                left: enabled ? 23 : 3,
                transition: "0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }}
            />
          </button>
        </div>
      </div>

      {/* Cards de Métricas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 20 }}>
        {/* Card 1: Dívida Acumulada */}
        <div style={{ background: "linear-gradient(135deg, #FEF2F2, #FFF1F2)", border: "1.5px solid #FECACA", borderRadius: 14, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#991B1B", textTransform: "uppercase" }}>Dívida Acumulada Total</span>
            <AlertTriangle size={18} color="#EA1D2C" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#991B1B" }}>{fmt(totalDebtSum)}</div>
          <div style={{ fontSize: "0.75rem", color: "#B91C1C", marginTop: 4 }}>
            {debtorCount} {debtorCount === 1 ? "colaborador com débito" : "colaboradores com débito"}
          </div>
        </div>

        {/* Card 2: Abatimentos no Período */}
        <div style={{ background: "linear-gradient(135deg, #F0FDF4, #DCFCE7)", border: "1.5px solid #BBF7D0", borderRadius: 14, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#166534", textTransform: "uppercase" }}>Abatidos / Pagos (Período)</span>
            <DollarSign size={18} color="#16A34A" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#15803D" }}>{fmt(periodAbatedSum)}</div>
          <div style={{ fontSize: "0.75rem", color: "#166534", marginTop: 4 }}>Baixas registradas no extrato</div>
        </div>

        {/* Card 3: Total Funcionários */}
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Cadastrados</span>
            <Users size={18} color="#64748B" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#0F172A" }}>{employees.length}</div>
          <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 4 }}>Equipe ativa</div>
        </div>
      </div>

      {/* Controles: Busca, Filtro de Data e Cadastrar */}
      <div
        style={{
          background: "#fff",
          border: "1.5px solid #E2E8F0",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 260 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, cargo ou CPF..."
              style={{
                width: "100%",
                padding: "8px 12px 8px 32px",
                borderRadius: 10,
                border: "1.5px solid #E2E8F0",
                fontSize: "0.85rem",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Filtro de datas */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Filter size={15} color="#64748B" />
          {(["today", "week", "month", "all", "custom"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setDateRange(mode)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "none",
                fontSize: "0.78rem",
                fontWeight: 700,
                cursor: "pointer",
                background: dateRange === mode ? "#EA1D2C" : "#F1F5F9",
                color: dateRange === mode ? "#fff" : "#64748B",
              }}
            >
              {mode === "today" ? "Hoje" : mode === "week" ? "7 Dias" : mode === "month" ? "Este Mês" : mode === "all" ? "Tudo" : "📅 Personalizado"}
            </button>
          ))}

          {dateRange === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#FEF2F2", padding: "4px 8px", borderRadius: 8, border: "1px solid #FECACA" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#991B1B" }}>De:</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.78rem", outline: "none", fontFamily: "inherit" }}
              />
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#991B1B" }}>Até:</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.78rem", outline: "none", fontFamily: "inherit" }}
              />
            </div>
          )}
        </div>

        <button
          onClick={() => {
            setEditingEmp(null);
            setEmpForm({ name: "", role: "", phone: "", cpf: "", creditLimit: "" });
            setShowAddModal(true);
          }}
          style={{
            padding: "9px 18px",
            borderRadius: 10,
            border: "none",
            background: "#EA1D2C",
            color: "#fff",
            fontWeight: 700,
            fontSize: "0.85rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <UserPlus size={16} /> Cadastrar Funcionário
        </button>
      </div>

      {/* Lista de Funcionários */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#64748B" }}>Carregando colaboradores...</div>
      ) : filteredEmployees.length === 0 ? (
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "3rem 1rem", textAlign: "center" }}>
          <Users size={40} color="#CBD5E1" style={{ margin: "0 auto 12px" }} />
          <h3 style={{ margin: 0, fontSize: "1rem", color: "#475569" }}>Nenhum funcionário encontrado</h3>
          <p style={{ fontSize: "0.82rem", color: "#94A3B8", margin: "4px 0 16px" }}>Cadastre sua equipe para gerenciar contas de consumo interno.</p>
          <button
            onClick={() => {
              setEditingEmp(null);
              setEmpForm({ name: "", role: "", phone: "", cpf: "", creditLimit: "" });
              setShowAddModal(true);
            }}
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#EA1D2C", color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}
          >
            + Adicionar Colaborador
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filteredEmployees.map((emp) => {
            const hasDebt = emp.currentDebt > 0;
            return (
              <div
                key={emp.id}
                style={{
                  background: "#fff",
                  border: `1.5px solid ${hasDebt ? "#FECACA" : "#E2E8F0"}`,
                  borderRadius: 14,
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: hasDebt ? "0 4px 12px rgba(239,68,68,0.06)" : "none",
                }}
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0F172A" }}>{emp.name}</h3>
                      <span style={{ fontSize: "0.75rem", background: "#F1F5F9", color: "#475569", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>
                        {emp.role || "Funcionário"}
                      </span>
                    </div>

                    {/* Badge Dívida */}
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: "0.7rem", fontWeight: 700, color: hasDebt ? "#991B1B" : "#166534", textTransform: "uppercase" }}>
                        {hasDebt ? "Débito Pendente" : "Quitado"}
                      </span>
                      <div style={{ fontSize: "1.25rem", fontWeight: 900, color: hasDebt ? "#DC2626" : "#16A34A" }}>
                        {fmt(emp.currentDebt)}
                      </div>
                    </div>
                  </div>

                  {/* Detalhes de consumo */}
                  <div style={{ fontSize: "0.78rem", color: "#64748B", background: "#F8FAFC", padding: "8px 10px", borderRadius: 8, margin: "10px 0 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div>
                      Consumo Período: <strong style={{ color: "#334155" }}>{fmt(emp.periodOrdersAmount)}</strong> ({emp.periodOrdersCount}x)
                    </div>
                    <div>
                      Abatido Período: <strong style={{ color: "#16A34A" }}>{fmt(emp.periodPaymentsAmount)}</strong>
                    </div>
                    {emp.creditLimit && (
                      <div style={{ gridColumn: "1/-1", color: emp.currentDebt > emp.creditLimit ? "#DC2626" : "#64748B" }}>
                        Limite Crédito: <strong>{fmt(emp.creditLimit)}</strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* Botões de Ação */}
                <div style={{ display: "flex", gap: 6, paddingTop: 10, borderTop: "1px solid #F1F5F9" }}>
                  <button
                    onClick={() => {
                      setAbateEmp(emp);
                      setAbateAmount(emp.currentDebt > 0 ? String(emp.currentDebt) : "");
                      setAbateNotes("");
                    }}
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "none",
                      background: "#16A34A",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                    }}
                  >
                    <DollarSign size={14} /> Abater Dívida
                  </button>

                  <button
                    onClick={() => handleOpenStatement(emp)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1.5px solid #CBD5E1",
                      background: "#fff",
                      color: "#334155",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <FileText size={14} /> Extrato
                  </button>

                  <button
                    onClick={() => {
                      setEditingEmp(emp);
                      setEmpForm({
                        name: emp.name,
                        role: emp.role || "",
                        phone: emp.phone || "",
                        cpf: emp.cpf || "",
                        creditLimit: emp.creditLimit ? String(emp.creditLimit) : "",
                      });
                      setShowAddModal(true);
                    }}
                    style={{ padding: "8px", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", cursor: "pointer" }}
                  >
                    <Edit size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Cadastrar / Editar Funcionário */}
      {showAddModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 450, padding: 20, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.1rem" }}>{editingEmp ? "Editar Funcionário" : "Novo Funcionário"}</h3>
              <button onClick={() => setShowAddModal(false)} style={{ border: "none", background: "none", cursor: "pointer", color: "#64748B" }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Nome Completo *</label>
                <input
                  value={empForm.name}
                  onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })}
                  placeholder="Ex: João Silva"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Cargo / Função</label>
                <input
                  value={empForm.role}
                  onChange={(e) => setEmpForm({ ...empForm, role: e.target.value })}
                  placeholder="Ex: Cozinheiro, Atendente, Motoboy"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Telefone</label>
                  <input
                    value={empForm.phone}
                    onChange={(e) => setEmpForm({ ...empForm, phone: e.target.value })}
                    placeholder="(00) 00000-0000"
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>CPF</label>
                  <input
                    value={empForm.cpf}
                    onChange={(e) => setEmpForm({ ...empForm, cpf: e.target.value })}
                    placeholder="000.000.000-00"
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Limite de Crédito Fiado (R$ opcional)</label>
                <input
                  type="number"
                  value={empForm.creditLimit}
                  onChange={(e) => setEmpForm({ ...empForm, creditLimit: e.target.value })}
                  placeholder="Ex: 300.00"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEmployee}
                disabled={savingEmp}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#EA1D2C", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
              >
                {savingEmp ? "Salvar..." : "Salvar Funcionário"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Abater Dívida */}
      {abateEmp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, padding: 20, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.1rem", color: "#166534" }}>💸 Registar Abatimento / Baixa</h3>
              <button onClick={() => setAbateEmp(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#64748B" }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
              <div style={{ fontSize: "0.82rem", color: "#166534" }}>Colaborador: <strong>{abateEmp.name}</strong></div>
              <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#15803D", marginTop: 2 }}>Dívida Atual: {fmt(abateEmp.currentDebt)}</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Valor do Abatimento (R$) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={abateAmount}
                  onChange={(e) => setAbateAmount(e.target.value)}
                  placeholder="Ex: 300.00"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #16A34A", fontSize: "1.1rem", fontWeight: 800, outline: "none" }}
                />
                {abateAmount && Number(abateAmount) > 0 && (
                  <div style={{ fontSize: "0.75rem", color: "#15803D", fontWeight: 700, marginTop: 4 }}>
                    Novo Saldo Restante: {fmt(Math.max(0, abateEmp.currentDebt - Number(abateAmount)))}
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Observação / Forma de Pagamento</label>
                <input
                  value={abateNotes}
                  onChange={(e) => setAbateNotes(e.target.value)}
                  placeholder="Ex: Abatido no holerite, Pago em PIX, Dinheiro"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", outline: "none" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                onClick={() => setAbateEmp(null)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={handleAbate}
                disabled={savingAbate}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#16A34A", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}
              >
                {savingAbate ? "Confirmando..." : "Confirmar Baixa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Extrato do Funcionário */}
      {statementEmp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 550, maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 20, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.1rem" }}>Extrato — {statementEmp.name}</h3>
                <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Histórico de consumos e baixas registradas</span>
              </div>
              <button onClick={() => setStatementEmp(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#64748B" }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
              {loadingStatement ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "#64748B" }}>Carregando extrato...</div>
              ) : statementData.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem", color: "#94A3B8" }}>Nenhuma movimentação registrada.</div>
              ) : (
                statementData.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1.5px solid ${item.type === "ORDER" ? "#FECACA" : "#BBF7D0"}`,
                      background: item.type === "ORDER" ? "#FFF1F2" : "#F0FDF4",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.85rem", color: item.type === "ORDER" ? "#991B1B" : "#15803D" }}>
                        {item.title}
                      </div>
                      {item.itemsSummary && <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: 2 }}>{item.itemsSummary}</div>}
                      {item.notes && <div style={{ fontSize: "0.72rem", color: "#64748B", fontStyle: "italic", marginTop: 2 }}>Obs: {item.notes}</div>}
                      <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>
                        {new Date(item.date).toLocaleString("pt-BR")}
                      </div>
                    </div>

                    <div style={{ fontWeight: 900, fontSize: "0.95rem", color: item.type === "ORDER" ? "#DC2626" : "#16A34A" }}>
                      {item.type === "ORDER" ? `+ ${fmt(item.amount)}` : `- ${fmt(item.amount)}`}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid #E2E8F0", textAlign: "right" }}>
              <button
                onClick={() => setStatementEmp(null)}
                style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: "#475569", color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
