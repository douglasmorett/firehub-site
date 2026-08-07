"use client";

import { useState, useEffect, useMemo } from "react";
import {
  FileText, ShieldCheck, Check, AlertTriangle, Search, Plus, Trash2,
  DollarSign, RefreshCw, Layers, Edit3, Settings, CheckCircle2, ChevronRight,
  Info, Sparkles, Receipt, Filter, ArrowUpRight, Calendar, Download, Printer, Copy, ExternalLink, Eye
} from "lucide-react";

type FiscalConfig = {
  enabled: boolean;
  ambiente: "homologacao" | "producao";
  cnpj: string;
  ie: string;
  cstDefault: string;
  ncmDefault: string;
  autoEmitPaymentMethods: string[];
};

type FiscalItem = {
  name: string;
  price: number;
  category: "BEBIDA" | "ALIMENTO" | "OUTRO";
  ncm?: string;
};

type ComboProduct = {
  id: string;
  name: string;
  price: number;
  imageUrl?: string | null;
  category: string;
  isCombo: boolean;
  fiscalBreakdown?: FiscalItem[] | null;
  comboGroups?: any[];
};

type FiscalOrder = {
  id: string;
  dailyOrderNumber?: number | string | null;
  customerName: string;
  customerCpfCnpj?: string;
  customerPhone?: string;
  customerAddress?: string;
  paymentMethod: string;
  totalAmount: number;
  deliveryFee?: number;
  createdAt: string;
  fiscalStatus?: string | null;
  fiscalInfo?: {
    nfceNumber: string;
    serie: string;
    nfceKey: string;
    protocol: string;
    emittedAt: string;
    ambiente: string;
    impostosAproximados: number;
    xmlUrl: string;
    pdfUrl: string;
    items: any[];
  };
};

const PAYMENT_METHOD_OPTIONS = [
  { key: "MONEY", label: "💵 Dinheiro", desc: "Pagamentos em espécie no balcão / entrega" },
  { key: "PIX", label: "⚡ PIX", desc: "Chave Pix online ou QR Code no balcão" },
  { key: "CREDIT_CARD", label: "💳 Cartão de Crédito", desc: "Crédito presencial ou online" },
  { key: "DEBIT_CARD", label: "💳 Cartão de Débito", desc: "Débito maquininha presencial" },
  { key: "VOUCHER", label: "🎟️ Voucher / Refeição", desc: "VR, VA, Alelo, Sodexo, Ticket" },
];

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export default function StoreFiscalPage() {
  const [activeTab, setActiveTab] = useState<"invoices" | "combos" | "config">("invoices");
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);

  const [fiscalConfig, setFiscalConfig] = useState<FiscalConfig>({
    enabled: false,
    ambiente: "homologacao",
    cnpj: "",
    ie: "",
    cstDefault: "102",
    ncmDefault: "2106.90.90",
    autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"],
  });

  // Combos data
  const [combos, setCombos] = useState<ComboProduct[]>([]);
  const [searchCombo, setSearchCombo] = useState("");
  const [editingCombo, setEditingCombo] = useState<ComboProduct | null>(null);
  const [fiscalItemsDraft, setFiscalItemsDraft] = useState<FiscalItem[]>([]);
  const [savingComboFiscal, setSavingComboFiscal] = useState(false);

  // Invoices data & Filters
  const [orders, setOrders] = useState<FiscalOrder[]>([]);
  const [searchInvoice, setSearchInvoice] = useState("");
  const [selectedInvoiceModal, setSelectedInvoiceModal] = useState<FiscalOrder | null>(null);

  // Date Filter State
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all" | "custom">("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterPaymentMethod, setFilterPaymentMethod] = useState<string>("ALL");

  // Load initial data
  useEffect(() => {
    fetchFiscalData();
    fetchCombos();
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [dateRange, fromDate, toDate, filterStatus, filterPaymentMethod]);

  const fetchFiscalData = async () => {
    try {
      const res = await fetch("/api/store/fiscal");
      if (res.ok) {
        const data = await res.json();
        setStoreName(data.storeName || "");
        setCpfCnpj(data.cpfCnpj || "");
        if (data.fiscalConfig) {
          setFiscalConfig(prev => ({ ...prev, ...data.fiscalConfig }));
        }
      }
    } catch (err) {
      console.error("Erro ao buscar dados fiscais:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCombos = async () => {
    try {
      const res = await fetch("/api/store/fiscal/combos");
      if (res.ok) {
        const data = await res.json();
        setCombos(data.combos || []);
      }
    } catch (err) {
      console.error("Erro ao buscar combos:", err);
    }
  };

  const fetchInvoices = async () => {
    try {
      let url = "/api/store/fiscal/invoices?";
      const params = new URLSearchParams();

      if (dateRange === "today") {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        params.append("fromDate", `${yyyy}-${mm}-${dd}`);
        params.append("toDate", `${yyyy}-${mm}-${dd}`);
      } else if (dateRange === "week") {
        const now = new Date();
        const past7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        params.append("fromDate", past7.toISOString().split("T")[0]);
        params.append("toDate", now.toISOString().split("T")[0]);
      } else if (dateRange === "month") {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        params.append("fromDate", firstDay.toISOString().split("T")[0]);
        params.append("toDate", now.toISOString().split("T")[0]);
      } else if (dateRange === "custom" && fromDate && toDate) {
        params.append("fromDate", fromDate);
        params.append("toDate", toDate);
      }

      if (filterStatus !== "ALL") params.append("status", filterStatus);
      if (filterPaymentMethod !== "ALL") params.append("paymentMethod", filterPaymentMethod);

      const res = await fetch(url + params.toString());
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error("Erro ao buscar notas fiscais:", err);
    }
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch("/api/store/fiscal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fiscalConfig),
      });
      if (res.ok) {
        alert("Configurações Fiscais salvas com sucesso! 🛡️");
      } else {
        alert("Erro ao salvar configurações.");
      }
    } catch {
      alert("Erro de conexão.");
    } finally {
      setSavingConfig(false);
    }
  };

  const togglePaymentMethod = (pmKey: string) => {
    setFiscalConfig(prev => {
      const current = prev.autoEmitPaymentMethods || [];
      const exists = current.includes(pmKey);
      const next = exists ? current.filter(k => k !== pmKey) : [...current, pmKey];
      return { ...prev, autoEmitPaymentMethods: next };
    });
  };

  const openComboFiscalModal = (combo: ComboProduct) => {
    setEditingCombo(combo);
    if (combo.fiscalBreakdown && combo.fiscalBreakdown.length > 0) {
      setFiscalItemsDraft(combo.fiscalBreakdown);
    } else {
      const draft: FiscalItem[] = [];
      if (combo.comboGroups && combo.comboGroups.length > 0) {
        let remainingPrice = combo.price;
        const totalGroups = combo.comboGroups.length;
        const perGroupPrice = Number((combo.price / totalGroups).toFixed(2));

        combo.comboGroups.forEach((cg, idx) => {
          const isLast = idx === totalGroups - 1;
          const price = isLast ? Number(remainingPrice.toFixed(2)) : perGroupPrice;
          remainingPrice -= price;

          const isBeverageGroup = /bebida|refrigerante|suco|cerveja|lata|pet/i.test(cg.title || "");
          draft.push({
            name: cg.title || `Item ${idx + 1} do Combo`,
            price: price,
            category: isBeverageGroup ? "BEBIDA" : "ALIMENTO",
            ncm: isBeverageGroup ? "2202.10.00" : "2106.90.90",
          });
        });
      } else {
        const bevPrice = Number((combo.price * 0.35).toFixed(2));
        const foodPrice = Number((combo.price - bevPrice).toFixed(2));
        draft.push(
          { name: "Bebida / Refrigerante (ST)", price: bevPrice, category: "BEBIDA", ncm: "2202.10.00" },
          { name: "Lanche / Prato Principal", price: foodPrice, category: "ALIMENTO", ncm: "2106.90.90" }
        );
      }
      setFiscalItemsDraft(draft);
    }
  };

  const handleSaveComboFiscal = async () => {
    if (!editingCombo) return;
    setSavingComboFiscal(true);
    try {
      const res = await fetch(`/api/store/fiscal/combos/${editingCombo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalBreakdown: fiscalItemsDraft }),
      });
      if (res.ok) {
        alert("Engenharia Fiscal do Combo salva com sucesso! ⚡");
        setEditingCombo(null);
        fetchCombos();
      } else {
        alert("Erro ao salvar engenharia do combo.");
      }
    } catch {
      alert("Erro de conexão.");
    } finally {
      setSavingComboFiscal(false);
    }
  };

  // Filtered Invoices in memory for instant text search
  const filteredOrders = useMemo(() => {
    if (!searchInvoice.trim()) return orders;
    const term = searchInvoice.trim().toLowerCase();
    return orders.filter(
      o =>
        o.customerName.toLowerCase().includes(term) ||
        String(o.dailyOrderNumber).includes(term) ||
        o.id.toLowerCase().includes(term) ||
        (o.fiscalInfo?.nfceNumber && o.fiscalInfo.nfceNumber.includes(term)) ||
        (o.fiscalInfo?.nfceKey && o.fiscalInfo.nfceKey.includes(term))
    );
  }, [orders, searchInvoice]);

  const periodStats = useMemo(() => {
    const totalAmount = filteredOrders.reduce((s, o) => s + o.totalAmount, 0);
    const totalImpostos = filteredOrders.reduce((s, o) => s + (o.fiscalInfo?.impostosAproximados || 0), 0);
    const totalEmitted = filteredOrders.filter(o => o.fiscalStatus === "EMITTED").length;
    return { totalAmount, totalImpostos, totalEmitted, totalCount: filteredOrders.length };
  }, [filteredOrders]);

  const draftTotalSum = fiscalItemsDraft.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const comboPriceDiff = editingCombo ? Number((draftTotalSum - editingCombo.price).toFixed(2)) : 0;
  const isDraftValid = Math.abs(comboPriceDiff) < 0.02;

  const filteredCombos = combos.filter(c => c.name.toLowerCase().includes(searchCombo.toLowerCase()));
  const configuredCombosCount = combos.filter(c => c.fiscalBreakdown && c.fiscalBreakdown.length > 0).length;

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem 1rem", fontFamily: "inherit" }}>
      {/* Top Banner & Title */}
      <div
        style={{
          background: "linear-gradient(135deg, #0F172A, #1E293B)",
          borderRadius: 20,
          padding: "1.5rem 2rem",
          color: "#fff",
          marginBottom: "1.5rem",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Receipt size={28} color="#38BDF8" />
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.5px" }}>
              Notas Fiscais Geradas & Engenharia Tributária
            </h1>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 800,
                padding: "3px 10px",
                borderRadius: 20,
                background: fiscalConfig.enabled ? "#16A34A" : "#64748B",
                color: "#fff",
              }}
            >
              {fiscalConfig.enabled ? "🟢 MÓDULO ATIVO" : "⚪ DESATIVADO"}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#94A3B8" }}>
            Consulte todas as notas fiscais emitidas (NFC-e), acompanhe chaves de acesso SEFAZ e gerencie a engenharia tributária de combos.
          </p>
        </div>

        {/* Quick Toggle Status */}
        <div
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 14,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <span style={{ fontSize: "0.72rem", color: "#CBD5E1", display: "block" }}>Emissão Automática</span>
            <strong style={{ fontSize: "0.88rem", color: fiscalConfig.enabled ? "#4ADE80" : "#94A3B8" }}>
              {fiscalConfig.enabled ? "Ativada no Sistema" : "Pausada"}
            </strong>
          </div>
          <button
            onClick={() => setFiscalConfig(p => ({ ...p, enabled: !p.enabled }))}
            style={{
              width: 48,
              height: 26,
              borderRadius: 13,
              background: fiscalConfig.enabled ? "#22C55E" : "#475569",
              border: "none",
              cursor: "pointer",
              position: "relative",
              transition: "0.2s",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#fff",
                position: "absolute",
                top: 3,
                left: fiscalConfig.enabled ? 25 : 3,
                transition: "0.2s",
                boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
              }}
            />
          </button>
        </div>
      </div>

      {/* Metric Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Notas Emitidas (Período)</span>
            <Receipt size={18} color="#0284C7" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#0F172A" }}>
            {periodStats.totalEmitted} <span style={{ fontSize: "0.9rem", color: "#64748B", fontWeight: 500 }}>/ {periodStats.totalCount} nfs</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#0284C7", marginTop: 4, fontWeight: 600 }}>
            {periodStats.totalCount > 0 ? `${Math.round((periodStats.totalEmitted / periodStats.totalCount) * 100)}% autorizadas` : "Nenhum pedido"}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1.5px solid #BBF7D0", borderRadius: 16, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#166534", textTransform: "uppercase" }}>Faturamento em Notas</span>
            <DollarSign size={18} color="#16A34A" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#15803D" }}>
            {fmt(periodStats.totalAmount)}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#166534", marginTop: 4, fontWeight: 600 }}>
            Volume fiscal do período selecionado
          </div>
        </div>

        <div style={{ background: "linear-gradient(135deg, #EFF6FF, #DBEAFE)", border: "1.5px solid #BFDBFE", borderRadius: 16, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1E40AF", textTransform: "uppercase" }}>Tributos Estimados (IBPT)</span>
            <Sparkles size={18} color="#2563EB" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#1E3A8A" }}>{fmt(periodStats.totalImpostos)}</div>
          <div style={{ fontSize: "0.75rem", color: "#1E40AF", marginTop: 4, fontWeight: 600 }}>
            Lei da Transparência Fiscal (~13,45%)
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div style={{ display: "flex", borderBottom: "2px solid #E2E8F0", marginBottom: 24, gap: 8 }}>
        <button
          onClick={() => setActiveTab("invoices")}
          style={{
            padding: "10px 18px",
            border: "none",
            background: "none",
            fontSize: "0.9rem",
            fontWeight: activeTab === "invoices" ? 800 : 600,
            color: activeTab === "invoices" ? "#EA1D2C" : "#64748B",
            borderBottom: activeTab === "invoices" ? "3px solid #EA1D2C" : "3px solid transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Receipt size={18} /> 📄 Notas Fiscais Geradas
        </button>

        <button
          onClick={() => setActiveTab("combos")}
          style={{
            padding: "10px 18px",
            border: "none",
            background: "none",
            fontSize: "0.9rem",
            fontWeight: activeTab === "combos" ? 800 : 600,
            color: activeTab === "combos" ? "#EA1D2C" : "#64748B",
            borderBottom: activeTab === "combos" ? "3px solid #EA1D2C" : "3px solid transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Layers size={18} /> Engenharia de Cardápio Fiscal
        </button>

        <button
          onClick={() => setActiveTab("config")}
          style={{
            padding: "10px 18px",
            border: "none",
            background: "none",
            fontSize: "0.9rem",
            fontWeight: activeTab === "config" ? 800 : 600,
            color: activeTab === "config" ? "#EA1D2C" : "#64748B",
            borderBottom: activeTab === "config" ? "3px solid #EA1D2C" : "3px solid transparent",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Settings size={18} /> Configurações & Regras de Emissão
        </button>
      </div>

      {/* TAB 1: NOTAS FISCAIS GERADAS (PERÍODO & DETALHES) */}
      {activeTab === "invoices" && (
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: "1.25rem" }}>
          {/* Controls Bar: Date Period & Filters */}
          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 14, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              {/* Date range presets */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Filter size={15} color="#64748B" />
                <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", marginRight: 4 }}>Período:</span>
                {(["today", "week", "month", "all", "custom"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setDateRange(mode)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 8,
                      border: "none",
                      fontSize: "0.78rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: dateRange === mode ? "#EA1D2C" : "#E2E8F0",
                      color: dateRange === mode ? "#fff" : "#475569",
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

              {/* Status and Payment Filters */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.78rem", fontWeight: 600, outline: "none", cursor: "pointer" }}
                >
                  <option value="ALL">Status: Todos</option>
                  <option value="EMITTED">🟢 Autorizadas</option>
                  <option value="PENDING">⏳ Pendentes</option>
                </select>

                <select
                  value={filterPaymentMethod}
                  onChange={e => setFilterPaymentMethod(e.target.value)}
                  style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.78rem", fontWeight: 600, outline: "none", cursor: "pointer" }}
                >
                  <option value="ALL">Pagamento: Todos</option>
                  <option value="PIX">⚡ PIX</option>
                  <option value="DINHEIRO">💵 Dinheiro</option>
                  <option value="CREDITO">💳 Cartão de Crédito</option>
                  <option value="DEBITO">💳 Cartão de Débito</option>
                  <option value="VOUCHER">🎟️ Voucher</option>
                </select>
              </div>
            </div>

            {/* Search Input */}
            <div style={{ marginTop: 10, position: "relative" }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
              <input
                value={searchInvoice}
                onChange={e => setSearchInvoice(e.target.value)}
                placeholder="Buscar por nº da nota, chave SEFAZ, pedido ou nome do cliente..."
                style={{
                  width: "100%",
                  padding: "7px 12px 7px 32px",
                  borderRadius: 8,
                  border: "1.5px solid #CBD5E1",
                  fontSize: "0.82rem",
                  outline: "none",
                  background: "#fff",
                }}
              />
            </div>
          </div>

          {/* Table of Invoices */}
          {filteredOrders.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "#94A3B8" }}>
              <Receipt size={40} style={{ margin: "0 auto 12px" }} />
              <p style={{ margin: 0, fontWeight: 700 }}>Nenhuma nota fiscal encontrada para os filtros selecionados.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC", textTransform: "uppercase", fontSize: "0.72rem", color: "#64748B" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #E2E8F0" }}>Nota Fiscal (NFC-e)</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #E2E8F0" }}>Pedido Vinculado</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #E2E8F0" }}>Data / Hora</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #E2E8F0" }}>Cliente</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #E2E8F0" }}>Forma Pgto</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", borderBottom: "2px solid #E2E8F0" }}>Valor Fiscal</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: "2px solid #E2E8F0" }}>Status SEFAZ</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: "2px solid #E2E8F0" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(order => {
                    const createdDate = new Date(order.createdAt);
                    const dateStr = createdDate.toLocaleDateString("pt-BR") + " " + createdDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <tr key={order.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <strong style={{ color: "#0F172A", display: "block" }}>NFC-e nº {order.fiscalInfo?.nfceNumber}</strong>
                          <span style={{ fontSize: "0.7rem", color: "#64748B" }}>Série {order.fiscalInfo?.serie || "1"}</span>
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 800, color: "#EA1D2C" }}>
                          #{order.dailyOrderNumber || order.id.slice(-5)}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#64748B", fontSize: "0.78rem" }}>{dateStr}</td>
                        <td style={{ padding: "10px 12px", color: "#334155" }}>
                          <strong style={{ display: "block" }}>{order.customerName}</strong>
                          <span style={{ fontSize: "0.7rem", color: "#94A3B8" }}>{order.customerCpfCnpj || "Consumidor"}</span>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#475569", fontWeight: 600 }}>{order.paymentMethod}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 900, color: "#15803D" }}>
                          {fmt(order.totalAmount)}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <span
                            style={{
                              fontSize: "0.72rem",
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background: order.fiscalStatus === "EMITTED" ? "#DCFCE7" : "#FFF7ED",
                              color: order.fiscalStatus === "EMITTED" ? "#15803D" : "#C2410C",
                            }}
                          >
                            {order.fiscalStatus === "EMITTED" ? "🟢 Autorizada SEFAZ" : "⏳ Processando"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <button
                            onClick={() => setSelectedInvoiceModal(order)}
                            style={{
                              padding: "5px 12px",
                              borderRadius: 8,
                              border: "1.5px solid #EA1D2C",
                              background: "#FEF2F2",
                              color: "#EA1D2C",
                              fontSize: "0.75rem",
                              fontWeight: 800,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontFamily: "inherit",
                            }}
                          >
                            <Eye size={13} /> Ver Nota 🔍
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ENGENHARIA DE CARDÁPIO FISCAL */}
      {activeTab === "combos" && (
        <div>
          {/* Card de Explicação */}
          <div
            style={{
              background: "#F8FAFC",
              border: "1.5px solid #E2E8F0",
              borderRadius: 16,
              padding: "1.25rem",
              marginBottom: 20,
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <Info size={22} color="#0284C7" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <h4 style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 800, color: "#0F172A" }}>
                Como funciona a Engenharia de Cardápio Fiscal nos Combos?
              </h4>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "#475569", lineHeight: 1.5 }}>
                Aqui você define a discriminação do valor fiscal dos componentes de cada combo.
                <strong> Para o seu cliente final nada muda</strong> (ele continuará vendo e pagando o preço normal do combo).
                No documento fiscal emitido, os itens saem discriminados com os valores configurados aqui, permitindo otimizar tributos em itens como bebidas (PIS/COFINS monofásico / Substituição Tributária).
              </p>
            </div>
          </div>

          {/* Controls: Search */}
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 360 }}>
              <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
              <input
                value={searchCombo}
                onChange={e => setSearchCombo(e.target.value)}
                placeholder="Buscar combo por nome..."
                style={{
                  width: "100%",
                  padding: "8px 12px 8px 36px",
                  borderRadius: 10,
                  border: "1.5px solid #CBD5E1",
                  fontSize: "0.85rem",
                  outline: "none",
                }}
              />
            </div>
            <span style={{ fontSize: "0.8rem", color: "#64748B", fontWeight: 600 }}>
              Exibindo {filteredCombos.length} combos
            </span>
          </div>

          {/* Grid de Combos */}
          {filteredCombos.length === 0 ? (
            <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: "3rem", textAlign: "center", color: "#64748B" }}>
              <Layers size={40} color="#CBD5E1" style={{ margin: "0 auto 12px" }} />
              <p style={{ margin: 0, fontWeight: 700, fontSize: "1rem" }}>Nenhum combo encontrado no cardápio</p>
              <p style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>
                Cadastre produtos do tipo "Combo" no cardápio da loja para configurar a Engenharia Fiscal.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
              {filteredCombos.map(combo => {
                const hasBreakdown = combo.fiscalBreakdown && combo.fiscalBreakdown.length > 0;
                return (
                  <div
                    key={combo.id}
                    style={{
                      background: "#fff",
                      border: `1.5px solid ${hasBreakdown ? "#BBF7D0" : "#E2E8F0"}`,
                      borderRadius: 16,
                      padding: "16px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      transition: "0.2s",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>{combo.name}</h3>
                        <span style={{ fontSize: "1.05rem", fontWeight: 900, color: "#16A34A" }}>{fmt(combo.price)}</span>
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: hasBreakdown ? "#DCFCE7" : "#F1F5F9",
                            color: hasBreakdown ? "#15803D" : "#64748B",
                          }}
                        >
                          {hasBreakdown ? "🟢 Engenharia Configurada" : "⚪ Valor Único Padrão"}
                        </span>
                      </div>

                      {/* Items Preview */}
                      {hasBreakdown ? (
                        <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "8px 10px", fontSize: "0.78rem" }}>
                          {combo.fiscalBreakdown!.map((item, idx) => (
                            <div key={idx} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, color: "#334155" }}>
                              <span>• {item.name} ({item.category})</span>
                              <strong style={{ color: "#0F172A" }}>{fmt(item.price)}</strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: "0.78rem", color: "#94A3B8", margin: 0, fontStyle: "italic" }}>
                          Sem discriminação fiscal customizada. O combo sairá como item único por {fmt(combo.price)}.
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => openComboFiscalModal(combo)}
                      style={{
                        marginTop: 16,
                        width: "100%",
                        padding: "9px",
                        borderRadius: 10,
                        border: "1.5px solid #EA1D2C",
                        background: hasBreakdown ? "#FEF2F2" : "#EA1D2C",
                        color: hasBreakdown ? "#EA1D2C" : "#fff",
                        fontWeight: 800,
                        fontSize: "0.82rem",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        fontFamily: "inherit",
                      }}
                    >
                      <Edit3 size={14} /> {hasBreakdown ? "Editar Engenharia Fiscal" : "Configurar Engenharia Fiscal"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CONFIGURAÇÕES & REGRAS DE EMISSÃO */}
      {activeTab === "config" && (
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: "1.5rem" }}>
          <h2 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>
            Formas de Pagamento com Emissão Automática
          </h2>
          <p style={{ margin: "0 0 1.25rem", fontSize: "0.82rem", color: "#64748B" }}>
            Selecione em quais modalidades de pagamento o sistema deve emitir a Nota Fiscal de Consumidor (NFC-e) automaticamente ao concluir o pedido.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 24 }}>
            {PAYMENT_METHOD_OPTIONS.map(pm => {
              const selected = fiscalConfig.autoEmitPaymentMethods?.includes(pm.key);
              return (
                <div
                  key={pm.key}
                  onClick={() => togglePaymentMethod(pm.key)}
                  style={{
                    border: `1.5px solid ${selected ? "#16A34A" : "#E2E8F0"}`,
                    background: selected ? "#F0FDF4" : "#F8FAFC",
                    borderRadius: 12,
                    padding: "12px 14px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    transition: "0.2s",
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      border: `2px solid ${selected ? "#16A34A" : "#CBD5E1"}`,
                      background: selected ? "#16A34A" : "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      marginTop: 2,
                    }}
                  >
                    {selected && <Check size={14} color="#fff" />}
                  </div>
                  <div>
                    <strong style={{ fontSize: "0.88rem", color: selected ? "#15803D" : "#0F172A", display: "block" }}>
                      {pm.label}
                    </strong>
                    <span style={{ fontSize: "0.75rem", color: "#64748B" }}>{pm.desc}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <hr style={{ border: "none", borderTop: "1px solid #E2E8F0", margin: "20px 0" }} />

          {/* Dados Fiscais da Empresa */}
          <h2 style={{ margin: "0 0 12px", fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>
            Dados Fiscais & Ambiente
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 20 }}>
            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>
                CNPJ / CPF do Emitente *
              </label>
              <input
                value={fiscalConfig.cnpj || cpfCnpj}
                onChange={e => setFiscalConfig(p => ({ ...p, cnpj: e.target.value }))}
                placeholder="00.000.000/0001-00"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", outline: "none" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>
                Inscrição Estadual (IE)
              </label>
              <input
                value={fiscalConfig.ie || ""}
                onChange={e => setFiscalConfig(p => ({ ...p, ie: e.target.value }))}
                placeholder="Isento ou nº da IE"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", outline: "none" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: 4 }}>
                Ambiente de Emissão
              </label>
              <select
                value={fiscalConfig.ambiente}
                onChange={e => setFiscalConfig(p => ({ ...p, ambiente: e.target.value as any }))}
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.85rem", outline: "none", cursor: "pointer" }}
              >
                <option value="homologacao">🧪 Homologação (Testes)</option>
                <option value="producao">🚀 Produção (Validade Jurídica)</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleSaveConfig}
            disabled={savingConfig}
            style={{
              padding: "10px 24px",
              background: "#EA1D2C",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontWeight: 800,
              fontSize: "0.88rem",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "inherit",
            }}
          >
            {savingConfig ? "Salvando..." : "Salvar Configurações Fiscais"}
          </button>
        </div>
      )}

      {/* MODAL: EDITAR ENGENHARIA DE CARDÁPIO FISCAL DO COMBO */}
      {editingCombo && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setEditingCombo(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "1.5rem",
              width: "100%",
              maxWidth: 600,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              position: "relative",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 900, color: "#0F172A" }}>
                  Engenharia Fiscal do Combo
                </h2>
                <span style={{ fontSize: "0.85rem", color: "#16A34A", fontWeight: 800 }}>
                  {editingCombo.name} • Preço de Venda: {fmt(editingCombo.price)}
                </span>
              </div>
              <button
                onClick={() => setEditingCombo(null)}
                style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "0.8rem", color: "#64748B", margin: "0 0 16px", lineHeight: 1.4 }}>
              Cadastre os componentes discriminados deste combo e atribua os seus valores tributários individuais.
              A soma de todos os itens deve totalizar exatamente <strong>{fmt(editingCombo.price)}</strong>.
            </p>

            {/* List of fiscal items draft */}
            <div style={{ marginBottom: 16 }}>
              {fiscalItemsDraft.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: "#F8FAFC",
                    border: "1px solid #E2E8F0",
                    borderRadius: 12,
                    padding: "12px",
                    marginBottom: 10,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 30px", gap: 10, alignItems: "center" }}>
                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 2 }}>
                        Nome do Item no Cupom Fiscal
                      </label>
                      <input
                        value={item.name}
                        onChange={e => {
                          const val = e.target.value;
                          setFiscalItemsDraft(prev => prev.map((it, i) => i === idx ? { ...it, name: val } : it));
                        }}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem" }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 2 }}>
                        Categoria
                      </label>
                      <select
                        value={item.category}
                        onChange={e => {
                          const val = e.target.value as any;
                          setFiscalItemsDraft(prev => prev.map((it, i) => i === idx ? { ...it, category: val } : it));
                        }}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem" }}
                      >
                        <option value="BEBIDA">🍹 Bebida (ST)</option>
                        <option value="ALIMENTO">🍔 Alimento</option>
                        <option value="OUTRO">📦 Outros</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 2 }}>
                        Valor Fiscal (R$)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.price}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 0;
                          setFiscalItemsDraft(prev => prev.map((it, i) => i === idx ? { ...it, price: val } : it));
                        }}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", fontWeight: 800 }}
                      />
                    </div>

                    <button
                      onClick={() => setFiscalItemsDraft(prev => prev.filter((_, i) => i !== idx))}
                      style={{ background: "none", border: "none", cursor: "pointer", marginTop: 14 }}
                      title="Remover Item"
                    >
                      <Trash2 size={16} color="#EF4444" />
                    </button>
                  </div>
                </div>
              ))}

              <button
                onClick={() => setFiscalItemsDraft(prev => [...prev, { name: "Novo Componente", price: 5.0, category: "ALIMENTO" }])}
                style={{
                  width: "100%",
                  padding: "8px",
                  borderRadius: 8,
                  border: "1.5px dashed #CBD5E1",
                  background: "#fff",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  color: "#475569",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontFamily: "inherit",
                }}
              >
                <Plus size={14} /> Adicionar Componente Discriminado
              </button>
            </div>

            {/* Validation & Total Bar */}
            <div
              style={{
                background: isDraftValid ? "#F0FDF4" : "#FEF2F2",
                border: `1.5px solid ${isDraftValid ? "#BBF7D0" : "#FECACA"}`,
                borderRadius: 12,
                padding: "12px 14px",
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: isDraftValid ? "#166534" : "#991B1B" }}>
                  {isDraftValid ? "✅ Soma Fiscal 100% válida!" : "⚠️ Soma Fiscal Divergente"}
                </span>
                <span style={{ fontSize: "1rem", fontWeight: 900, color: isDraftValid ? "#15803D" : "#DC2626" }}>
                  Soma: {fmt(draftTotalSum)} / {fmt(editingCombo.price)}
                </span>
              </div>
              {!isDraftValid && (
                <p style={{ margin: "4px 0 0", fontSize: "0.75rem", color: "#991B1B" }}>
                  Ajuste os valores para que a soma seja exatamente igual ao preço total do combo ({fmt(editingCombo.price)}).
                </p>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setEditingCombo(null)}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: 10,
                  border: "1.5px solid #CBD5E1",
                  background: "#fff",
                  fontWeight: 700,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveComboFiscal}
                disabled={savingComboFiscal || !isDraftValid}
                style={{
                  flex: 2,
                  padding: "11px",
                  borderRadius: 10,
                  border: "none",
                  background: isDraftValid ? "#16A34A" : "#CBD5E1",
                  color: "#fff",
                  fontWeight: 900,
                  fontSize: "0.88rem",
                  cursor: isDraftValid ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                }}
              >
                {savingComboFiscal ? "Salvando..." : "Salvar Engenharia Fiscal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL COMPLETO: ESPELHO FISCAL DANFE NFC-E DO PEDIDO */}
      {selectedInvoiceModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.65)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setSelectedInvoiceModal(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "1.5rem",
              width: "100%",
              maxWidth: 580,
              maxHeight: "92vh",
              overflowY: "auto",
              boxShadow: "0 25px 70px rgba(0,0,0,0.35)",
              position: "relative",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header DANFE */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, borderBottom: "2px solid #0F172A", paddingBottom: 10 }}>
              <div>
                <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase" }}>DOCUMENTO AUXILIAR DA NFC-E</span>
                <h2 style={{ margin: "2px 0 0", fontSize: "1.2rem", fontWeight: 900, color: "#0F172A" }}>
                  DANFE NFC-e nº {selectedInvoiceModal.fiscalInfo?.nfceNumber}
                </h2>
                <span style={{ fontSize: "0.78rem", color: "#16A34A", fontWeight: 700 }}>
                  Pedido Vinculado #{selectedInvoiceModal.dailyOrderNumber || selectedInvoiceModal.id.slice(-5)}
                </span>
              </div>
              <button onClick={() => setSelectedInvoiceModal(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", fontWeight: 800 }}>
                ✕
              </button>
            </div>

            {/* Emitente & Chave SEFAZ Box */}
            <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: "12px", marginBottom: 14, fontSize: "0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div>
                  <strong style={{ display: "block", color: "#0F172A", fontSize: "0.88rem" }}>{storeName || "RESTAURANTE / LOJA"}</strong>
                  <span style={{ color: "#64748B" }}>CNPJ: {cpfCnpj || fiscalConfig.cnpj || "00.000.000/0001-00"} • IE: {fiscalConfig.ie || "Isento"}</span>
                </div>
                <span style={{ fontSize: "0.7rem", fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: "#DCFCE7", color: "#15803D", height: "fit-content" }}>
                  AUTORIZADA SEFAZ
                </span>
              </div>

              <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 10px", marginTop: 8 }}>
                <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#64748B", display: "block" }}>CHAVE DE ACESSO (44 DÍGITOS)</span>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <code style={{ fontSize: "0.72rem", color: "#0F172A", fontWeight: 700, wordBreak: "break-all" }}>
                    {selectedInvoiceModal.fiscalInfo?.nfceKey}
                  </code>
                  <button
                    onClick={() => handleCopyKey(selectedInvoiceModal.fiscalInfo?.nfceKey || "")}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
                    title="Copiar Chave de Acesso"
                  >
                    <Copy size={15} color={copiedKey ? "#16A34A" : "#64748B"} />
                  </button>
                </div>
                {copiedKey && <span style={{ fontSize: "0.68rem", color: "#16A34A", fontWeight: 700 }}>Copiado!</span>}
              </div>
            </div>

            {/* Protocolo & Cliente */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14, fontSize: "0.78rem" }}>
              <div style={{ background: "#F1F5F9", padding: "8px 10px", borderRadius: 8 }}>
                <span style={{ color: "#64748B", display: "block", fontSize: "0.7rem", fontWeight: 700 }}>PROTOCOLO DE AUTORIZAÇÃO</span>
                <strong style={{ color: "#0F172A" }}>{selectedInvoiceModal.fiscalInfo?.protocol}</strong>
              </div>
              <div style={{ background: "#F1F5F9", padding: "8px 10px", borderRadius: 8 }}>
                <span style={{ color: "#64748B", display: "block", fontSize: "0.7rem", fontWeight: 700 }}>CLIENTE / CONSUMIDOR</span>
                <strong style={{ color: "#0F172A" }}>{selectedInvoiceModal.customerName}</strong>
              </div>
            </div>

            {/* Itens Discriminados Fiscalmente */}
            <h4 style={{ margin: "0 0 8px", fontSize: "0.85rem", fontWeight: 800, color: "#0F172A" }}>
              Itens do Documento Fiscal (NFC-e)
            </h4>

            <div style={{ background: "#FFF", border: "1.5px solid #CBD5E1", borderRadius: 12, padding: "12px", marginBottom: 14, fontSize: "0.8rem" }}>
              {selectedInvoiceModal.fiscalInfo?.items.map((item: any, idx: number) => {
                const hasBreakdown = item.fiscalBreakdown && item.fiscalBreakdown.length > 0;
                return (
                  <div key={idx} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: idx < selectedInvoiceModal.fiscalInfo!.items.length - 1 ? "1px dashed #E2E8F0" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, color: "#0F172A" }}>
                      <span>{item.quantity}x {item.name}</span>
                      <span>{fmt(item.totalPrice)}</span>
                    </div>

                    {hasBreakdown && (
                      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "8px 10px", marginTop: 6, fontSize: "0.75rem", color: "#166534" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <Sparkles size={13} color="#16A34A" />
                          <strong style={{ color: "#15803D" }}>Itens discriminados via Engenharia Fiscal de Combo:</strong>
                        </div>
                        {item.fiscalBreakdown.map((fItem: any, fIdx: number) => (
                          <div key={fIdx} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                            <span>• {fItem.name} ({fItem.category})</span>
                            <strong>{fmt(fItem.price)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Totais & IBPT */}
            <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: "12px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: "0.85rem" }}>
                <span>Subtotal dos Produtos:</span>
                <strong>{fmt(selectedInvoiceModal.totalAmount - (selectedInvoiceModal.deliveryFee || 0))}</strong>
              </div>
              {selectedInvoiceModal.deliveryFee ? (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: "0.85rem" }}>
                  <span>Taxa de Entrega:</span>
                  <strong>{fmt(selectedInvoiceModal.deliveryFee)}</strong>
                </div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.1rem", fontWeight: 900, color: "#15803D", paddingTop: 6, borderTop: "1.5px solid #CBD5E1" }}>
                <span>VALOR TOTAL DA NOTA:</span>
                <span>{fmt(selectedInvoiceModal.totalAmount)}</span>
              </div>
              <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 6, textAlign: "right" }}>
                Tributos Aproximados (IBPT Lei 12.741/2012): <strong>{fmt(selectedInvoiceModal.fiscalInfo?.impostosAproximados || 0)}</strong>
              </div>
            </div>

            {/* Actions: Download XML / Print */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => alert(`Download do XML da NFC-e nº ${selectedInvoiceModal.fiscalInfo?.nfceNumber} iniciado!`)}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: 10,
                  border: "1.5px solid #CBD5E1",
                  background: "#fff",
                  fontWeight: 800,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontFamily: "inherit",
                }}
              >
                <Download size={14} /> Download XML
              </button>

              <button
                onClick={() => window.print()}
                style={{
                  flex: 1.5,
                  padding: "10px",
                  borderRadius: 10,
                  border: "none",
                  background: "#0F172A",
                  color: "#fff",
                  fontWeight: 900,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontFamily: "inherit",
                }}
              >
                <Printer size={15} /> Imprimir DANFE NFC-e
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
