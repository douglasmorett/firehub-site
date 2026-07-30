"use client";
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingBag,
  BarChart2, ArrowUpRight, ArrowDownRight, Download, Filter,
  Package, Truck, CreditCard, Percent, Users, Plus, Trash2, Building2
} from "lucide-react";
import { calcMensalidade, FIREHUB_PLAN } from "@/lib/firehub-billing";

type BillingCycle = {
  yearMonth: string; totalSales: number; amountDue: number;
  amountOffset: number; amountPending: number; status: string;
  asaasBoletoUrl?: string | null; asaasBoletoCode?: string | null;
};

type FixedCost = { id: string; label: string; value: number };

type OrderItem = { quantity: number; price: number; cost: number; name: string };
type Order = {
  id: string; totalAmount: number; deliveryFee: number; motoboyFee: number;
  deliveryDistance: number; status: string; deliveryType: string;
  paymentMethod: string; source: string; createdAt: string;
  items: OrderItem[]; motoboy: any;
};

// Configura taxa por forma de pagamento (padrão FireHub)
const DEFAULT_GATEWAY_FEES: Record<string, number> = {
  PIX: 0.5, CREDITO: 2.99, DEBITO: 1.5, DINHEIRO: 0, VOUCHER: 5.0
};

// Plataforma FireHub — Pay as You Grow
// 3% do faturamento (mín R$60 · teto R$300)
function calcPlatformFee(total: number): number {
  return calcMensalidade(total).mensalidade;
}

const PERIOD_PRESETS = [
  { label: "Hoje", days: 0 },
  { label: "7 dias", days: 7 },
  { label: "15 dias", days: 15 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "Este mês", days: -1 },
];

function getRange(preset: number): { from: Date; to: Date } {
  const to = new Date();
  if (preset === 0) {
    const from = new Date(to); from.setHours(0, 0, 0, 0);
    return { from, to };
  }
  if (preset === -1) {
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    return { from, to };
  }
  const from = new Date(to); from.setDate(to.getDate() - preset);
  return { from, to };
}

function fmtR(v: number) { return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`; }
function fmtPct(v: number) { return `${v.toFixed(1)}%`; }

function KPICard({ icon, label, value, sub, color, trend }: any) {
  return (
    <div style={{
      background: "#fff", borderRadius: "16px", padding: "20px 22px",
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9",
      display: "flex", flexDirection: "column", gap: "8px"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: 40, height: 40, borderRadius: "10px", background: color + "15", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
        {trend !== undefined && (
          <span style={{ fontSize: "0.75rem", fontWeight: 700, color: trend >= 0 ? "#16A34A" : "#DC2626", display: "flex", alignItems: "center", gap: "2px" }}>
            {trend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      <div>
        <p style={{ fontSize: "0.78rem", color: "#64748B", margin: 0 }}>{label}</p>
        <p style={{ fontSize: "1.35rem", fontWeight: 800, color: "#0F172A", margin: 0 }}>{value}</p>
        {sub && <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: 0 }}>{sub}</p>}
      </div>
    </div>
  );
}

function DRERow({ label, value, indent = 0, bold = false, color = "#0F172A", border = false }: any) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: `${border ? "12px" : "8px"} ${16 + indent * 16}px`,
      borderTop: border ? "2px solid #E2E8F0" : "1px solid #F1F5F9",
      fontWeight: bold ? 800 : 400, fontSize: bold ? "0.95rem" : "0.87rem"
    }}>
      <span style={{ color: "#475569" }}>{label}</span>
      <span style={{ color, fontWeight: bold ? 800 : 600 }}>{typeof value === "number" ? fmtR(value) : value}</span>
    </div>
  );
}

export default function DREClient({ orders, paymentFees, storeName, storeCreatedAt, produtosSemCusto = [], initialFixedCosts = [], initialGoals = {} }: {
  orders: Order[];
  paymentFees: any;
  storeName: string;
  storeCreatedAt?: string;
  produtosSemCusto?: { id: string; name: string }[];
  initialFixedCosts?: FixedCost[];
  initialGoals?: Record<string, any>;
}) {
  const [preset, setPreset] = useState(1); // 7 dias default
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [activeTab, setActiveTab] = useState<"dre" | "extrato" | "pagamentos" | "online" | "mensalidade" | "custosfix">("dre");
  const [showAllSemCusto, setShowAllSemCusto] = useState(false);

  // ===== CICLO DE FATURAMENTO REAL (API) =====
  const [billingCycle, setBillingCycle] = useState<BillingCycle | null>(null);
  useEffect(() => {
    fetch("/api/billing/cycle")
      .then(r => r.json())
      .then(d => { if (!d.error) setBillingCycle(d); })
      .catch(() => {});
  }, []);

  // ===== CUSTOS FIXOS =====
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>(initialFixedCosts);
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [savingFC, setSavingFC] = useState(false);
  const [savedFC, setSavedFC] = useState(false);

  const totalFixedCosts = fixedCosts.reduce((s, c) => s + c.value, 0);

  const saveFixedCosts = useCallback(async (costs: FixedCost[]) => {
    setSavingFC(true);
    try {
      await fetch("/api/store/fixed-costs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixedCosts: costs }),
      });
      setSavedFC(true);
      setTimeout(() => setSavedFC(false), 2000);
    } finally { setSavingFC(false); }
  }, []);

  const addFixedCost = () => {
    const val = parseFloat(newValue.replace(",", "."));
    if (!newLabel.trim() || isNaN(val) || val <= 0) return;
    const updated = [...fixedCosts, { id: Date.now().toString(), label: newLabel.trim(), value: val }];
    setFixedCosts(updated);
    setNewLabel("");
    setNewValue("");
    saveFixedCosts(updated);
  };

  const removeFixedCost = (id: string) => {
    const updated = fixedCosts.filter(c => c.id !== id);
    setFixedCosts(updated);
    saveFixedCosts(updated);
  };

  const { from, to } = useMemo(() => {
    if (useCustom && customFrom && customTo) {
      return { from: new Date(customFrom + "T00:00"), to: new Date(customTo + "T23:59") };
    }
    return getRange(PERIOD_PRESETS[preset].days);
  }, [preset, useCustom, customFrom, customTo]);

  const filtered = useMemo(() =>
    orders.filter(o => {
      const d = new Date(o.createdAt);
      return d >= from && d <= to && o.status !== "CANCELADO";
    }), [orders, from, to]);

  const cancelled = useMemo(() => orders.filter(o => {
    const d = new Date(o.createdAt); return d >= from && d <= to && o.status === "CANCELADO";
  }), [orders, from, to]);

  const allInRange = useMemo(() => orders.filter(o => {
    const d = new Date(o.createdAt); return d >= from && d <= to;
  }), [orders, from, to]);

  // ===== CÁLCULOS DRE =====
  const dre = useMemo(() => {
    const receitaBruta = filtered.reduce((s, o) => s + o.totalAmount, 0);
    const totalFrete = filtered.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const receitaSemFrete = receitaBruta - totalFrete;

    // CMV (custo dos produtos)
    const cmv = filtered.reduce((s, o) =>
      s + o.items.reduce((si, i) => si + (i.cost || 0) * i.quantity, 0), 0);

    // Taxa de gateway por forma de pagamento
    const taxaGateway = filtered.reduce((s, o) => {
      const pm = (o.paymentMethod || "DINHEIRO").toUpperCase();
      const fees = paymentFees || {};
      let rate = 0;
      if (fees[pm] && typeof fees[pm] === "object") rate = fees[pm].rate || 0;
      else rate = DEFAULT_GATEWAY_FEES[pm] || 0;
      return s + (o.totalAmount * (rate / 100));
    }, 0);

    // Custo de motoboy
    const custoMotoboy = filtered
      .filter(o => o.deliveryType === "DELIVERY")
      .reduce((s, o) => s + (o.motoboyFee || 0), 0);

    // Taxa FireHub (Pay as You Grow)
    const taxaFireHub = calcPlatformFee(receitaBruta);

    // Proporção dos custos fixos mensais no período selecionado
    // (ex: 7 dias = 7/30 dos custos fixos mensais)
    const diasNoPeriodo = Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));
    const proporcaoPeriodo = Math.min(1, diasNoPeriodo / 30);
    const custosFixosPeriodo = totalFixedCosts * proporcaoPeriodo;

    // DRE
    const lucro1 = receitaSemFrete - cmv;  // Lucro Bruto
    const despesasOp = taxaGateway + custoMotoboy;
    const ebitda = lucro1 - despesasOp;
    const lucroAntesFixos = ebitda - taxaFireHub;
    const lucroLiquido = lucroAntesFixos - custosFixosPeriodo; // ← impacto dos custos fixos

    // Totais
    const totalPedidos = filtered.length;
    const ticketMedio = totalPedidos > 0 ? receitaBruta / totalPedidos : 0;
    const delivery = filtered.filter(o => o.deliveryType === "DELIVERY").length;
    const retirada = filtered.filter(o => o.deliveryType === "RETIRADA").length;
    const margemLiquida = receitaBruta > 0 ? (lucroLiquido / receitaBruta) * 100 : 0;
    const margemCMV = receitaSemFrete > 0 ? (cmv / receitaSemFrete) * 100 : 0;

    return {
      receitaBruta, totalFrete, receitaSemFrete, cmv, taxaGateway,
      custoMotoboy, taxaFireHub, lucro1, despesasOp, ebitda,
      lucroAntesFixos, custosFixosPeriodo, lucroLiquido,
      totalPedidos, ticketMedio, delivery, retirada, margemLiquida, margemCMV,
      cancelados: cancelled.length, diasNoPeriodo, proporcaoPeriodo
    };
  }, [filtered, cancelled, paymentFees, totalFixedCosts, from, to]);

  // Grupos por forma de pagamento
  const paymentGroups = useMemo(() => {
    const g: Record<string, { count: number; total: number }> = {};
    allInRange.forEach(o => {
      const pm = o.paymentMethod || "Não informado";
      if (!g[pm]) g[pm] = { count: 0, total: 0 };
      g[pm].count++;
      g[pm].total += o.totalAmount;
    });
    return Object.entries(g).sort((a, b) => b[1].total - a[1].total);
  }, [allInRange]);

  const tabStyle = (tab: string) => ({
    padding: "8px 20px", borderRadius: "10px", border: "none", cursor: "pointer",
    fontWeight: 700, fontSize: "0.85rem", fontFamily: "inherit",
    background: activeTab === tab ? "#0F172A" : "transparent",
    color: activeTab === tab ? "#fff" : "#64748B",
    transition: "all 0.2s"
  });

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8FAFC", minHeight: "100vh" }}>
      {/* HEADER */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E2E8F0", padding: "1rem 1.5rem" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h1 style={{ fontWeight: 800, fontSize: "1.4rem", margin: 0 }}>📊 DRE — Demonstrativo de Resultado</h1>
              <p style={{ fontSize: "0.8rem", color: "#64748B", margin: 0 }}>{storeName}</p>
            </div>
            {/* FILTROS DE PERÍODO */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
              {PERIOD_PRESETS.map((p, i) => (
                <button key={i}
                  onClick={() => { setPreset(i); setUseCustom(false); }}
                  style={{
                    padding: "6px 14px", borderRadius: "10px", border: "none", cursor: "pointer",
                    fontWeight: 700, fontSize: "0.8rem", fontFamily: "inherit",
                    background: !useCustom && preset === i ? "#0F172A" : "#F1F5F9",
                    color: !useCustom && preset === i ? "#fff" : "#475569",
                    transition: "all 0.2s"
                  }}>
                  {p.label}
                </button>
              ))}
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setUseCustom(true); }}
                  style={{ padding: "5px 8px", borderRadius: "8px", border: "1.5px solid #E2E8F0", fontSize: "0.78rem" }} />
                <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>até</span>
                <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setUseCustom(true); }}
                  style={{ padding: "5px 8px", borderRadius: "8px", border: "1.5px solid #E2E8F0", fontSize: "0.78rem" }} />
              </div>
            </div>
          </div>

          {/* TABS */}
          <div style={{ display: "flex", gap: "4px", marginTop: "1rem", background: "#F8FAFC", borderRadius: "12px", padding: "4px", width: "fit-content", flexWrap: "wrap" }}>
            <button style={tabStyle("dre")} onClick={() => setActiveTab("dre")}>📊 DRE</button>
            <button style={tabStyle("extrato")} onClick={() => setActiveTab("extrato")}>📋 Extrato</button>
            <button style={tabStyle("pagamentos")} onClick={() => setActiveTab("pagamentos")}>💳 Formas de Pgto</button>
            <button
              style={{
                ...tabStyle("online"),
                background: activeTab === "online" ? "#2563EB" : "#EFF6FF",
                color: activeTab === "online" ? "#fff" : "#1D4ED8",
                fontWeight: 800
              }}
              onClick={() => setActiveTab("online")}
            >
              ⚡ Pagamentos Online (MP)
            </button>
            <button
              style={{
                ...tabStyle("relatorios"),
                background: "#F1F5F9",
                color: "#475569",
                fontWeight: 700
              }}
              onClick={() => window.location.href = "/store/relatorios"}
            >
              📈 Relatórios
            </button>
            <button style={tabStyle("mensalidade")} onClick={() => setActiveTab("mensalidade")}>💰 Mensalidade</button>
            <button
              style={{
                ...tabStyle("custosfix"),
                background: activeTab === "custosfix" ? "#7C3AED" : (fixedCosts.length > 0 ? "#F3E8FF" : "transparent"),
                color: activeTab === "custosfix" ? "#fff" : (fixedCosts.length > 0 ? "#7C3AED" : "#64748B"),
              }}
              onClick={() => setActiveTab("custosfix")}
            >
              🏢 Custos Fixos {fixedCosts.length > 0 && <span style={{ background: "#7C3AED", color: "#fff", borderRadius: 20, padding: "1px 7px", fontSize: "0.72rem", marginLeft: 4 }}>{fixedCosts.length}</span>}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem" }}>

        {/* ===== ALERTA CMV + KPIs — visíveis apenas na aba DRE ===== */}
        {activeTab === "dre" && (
          <>
            {/* ALERTA PRODUTOS SEM CUSTO */}
            {produtosSemCusto.length > 0 && (
              <div style={{
                background: "#FFFBEB", border: "2px solid #F59E0B", borderRadius: "14px",
                padding: "16px 20px", marginBottom: "1.5rem",
                display: "flex", gap: "14px", alignItems: "flex-start"
              }}>
                <div style={{ fontSize: "1.6rem", flexShrink: 0 }}>⚠️</div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 800, color: "#92400E", margin: "0 0 4px", fontSize: "0.95rem" }}>
                    Dados de CMV incompletos — {produtosSemCusto.length} {produtosSemCusto.length === 1 ? "produto sem" : "produtos sem"} custo cadastrado
                  </p>
                  <p style={{ color: "#78350F", fontSize: "0.82rem", margin: "0 0 10px", lineHeight: 1.5 }}>
                    O <strong>Custo dos Produtos Vendidos (CMV)</strong> e a <strong>margem de lucro</strong> exibidos abaixo estão <strong>incorretos</strong>.
                    Clique em cada produto para cadastrar o custo direto no cardápio.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                    {(showAllSemCusto ? produtosSemCusto : produtosSemCusto.slice(0, 10)).map(p => (
                      <a
                        key={p.id}
                        href="/store/cardapio"
                        title={`Clique para cadastrar custo de ${p.name}`}
                        style={{
                          background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: "6px",
                          padding: "3px 10px", fontSize: "0.78rem", fontWeight: 600, color: "#92400E",
                          textDecoration: "none", cursor: "pointer", transition: "background 0.15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#FDE68A")}
                        onMouseLeave={e => (e.currentTarget.style.background = "#FEF3C7")}
                      >
                        {p.name}
                      </a>
                    ))}
                    {produtosSemCusto.length > 10 && (
                      <button
                        onClick={() => setShowAllSemCusto(v => !v)}
                        style={{
                          fontSize: "0.78rem", color: "#92400E", fontWeight: 700,
                          background: "none", border: "1px dashed #FCD34D", borderRadius: "6px",
                          padding: "3px 10px", cursor: "pointer", alignSelf: "center"
                        }}
                      >
                        {showAllSemCusto ? "▲ Ver menos" : `▼ Ver mais ${produtosSemCusto.length - 10} produtos`}
                      </button>
                    )}
                  </div>
                  <a
                    href="/store/cardapio"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "6px",
                      background: "#F59E0B", color: "#fff", padding: "8px 16px",
                      borderRadius: "8px", fontWeight: 700, fontSize: "0.82rem", textDecoration: "none"
                    }}
                  >
                    📦 Abrir cardápio e cadastrar custos
                  </a>
                </div>
              </div>
            )}

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
              <KPICard icon={<DollarSign size={18} color="#16A34A" />} label="Receita Bruta" value={fmtR(dre.receitaBruta)} sub={`${dre.totalPedidos} pedidos`} color="#16A34A" />
              <KPICard icon={<TrendingUp size={18} color="#3B82F6" />} label="Lucro Líquido" value={fmtR(dre.lucroLiquido)} sub={`Margem: ${fmtPct(dre.margemLiquida)}`} color="#3B82F6" />
              <KPICard icon={<ShoppingBag size={18} color="#8B5CF6" />} label="Ticket Médio" value={fmtR(dre.ticketMedio)} sub={`Delivery: ${dre.delivery} | Retirada: ${dre.retirada}`} color="#8B5CF6" />
              <KPICard icon={<Package size={18} color="#F59E0B" />} label="CMV (Custo Produto)" value={fmtR(dre.cmv)} sub={`${fmtPct(dre.margemCMV)} da receita`} color="#F59E0B" />
              <KPICard icon={<Truck size={18} color="#06B6D4" />} label="Custo Motoboy" value={fmtR(dre.custoMotoboy)} sub={`${dre.delivery} entregas`} color="#06B6D4" />
              <KPICard icon={<Users size={18} color="#EC4899" />} label="Cancelamentos" value={`${dre.cancelados}`} sub="pedidos cancelados" color="#EC4899" />
            </div>
          </>
        )}

        {/* ===== ABA DRE ===== */}
        {activeTab === "dre" && (
          <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: "8px" }}>
              <BarChart2 size={20} color="#0F172A" />
              <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>
                Demonstrativo de Resultado — {from.toLocaleDateString("pt-BR")} a {to.toLocaleDateString("pt-BR")}
              </h2>
            </div>

            {/* RECEITAS */}
            <div style={{ padding: "12px 24px 4px", background: "#F0FDF4" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#16A34A", letterSpacing: 1 }}>RECEITAS</span>
            </div>
            <DRERow label="(+) Receita Bruta Total" value={dre.receitaBruta} bold />
            <DRERow label="    Receita de Produtos" value={dre.receitaSemFrete} indent={1} />
            <DRERow label="    Taxa de Entrega Cobrada" value={dre.totalFrete} indent={1} />

            {/* CMV */}
            <div style={{ padding: "12px 24px 4px", background: "#FFF7ED" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#EA580C", letterSpacing: 1 }}>CUSTO DOS PRODUTOS VENDIDOS</span>
            </div>
            <DRERow label="(-) CMV — Custo das Mercadorias" value={-dre.cmv} color={dre.cmv > 0 ? "#DC2626" : "#0F172A"} />
            <DRERow label="(=) LUCRO BRUTO" value={dre.lucro1} bold color={dre.lucro1 >= 0 ? "#16A34A" : "#DC2626"} border />

            {/* DESPESAS OPERACIONAIS */}
            <div style={{ padding: "12px 24px 4px", background: "#FFF1F2" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#E11D48", letterSpacing: 1 }}>DESPESAS OPERACIONAIS</span>
            </div>
            <DRERow label="(-) Taxa de Pagamento (Gateway)" value={-dre.taxaGateway} color="#DC2626" />
            <DRERow label="(-) Custo de Entrega (Motoboy)" value={-dre.custoMotoboy} color="#DC2626" />
            <DRERow label="(=) EBITDA" value={dre.ebitda} bold color={dre.ebitda >= 0 ? "#16A34A" : "#DC2626"} border />

            {/* TAXA FIREHUB */}
            <div style={{ padding: "12px 24px 4px", background: "#F0F9FF" }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#0369A1", letterSpacing: 1 }}>PLATAFORMA FIREHUB</span>
            </div>
            <DRERow label={`(-) Mensalidade FireHub (3% · mín R$60 · teto R$${FIREHUB_PLAN.MAX_MONTHLY})`} value={-dre.taxaFireHub} color="#0369A1" />
            <div style={{ padding: "6px 24px 10px", background: "#F0F9FF" }}>
              <span style={{ fontSize: "0.72rem", color: "#0369A1" }}>
                {dre.receitaBruta >= FIREHUB_PLAN.THRESHOLD
                  ? `✅ Teto atingido — R$${FIREHUB_PLAN.MAX_MONTHLY} fixo (faturamento ≥ R$${FIREHUB_PLAN.THRESHOLD.toLocaleString("pt-BR")})`
                  : `📊 ${FIREHUB_PLAN.PERCENT_RATE}% de R$${dre.receitaBruta.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} — aumenta até R$${FIREHUB_PLAN.MAX_MONTHLY} teto`
                }
              </span>
            </div>
            <div style={{ background: dre.lucroAntesFixos >= 0 ? "#F0FDF4" : "#FFF1F2", borderTop: "2px solid #E2E8F0" }}>
              <DRERow label="(=) LUCRO ANTES DOS CUSTOS FIXOS" value={dre.lucroAntesFixos} bold color={dre.lucroAntesFixos >= 0 ? "#16A34A" : "#DC2626"} />
            </div>

            {/* CUSTOS FIXOS */}
            {fixedCosts.length > 0 && (
              <>
                <div style={{ padding: "12px 24px 4px", background: "#F5F3FF" }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#7C3AED", letterSpacing: 1 }}>
                    CUSTOS FIXOS MENSAIS
                    {dre.proporcaoPeriodo < 1 && (
                      <span style={{ fontWeight: 400, marginLeft: 8 }}>
                        (proporcional: {dre.diasNoPeriodo} dias = {Math.round(dre.proporcaoPeriodo * 100)}% do mês)
                      </span>
                    )}
                  </span>
                </div>
                {fixedCosts.map(c => (
                  <DRERow key={c.id} label={`(-) ${c.label}`} value={-(c.value * dre.proporcaoPeriodo)} color="#7C3AED" indent={1} />
                ))}
                <DRERow label="(-) Total Custos Fixos (período)" value={-dre.custosFixosPeriodo} color="#7C3AED" />
              </>
            )}

            {fixedCosts.length === 0 && (
              <div style={{ padding: "10px 24px", background: "#FAFAFA", borderTop: "1px solid #F1F5F9" }}>
                <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
                  💡 Nenhum custo fixo cadastrado —{" "}
                  <button onClick={() => setActiveTab("custosfix")} style={{ background: "none", border: "none", color: "#7C3AED", cursor: "pointer", fontWeight: 700, fontSize: "0.75rem", padding: 0, fontFamily: "inherit" }}>
                    clique aqui para cadastrar aluguel, funcionários, etc.
                  </button>
                </span>
              </div>
            )}

            <div style={{ background: dre.lucroLiquido >= 0 ? "#F0FDF4" : "#FFF1F2", borderTop: "2px solid #E2E8F0" }}>
              <DRERow label="(=) LUCRO LÍQUIDO FINAL" value={dre.lucroLiquido} bold color={dre.lucroLiquido >= 0 ? "#16A34A" : "#DC2626"} />
            </div>

            {/* Margem visual */}
            <div style={{ padding: "20px 24px", borderTop: "1px solid #F1F5F9" }}>
              <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
                {[
                  { label: "Margem Bruta", val: dre.receitaBruta > 0 ? (dre.lucro1 / dre.receitaBruta) * 100 : 0, color: "#F59E0B" },
                  { label: "Margem EBITDA", val: dre.receitaBruta > 0 ? (dre.ebitda / dre.receitaBruta) * 100 : 0, color: "#3B82F6" },
                  { label: "Margem Líquida", val: dre.margemLiquida, color: "#16A34A" },
                ].map((m, i) => (
                  <div key={i} style={{ flex: 1, minWidth: 160 }}>
                    <p style={{ fontSize: "0.75rem", color: "#64748B", margin: "0 0 4px" }}>{m.label}</p>
                    <div style={{ background: "#F1F5F9", borderRadius: "6px", height: "8px", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, Math.max(0, m.val))}%`, height: "100%", background: m.color, borderRadius: "6px", transition: "width 0.5s" }} />
                    </div>
                    <p style={{ fontSize: "0.85rem", fontWeight: 800, color: m.color, margin: "4px 0 0" }}>{fmtPct(m.val)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ===== ABA EXTRATO ===== */}
        {activeTab === "extrato" && (
          <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontWeight: 800, fontSize: "1rem", margin: 0 }}>📋 Extrato de Pedidos ({allInRange.length})</h2>
              <span style={{ fontSize: "0.8rem", color: "#64748B" }}>
                Total: <strong style={{ color: "#16A34A" }}>{fmtR(filtered.reduce((s, o) => s + o.totalAmount, 0))}</strong>
              </span>
            </div>
            <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
              {allInRange.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "#94A3B8" }}>Nenhum pedido neste período.</div>
              ) : allInRange.map(o => {
                const isCancelled = o.status === "CANCELADO";
                return (
                  <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", borderBottom: "1px solid #F8FAFC", opacity: isCancelled ? 0.5 : 1 }}>
                    <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                      <div style={{ width: 32, height: 32, borderRadius: "8px", background: isCancelled ? "#FEE2E2" : "#F0FDF4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem" }}>
                        {isCancelled ? "❌" : o.deliveryType === "DELIVERY" ? "🛵" : "🏪"}
                      </div>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: "0.85rem", margin: 0 }}>#{o.id.slice(-6).toUpperCase()}</p>
                        <p style={{ fontSize: "0.73rem", color: "#94A3B8", margin: 0 }}>
                          {new Date(o.createdAt).toLocaleString("pt-BR")} · {o.paymentMethod || "Não informado"}
                        </p>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontWeight: 800, fontSize: "0.9rem", color: isCancelled ? "#DC2626" : "#16A34A", margin: 0 }}>
                        {isCancelled ? "-" : "+"}{fmtR(o.totalAmount)}
                      </p>
                      {o.deliveryFee > 0 && <p style={{ fontSize: "0.7rem", color: "#94A3B8", margin: 0 }}>+{fmtR(o.deliveryFee)} frete</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== ABA PAGAMENTOS ===== */}
        {activeTab === "pagamentos" && (
          <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #F1F5F9" }}>
              <h2 style={{ fontWeight: 800, fontSize: "1rem", margin: 0 }}>💳 Breakdown por Forma de Pagamento</h2>
            </div>
            {paymentGroups.length === 0 ? (
              <div style={{ textAlign: "center", padding: "3rem", color: "#94A3B8" }}>Nenhum dado neste período.</div>
            ) : (
              <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                {paymentGroups.map(([pm, g], i) => {
                  const totalBruto = allInRange.reduce((s, o) => s + o.totalAmount, 0);
                  const pct = totalBruto > 0 ? (g.total / totalBruto) * 100 : 0;
                  const PM_COLORS: Record<string, string> = {
                    PIX: "#00BFA5", DINHEIRO: "#4CAF50", CREDITO: "#9C27B0",
                    DEBITO: "#2196F3", VOUCHER: "#E65100"
                  };
                  const color = PM_COLORS[(pm || "").toUpperCase()] || "#64748B";
                  return (
                    <div key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>{pm || "Não informado"}</span>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontWeight: 800, color }}>{fmtR(g.total)}</span>
                          <span style={{ fontSize: "0.75rem", color: "#94A3B8", marginLeft: "8px" }}>{g.count} pedidos · {fmtPct(pct)}</span>
                        </div>
                      </div>
                      <div style={{ background: "#F1F5F9", borderRadius: "6px", height: "8px", overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: "6px", transition: "width 0.5s" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== ABA PAGAMENTOS ONLINE & MERCADO PAGO ===== */}
        {activeTab === "online" && (() => {
          const onlineOrders = allInRange.filter(o => {
            const pm = (o.paymentMethod || "").toUpperCase();
            const src = (o.source || "").toUpperCase();
            return pm === "PIX" || pm === "ONLINE" || pm === "CREDIT" || pm === "CREDITO" || pm === "DEBITO" || pm === "DEBIT" || src === "ONLINE";
          });

          const pixOrders = onlineOrders.filter(o => (o.paymentMethod || "").toUpperCase() === "PIX");
          const cardOrders = onlineOrders.filter(o => (o.paymentMethod || "").toUpperCase() !== "PIX");

          const pixTotal = pixOrders.reduce((s, o) => s + o.totalAmount, 0);
          const cardTotal = cardOrders.reduce((s, o) => s + o.totalAmount, 0);
          const onlineTotal = pixTotal + cardTotal;

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* CARDS DE MÉTRICAS */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
                <KPICard icon={<DollarSign size={20} color="#2563EB" />} label="Total Online Recebido" value={fmtR(onlineTotal)} sub={`${onlineOrders.length} pedidos no período`} color="#2563EB" />
                <KPICard icon={<CreditCard size={20} color="#059669" />} label="PIX Online (D+0 Na Hora)" value={fmtR(pixTotal)} sub={`${pixOrders.length} pedidos · Saldo Instantâneo`} color="#059669" />
                <KPICard icon={<CreditCard size={20} color="#7C3AED" />} label="Cartão Online (D+0 / D+30)" value={fmtR(cardTotal)} sub={`${cardOrders.length} pedidos · Cartão no Site`} color="#7C3AED" />
                <KPICard icon={<TrendingUp size={20} color="#D97706" />} label="Taxa Média Gateway" value="~ 0.99% - 3.99%" sub="Direto no Mercado Pago" color="#D97706" />
              </div>

              {/* CARD EXPLICATIVO DO MERCADO PAGO & ANTECIPAÇÃO */}
              <div style={{ background: "linear-gradient(135deg, #1E293B 0%, #0F172A 100%)", borderRadius: "16px", padding: "1.5rem", color: "#fff", boxShadow: "0 10px 25px rgba(0,0,0,0.15)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
                  <div>
                    <span style={{ background: "#009EE3", color: "#fff", padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase" }}>
                      🤝 Gateway Oficial Mercado Pago
                    </span>
                    <h2 style={{ fontWeight: 800, fontSize: "1.2rem", margin: "0.5rem 0 0.25rem 0", color: "#fff" }}>
                      Como funciona o recebimento e antecipação do seu dinheiro?
                    </h2>
                    <p style={{ color: "#94A3B8", fontSize: "0.85rem", margin: 0, maxWidth: "750px" }}>
                      Todos os pagamentos online feitos no seu site caem direto na sua conta do Mercado Pago. Veja abaixo a regra de prazos e como antecipar seus recebíveis se precisar do dinheiro na hora.
                    </p>
                  </div>
                  <a
                    href="https://www.mercadopago.com.br/recebiveis/antecipacoes"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ background: "#009EE3", color: "#fff", textDecoration: "none", padding: "10px 18px", borderRadius: "10px", fontWeight: 800, fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    🚀 Painel de Antecipação no Mercado Pago ↗
                  </a>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem", marginTop: "1rem" }}>
                  {/* Bloco PIX */}
                  <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "1.2rem", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#34D399", fontWeight: 800, fontSize: "0.95rem", marginBottom: "6px" }}>
                      ⚡ PIX (D+0 - Instantâneo)
                    </div>
                    <p style={{ fontSize: "0.82rem", color: "#CBD5E1", margin: 0, lineHeight: "1.5" }}>
                      O pagamento por <strong>PIX é 100% automático e instantâneo</strong>. Assim que o cliente paga no seu site, o dinheiro entra na hora na sua conta do Mercado Pago e fica disponível para saque ou PIX de saída imediatamente.
                    </p>
                  </div>

                  {/* Bloco Cartão */}
                  <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "1.2rem", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#60A5FA", fontWeight: 800, fontSize: "0.95rem", marginBottom: "6px" }}>
                      💳 Cartão de Crédito (D+0 ou D+30)
                    </div>
                    <p style={{ fontSize: "0.82rem", color: "#CBD5E1", margin: 0, lineHeight: "1.5" }}>
                      No Mercado Pago você escolhe o seu plano de prazos:
                      <br />• <strong>D+0 (Na hora)</strong>: Receba vendas no cartão no mesmo dia.
                      <br />• <strong>D+30 (Prazo Padrão)</strong>: Menor taxa por transação, dinheiro a liberar em 30 dias.
                    </p>
                  </div>

                  {/* Bloco Antecipação */}
                  <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "1.2rem", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#FBBF24", fontWeight: 800, fontSize: "0.95rem", marginBottom: "6px" }}>
                      🔓 Ficou com valor preso em D+30 e quer antecipar?
                    </div>
                    <p style={{ fontSize: "0.82rem", color: "#CBD5E1", margin: 0, lineHeight: "1.5" }}>
                      Se você começou vendendo em D+30 e deseja liberar o dinheiro acumulado imediatamente, basta entrar na sua conta Mercado Pago e solicitar a <strong>Antecipação de Recebíveis</strong>. O valor cai na hora na sua conta mediante a taxa de antecipação do próprio Mercado Pago.
                    </p>
                  </div>
                </div>
              </div>

              {/* LISTA DE TRANSAÇÕES ONLINE */}
              <div style={{ background: "#fff", borderRadius: "16px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden" }}>
                <div style={{ padding: "16px 24px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ fontWeight: 800, fontSize: "1rem", margin: 0 }}>📋 Transações Online no Período</h2>
                  <span style={{ fontSize: "0.8rem", color: "#64748B", fontWeight: 600 }}>{onlineOrders.length} transações</span>
                </div>

                {onlineOrders.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "3rem", color: "#94A3B8" }}>Nenhum pagamento online registrado neste período.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
                      <thead>
                        <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", color: "#64748B", fontWeight: 700 }}>
                          <th style={{ padding: "12px 16px" }}>Pedido</th>
                          <th style={{ padding: "12px 16px" }}>Data / Hora</th>
                          <th style={{ padding: "12px 16px" }}>Método</th>
                          <th style={{ padding: "12px 16px" }}>Valor Bruto</th>
                          <th style={{ padding: "12px 16px" }}>Prazo Estimado</th>
                          <th style={{ padding: "12px 16px" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {onlineOrders.map((o, i) => {
                          const isPix = (o.paymentMethod || "").toUpperCase() === "PIX";
                          const created = new Date(o.createdAt);
                          const dateFormatted = created.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

                          return (
                            <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                              <td style={{ padding: "12px 16px", fontWeight: 800, color: "#0F172A" }}>#{o.id.slice(-5).toUpperCase()}</td>
                              <td style={{ padding: "12px 16px", color: "#64748B" }}>{dateFormatted}</td>
                              <td style={{ padding: "12px 16px" }}>
                                <span style={{ background: isPix ? "#ECFDF5" : "#F3E8FF", color: isPix ? "#047857" : "#6D28D9", padding: "3px 8px", borderRadius: "6px", fontWeight: 800, fontSize: "0.75rem" }}>
                                  {isPix ? "⚡ PIX Online" : "💳 Cartão Online"}
                                </span>
                              </td>
                              <td style={{ padding: "12px 16px", fontWeight: 800, color: "#0F172A" }}>{fmtR(o.totalAmount)}</td>
                              <td style={{ padding: "12px 16px", color: isPix ? "#059669" : "#D97706", fontWeight: 700 }}>
                                {isPix ? "⚡ D+0 (Na hora)" : "💳 D+0 / D+30 (MP)"}
                              </td>
                              <td style={{ padding: "12px 16px" }}>
                                <span style={{ background: "#DCFCE7", color: "#15803D", padding: "3px 8px", borderRadius: "6px", fontWeight: 800, fontSize: "0.75rem" }}>
                                  ✅ Aprovado
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ===== ABA MENSALIDADE ===== */}
        {activeTab === "mensalidade" && (() => {
          const billing = calcMensalidade(billingCycle?.totalSales ?? dre.receitaBruta);
          const bc = billingCycle;
          const pct = bc && bc.amountDue > 0
            ? Math.min(100, (bc.totalSales / (FIREHUB_PLAN.THRESHOLD)) * 100)
            : 0;

          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", alignItems: "start" }}>
              {/* Esquerda: regras */}
              <div>
                <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.5rem" }}>💰 Mensalidade FireHub</h2>
                <p style={{ color: "#64748B", fontSize: "0.85rem", marginBottom: "1.5rem", lineHeight: 1.7 }}>
                  Modelo <strong>Pay as You Grow</strong>: você usa o sistema e paga ao final do mês
                  proporcionalmente ao quanto faturou. Sem Pagar.me, sem surpresa.
                </p>

                <div style={{ background: "#F8FAFC", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0", marginBottom: "1rem" }}>
                  <p style={{ fontWeight: 800, fontSize: "0.85rem", marginBottom: "0.75rem", color: "#0F172A" }}>📋 Regra de cobrança:</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {[
                      { label: "Taxa", value: `${FIREHUB_PLAN.PERCENT_RATE}% do faturamento mensal` },
                      { label: "Mínimo", value: `R$ ${FIREHUB_PLAN.MIN_MONTHLY},00 / mês`, color: "#D97706" },
                      { label: "Máximo (teto)", value: `R$ ${FIREHUB_PLAN.MAX_MONTHLY},00 / mês`, color: "#DC2626" },
                      { label: "Cobrança", value: "Gerada automaticamente no fechamento do mês" },
                    ].map((r, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.83rem", padding: "8px 12px", background: "#fff", borderRadius: "8px", border: "1px solid #E2E8F0" }}>
                        <span style={{ color: "#64748B" }}>{r.label}</span>
                        <strong style={{ color: r.color || "#0F172A" }}>{r.value}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <p style={{ fontWeight: 700, fontSize: "0.82rem", color: "#475569", margin: "0 0 8px" }}>Exemplos práticos:</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {[1500, 3000, 5000, 8000, 13334, 20000].map((fat, i) => {
                    const r = calcMensalidade(fat);
                    const isMax = r.modelo === "fixo";
                    return (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem", padding: "7px 12px", background: isMax ? "#FFF1F2" : "#F8FAFC", borderRadius: "8px", border: isMax ? "1px solid #FCA5A5" : "1px solid #F1F5F9" }}>
                        <span style={{ color: "#64748B" }}>Fatura R${fat.toLocaleString("pt-BR")}/mês</span>
                        <strong style={{ color: isMax ? "#DC2626" : "#0F172A" }}>
                          R${r.mensalidade.toFixed(0)} {isMax && "✅ teto"}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Direita: status real do mês */}
              <div>
                {/* Card principal */}
                <div style={{ background: "linear-gradient(135deg,#0F172A,#1E293B)", borderRadius: "20px", padding: "1.5rem", color: "#fff", marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <p style={{ fontWeight: 800, fontSize: "1rem", margin: 0 }}>📊 Este mês</p>
                    <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
                      {bc?.yearMonth ? new Date(bc.yearMonth + "-01").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : "—"}
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ background: "#1E293B", borderRadius: "12px", padding: "1rem" }}>
                      <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "0 0 2px" }}>Faturamento acumulado</p>
                      <p style={{ fontSize: "1.5rem", fontWeight: 900, color: "#F59E0B", margin: 0 }}>
                        {fmtR(bc?.totalSales ?? 0)}
                      </p>
                    </div>

                    <div style={{ background: "#1E293B", borderRadius: "12px", padding: "1rem", border: "2px solid #E63946" }}>
                      <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "0 0 2px" }}>Você deve este mês</p>
                      <p style={{ fontSize: "2rem", fontWeight: 900, color: "#E63946", margin: 0 }}>
                        {fmtR(bc?.amountDue ?? 0)}
                      </p>
                      <p style={{ fontSize: "0.72rem", color: "#64748B", margin: "4px 0 0" }}>
                        {bc
                          ? billing.modelo === "fixo"
                            ? `✅ Teto atingido — R$${FIREHUB_PLAN.MAX_MONTHLY} fixo`
                            : bc.totalSales === 0
                            ? "📭 Sem vendas registradas este mês"
                            : `${FIREHUB_PLAN.PERCENT_RATE}% de ${fmtR(bc.totalSales)}`
                          : "Carregando..."}
                      </p>
                    </div>

                    {/* Barra de progresso pro teto */}
                    <div style={{ background: "#1E293B", borderRadius: "12px", padding: "1rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: "0.72rem", color: "#94A3B8" }}>
                        <span>Progresso pro teto (R${FIREHUB_PLAN.MAX_MONTHLY})</span>
                        <span>{Math.min(100, ((bc?.totalSales ?? 0) / FIREHUB_PLAN.THRESHOLD * 100)).toFixed(0)}%</span>
                      </div>
                      <div style={{ height: 8, background: "#334155", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{
                          height: "100%",
                          width: `${Math.min(100, ((bc?.totalSales ?? 0) / FIREHUB_PLAN.THRESHOLD) * 100)}%`,
                          background: (bc?.totalSales ?? 0) >= FIREHUB_PLAN.THRESHOLD
                            ? "linear-gradient(90deg,#DC2626,#EF4444)"
                            : "linear-gradient(90deg,#1565C0,#42A5F5)",
                          borderRadius: 4, transition: "width 0.5s"
                        }} />
                      </div>
                      <p style={{ fontSize: "0.7rem", color: "#64748B", margin: "4px 0 0" }}>
                        Fature R${FIREHUB_PLAN.THRESHOLD.toLocaleString("pt-BR")} para atingir o teto
                      </p>
                    </div>

                    {/* Boleto pendente (se fechado) */}
                    {bc?.asaasBoletoUrl && (
                      <a href={bc.asaasBoletoUrl} target="_blank" rel="noopener noreferrer" style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        padding: "0.85rem", borderRadius: 12, background: "#16A34A",
                        color: "#fff", fontWeight: 800, fontSize: "0.9rem", textDecoration: "none",
                      }}>
                        💳 Pagar Boleto Pendente — {fmtR(bc.amountPending)}
                      </a>
                    )}

                    <div style={{ background: "#0F172A", border: "1px solid #334155", borderRadius: "10px", padding: "0.75rem 1rem", fontSize: "0.75rem", color: "#94A3B8", lineHeight: 1.8 }}>
                      ✅ Atualizado a cada pedido confirmado<br />
                      ✅ Cobrança gerada automaticamente no fechamento<br />
                      ✅ Sem mínimo se não faturou nada no mês
                    </div>
                  </div>
                </div>

                {/* ── Seção Fatura Detalhada ── */}
                {bc && bc.status !== "OPEN" && bc.amountPending > 0 && (
                  <div id="fatura" style={{ background: "#fff", border: "2px solid #FDE68A", borderRadius: 16, padding: "1.5rem", marginTop: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                      <h3 style={{ fontWeight: 800, fontSize: "1rem", margin: 0 }}>📄 Detalhes da Fatura</h3>
                      <span style={{
                        padding: "4px 12px", borderRadius: 99, fontSize: "0.72rem", fontWeight: 700,
                        background: "#FEF9C3", color: "#92400E", border: "1px solid #FDE68A",
                      }}>PENDENTE</span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: "1rem" }}>
                      {[
                        { label: "Faturamento do mês", value: fmtR(bc.totalSales) },
                        { label: `Taxa (${FIREHUB_PLAN.PERCENT_RATE}%, mín R$${FIREHUB_PLAN.MIN_MONTHLY})`, value: fmtR(bc.amountDue), bold: true },
                        { label: "Abatido via pagamento online", value: `- ${fmtR(bc.amountOffset)}`, color: "#16A34A" },
                        { label: "Saldo pendente", value: fmtR(bc.amountPending), color: "#DC2626", bold: true },
                      ].map((r, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", padding: "8px 12px", background: i === 3 ? "#FEF2F2" : "#F9FAFB", borderRadius: 8 }}>
                          <span style={{ color: "#64748B" }}>{r.label}</span>
                          <strong style={{ color: r.color || "#0F172A", fontWeight: r.bold ? 800 : 600 }}>{r.value}</strong>
                        </div>
                      ))}
                    </div>

                    {/* Abatimentos - log de pedidos */}
                    {bc.amountOffset > 0 && (
                      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "0.85rem", marginBottom: "1rem" }}>
                        <p style={{ fontWeight: 700, fontSize: "0.82rem", color: "#166534", margin: "0 0 6px" }}>💚 Pedidos que abateram a fatura:</p>
                        <p style={{ fontSize: "0.78rem", color: "#166534", margin: 0 }}>
                          Total abatido via pagamento online (PIX/Cartão): <strong>{fmtR(bc.amountOffset)}</strong>
                        </p>
                      </div>
                    )}

                    {bc.asaasBoletoUrl && (
                      <a href={bc.asaasBoletoUrl} target="_blank" rel="noopener noreferrer" style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        padding: "0.85rem", borderRadius: 12, background: "#16A34A",
                        color: "#fff", fontWeight: 800, fontSize: "0.9rem", textDecoration: "none", marginBottom: "1rem",
                      }}>
                        ⚡ Pagar Saldo Pendente — {fmtR(bc.amountPending)}
                      </a>
                    )}
                  </div>
                )}

                {/* ── Termos ── */}
                <div style={{ background: "#F1F5F9", borderRadius: 12, padding: "1rem", marginTop: "1rem", fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
                  <p style={{ fontWeight: 700, margin: "0 0 6px", color: "#0F172A" }}>📜 Termos de cobrança:</p>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                    <li>O <strong>pagamento online</strong> (PIX e cartão) é <strong>obrigatório</strong> estar ativo.</li>
                    <li>Pendências de cobrança são <strong>descontadas automaticamente</strong> dos pagamentos online recebidos.</li>
                    <li>A fatura é gerada no fechamento do mês (<strong>horário de Brasília</strong>) e tem <strong>10 dias</strong> para pagamento.</li>
                    <li>Após 10 dias sem regularizar, o sistema será <strong>bloqueado</strong> até o pagamento.</li>
                    <li>Caso não tenha faturado no mês, <strong>não há cobrança</strong>. Pausou a loja e não vendeu? R$0.</li>
                    <li><strong>Tráfego Pago:</strong> R$50/semana pelo <strong>serviço de gestão</strong>. Ativou campanha = cobra. O ROAS depende da qualidade do produto, atendimento e mercado local.</li>
                  </ul>
                  <a href="/termos" target="_blank" style={{ color: "#2563EB", fontWeight: 600, fontSize: "0.76rem", textDecoration: "underline" }}>Ver termos completos →</a>
                </div>
              </div>
            </div>
          );

        })()}
      </div>

      {/* ===== ABA CUSTOS FIXOS ===== */}
      {activeTab === "custosfix" && (
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "1.5rem" }}>
          <div style={{ background: "linear-gradient(135deg,#7C3AED,#6D28D9)", borderRadius: 16, padding: "1.5rem", color: "#fff", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <Building2 size={24} />
              <h2 style={{ fontWeight: 900, fontSize: "1.2rem", margin: 0 }}>Custos Fixos Mensais</h2>
            </div>
            <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.8)", margin: 0 }}>
              Cadastre aluguel, funcionários, energia, internet e outros. Eles são descontados proporcionalmente do lucro líquido no DRE.
            </p>
            {fixedCosts.length > 0 && (
              <div style={{ marginTop: 12, background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>Total mensal cadastrado:</span>
                <span style={{ fontSize: "1.1rem", fontWeight: 900 }}>R$ {totalFixedCosts.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
          </div>

          {/* Formulário para adicionar */}
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0", marginBottom: "1.25rem" }}>
            <h3 style={{ fontWeight: 800, fontSize: "0.95rem", margin: "0 0 1rem" }}>➕ Adicionar custo fixo</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addFixedCost()}
                placeholder="Descrição (ex: Aluguel, Salário João, Energia...)"
                style={{ flex: 2, minWidth: 180, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit" }}
              />
              <div style={{ position: "relative", flex: 1, minWidth: 120 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#64748B", fontSize: "0.85rem", fontWeight: 700 }}>R$</span>
                <input
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addFixedCost()}
                  placeholder="0,00"
                  type="text"
                  inputMode="decimal"
                  style={{ width: "100%", padding: "10px 14px 10px 34px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", fontFamily: "inherit", boxSizing: "border-box" }}
                />
              </div>
              <button
                onClick={addFixedCost}
                disabled={!newLabel.trim() || !newValue}
                style={{ padding: "10px 20px", borderRadius: 10, background: (!newLabel.trim() || !newValue) ? "#E2E8F0" : "#7C3AED", color: (!newLabel.trim() || !newValue) ? "#94A3B8" : "#fff", border: "none", fontWeight: 700, fontSize: "0.88rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" }}
              >
                <Plus size={16} /> Adicionar
              </button>
            </div>
            <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "8px 0 0" }}>
              💡 Pressione Enter para adicionar rapidamente. Salvo automaticamente.
            </p>
          </div>

          {/* Lista */}
          {fixedCosts.length === 0 ? (
            <div style={{ background: "#fff", borderRadius: 16, padding: "2.5rem", textAlign: "center", border: "1.5px dashed #E2E8F0" }}>
              <Building2 size={40} color="#CBD5E1" style={{ marginBottom: 12 }} />
              <p style={{ fontWeight: 700, color: "#64748B", margin: "0 0 6px" }}>Nenhum custo fixo cadastrado</p>
              <p style={{ fontSize: "0.82rem", color: "#94A3B8", margin: 0 }}>Adicione aluguel, salários, energia, internet, etc.</p>
            </div>
          ) : (
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>DESCRIÇÃO</span>
                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>VALOR / MÊS</span>
              </div>
              {fixedCosts.map((c, i) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderTop: i === 0 ? "none" : "1px solid #F1F5F9" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7C3AED", flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{c.label}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#7C3AED" }}>
                      R$ {c.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                    <button onClick={() => removeFixedCost(c.id)} style={{ padding: 6, borderRadius: 8, background: "#FEF2F2", border: "none", cursor: "pointer" }}>
                      <Trash2 size={14} color="#EF4444" />
                    </button>
                  </div>
                </div>
              ))}
              <div style={{ padding: "14px 16px", background: "#F5F3FF", borderTop: "2px solid #DDD6FE", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 800, color: "#7C3AED" }}>Total mensal</span>
                <span style={{ fontWeight: 900, fontSize: "1.05rem", color: "#7C3AED" }}>
                  R$ {totalFixedCosts.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          {/* Impacto */}
          {fixedCosts.length > 0 && (
            <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 14, padding: "1rem 1.25rem", marginTop: "1.25rem" }}>
              <p style={{ fontWeight: 800, fontSize: "0.88rem", color: "#92400E", margin: "0 0 8px" }}>📊 Impacto no período atual ({dre.diasNoPeriodo} dias)</p>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "#78350F", marginBottom: 4 }}>
                <span>Custo proporcional do período:</span>
                <strong>- R$ {dre.custosFixosPeriodo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: "#78350F" }}>
                <span>Lucro líquido resultante:</span>
                <strong style={{ color: dre.lucroLiquido >= 0 ? "#16A34A" : "#DC2626" }}>
                  R$ {dre.lucroLiquido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </strong>
              </div>
            </div>
          )}

          {savedFC && <div style={{ marginTop: 12, textAlign: "center", color: "#16A34A", fontWeight: 700 }}>✅ Custos salvos!</div>}
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          div[style*="grid-template-columns"] { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 480px) {
          div[style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
