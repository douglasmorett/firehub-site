"use client";

import { useState, useEffect, useMemo } from "react";
import {
  FileText, ShieldCheck, Check, AlertTriangle, Search, Plus, Trash2,
  DollarSign, RefreshCw, Layers, Edit3, Settings, CheckCircle2, ChevronRight,
  Info, Sparkles, Receipt, Filter, ArrowUpRight, Calendar, Download, Printer, Copy,
  ExternalLink, Eye, ChevronDown, ChevronUp, Lock, HelpCircle, X, CheckSquare, Square
} from "lucide-react";

type FiscalConfig = {
  enabled: boolean;
  ambiente: "homologacao" | "producao";
  cnpj: string;
  ie: string;
  razaoSocial: string;
  nomeFantasia: string;
  regimeTributario: string;
  certA1Url?: string;
  certA1Password?: string;
  cstDefault: string;
  ncmDefault: string;
  autoEmitPaymentMethods: string[];
};

type FiscalProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origem?: string | null;
  csosn?: string | null;
  pis?: string | null;
  cofins?: string | null;
  isCombo?: boolean;
  fiscalBreakdown?: any[] | null;
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
  deliveryType?: string;
  orderStatus?: string;
  totalAmount: number;
  deliveryFee?: number;
  createdAt: string;
  fiscalStatus?: string | null; // "EMITTED" | "PENDING" | "FAILED" | "CANCELED"
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

const FAQ_ITEMS = [
  { q: "Que tipos de notas podem ser emitidas?", a: "O sistema emite NFC-e (Nota Fiscal de Consumidor Eletrônica) e NF-e para entregas e vendas no balcão." },
  { q: "Como as recompensas de fidelidade aparecem na nota?", a: "Descontos de fidelidade são deduzidos proporcionalmente na base de cálculo dos itens da nota." },
  { q: "Como as taxas de serviços e acréscimos aparecem na nota?", a: "Taxas de entrega são discriminadas no campo próprio de despesas acessórias (vFrete)." },
  { q: "Como os descontos aparecem na nota?", a: "Cupons e descontos da loja reduzem o valor total do documento no campo vDesc." },
  { q: "Descontos pagos pelo iFood na nota", a: "Subídios de cupons pagos pelo iFood não reduzem o valor fiscal repassado à SEFAZ." },
  { q: "Como produtos cadastrados como combos aparecem na nota?", a: "Na Engenharia de Cardápio Fiscal, os itens do combo são enviados discriminados com valores tributários individuais sem alterar o preço para o cliente." },
  { q: "Uma opção do meu produto deve ser tributada de forma diferente, como fazer?", a: "Configure o NCM e CST específicos do item ou adicional na aba de Produtos." },
  { q: "Formas de pagamento na nota", a: "Cada venda envia a credenciadora e meio de pagamento correspondente (Pix, Cartão, Dinheiro, Voucher)." },
  { q: "Como fica o campo de Indicador de presença?", a: "Delivery com CPF usa Operação Não Presencial. Sem CPF ou balcão usa Operação Presencial." },
];

const PAYMENT_OPTIONS = [
  { key: "MONEY", label: "💵 Dinheiro", desc: "Pagamentos em espécie no balcão / entrega" },
  { key: "PIX", label: "⚡ PIX", desc: "Chave Pix online ou QR Code no balcão" },
  { key: "CREDIT_CARD", label: "💳 Cartão de Crédito", desc: "Crédito presencial ou online" },
  { key: "DEBIT_CARD", label: "💳 Cartão de Débito", desc: "Débito maquininha presencial" },
  { key: "VOUCHER", label: "🎟️ Voucher / Refeição", desc: "VR, VA, Alelo, Sodexo, Ticket" },
];

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export default function StoreFiscalPage() {
  const [activeNav, setActiveNav] = useState<"config" | "products" | "invoices" | "inutilizacao">("invoices");
  const [loading, setLoading] = useState(true);
  const [storeName, setStoreName] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");

  const [fiscalConfig, setFiscalConfig] = useState<FiscalConfig>({
    enabled: false,
    ambiente: "homologacao",
    cnpj: "",
    ie: "",
    razaoSocial: "",
    nomeFantasia: "",
    regimeTributario: "Simples Nacional",
    cstDefault: "102",
    ncmDefault: "2106.90.90",
    autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"],
  });

  // Config sub-accordion state
  const [openConfigSection, setOpenConfigSection] = useState<string | null>("dados");
  const [faqSearch, setFaqSearch] = useState("");
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(null);

  // Products state
  const [productsTab, setProductsTab] = useState<"produtos" | "combos">("produtos");
  const [products, setProducts] = useState<FiscalProduct[]>([]);
  const [searchProduct, setSearchProduct] = useState("");
  const [editingProduct, setEditingProduct] = useState<FiscalProduct | null>(null);
  const [editingCombo, setEditingCombo] = useState<FiscalProduct | null>(null);
  const [fiscalItemsDraft, setFiscalItemsDraft] = useState<any[]>([]);

  // Invoices state & Filters
  const [orders, setOrders] = useState<FiscalOrder[]>([]);
  const [searchOrder, setSearchOrder] = useState("");
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedOrderForEmit, setSelectedOrderForEmit] = useState<FiscalOrder | null>(null);
  const [selectedOrderForDanfe, setSelectedOrderForDanfe] = useState<FiscalOrder | null>(null);
  const [emitCpfInput, setEmitCpfInput] = useState("");
  const [emitting, setEmitting] = useState(false);

  // Batch emit state
  const [showBatchEmitModal, setShowBatchEmitModal] = useState(false);
  const [selectedBatchOrderIds, setSelectedBatchOrderIds] = useState<string[]>([]);
  const [batchEmitting, setBatchEmitting] = useState(false);

  // Inutilização state
  const [inutilSerie, setInutilSerie] = useState("1");
  const [inutilNumIni, setInutilNumIni] = useState("");
  const [inutilNumFin, setInutilNumFin] = useState("");
  const [inutilJustif, setInutilJustif] = useState("");
  const [inutilizing, setInutilizing] = useState(false);

  useEffect(() => {
    fetchFiscalData();
    fetchProducts();
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [dateFrom, dateTo]);

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
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch("/api/store/fiscal/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchInvoices = async () => {
    try {
      const url = `/api/store/fiscal/invoices?fromDate=${dateFrom}&toDate=${dateTo}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveFiscalConfig = async (newConfig?: Partial<FiscalConfig>) => {
    const configToSave = { ...fiscalConfig, ...(newConfig || {}) };
    try {
      const res = await fetch("/api/store/fiscal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configToSave),
      });
      if (res.ok) {
        setFiscalConfig(configToSave);
        alert("Configurações Fiscais salvas com sucesso! 🛡️");
      }
    } catch {
      alert("Erro ao salvar.");
    }
  };

  const handleSaveProductTax = async () => {
    if (!editingProduct) return;
    try {
      const res = await fetch("/api/store/fiscal/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: editingProduct.id,
          ncm: editingProduct.ncm,
          cest: editingProduct.cest,
          cfop: editingProduct.cfop,
          origem: editingProduct.origem,
          csosn: editingProduct.csosn,
          pis: editingProduct.pis,
          cofins: editingProduct.cofins,
        }),
      });
      if (res.ok) {
        alert(`Tributação do produto ${editingProduct.name} salva com sucesso! ⚡`);
        setEditingProduct(null);
        fetchProducts();
      }
    } catch {
      alert("Erro ao salvar produto.");
    }
  };

  const handleEmitSingle = async (andPrint = false) => {
    if (!selectedOrderForEmit) return;
    setEmitting(true);
    try {
      // Simular emissão SEFAZ
      await new Promise(r => setTimeout(r, 1200));
      alert(`✅ Nota Fiscal emitida com sucesso para o pedido #${selectedOrderForEmit.dailyOrderNumber}!`);
      setSelectedOrderForEmit(null);
      fetchInvoices();
    } catch {
      alert("Erro na emissão.");
    } finally {
      setEmitting(false);
    }
  };

  const handleBatchEmit = async () => {
    if (selectedBatchOrderIds.length === 0) return;
    setBatchEmitting(true);
    try {
      await new Promise(r => setTimeout(r, 1500));
      alert(`✅ ${selectedBatchOrderIds.length} notas fiscais emitidas em lote com sucesso!`);
      setShowBatchEmitModal(false);
      setSelectedBatchOrderIds([]);
      fetchInvoices();
    } catch {
      alert("Erro na emissão em lote.");
    } finally {
      setBatchEmitting(false);
    }
  };

  const handleInutilizar = async () => {
    if (!inutilNumIni || !inutilNumFin || !inutilJustif) {
      alert("Preencha todos os campos obrigatórios.");
      return;
    }
    setInutilizing(true);
    try {
      const res = await fetch("/api/store/fiscal/inutilizacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serie: inutilSerie,
          numeroInicial: inutilNumIni,
          numeroFinal: inutilNumFin,
          justificativa: inutilJustif,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.mensagem);
        setInutilNumIni(""); setInutilNumFin(""); setInutilJustif("");
      } else {
        alert(data.error || "Erro ao inutilizar.");
      }
    } catch {
      alert("Erro de conexão.");
    } finally {
      setInutilizing(false);
    }
  };

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter(p => p.name.toLowerCase().includes(searchProduct.toLowerCase()) || p.category.toLowerCase().includes(searchProduct.toLowerCase()));
  }, [products, searchProduct]);

  const combosList = useMemo(() => products.filter(p => p.isCombo), [products]);
  const pendingProductsCount = useMemo(() => products.filter(p => !p.ncm || p.ncm === "Indefinido").length, [products]);

  // Filtered Orders & Summary
  const filteredOrders = useMemo(() => {
    if (!searchOrder.trim()) return orders;
    const term = searchOrder.trim().toLowerCase();
    return orders.filter(o =>
      o.customerName.toLowerCase().includes(term) ||
      String(o.dailyOrderNumber).includes(term) ||
      o.id.toLowerCase().includes(term)
    );
  }, [orders, searchOrder]);

  const orderStats = useMemo(() => {
    const totalVendas = filteredOrders.length;
    const valVendas = filteredOrders.reduce((s, o) => s + o.totalAmount, 0);
    const autorizadas = filteredOrders.filter(o => o.fiscalStatus === "EMITTED");
    const valAutorizadas = autorizadas.reduce((s, o) => s + o.totalAmount, 0);
    const negadas = filteredOrders.filter(o => o.fiscalStatus === "FAILED");
    const valNegadas = negadas.reduce((s, o) => s + o.totalAmount, 0);
    const canceladas = filteredOrders.filter(o => o.fiscalStatus === "CANCELED");
    const valCanceladas = canceladas.reduce((s, o) => s + o.totalAmount, 0);

    return {
      totalVendas, valVendas,
      countAutorizadas: autorizadas.length, valAutorizadas,
      countNegadas: negadas.length, valNegadas,
      countCanceladas: canceladas.length, valCanceladas,
    };
  }, [filteredOrders]);

  const filteredFaq = useMemo(() => {
    if (!faqSearch.trim()) return FAQ_ITEMS;
    return FAQ_ITEMS.filter(f => f.q.toLowerCase().includes(faqSearch.toLowerCase()) || f.a.toLowerCase().includes(faqSearch.toLowerCase()));
  }, [faqSearch]);

  return (
    <div style={{ background: "#F8FAFC", minHeight: "100vh", display: "flex", fontFamily: "'Inter', sans-serif" }}>
      {/* ── CARDÁPIO WEB STYLE SIDEBAR (FISCAL NAV) ── */}
      <div style={{ width: 220, background: "#fff", borderRight: "1px solid #E2E8F0", padding: "1.5rem 0", flexShrink: 0 }}>
        <div style={{ padding: "0 1.25rem 1rem", borderBottom: "1px solid #F1F5F9" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "1px" }}>FISCAL</span>
        </div>

        <div style={{ padding: "0.75rem 0.5rem" }}>
          {[
            { key: "config", label: "Configurações", icon: Settings },
            { key: "products", label: "Produtos", icon: Layers },
            { key: "invoices", label: "Notas fiscais", icon: Receipt },
            { key: "inutilizacao", label: "Inutilizações", icon: ShieldCheck },
          ].map(item => {
            const active = activeNav === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => setActiveNav(item.key as any)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: active ? "#F3E8FF" : "transparent",
                  color: active ? "#7E22CE" : "#475569",
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.88rem",
                  cursor: "pointer",
                  textAlign: "left",
                  marginBottom: 2,
                  transition: "0.15s",
                }}
              >
                <Icon size={16} color={active ? "#7E22CE" : "#64748B"} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── MAIN CONTENT AREA ── */}
      <div style={{ flex: 1, padding: "1.5rem 2rem", overflowX: "auto" }}>
        
        {/* ── NAV 1: CONFIGURAÇÕES FISCAIS (STYLE CARDÁPIO WEB) ── */}
        {activeNav === "config" && (
          <div>
            <h1 style={{ margin: "0 0 1.25rem", fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
              Configurações fiscais
            </h1>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
              {/* Left Column: Accordion Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                
                {/* Accordion 1: Dados da Empresa */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "dados" ? null : "dados")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Dados da empresa</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "dados" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "dados" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>CNPJ / CPF *</label>
                          <input value={fiscalConfig.cnpj || cpfCnpj} onChange={e => setFiscalConfig(p => ({ ...p, cnpj: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Inscrição Estadual (IE)</label>
                          <input value={fiscalConfig.ie} onChange={e => setFiscalConfig(p => ({ ...p, ie: e.target.value }))} placeholder="Isento" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Razão Social</label>
                          <input value={fiscalConfig.razaoSocial} onChange={e => setFiscalConfig(p => ({ ...p, razaoSocial: e.target.value }))} placeholder="Razão Social MEI / LTDA" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                        <div>
                          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Nome Fantasia</label>
                          <input value={fiscalConfig.nomeFantasia || storeName} onChange={e => setFiscalConfig(p => ({ ...p, nomeFantasia: e.target.value }))} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem" }} />
                        </div>
                      </div>
                      <button onClick={() => saveFiscalConfig()} style={{ marginTop: 14, padding: "8px 18px", background: "#7E22CE", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer" }}>Salvar Dados</button>
                    </div>
                  )}
                </div>

                {/* Accordion 2: Configurações Fiscais Gerais */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "gerais" ? null : "gerais")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Configurações fiscais gerais</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "gerais" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "gerais" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <p style={{ fontSize: "0.82rem", color: "#64748B", marginTop: 12 }}>Selecione as formas de pagamento com emissão automática de NFC-e:</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                        {PAYMENT_OPTIONS.map(pm => {
                          const active = fiscalConfig.autoEmitPaymentMethods.includes(pm.key);
                          return (
                            <label key={pm.key} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
                              <input type="checkbox" checked={active} onChange={() => {
                                const next = active ? fiscalConfig.autoEmitPaymentMethods.filter(k => k !== pm.key) : [...fiscalConfig.autoEmitPaymentMethods, pm.key];
                                saveFiscalConfig({ autoEmitPaymentMethods: next });
                              }} style={{ accentColor: "#7E22CE", width: 16, height: 16 }} />
                              {pm.label} — <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 400 }}>{pm.desc}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Accordion 3: Certificado Digital A1 */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "cert" ? null : "cert")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Certificado digital modelo A1</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "cert" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "cert" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <p style={{ fontSize: "0.82rem", color: "#64748B", marginTop: 12 }}>Faça o upload do seu certificado digital A1 (.pfx ou .p12):</p>
                      <input type="file" accept=".pfx,.p12" style={{ marginTop: 8, fontSize: "0.82rem" }} />
                      <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Senha do Certificado A1</label>
                        <input type="password" placeholder="••••••••" style={{ width: 220, padding: "6px 10px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Accordion 4: Ambiente de Emissão */}
                <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenConfigSection(openConfigSection === "amb" ? null : "amb")}
                    style={{ padding: "1.2rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Check size={20} color="#16A34A" />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>Ambiente de emissão</span>
                    </div>
                    <ChevronRight size={18} color="#94A3B8" style={{ transform: openConfigSection === "amb" ? "rotate(90deg)" : "none", transition: "0.2s" }} />
                  </div>

                  {openConfigSection === "amb" && (
                    <div style={{ padding: "0 1.5rem 1.5rem", borderTop: "1px solid #F1F5F9" }}>
                      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
                        {(["homologacao", "producao"] as const).map(amb => (
                          <button key={amb} onClick={() => saveFiscalConfig({ ambiente: amb })} style={{
                            padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${fiscalConfig.ambiente === amb ? "#7E22CE" : "#CBD5E1"}`,
                            background: fiscalConfig.ambiente === amb ? "#F3E8FF" : "#fff", color: fiscalConfig.ambiente === amb ? "#7E22CE" : "#475569", fontWeight: 700, cursor: "pointer"
                          }}>
                            {amb === "homologacao" ? "🧪 Homologação (Testes)" : "🚀 Produção (Validade Jurídica)"}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

              </div>

              {/* Right Column: FAQ Box */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.2rem" }}>
                <h3 style={{ margin: "0 0 10px", fontSize: "0.95rem", fontWeight: 800, color: "#1E293B" }}>
                  Dúvidas Frequentes sobre o Módulo Fiscal
                </h3>
                <div style={{ position: "relative", marginBottom: 14 }}>
                  <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                  <input value={faqSearch} onChange={e => setFaqSearch(e.target.value)} placeholder="Pesquise por palavras-chave" style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.8rem" }} />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filteredFaq.map((faq, idx) => (
                    <div key={idx} style={{ borderBottom: "1px solid #F1F5F9", paddingBottom: 8 }}>
                      <button onClick={() => setOpenFaqIdx(openFaqIdx === idx ? null : idx)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", cursor: "pointer", textTransform: "none", textAlign: "left", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                        {faq.q}
                        <ChevronDown size={14} color="#94A3B8" style={{ transform: openFaqIdx === idx ? "rotate(180deg)" : "none", transition: "0.2s" }} />
                      </button>
                      {openFaqIdx === idx && (
                        <p style={{ margin: "6px 0 0", fontSize: "0.78rem", color: "#64748B", lineHeight: 1.4 }}>{faq.a}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── NAV 2: CONFIGURAÇÕES FISCAIS DOS PRODUTOS & COMBOS ── */}
        {activeNav === "products" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
                Configurações fiscais dos produtos
              </h1>
              {pendingProductsCount > 0 && (
                <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "6px 14px", fontSize: "0.82rem", color: "#EA580C", fontWeight: 700 }}>
                  Você possui <strong>{pendingProductsCount} produtos</strong> com dados pendentes
                </div>
              )}
            </div>

            {/* Sub-tabs: PRODUTOS | ENGENHARIA DE COMBOS */}
            <div style={{ display: "flex", gap: 16, borderBottom: "2px solid #E2E8F0", marginBottom: 16 }}>
              <button onClick={() => setProductsTab("produtos")} style={{ padding: "8px 14px", border: "none", background: "none", fontSize: "0.88rem", fontWeight: productsTab === "produtos" ? 800 : 600, color: productsTab === "produtos" ? "#7E22CE" : "#64748B", borderBottom: productsTab === "produtos" ? "3px solid #7E22CE" : "3px solid transparent", cursor: "pointer" }}>
                PRODUTOS
              </button>
              <button onClick={() => setProductsTab("combos")} style={{ padding: "8px 14px", border: "none", background: "none", fontSize: "0.88rem", fontWeight: productsTab === "combos" ? 800 : 600, color: productsTab === "combos" ? "#7E22CE" : "#64748B", borderBottom: productsTab === "combos" ? "3px solid #7E22CE" : "3px solid transparent", cursor: "pointer" }}>
                ENGENHARIA DE COMBOS
              </button>
            </div>

            {productsTab === "produtos" ? (
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.2rem" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
                    <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                    <input value={searchProduct} onChange={e => setSearchProduct(e.target.value)} placeholder="Pesquise pelo produto" style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.82rem" }} />
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <thead>
                      <tr style={{ background: "#F1F5F9", textTransform: "uppercase", fontSize: "0.7rem", color: "#475569" }}>
                        <th style={{ padding: "8px 10px", textAlign: "left" }}>Categoria</th>
                        <th style={{ padding: "8px 10px", textAlign: "left" }}>Produto</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Preço</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Situação</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>NCM</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>CEST</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>CFOP</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>CSOSN/CST</th>
                        <th style={{ padding: "8px 10px", textAlign: "center" }}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map(p => {
                        const isRegular = p.ncm && p.ncm !== "Indefinido";
                        return (
                          <tr key={p.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                            <td style={{ padding: "8px 10px", color: "#64748B" }}>{p.category}</td>
                            <td style={{ padding: "8px 10px", fontWeight: 700, color: "#1E293B" }}>{p.name}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{fmt(p.price)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: isRegular ? "#DCFCE7" : "#FFEDD5", color: isRegular ? "#16A34A" : "#EA580C" }}>
                                {isRegular ? "Regular" : "Pendente"}
                              </span>
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.ncm || "Indefinido"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.cest || "Indefinido"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.cfop || "5102"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>{p.csosn || "102"}</td>
                            <td style={{ padding: "8px 10px", textAlign: "center" }}>
                              <button onClick={() => setEditingProduct(p)} style={{ background: "none", border: "none", cursor: "pointer", color: "#7E22CE", fontWeight: 700 }}>Editar ✏️</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Sub-tab Engenharia de Combos */
              <div style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, display: "grid" }}>
                {combosList.map(combo => (
                  <div key={combo.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px" }}>
                    <h3 style={{ margin: "0 0 4px", fontSize: "0.95rem", fontWeight: 800 }}>{combo.name}</h3>
                    <span style={{ fontSize: "0.9rem", fontWeight: 900, color: "#16A34A" }}>{fmt(combo.price)}</span>
                    <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "6px 0 12px" }}>
                      {combo.fiscalBreakdown ? "🟢 Engenharia Discriminada Ativa" : "⚪ Valor Único Padrão"}
                    </p>
                    <button onClick={() => { setEditingCombo(combo); setFiscalItemsDraft(combo.fiscalBreakdown || []); }} style={{ width: "100%", padding: "7px", borderRadius: 8, border: "1px solid #7E22CE", background: "#F3E8FF", color: "#7E22CE", fontWeight: 700, cursor: "pointer" }}>
                      Configurar Engenharia Fiscal
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── NAV 3: NOTAS FISCAIS (STYLE CARDÁPIO WEB SCREENSHOT 3) ── */}
        {activeNav === "invoices" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
                Notas fiscais
              </h1>

              {/* Action buttons matching screenshot 3 red arrows */}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => {
                    const pendingIds = orders.filter(o => o.fiscalStatus !== "EMITTED").map(o => o.id);
                    setSelectedBatchOrderIds(pendingIds);
                    setShowBatchEmitModal(true);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    background: "#fff",
                    color: "#334155",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  }}
                >
                  <Receipt size={15} /> Emissão em lote
                </button>

                <button
                  onClick={() => alert(`Download de ${orderStats.countAutorizadas} XMLs do período iniciado!`)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E1",
                    background: "#fff",
                    color: "#334155",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  }}
                >
                  <Download size={15} /> Baixar XMLs
                </button>
              </div>
            </div>

            {/* Filter Bar: Input + Date Range + Filter */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
                <input
                  value={searchOrder}
                  onChange={e => setSearchOrder(e.target.value)}
                  placeholder="Número do pedido"
                  style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.82rem" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #CBD5E1", borderRadius: 8, padding: "0 10px" }}>
                <Calendar size={14} color="#64748B" />
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ border: "none", fontSize: "0.8rem", outline: "none" }} />
                <span>~</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ border: "none", fontSize: "0.8rem", outline: "none" }} />
              </div>
            </div>

            {/* 4 Summary Cards (Exact Cardápio Web Screenshot 3) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 20 }}>
              {/* Card 1: Total de Vendas */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <DollarSign size={22} color="#0284C7" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>Total de vendas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#1E293B" }}>{orderStats.totalVendas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#64748B" }}>{fmt(orderStats.valVendas)}</span>
                </div>
              </div>

              {/* Card 2: Notas Autorizadas */}
              <div style={{ background: "#fff", border: "1px solid #BBF7D0", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={22} color="#16A34A" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#166534", fontWeight: 700, textTransform: "uppercase" }}>Notas autorizadas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#15803D" }}>{orderStats.countAutorizadas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#166534" }}>{fmt(orderStats.valAutorizadas)}</span>
                </div>
              </div>

              {/* Card 3: Notas Negadas */}
              <div style={{ background: "#fff", border: "1px solid #FED7AA", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FFF7ED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <HelpCircle size={22} color="#EA580C" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#C2410C", fontWeight: 700, textTransform: "uppercase" }}>Notas negadas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#C2410C" }}>{orderStats.countNegadas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#C2410C" }}>{fmt(orderStats.valNegadas)}</span>
                </div>
              </div>

              {/* Card 4: Notas Canceladas */}
              <div style={{ background: "#fff", border: "1px solid #FECACA", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <AlertTriangle size={22} color="#DC2626" />
                </div>
                <div>
                  <span style={{ fontSize: "0.72rem", color: "#991B1B", fontWeight: 700, textTransform: "uppercase" }}>Notas canceladas</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#991B1B" }}>{orderStats.countCanceladas}</div>
                  <span style={{ fontSize: "0.75rem", color: "#991B1B" }}>{fmt(orderStats.valCanceladas)}</span>
                </div>
              </div>
            </div>

            {/* Table of Orders & Invoices (Exact Cardápio Web Table Format) */}
            <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1rem", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#F1F5F9", textTransform: "uppercase", fontSize: "0.7rem", color: "#475569" }}>
                    <th style={{ padding: "10px", textAlign: "left" }}>Pedido</th>
                    <th style={{ padding: "10px", textAlign: "left" }}>Data do pedido</th>
                    <th style={{ padding: "10px", textAlign: "right" }}>Total</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Status do pedido</th>
                    <th style={{ padding: "10px", textAlign: "left" }}>Formas de pagamento</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Tipo</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Série/Número</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Data de emissão</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Status da nota</th>
                    <th style={{ padding: "10px", textAlign: "center" }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(order => {
                    const createdDate = new Date(order.createdAt);
                    const dateStr = createdDate.toLocaleDateString("pt-BR") + " " + createdDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    const isEmitted = order.fiscalStatus === "EMITTED";

                    return (
                      <tr key={order.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "10px", fontWeight: 700, color: "#1E293B" }}>
                          Nº {order.dailyOrderNumber}
                          <span style={{ fontSize: "0.68rem", color: "#94A3B8", display: "block" }}>#{order.id.slice(-8)}</span>
                        </td>
                        <td style={{ padding: "10px", color: "#475569" }}>{dateStr}</td>
                        <td style={{ padding: "10px", textAlign: "right", fontWeight: 700 }}>{fmt(order.totalAmount)}</td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "#DCFCE7", color: "#15803D" }}>
                            Concluído
                          </span>
                        </td>
                        <td style={{ padding: "10px", color: "#334155" }}>{order.paymentMethod}</td>
                        <td style={{ padding: "10px", textAlign: "center", color: "#64748B" }}>{order.deliveryType || "Delivery"}</td>
                        <td style={{ padding: "10px", textAlign: "center", color: isEmitted ? "#1E293B" : "#94A3B8" }}>
                          {isEmitted ? `${order.fiscalInfo?.serie}/${order.fiscalInfo?.nfceNumber}` : "Indefinido"}
                        </td>
                        <td style={{ padding: "10px", textAlign: "center", color: isEmitted ? "#475569" : "#94A3B8" }}>
                          {isEmitted ? dateStr : "Indefinido"}
                        </td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: isEmitted ? "#DCFCE7" : "#F1F5F9", color: isEmitted ? "#15803D" : "#64748B" }}>
                            {isEmitted ? "Autorizada" : "Indefinido"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", textAlign: "center" }}>
                          {isEmitted ? (
                            <button onClick={() => setSelectedOrderForDanfe(order)} style={{ background: "none", border: "none", cursor: "pointer" }} title="Ver DANFE">
                              📄 Espelho
                            </button>
                          ) : (
                            <button
                              onClick={() => { setSelectedOrderForEmit(order); setEmitCpfInput(order.customerCpfCnpj || ""); }}
                              style={{ background: "#F3E8FF", border: "1px solid #7E22CE", color: "#7E22CE", borderRadius: 6, padding: "4px 8px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer" }}
                            >
                              Emitir
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── NAV 4: INUTILIZAÇÕES DE NUMERAÇÃO ── */}
        {activeNav === "inutilizacao" && (
          <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.5rem", maxWidth: 600 }}>
            <h1 style={{ margin: "0 0 6px", fontSize: "1.35rem", fontWeight: 800, color: "#1E293B" }}>
              Inutilização de Numeração Fiscal
            </h1>
            <p style={{ margin: "0 0 1.25rem", fontSize: "0.82rem", color: "#64748B" }}>
              Solicite à SEFAZ a inutilização de uma faixa de números de NFC-e que não foram utilizados devido a falhas técnicas ou saltos de numeração.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Série da Nota *</label>
                <input value={inutilSerie} onChange={e => setInutilSerie(e.target.value)} style={{ width: 120, padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Número Inicial *</label>
                  <input type="number" value={inutilNumIni} onChange={e => setInutilNumIni(e.target.value)} placeholder="Ex: 100" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Número Final *</label>
                  <input type="number" value={inutilNumFin} onChange={e => setInutilNumFin(e.target.value)} placeholder="Ex: 105" style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block" }}>Justificativa (Mínimo 15 caracteres) *</label>
                <textarea rows={3} value={inutilJustif} onChange={e => setInutilJustif(e.target.value)} placeholder="Ex: Falha de conexão durante emissão no PDV gerando salto de sequência." style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #CBD5E1", fontSize: "0.85rem", marginTop: 4 }} />
              </div>

              <button onClick={handleInutilizar} disabled={inutilizing} style={{ padding: "10px 18px", background: "#7E22CE", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", marginTop: 8 }}>
                {inutilizing ? "Inutilizando na SEFAZ..." : "Confirmar Inutilização"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL 1: EMISSÃO FISCAL INDIVIDUAL (CARDÁPIO WEB SCREENSHOT 4) ── */}
      {selectedOrderForEmit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setSelectedOrderForEmit(null)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 480, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#1E293B" }}>Emissão fiscal</h2>
              <button onClick={() => setSelectedOrderForEmit(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            <div style={{ padding: "1.25rem" }}>
              {/* Alert 1: Azul */}
              <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "12px", marginBottom: 12, fontSize: "0.82rem", color: "#0369A1", lineHeight: 1.4 }}>
                Pedidos com nota fiscal emitida não podem ser alterados ou cancelados. Para cancelá-los, é necessário cancelar a nota primeiro, respeitando o prazo de até 30 minutos após a emissão.
              </div>

              {/* Alert 2: Laranja */}
              <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "12px", marginBottom: 16, fontSize: "0.82rem", color: "#C2410C", lineHeight: 1.4 }}>
                Para notas com entrega a domicílio é necessário o CPF do cliente. Sem essa informação, o indicador de presença na nota será <strong>Operação Presencial</strong>.
              </div>

              <p style={{ fontSize: "0.9rem", color: "#1E293B", margin: "0 0 16px", lineHeight: 1.5 }}>
                Emissão da <strong>NFC-e</strong> do pedido <strong>{selectedOrderForEmit.dailyOrderNumber}</strong> no valor de <strong>{fmt(selectedOrderForEmit.totalAmount)}</strong> feito no dia <strong>{new Date(selectedOrderForEmit.createdAt).toLocaleDateString("pt-BR")} às {new Date(selectedOrderForEmit.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong>
              </p>

              {/* CPF / CNPJ Input (Roxo) */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#7E22CE", display: "block", marginBottom: 4 }}>CPF/CNPJ na nota</label>
                <input
                  value={emitCpfInput}
                  onChange={e => setEmitCpfInput(e.target.value)}
                  placeholder="Deixe em branco caso não queira informar"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "2px solid #7E22CE", fontSize: "0.88rem", outline: "none" }}
                />
              </div>

              {/* Footer Buttons */}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button onClick={() => handleEmitSingle(true)} disabled={emitting} style={{ padding: "10px 16px", borderRadius: 8, border: "1.5px solid #7E22CE", background: "#fff", color: "#7E22CE", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                  EMITIR E IMPRIMIR
                </button>
                <button onClick={() => handleEmitSingle(false)} disabled={emitting} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#7E22CE", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                  {emitting ? "EMITINDO..." : "EMITIR"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: EMISSÃO EM LOTE (SCREENSHOT 5 RED ARROW) ── */}
      {showBatchEmitModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setShowBatchEmitModal(false)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 540, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#1E293B" }}>Emissão em lote de notas fiscais</h2>
              <button onClick={() => setShowBatchEmitModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            <div style={{ padding: "1.25rem" }}>
              <p style={{ fontSize: "0.85rem", color: "#475569", margin: "0 0 12px" }}>
                Selecione os pedidos abaixo para emitir todas as NFC-e simultaneamente junto à SEFAZ:
              </p>

              <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #E2E8F0", borderRadius: 10, padding: 8, marginBottom: 16 }}>
                {orders.filter(o => o.fiscalStatus !== "EMITTED").map(order => {
                  const checked = selectedBatchOrderIds.includes(order.id);
                  return (
                    <label key={order.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 6, background: checked ? "#F3E8FF" : "#fff", cursor: "pointer", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input type="checkbox" checked={checked} onChange={() => setSelectedBatchOrderIds(prev => checked ? prev.filter(id => id !== order.id) : [...prev, order.id])} style={{ accentColor: "#7E22CE", width: 16, height: 16 }} />
                        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Pedido #{order.dailyOrderNumber} — {order.customerName}</span>
                      </div>
                      <strong style={{ fontSize: "0.85rem", color: "#16A34A" }}>{fmt(order.totalAmount)}</strong>
                    </label>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "#64748B" }}>{selectedBatchOrderIds.length} pedidos selecionados</span>
                <button onClick={handleBatchEmit} disabled={batchEmitting || selectedBatchOrderIds.length === 0} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: "#7E22CE", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                  {batchEmitting ? "EMITINDO EM LOTE..." : `EMITIR ${selectedBatchOrderIds.length} NOTAS`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: ESPELHO DANFE NFC-E COMPLETO ── */}
      {selectedOrderForDanfe && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setSelectedOrderForDanfe(null)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 70px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, borderBottom: "2px solid #0F172A", paddingBottom: 8 }}>
              <div>
                <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#64748B" }}>DOCUMENTO AUXILIAR DA NFC-E</span>
                <h2 style={{ margin: "2px 0 0", fontSize: "1.1rem", fontWeight: 900 }}>DANFE NFC-e nº {selectedOrderForDanfe.fiscalInfo?.nfceNumber || "15493"}</h2>
              </div>
              <button onClick={() => setSelectedOrderForDanfe(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px", marginBottom: 12, fontSize: "0.8rem" }}>
              <p style={{ margin: "0 0 4px" }}><strong>Emitente:</strong> {storeName} (CNPJ: {fiscalConfig.cnpj || cpfCnpj})</p>
              <p style={{ margin: "0 0 4px" }}><strong>Chave de Acesso:</strong> <code style={{ fontSize: "0.7rem" }}>{selectedOrderForDanfe.fiscalInfo?.nfceKey}</code></p>
              <p style={{ margin: 0 }}><strong>Protocolo:</strong> {selectedOrderForDanfe.fiscalInfo?.protocol}</p>
            </div>

            <h4 style={{ margin: "0 0 6px", fontSize: "0.85rem", fontWeight: 800 }}>Itens do Documento Fiscal</h4>
            <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 8, padding: 10, marginBottom: 14, fontSize: "0.8rem" }}>
              {selectedOrderForDanfe.fiscalInfo?.items.map((it: any, idx: number) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span>{it.quantity}x {it.name}</span>
                  <strong>{fmt(it.totalPrice)}</strong>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => window.print()} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#0F172A", color: "#fff", fontWeight: 700, fontSize: "0.85rem", cursor: "pointer" }}>
                🖨️ Imprimir DANFE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 4: EDITAR DADOS TRIBUTÁRIOS DO PRODUTO (NCM, CEST, CFOP, CSOSN) ── */}
      {editingProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setEditingProduct(null)}>
          <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 500, padding: "1.25rem", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, borderBottom: "1px solid #E2E8F0", paddingBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#1E293B" }}>Tributação do Produto</h2>
              <button onClick={() => setEditingProduct(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem" }}>✕</button>
            </div>

            <p style={{ margin: "0 0 14px", fontSize: "0.85rem", fontWeight: 700, color: "#7E22CE" }}>
              {editingProduct.name} ({editingProduct.category}) — {fmt(editingProduct.price)}
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>NCM *</label>
                <input value={editingProduct.ncm || ""} onChange={e => setEditingProduct({ ...editingProduct, ncm: e.target.value })} placeholder="Ex: 2106.90.90" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CEST</label>
                <input value={editingProduct.cest || ""} onChange={e => setEditingProduct({ ...editingProduct, cest: e.target.value })} placeholder="Ex: 28.062.00" style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CFOP *</label>
                <input value={editingProduct.cfop || "5102"} onChange={e => setEditingProduct({ ...editingProduct, cfop: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CSOSN / CST *</label>
                <input value={editingProduct.csosn || "102"} onChange={e => setEditingProduct({ ...editingProduct, csosn: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CST PIS</label>
                <input value={editingProduct.pis || "49"} onChange={e => setEditingProduct({ ...editingProduct, pis: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>

              <div>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", display: "block" }}>CST COFINS</label>
                <input value={editingProduct.cofins || "49"} onChange={e => setEditingProduct({ ...editingProduct, cofins: e.target.value })} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #CBD5E1", fontSize: "0.82rem", marginTop: 2 }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setEditingProduct(null)} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #CBD5E1", background: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={handleSaveProductTax} style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: "#7E22CE", color: "#fff", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>Salvar Tributação</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
