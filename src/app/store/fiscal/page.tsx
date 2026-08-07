"use client";

import { useState, useEffect } from "react";
import {
  FileText, ShieldCheck, Check, AlertTriangle, Search, Plus, Trash2,
  DollarSign, RefreshCw, Layers, Edit3, Settings, CheckCircle2, ChevronRight,
  Info, Sparkles, Receipt, Filter, ArrowUpRight
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
  paymentMethod: string;
  totalAmount: number;
  createdAt: string;
  fiscalStatus?: string | null;
  fiscalInfo?: any;
  items: any[];
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
  const [activeTab, setActiveTab] = useState<"config" | "combos" | "invoices">("combos");
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [storeName, setStoreName] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");

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

  // Invoices data
  const [orders, setOrders] = useState<FiscalOrder[]>([]);
  const [searchInvoice, setSearchInvoice] = useState("");
  const [selectedInvoiceModal, setSelectedInvoiceModal] = useState<FiscalOrder | null>(null);

  // Load initial data
  useEffect(() => {
    fetchFiscalData();
    fetchCombos();
    fetchInvoices();
  }, []);

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
      const res = await fetch("/api/store/fiscal/invoices");
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
      // Auto-gerar rascunho com base nos grupos ou itens do combo se existirem
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
        // Fallback: 2 itens padronizados (Bebida ST + Lanche/Prato)
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

  const draftTotalSum = fiscalItemsDraft.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const comboPriceDiff = editingCombo ? Number((draftTotalSum - editingCombo.price).toFixed(2)) : 0;
  const isDraftValid = Math.abs(comboPriceDiff) < 0.02;

  const filteredCombos = combos.filter(c => c.name.toLowerCase().includes(searchCombo.toLowerCase()));
  const configuredCombosCount = combos.filter(c => c.fiscalBreakdown && c.fiscalBreakdown.length > 0).length;

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
              Módulo Fiscal & Engenharia Tributária
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
            Gerencie a emissão de notas fiscais (NFC-e / NF-e) e configure a discriminação de valores nos combos para redução tributária legal.
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
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Combos com Engenharia</span>
            <Layers size={18} color="#0284C7" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#0F172A" }}>
            {configuredCombosCount} <span style={{ fontSize: "0.9rem", color: "#64748B", fontWeight: 500 }}>/ {combos.length}</span>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#0284C7", marginTop: 4, fontWeight: 600 }}>
            {combos.length > 0 ? `${Math.round((configuredCombosCount / combos.length) * 100)}% configurados` : "Nenhum combo cadastrado"}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1.5px solid #BBF7D0", borderRadius: 16, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#166534", textTransform: "uppercase" }}>Formas com Emissão Auto</span>
            <ShieldCheck size={18} color="#16A34A" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#15803D" }}>
            {fiscalConfig.autoEmitPaymentMethods?.length || 0}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#166534", marginTop: 4, fontWeight: 600 }}>
            Formas de pagamento configuradas
          </div>
        </div>

        <div style={{ background: "linear-gradient(135deg, #EFF6FF, #DBEAFE)", border: "1.5px solid #BFDBFE", borderRadius: 16, padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#1E40AF", textTransform: "uppercase" }}>Economia Estimada PIS/COFINS</span>
            <Sparkles size={18} color="#2563EB" />
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "#1E3A8A" }}>Até 30%</div>
          <div style={{ fontSize: "0.75rem", color: "#1E40AF", marginTop: 4, fontWeight: 600 }}>
            Redução tributária via monofásicos em combos
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div style={{ display: "flex", borderBottom: "2px solid #E2E8F0", marginBottom: 24, gap: 8 }}>
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
          <Receipt size={18} /> Notas Emitidas / Pedidos Fiscais
        </button>
      </div>

      {/* TAB 1: ENGENHARIA DE CARDÁPIO FISCAL */}
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

      {/* TAB 2: CONFIGURAÇÕES & REGRAS DE EMISSÃO */}
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

      {/* TAB 3: NOTAS EMITIDAS */}
      {activeTab === "invoices" && (
        <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>
              Histórico de Pedidos & Emissão Fiscal
            </h2>
            <span style={{ fontSize: "0.8rem", color: "#64748B" }}>Total: {orders.length} pedidos</span>
          </div>

          {orders.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "#94A3B8" }}>
              <Receipt size={40} style={{ margin: "0 auto 12px" }} />
              <p style={{ margin: 0, fontWeight: 700 }}>Nenhum pedido fiscal registrado até o momento.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC", textTransform: "uppercase", fontSize: "0.72rem", color: "#64748B" }}>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #E2E8F0" }}>Pedido</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #E2E8F0" }}>Cliente</th>
                    <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "2px solid #E2E8F0" }}>Pagamento</th>
                    <th style={{ padding: "10px 12px", textAlign: "right", borderBottom: "2px solid #E2E8F0" }}>Valor Total</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: "2px solid #E2E8F0" }}>Status Fiscal</th>
                    <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: "2px solid #E2E8F0" }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(order => (
                    <tr key={order.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 800, color: "#0F172A" }}>
                        #{order.dailyOrderNumber || order.id.slice(-5)}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#334155" }}>{order.customerName}</td>
                      <td style={{ padding: "10px 12px", color: "#64748B" }}>{order.paymentMethod || "Padrão"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 800, color: "#0F172A" }}>
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
                          {order.fiscalStatus === "EMITTED" ? "🟢 NF Emitida" : "⏳ Pronta p/ Emissão"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        <button
                          onClick={() => setSelectedInvoiceModal(order)}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            border: "1px solid #CBD5E1",
                            background: "#fff",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          Espelho Fiscal 🔍
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

      {/* MODAL: ESPELHO FISCAL DO PEDIDO */}
      {selectedInvoiceModal && (
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
          onClick={() => setSelectedInvoiceModal(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "1.5rem",
              width: "100%",
              maxWidth: 520,
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              position: "relative",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 900 }}>
                Espelho Fiscal — Pedido #{selectedInvoiceModal.dailyOrderNumber || selectedInvoiceModal.id.slice(-5)}
              </h3>
              <button onClick={() => setSelectedInvoiceModal(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>
                ✕
              </button>
            </div>

            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px", marginBottom: 16, fontSize: "0.82rem" }}>
              <p style={{ margin: "0 0 4px" }}><strong>Cliente:</strong> {selectedInvoiceModal.customerName}</p>
              <p style={{ margin: "0 0 4px" }}><strong>Pagamento:</strong> {selectedInvoiceModal.paymentMethod}</p>
              <p style={{ margin: 0 }}><strong>Total:</strong> {fmt(selectedInvoiceModal.totalAmount)}</p>
            </div>

            <h4 style={{ margin: "0 0 8px", fontSize: "0.85rem", fontWeight: 800, color: "#0F172A" }}>
              Itens Discriminados na Emissão da Nota
            </h4>

            <div style={{ background: "#FFF", border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px", marginBottom: 16, fontSize: "0.8rem" }}>
              {selectedInvoiceModal.items.map((item, idx) => {
                const p = item.menuProduct;
                const hasBreakdown = p?.fiscalBreakdown && p.fiscalBreakdown.length > 0;
                return (
                  <div key={idx} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: idx < selectedInvoiceModal.items.length - 1 ? "1px dashed #E2E8F0" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                      <span>{item.quantity}x {p?.name || item.name}</span>
                      <span>{fmt(item.price * item.quantity)}</span>
                    </div>

                    {hasBreakdown && (
                      <div style={{ background: "#F0FDF4", borderRadius: 6, padding: "6px 8px", marginTop: 4, fontSize: "0.75rem", color: "#166534" }}>
                        <span style={{ fontWeight: 700, display: "block", marginBottom: 2 }}>⚡ Itens discriminados via Engenharia Fiscal:</span>
                        {p.fiscalBreakdown.map((fItem: any, fIdx: number) => (
                          <div key={fIdx} style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>• {fItem.name} ({fItem.category})</span>
                            <span>{fmt(fItem.price)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setSelectedInvoiceModal(null)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: 10,
                border: "none",
                background: "#0F172A",
                color: "#fff",
                fontWeight: 800,
                fontSize: "0.85rem",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Fechar Espelho Fiscal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
