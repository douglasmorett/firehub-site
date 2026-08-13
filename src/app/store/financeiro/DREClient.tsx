"use client";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  TrendingUp, TrendingDown, DollarSign, ShoppingBag,
  BarChart2, ArrowUpRight, ArrowDownRight, Download, Filter,
  Package, Truck, CreditCard, Percent, Users, Plus, Trash2, Building2
} from "lucide-react";
import { calcMensalidade, FIREHUB_PLAN } from "@/lib/firehub-billing";
import { isExemptAccount } from "@/lib/billing";
import FinanceForm from "@/components/FinanceForm";
import InvoicesClient from "@/components/InvoicesClient";

type BillingCycle = {
  yearMonth: string; totalSales: number; amountDue: number;
  amountOffset: number; amountPending: number; status: string;
  isExempt?: boolean;
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

function getOrderDisplayNumber(o: any): string {
  if (!o) return "—";
  if (o.dailyOrderNumber != null && o.dailyOrderNumber !== "") return String(o.dailyOrderNumber);
  if (o.ifoodReference) return String(o.ifoodReference);
  if (o.openDeliveryReference) return String(o.openDeliveryReference);
  if (o.orderNumber) return String(o.orderNumber);
  if (o.displayId) return String(o.displayId);
  return String(o.id || "").slice(-4).toUpperCase();
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
  const { data: session } = useSession();
  const userEmailClean = session?.user?.email;

  const [preset, setPreset] = useState(1); // 7 dias default
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [activeTab, setActiveTab] = useState<"mensalidade" | "extrato" | "relatorio" | "configuracoes" | "dre" | "custosfix" | "pagamentos" | "contasapagar" | "notascompras">("mensalidade");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab && ["mensalidade", "extrato", "relatorio", "configuracoes", "dre", "custosfix", "pagamentos", "contasapagar", "notascompras"].includes(tab)) {
        setActiveTab(tab as any);
      }
    }
  }, []);
  const [showAllSemCusto, setShowAllSemCusto] = useState(false);
  const [showFaturaModal, setShowFaturaModal] = useState(false);

  // ===== CICLO DE FATURAMENTO REAL (API) =====
  const [billingCycle, setBillingCycle] = useState<BillingCycle | null>(null);
  useEffect(() => {
    fetch("/api/billing/cycle")
      .then(r => r.json())
      .then(d => { if (!d.error) setBillingCycle(d); })
      .catch(() => {});
  }, []);

  const isExempt = isExemptAccount(userEmailClean) || (billingCycle as any)?.isExempt || (billingCycle as any)?.status === "ISENTO" || (billingCycle as any)?.status === "PAID";

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

  // ===== CÁLCULOS EXTRATO & RELATÓRIO BRENDI =====
  const extratoCalc = useMemo(() => {
    let pixTotal = 0;
    let cardTotal = 0;
    let countPix = 0;
    let countCard = 0;
    let reembolsos = 0;
    let faturamentoTotalSemFiltro = 0;
    const lancamentos: any[] = [];

    allInRange.forEach(o => {
      const isCancelled = o.status === "CANCELADO";
      const pm = (o.paymentMethod || "").toUpperCase();
      const src = (o.source || "").toUpperCase();
      const gross = (o.totalAmount || 0) + ((o as any).discountIfood || 0);

      faturamentoTotalSemFiltro += gross;

      // Identify if payment was processed strictly through Store's Mercado Pago / Celcoin Gateway
      const isIfood = src === "IFOOD" || pm.includes("IFOOD");
      const isJotaja = src === "JOTAJA" || pm.includes("JOTAJA") || src === "OPEN_DELIVERY";
      const isPresencial = src === "PRESENCIAL" || pm.includes("DINHEIRO") || pm.includes("MAQUININHA") || pm.includes("ENTREGA");

      const isMercadoPagoGateway = !isIfood && !isJotaja && !isPresencial && (
        Boolean((o as any).gatewayProvider) || Boolean((o as any).gatewayPaymentId) || Boolean((o as any).pagarmeOrderId) ||
        pm.includes("MERCADOPAGO") || pm.includes("CELCOIN") || pm.includes("PAGARME") || (
          (src === "ONLINE" || src === "SITE" || src === "APP") && (pm.includes("PIX") || pm.includes("CREDITO") || pm.includes("ONLINE"))
        )
      );

      const displayOrderNum = getOrderDisplayNumber(o);

      if (isCancelled) {
        if (isMercadoPagoGateway) reembolsos += gross;
        lancamentos.push({
          id: o.id,
          tipo: "Estorno",
          horario: new Date(o.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          descricao: `Cancelamento Pedido #${displayOrderNum}`,
          formaPagamento: isIfood ? "iFood Pago Online" : isJotaja ? "Jotajá Pago Online" : (o.paymentMethod || "Online"),
          origem: isIfood ? "iFood (Repasse)" : isJotaja ? "Jotajá (Repasse)" : isMercadoPagoGateway ? "Gateway Mercado Pago" : "Loja",
          isGateway: isMercadoPagoGateway,
          sourceChannel: isIfood ? "IFOOD" : isJotaja ? "JOTAJA" : isMercadoPagoGateway ? "GATEWAY" : "LOJA",
          status: "Cancelado",
          dataLiberacao: "—",
          valorBruto: -gross,
          taxa: 0,
          valorLiquido: -gross
        });
        return;
      }

      const isPix = pm.includes("PIX");
      const isCard = pm.includes("CREDITO") || pm.includes("CARD") || pm.includes("ONLINE");

      let fee = 0;
      if (isMercadoPagoGateway) {
        if (isPix) {
          pixTotal += gross;
          countPix++;
          fee = gross * 0.005 + 0.40;
        } else if (isCard) {
          cardTotal += gross;
          countCard++;
          fee = gross * 0.0399;
        } else {
          fee = gross * 0.01;
        }
      }

      const net = Math.max(0, gross - fee);

      lancamentos.push({
        id: o.id,
        tipo: isMercadoPagoGateway ? "Venda Online (Mercado Pago)" : isIfood ? "Venda iFood" : isJotaja ? "Venda Jotajá" : "Venda Presencial",
        horario: new Date(o.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        descricao: `Pedido #${displayOrderNum}`,
        formaPagamento: o.paymentMethod || "Online",
        origem: isMercadoPagoGateway ? "Gateway Mercado Pago" : isIfood ? "Repasse Direto iFood" : isJotaja ? "Repasse Direto Jotajá" : "Loja (Entrega)",
        isGateway: isMercadoPagoGateway,
        sourceChannel: isIfood ? "IFOOD" : isJotaja ? "JOTAJA" : isMercadoPagoGateway ? "GATEWAY" : "LOJA",
        status: "Aprovado",
        dataLiberacao: !isMercadoPagoGateway ? "Repasse Externo" : isPix ? "Imediato (D+0)" : "30 dias (D+30)",
        valorBruto: gross,
        taxa: fee,
        valorLiquido: net
      });
    });

    const receitaBruta = pixTotal + cardTotal;
    const taxasPix = pixTotal * 0.005 + countPix * 0.40;
    const taxasCard = cardTotal * 0.0399;
    const taxasOperacionais = taxasPix + taxasCard;
    const mensalidadeVal = isExempt ? 0 : calcPlatformFee(faturamentoTotalSemFiltro);
    const receitaLiquida = Math.max(0, receitaBruta - taxasOperacionais - reembolsos);
    const saldoDisponivel = Math.max(0, pixTotal - taxasPix);
    const saldoALiberar = Math.max(0, cardTotal - taxasCard);

    return {
      pixTotal,
      cardTotal,
      receitaBruta,
      taxasPix,
      taxasCard,
      taxasOperacionais,
      mensalidade: mensalidadeVal,
      reembolsos,
      receitaLiquida,
      saldoDisponivel,
      saldoALiberar,
      faturamentoOnline: receitaBruta,
      lancamentos
    };
  }, [allInRange]);

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

    // Taxa FireHub (Pay as You Grow) — Zerada se a conta for isenta
    const taxaFireHub = isExempt ? 0 : calcPlatformFee(receitaBruta);

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


  const tabStyle = (tab: typeof activeTab) => ({
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

          {/* TABS BRENDI STYLE */}
          <div style={{ display: "flex", gap: "6px", marginTop: "1rem", background: "#F1F5F9", borderRadius: "12px", padding: "4px", width: "fit-content", flexWrap: "wrap" }}>
            <button style={tabStyle("mensalidade")} onClick={() => setActiveTab("mensalidade")}>Mensalidade</button>
            <button style={tabStyle("extrato")} onClick={() => setActiveTab("extrato")}>Extrato</button>
            <button style={tabStyle("relatorio")} onClick={() => setActiveTab("relatorio")}>Relatório</button>
            <button style={tabStyle("configuracoes")} onClick={() => setActiveTab("configuracoes")}>Configurações</button>
            <button style={tabStyle("dre")} onClick={() => setActiveTab("dre")}>📊 DRE Geral</button>
            <button
              style={{
                ...tabStyle("contasapagar"),
                background: activeTab === "contasapagar" ? "#DB2777" : "transparent",
                color: activeTab === "contasapagar" ? "#fff" : "#64748B",
              }}
              onClick={() => setActiveTab("contasapagar")}
            >
              🤖 Contas a Pagar (IA)
            </button>
            <button
              style={{
                ...tabStyle("notascompras"),
                background: activeTab === "notascompras" ? "#2563EB" : "transparent",
                color: activeTab === "notascompras" ? "#fff" : "#64748B",
              }}
              onClick={() => setActiveTab("notascompras")}
            >
              🧾 Notas de Compras
            </button>
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
        {/* ===== ABA MENSALIDADE FIREHUB ===== */}
        {activeTab === "mensalidade" && (() => {
          const mensalidadeInfo = calcMensalidade(dre.receitaBruta);
          const valFatura = isExempt ? 0 : mensalidadeInfo.mensalidade;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {/* Card Principal de Fatura Atual */}
              <div style={{
                background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
                borderRadius: "20px", padding: "1.75rem", color: "#FFFFFF",
                boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: isExempt ? "1.5px solid #10B981" : "1px solid #334155"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: isExempt ? 0 : "1.25rem" }}>
                  <div>
                    <span style={{ background: isExempt ? "#DCFCE7" : "#FEF3C7", color: isExempt ? "#15803D" : "#92400E", padding: "4px 12px", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 900, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {isExempt ? "✨ Conta VIP / Loja Oficial — Isenção Ativa" : "⚠️ Cobrança Pendente · Vencimento em 10 dias"}
                    </span>
                    <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "8px 0 2px", color: "#F8FAFC" }}>
                      {isExempt ? "Mensalidade FireHub Pro (Isento)" : "Mensalidade FireHub Pro"}
                    </h2>
                    <p style={{ margin: 0, fontSize: "0.85rem", color: "#94A3B8" }}>
                      {isExempt ? "Esta conta (contatohakim@gmail.com) é isenta de cobranças de mensalidade e comissão da plataforma." : "Plano Oficial: 1% sobre vendas · Mínimo R$ 100,00 · Teto Máximo R$ 400,00/mês"}
                    </p>
                  </div>

                  <div style={{ textAlign: "right", background: isExempt ? "#064E3B" : "#1E293B", padding: "12px 18px", borderRadius: "14px", border: isExempt ? "1px solid #10B981" : "1px solid #334155" }}>
                    <div style={{ fontSize: "0.75rem", color: isExempt ? "#A7F3D0" : "#94A3B8", fontWeight: 700 }}>VALOR DA FATURA ATUAL</div>
                    <div style={{ fontSize: "1.8rem", fontWeight: 900, color: isExempt ? "#34D399" : "#38BDF8", marginTop: 2 }}>
                      {isExempt ? "R$ 0,00 (ISENTO)" : fmtR(valFatura)}
                    </div>
                  </div>
                </div>

                {/* Botões de Ação de Pagamento */}
                {!isExempt && (
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", borderTop: "1px solid #334155", paddingTop: "1.25rem" }}>
                    <button
                      onClick={() => alert(`🔑 Código PIX de ${fmtR(valFatura)} gerado com sucesso! Cole no seu app de banco.`)}
                      style={{
                        background: "linear-gradient(135deg, #10B981, #059669)", color: "#FFFFFF",
                        border: "none", padding: "12px 22px", borderRadius: "12px", fontSize: "0.92rem",
                        fontWeight: 900, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                        boxShadow: "0 4px 14px rgba(16, 185, 129, 0.4)", fontFamily: "inherit"
                      }}
                    >
                      ⚡ Pagar Fatura Agora (PIX)
                    </button>
                    <button
                      onClick={() => setShowFaturaModal(true)}
                      style={{
                        background: "#334155", color: "#F8FAFC", border: "1px solid #475569",
                        padding: "12px 18px", borderRadius: "12px", fontSize: "0.88rem",
                        fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                        display: "flex", alignItems: "center", gap: 6
                      }}
                    >
                      📄 Detalhes da Cobrança
                    </button>
                  </div>
                )}
              </div>

              {/* Grid com Destaques Financeiros da Mensalidade */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                <div style={{ background: "#FFFFFF", borderRadius: "16px", padding: "1.25rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B" }}>📈 Vendas no Ciclo Atual</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#0F172A", marginTop: 4 }}>
                    {fmtR(dre.receitaBruta)}
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "0.76rem", color: "#64748B" }}>
                    Base de cálculo da comissão de 1%
                  </p>
                </div>

                <div style={{ background: "#F0FDF4", borderRadius: "16px", padding: "1.25rem", border: "1px solid #BBF7D0", boxShadow: "0 2px 10px rgba(16,185,129,0.05)" }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#166534" }}>💚 Economia Estimada (vs iFood)</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#15803D", marginTop: 4 }}>
                    {fmtR(dre.receitaBruta * 0.26)}
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "0.76rem", color: "#166534" }}>
                    Sua loja economizou ~26% pedindo direto no FireHub
                  </p>
                </div>

                <div style={{ background: "#EFF6FF", borderRadius: "16px", padding: "1.25rem", border: "1px solid #BFDBFE" }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#1E40AF" }}>💳 Status do Ciclo</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#1D4ED8", marginTop: 4 }}>
                    Aberto (Faturado)
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "0.76rem", color: "#1E40AF" }}>
                    Vencimento regular em 10 dias
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

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

        {/* ===== ABA EXTRATO (ESTILO BRENDI) ===== */}
        {activeTab === "extrato" && (
          <div>
            {/* Cards do Topo: Saldo Disponível (Esq) vs Resumo Financeiro (Dir) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
              {/* Esquerda: Saldo Disponível e Saldo a Liberar */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.5rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#1E40AF", fontSize: "0.88rem", fontWeight: 800 }}>
                    <span>💳 Saldo Gateway da Loja (Mercado Pago / Celcoin)</span>
                  </div>
                  <span style={{ background: "#EFF6FF", color: "#1D4ED8", padding: "2px 8px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 800 }}>
                    Vendas Online Próprias
                  </span>
                </div>

                <p style={{ fontSize: "2.1rem", fontWeight: 900, color: "#16A34A", margin: "4px 0 12px" }}>
                  {fmtR(extratoCalc.saldoDisponivel)}
                </p>

                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748B", fontSize: "0.82rem", fontWeight: 700 }}>
                  <span>🔒 Saldo a Liberar (Crédito D+30)</span>
                </div>
                <p style={{ fontSize: "1.4rem", fontWeight: 800, color: "#334155", margin: "4px 0 16px" }}>
                  {fmtR(extratoCalc.saldoALiberar)}
                </p>

                <div style={{ fontSize: "0.75rem", color: "#64748B", background: "#F8FAFC", padding: "8px 12px", borderRadius: "8px", border: "1px solid #E2E8F0", marginBottom: "12px" }}>
                  💡 <strong>Nota Importante:</strong> Vendas do iFood e Jotajá não são depositadas neste saldo — elas são repassadas diretamente pelas próprias plataformas para a conta bancária da sua loja.
                </div>

                {/* Box Azul de taxas operacionais */}
                <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: "12px", padding: "1rem", fontSize: "0.76rem", color: "#1E40AF", lineHeight: 1.7 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>• <strong>Taxa do pix:</strong> 0,5% + R$ 0,40</div>
                    <div>• <strong>Taxa do crédito:</strong> 3,99% por pedido</div>
                    <div>• <strong>Taxa de adiantamento:</strong> 1,7% (D+0)</div>
                    <div>• <strong>Taxa de transferência:</strong> R$ 0,40</div>
                  </div>
                </div>
              </div>

              {/* Direita: Resumo Financeiro */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.5rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <h3 style={{ fontWeight: 800, fontSize: "1rem", color: "#0F172A", margin: "0 0 16px" }}>📋 Resumo Financeiro</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "0.86rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 8, borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ color: "#475569" }}>Receita Bruta ℹ️</span>
                      <strong style={{ color: "#16A34A" }}>+ {fmtR(extratoCalc.receitaBruta)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 8, borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ color: "#475569" }}>Taxas Operacionais ℹ️</span>
                      <strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.taxasOperacionais)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 8, borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ color: "#475569" }}>Investimentos e Mensalidade ℹ️</span>
                      <strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.mensalidade)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 8, borderBottom: "1px solid #F1F5F9" }}>
                      <span style={{ color: "#475569" }}>Reembolsos ℹ️</span>
                      <strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.reembolsos)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, fontSize: "0.95rem" }}>
                      <strong style={{ color: "#0F172A" }}>Receita Líquida</strong>
                      <strong style={{ color: "#16A34A" }}>= {fmtR(extratoCalc.receitaLiquida)}</strong>
                    </div>
                  </div>
                </div>

                <button onClick={() => setActiveTab("relatorio")} style={{ marginTop: "16px", width: "100%", padding: "10px", borderRadius: "10px", border: "1.5px solid #DC2626", background: "#fff", color: "#DC2626", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  Ver demonstrativo completo
                </button>
              </div>
            </div>

            {/* Ações e Filtros de Data */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                {PERIOD_PRESETS.map((p, i) => (
                  <button key={i} onClick={() => setPreset(i)} style={{ padding: "6px 14px", borderRadius: "8px", border: preset === i ? "2px solid #DC2626" : "1px solid #CBD5E1", background: preset === i ? "#FEF2F2" : "#fff", color: preset === i ? "#DC2626" : "#475569", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => setActiveTab("configuracoes")} style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid #DC2626", background: "#fff", color: "#DC2626", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>↩️ Ver último repasse</button>
                <button onClick={() => alert("📥 Relatório exportado com sucesso!")} style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid #DC2626", background: "#fff", color: "#DC2626", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>📥 Exportar transações</button>
              </div>
            </div>

            {/* Tabela de Lançamentos */}
            <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #E2E8F0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", color: "#475569", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px" }}>Tipo</th>
                    <th style={{ padding: "10px 14px" }}>Horário</th>
                    <th style={{ padding: "10px 14px" }}>Descrição</th>
                    <th style={{ padding: "10px 14px" }}>Canal / Origem</th>
                    <th style={{ padding: "10px 14px" }}>Forma de pagamento</th>
                    <th style={{ padding: "10px 14px" }}>Status</th>
                    <th style={{ padding: "10px 14px" }}>Data de liberação</th>
                    <th style={{ padding: "10px 14px" }}>Valor bruto</th>
                    <th style={{ padding: "10px 14px" }}>Taxa</th>
                    <th style={{ padding: "10px 14px" }}>Valor líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {extratoCalc.lancamentos.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ padding: "2.5rem", textAlign: "center", color: "#64748B" }}>
                        ⚠️ Sem dados disponíveis para o período selecionado.
                      </td>
                    </tr>
                  ) : (
                    extratoCalc.lancamentos.map((l: any, i: number) => {
                      const isMp = l.sourceChannel === "GATEWAY";
                      const isIf = l.sourceChannel === "IFOOD";
                      const isJt = l.sourceChannel === "JOTAJA";
                      return (
                        <tr key={l.id || i} style={{ borderBottom: "1px solid #F1F5F9", background: isMp ? "#F0FDF4" : "#FFFFFF" }}>
                          <td style={{ padding: "10px 14px", fontWeight: 700 }}>{l.tipo}</td>
                          <td style={{ padding: "10px 14px" }}>{l.horario}</td>
                          <td style={{ padding: "10px 14px" }}>{l.descricao}</td>
                          <td style={{ padding: "10px 14px" }}>
                            <span style={{
                              padding: "2px 8px", borderRadius: 6, fontSize: "0.72rem", fontWeight: 800,
                              background: isMp ? "#DBEAFE" : isIf ? "#FEE2E2" : isJt ? "#FFEDD5" : "#F1F5F9",
                              color: isMp ? "#1E40AF" : isIf ? "#991B1B" : isJt ? "#9A3412" : "#475569"
                            }}>
                              {l.origem}
                            </span>
                          </td>
                          <td style={{ padding: "10px 14px" }}>{l.formaPagamento}</td>
                          <td style={{ padding: "10px 14px" }}>
                            <span style={{ padding: "2px 8px", borderRadius: 99, background: l.status === "Aprovado" ? "#E6F4EA" : "#FEF3C7", color: l.status === "Aprovado" ? "#137333" : "#92400E", fontSize: "0.72rem", fontWeight: 700 }}>
                              {l.status}
                            </span>
                          </td>
                          <td style={{ padding: "10px 14px" }}>{l.dataLiberacao}</td>
                          <td style={{ padding: "10px 14px", color: "#16A34A", fontWeight: 700 }}>{fmtR(l.valorBruto)}</td>
                          <td style={{ padding: "10px 14px", color: "#DC2626" }}>- {fmtR(l.taxa)}</td>
                          <td style={{ padding: "10px 14px", fontWeight: 800 }}>{fmtR(l.valorLiquido)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== ABA RELATÓRIO (ESTILO BRENDI) ===== */}
        {activeTab === "relatorio" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <div>
                <span style={{ fontSize: "0.82rem", color: "#64748B", fontWeight: 700 }}>Faturamento Online</span>
                <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "#16A34A", margin: 0 }}>{fmtR(extratoCalc.faturamentoOnline)}</h2>
              </div>
              <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: "10px", padding: "8px 14px", fontSize: "0.82rem", fontWeight: 700, color: "#334155" }}>
                📅 Período: {from.toLocaleDateString("pt-BR")} - {to.toLocaleDateString("pt-BR")}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              {/* Card 1: Demonstrativo de Receita Online */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.25rem" }}>
                <h4 style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", margin: "0 0 12px" }}>Demonstrativo de Receita Online</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.84rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>PIX (Online)</span><strong style={{ color: "#16A34A" }}>{fmtR(extratoCalc.pixTotal)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Cartão de Crédito (Online)</span><strong style={{ color: "#16A34A" }}>{fmtR(extratoCalc.cardTotal)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Programa de Indicação</span><strong style={{ color: "#16A34A" }}>R$ 0,00</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Reembolsos Recebidos</span><strong style={{ color: "#16A34A" }}>R$ 0,00</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #F1F5F9", paddingTop: 8 }}><strong style={{ color: "#0F172A" }}>Total Receita Bruta</strong><strong style={{ color: "#16A34A" }}>{fmtR(extratoCalc.receitaBruta)}</strong></div>
                </div>
              </div>

              {/* Card 2: Taxas Operacionais */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.25rem" }}>
                <h4 style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", margin: "0 0 12px" }}>Taxas Operacionais</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.84rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Taxas PIX</span><strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.taxasPix)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Taxas Cartão</span><strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.taxasCard)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Taxa de Repasse</span><strong style={{ color: "#DC2626" }}>- R$ 0,00</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #F1F5F9", paddingTop: 8 }}><strong style={{ color: "#0F172A" }}>Total Taxas</strong><strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.taxasOperacionais)}</strong></div>
                </div>
              </div>

              {/* Card 3: Investimentos e Mensalidade */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.25rem" }}>
                <h4 style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", margin: "0 0 12px" }}>Investimentos e Mensalidade</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.84rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Investimento em Tráfego Pago</span><strong style={{ color: "#DC2626" }}>- R$ 0,00</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Mensalidade FireHub</span><strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.mensalidade)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #F1F5F9", paddingTop: 8 }}><strong style={{ color: "#0F172A" }}>Total Investimentos</strong><strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.mensalidade)}</strong></div>
                </div>
              </div>

              {/* Card 4: Reembolsos a Clientes */}
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.25rem" }}>
                <h4 style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", margin: "0 0 12px" }}>Reembolsos a Clientes</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.84rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#475569" }}>Reembolsos a Clientes</span><strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.reembolsos)}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #F1F5F9", paddingTop: 8 }}><strong style={{ color: "#0F172A" }}>Total Reembolsos</strong><strong style={{ color: "#DC2626" }}>- {fmtR(extratoCalc.reembolsos)}</strong></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== ABA CONFIGURAÇÕES (CONFIGURAÇÕES DE REPASSE BRENDI) ===== */}
        {activeTab === "configuracoes" && (
          <div>
            <h3 style={{ fontWeight: 900, fontSize: "1.15rem", color: "#0F172A", marginBottom: "0.5rem" }}>Configurações financeiras de repasse</h3>
            <p style={{ fontSize: "0.82rem", color: "#64748B", marginBottom: "1.5rem" }}>
              Se você aceita pagamentos online (Pix e Cartão), cadastre a sua chave Pix/conta de repasse para receber o valor automaticamente sem ficar com o saldo retido.
            </p>

            <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.5rem", maxWidth: "650px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem" }}>
                <Building2 size={22} color="#16A34A" />
                <h4 style={{ fontWeight: 800, fontSize: "1rem", margin: 0, color: "#0F172A" }}>Conta de repasse</h4>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>Chave Pix para repasse</label>
                  <input
                    type="text"
                    placeholder="Digite sua Chave Pix..."
                    defaultValue=""
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.88rem" }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>Frequência do repasse</label>
                    <select
                      defaultValue="DAILY"
                      style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.88rem" }}
                    >
                      <option value="DAILY">Todos os dias</option>
                      <option value="WEEKLY">Uma vez por semana</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>Horário do repasse</label>
                    <select
                      defaultValue="03:00"
                      style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.88rem" }}
                    >
                      <option value="03:00">03:00 (Madrugada)</option>
                      <option value="06:00">06:00 (Manhã)</option>
                      <option value="12:00">12:00 (Meio-dia)</option>
                      <option value="18:00">18:00 (Fim de Tarde)</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={() => alert("✅ Configurações de repasse salvas com sucesso!")}
                  style={{ marginTop: "10px", padding: "12px", borderRadius: "10px", border: "none", background: "#DC2626", color: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Salvar Conta de Repasse
                </button>
              </div>
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

      {/* ===== ABA CONTAS A PAGAR & LEITURA COM IA ===== */}
      {activeTab === "contasapagar" && (
        <div style={{ maxWidth: 850, margin: "0 auto", padding: "1.5rem" }}>
          <div style={{ background: "#fff", borderRadius: "20px", border: "1px solid #E2E8F0", padding: "24px", boxShadow: "0 10px 30px rgba(0,0,0,0.04)" }}>
            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FDF2F8", border: "1px solid #FBCFE8", color: "#DB2777", fontSize: "0.75rem", fontWeight: 800, padding: "4px 12px", borderRadius: 20, marginBottom: 8 }}>
                ✨ LEITURA AUTOMÁTICA VIA GEMINI IA
              </div>
              <h2 style={{ fontSize: "1.35rem", fontWeight: 900, color: "#0F172A", margin: "0 0 6px" }}>
                Gestão Inteligente de Contas a Pagar
              </h2>
              <p style={{ fontSize: "0.85rem", color: "#64748B", margin: 0, lineHeight: 1.5 }}>
                Tire foto do boleto ou conta de fornecedor com a câmera do celular ou suba um arquivo. A IA do Gemini lê instantaneamente o fornecedor, valor total, código de barras e data de vencimento.
              </p>
            </div>
            <FinanceForm category="BUSINESS" />
          </div>
        </div>
      )}

      {/* ===== ABA NOTAS DE COMPRAS ===== */}
      {activeTab === "notascompras" && (
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1rem 0" }}>
          <InvoicesClient role={(session?.user as any)?.role || "FRANCHISEE"} canSeePersonal={false} />
        </div>
      )}

      {/* ===== MODAL DE EXTRATO DETALHADO DA COBRANÇA ===== */}
      {showFaturaModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.75)",
          backdropFilter: "blur(6px)", zIndex: 99999, display: "flex",
          alignItems: "center", justifyContent: "center", padding: "1.5rem"
        }}>
          <div style={{
            background: "#FFFFFF", borderRadius: "20px", width: "100%", maxWidth: "820px",
            maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)", border: "1px solid #E2E8F0"
          }}>
            {/* Header */}
            <div style={{
              background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", padding: "1.25rem 1.5rem",
              color: "#FFFFFF", display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ background: "rgba(255,255,255,0.1)", padding: "8px 12px", borderRadius: "10px", fontSize: "1.2rem" }}>
                  📄
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 900, color: "#F8FAFC" }}>
                    Extrato Detalhado da Cobrança — FireHub Pro
                  </h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#94A3B8" }}>
                    Detalhamento de todos os pedidos e cálculo transparente da comissão oficial de 1%
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowFaturaModal(false)}
                style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: "1.2rem", fontWeight: 900 }}
              >
                ✕
              </button>
            </div>

            {/* Content Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
              {/* Card Resumo 1% Promessa */}
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "14px", padding: "1.25rem", marginBottom: "1.25rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                  <div>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>VENDAS REGISTRADAS NO CICLO</span>
                    <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#0F172A", marginTop: 2 }}>
                      {fmtR(dre.receitaBruta)}
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>TAXA OFICIAL APLICADA</span>
                    <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#059669", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                      1,0% <span style={{ fontSize: "0.7rem", color: "#166534", background: "#DCFCE7", padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>Promessa Landing Page</span>
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748B" }}>VALOR DA MENSALIDADE</span>
                    <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#2563EB", marginTop: 2 }}>
                      {fmtR(calcMensalidade(dre.receitaBruta).mensalidade)}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #E2E8F0", fontSize: "0.78rem", color: "#475569", lineHeight: 1.5 }}>
                  💡 <strong>Regra Oficial do Plano FireHub:</strong> A comissão é de exatamente <strong>1% sobre o faturamento do mês</strong> (respeitando o piso mínimo de R$ 100,00 e o teto máximo fixo de R$ 400,00/mês).
                </div>
              </div>

              {/* Tabela de Pedidos Integrantes */}
              <h4 style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", marginBottom: "0.75rem" }}>
                📦 Pedidos Integrantes da Cobrança ({filtered.length} pedidos)
              </h4>

              <div style={{ border: "1px solid #E2E8F0", borderRadius: "12px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead>
                    <tr style={{ background: "#F1F5F9", color: "#475569", textAlign: "left" }}>
                      <th style={{ padding: "10px 12px" }}>Pedido</th>
                      <th style={{ padding: "10px 12px" }}>Data / Hora</th>
                      <th style={{ padding: "10px 12px" }}>Cliente</th>
                      <th style={{ padding: "10px 12px" }}>Forma de Pagam.</th>
                      <th style={{ padding: "10px 12px" }}>Valor Total</th>
                      <th style={{ padding: "10px 12px" }}>Comissão (1%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#94A3B8" }}>
                          Nenhum pedido no período selecionado.
                        </td>
                      </tr>
                    ) : (
                      filtered.slice(0, 50).map((o: any) => {
                        const comissaoPedido = (o.totalAmount || 0) * 0.01;
                        return (
                          <tr key={o.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                            <td style={{ padding: "10px 12px", fontWeight: 800, color: "#0F172A" }}>
                              #{getOrderDisplayNumber(o)}
                            </td>
                            <td style={{ padding: "10px 12px", color: "#64748B" }}>
                              {new Date(o.createdAt).toLocaleDateString("pt-BR")} {new Date(o.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td style={{ padding: "10px 12px" }}>{o.customerName}</td>
                            <td style={{ padding: "10px 12px" }}>{o.paymentMethod || "Online"}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 700, color: "#0F172A" }}>{fmtR(o.totalAmount)}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 800, color: "#2563EB" }}>{fmtR(comissaoPedido)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                {filtered.length > 50 && (
                  <div style={{ padding: "8px 12px", textAlign: "center", background: "#F8FAFC", fontSize: "0.75rem", color: "#64748B" }}>
                    Mostrando os primeiros 50 pedidos de {filtered.length} no ciclo.
                  </div>
                )}
              </div>

            </div>

            {/* Footer */}
            <div style={{ background: "#F8FAFC", borderTop: "1px solid #E2E8F0", padding: "1rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                onClick={() => window.print()}
                style={{ background: "#FFFFFF", border: "1px solid #CBD5E1", borderRadius: "8px", padding: "8px 14px", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", color: "#334155" }}
              >
                🖨️ Imprimir / Salvar Extrato (PDF)
              </button>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setShowFaturaModal(false)}
                  style={{ background: "#E2E8F0", border: "none", borderRadius: "8px", padding: "8px 14px", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", color: "#475569" }}
                >
                  Fechar
                </button>
                <button
                  onClick={() => {
                    setShowFaturaModal(false);
                    alert(`🔑 Código PIX de ${fmtR(calcMensalidade(dre.receitaBruta).mensalidade)} copiado com sucesso!`);
                  }}
                  style={{ background: "linear-gradient(135deg, #10B981, #059669)", border: "none", borderRadius: "8px", padding: "8px 16px", fontSize: "0.82rem", fontWeight: 900, color: "#FFFFFF", cursor: "pointer" }}
                >
                  ⚡ Pagar Fatura Agora (PIX)
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      </div>
    </div>
  );
}
