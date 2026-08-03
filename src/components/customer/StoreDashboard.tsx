"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, DollarSign, ShoppingCart, Users, CreditCard, Banknote, Smartphone, ArrowUpRight, ArrowDownRight, Filter, Calendar, Store as StoreIcon, ChevronDown } from "lucide-react";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import StoreDashboardMap from "@/components/customer/StoreDashboardMap";

type Order = {
  id: string; totalAmount: number; status: string; deliveryType: string;
  paymentMethod?: string; customerName: string; customerPhone?: string;
  customerAddress?: string; ifoodReference?: string; openDeliveryReference?: string;
  source?: string; notes?: string;
  createdAt: string; items?: any[]; storeName?: string; storeSlug?: string;
};
type StoreOption = { id: string; name: string; slug: string };

const PAYMENT_LABELS: Record<string, { label: string; icon: any; color: string }> = {
  PIX: { label: "Pix", icon: Smartphone, color: "#00BFA5" },
  DINHEIRO: { label: "Dinheiro", icon: Banknote, color: "#4CAF50" },
  DEBITO: { label: "Débito", icon: CreditCard, color: "#2196F3" },
  CREDITO: { label: "Crédito", icon: CreditCard, color: "#9C27B0" },
  VOUCHER: { label: "Voucher", icon: DollarSign, color: "#E65100" },
  OUTRO: { label: "Outro", icon: DollarSign, color: "#757575" },
};

const STATUS_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  NOVO: { label: "Novos", emoji: "🔔", color: "#3B82F6" },
  ACEITO: { label: "Aceitos", emoji: "✅", color: "#10B981" },
  PREPARANDO: { label: "Preparando", emoji: "👨‍🍳", color: "#F59E0B" },
  SAIU_ENTREGA: { label: "Em Entrega", emoji: "🛵", color: "#8B5CF6" },
  ENTREGUE: { label: "Entregues", emoji: "📦", color: "#059669" },
  CANCELADO: { label: "Cancelados", emoji: "❌", color: "#EF4444" },
};

type DateFilter = "hoje" | "ontem" | "semana" | "mes" | "custom";

export default function StoreDashboard({ orders: allOrders, paymentFees = {}, completedOnboardingSteps = [], isAdmin = false, storeList = [], selectedStoreId = "todas" }: { orders: Order[]; paymentFees?: Record<string, any>; completedOnboardingSteps?: string[]; isAdmin?: boolean; storeList?: StoreOption[]; selectedStoreId?: string; }) {
  const router = useRouter();
  const [dateFilter, setDateFilter] = useState<DateFilter>("hoje");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const filteredOrders = useMemo(() => {
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    let start: Date, end: Date;
    switch (dateFilter) {
      case "hoje":
        start = startOfDay(now); end = endOfDay(now); break;
      case "ontem":
        const y = new Date(now); y.setDate(y.getDate() - 1);
        start = startOfDay(y); end = endOfDay(y); break;
      case "semana":
        const w = new Date(now); w.setDate(w.getDate() - 7);
        start = startOfDay(w); end = endOfDay(now); break;
      case "mes":
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = endOfDay(now); break;
      case "custom":
        start = customStart ? startOfDay(new Date(customStart + "T00:00:00")) : startOfDay(now);
        end = customEnd ? endOfDay(new Date(customEnd + "T00:00:00")) : endOfDay(now); break;
      default:
        start = startOfDay(now); end = endOfDay(now);
    }
    return allOrders.filter(o => {
      const d = new Date(o.createdAt);
      return d >= start && d <= end;
    });
  }, [allOrders, dateFilter, customStart, customEnd]);

  const activeOrders = filteredOrders.filter(o => o.status !== "CANCELADO");
  const totalVendas = activeOrders.reduce((s, o) => s + o.totalAmount, 0);
  const totalPedidos = activeOrders.length;
  const ticketMedio = totalPedidos > 0 ? totalVendas / totalPedidos : 0;
  const cancelados = filteredOrders.filter(o => o.status === "CANCELADO").length;

  // Custo dos produtos
  const totalCost = useMemo(() => {
    return activeOrders.reduce((sum, o) => {
      return sum + (o.items?.reduce((s, i: any) => s + ((i.cost || 0) * i.quantity), 0) || 0);
    }, 0);
  }, [activeOrders]);

  // Taxas das maquininhas
  const totalFees = useMemo(() => {
    return activeOrders.reduce((sum, o) => {
      const pm = o.paymentMethod || "OUTRO";
      const feeConfig = paymentFees[pm];
      let feeRate = 0;
      if (typeof feeConfig === 'number') feeRate = feeConfig / 100;
      else if (feeConfig && typeof feeConfig === 'object' && feeConfig.rate) feeRate = feeConfig.rate / 100;
      return sum + (o.totalAmount * feeRate);
    }, 0);
  }, [activeOrders, paymentFees]);

  const lucroLiquido = totalVendas - totalCost - totalFees;
  const margemLucro = totalVendas > 0 ? (lucroLiquido / totalVendas * 100) : 0;

  // Comparação com período anterior
  const prevOrders = useMemo(() => {
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    let start: Date, end: Date;
    switch (dateFilter) {
      case "hoje":
        const y = new Date(now); y.setDate(y.getDate() - 1);
        start = startOfDay(y); end = endOfDay(y); break;
      case "ontem":
        const a = new Date(now); a.setDate(a.getDate() - 2);
        start = startOfDay(a); end = endOfDay(a); break;
      case "semana":
        const ws = new Date(now); ws.setDate(ws.getDate() - 14);
        const we = new Date(now); we.setDate(we.getDate() - 7);
        start = startOfDay(ws); end = endOfDay(we); break;
      default: return [];
    }
    return allOrders.filter(o => { const d = new Date(o.createdAt); return d >= start && d <= end && o.status !== "CANCELADO"; });
  }, [allOrders, dateFilter]);

  const prevTotal = prevOrders.reduce((s, o) => s + o.totalAmount, 0);
  const crescimento = prevTotal > 0 ? ((totalVendas - prevTotal) / prevTotal * 100) : 0;

  // Por forma de pagamento
  const byPayment = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    activeOrders.forEach(o => {
      const m = o.paymentMethod || "OUTRO";
      if (!map[m]) map[m] = { count: 0, total: 0 };
      map[m].count++; map[m].total += o.totalAmount;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [activeOrders]);

  // Por status
  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    filteredOrders.forEach(o => { map[o.status] = (map[o.status] || 0) + 1; });
    return Object.entries(map);
  }, [filteredOrders]);

  // Por tipo entrega
  const deliveryCount = activeOrders.filter(o => o.deliveryType === "DELIVERY").length;
  const pickupCount = activeOrders.filter(o => o.deliveryType !== "DELIVERY").length;

  // Top produtos com margem
  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; qty: number; total: number; cost: number }> = {};
    activeOrders.forEach(o => {
      o.items?.forEach((item: any) => {
        const name = item.menuProduct?.name || "—";
        if (!map[name]) map[name] = { name, qty: 0, total: 0, cost: 0 };
        map[name].qty += item.quantity;
        map[name].total += item.price * item.quantity;
        map[name].cost += (item.cost || 0) * item.quantity;
      });
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [activeOrders]);

  // Pedidos por hora
  const byHour = useMemo(() => {
    const hours = Array(24).fill(0);
    activeOrders.forEach(o => { hours[new Date(o.createdAt).getHours()]++; });
    return hours;
  }, [activeOrders]);
  const maxHour = Math.max(...byHour, 1);

  // Últimos pedidos
  const recentOrders = filteredOrders.slice(0, 10);

  const filterBtns: { key: DateFilter; label: string }[] = [
    { key: "hoje", label: "Hoje" }, { key: "ontem", label: "Ontem" },
    { key: "semana", label: "7 dias" }, { key: "mes", label: "Mês" },
    { key: "custom", label: "Período" }
  ];

  const Card = ({ title, value, subtitle, icon: Icon, color, trend }: any) => (
    <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0", flex: "1 1 200px", minWidth: "180px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: "0.75rem", color: "#94A3B8", fontWeight: 600, margin: "0 0 4px" }}>{title}</p>
          <p style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0, color: "#1E293B" }}>{value}</p>
          {subtitle && <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "4px 0 0" }}>{subtitle}</p>}
        </div>
        <div style={{ width: "42px", height: "42px", borderRadius: "12px", background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} color={color} />
        </div>
      </div>
      {trend !== undefined && trend !== 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "8px", fontSize: "0.72rem", fontWeight: 700, color: trend > 0 ? "#10B981" : "#EF4444" }}>
          {trend > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          {Math.abs(trend).toFixed(1)}% vs período anterior
        </div>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.25rem 1.5rem", fontFamily: "'Inter', sans-serif" }}>

      {/* SELETOR MULTILOJA — só para ADMIN */}
      {isAdmin && storeList.length > 1 && (
        <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #E2E8F0", padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <StoreIcon size={16} color="#C62828" />
            <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1E293B" }}>Selecionar Loja</span>
            <span style={{ fontSize: "0.75rem", color: "#94A3B8", marginLeft: "4px" }}>{storeList.length - 1} franquia(s) cadastrada(s)</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {storeList.map(s => {
              const active = s.id === selectedStoreId;
              return (
                <button key={s.id} onClick={() => router.push(`/store${s.id === "todas" ? "" : `?loja=${s.id}`}`)}
                  style={{ padding: "0.45rem 1rem", borderRadius: "20px", fontSize: "0.82rem", fontWeight: active ? 700 : 500, cursor: "pointer", transition: "all 0.15s",
                    border: active ? "2px solid #C62828" : "1.5px solid #E2E8F0",
                    background: active ? "#C62828" : "#F8FAFC",
                    color: active ? "#fff" : "#64748B",
                    boxShadow: active ? "0 2px 8px #C6282830" : "none"
                  }}>
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ONBOARDING — some se admin ou todas as etapas concluídas */}
      {!isAdmin && completedOnboardingSteps.length < 6 && (
        <OnboardingChecklist completedSteps={completedOnboardingSteps} />
      )}

      {/* FILTER BAR */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <Filter size={16} color="#94A3B8" />
        {filterBtns.map(f => (
          <button key={f.key} onClick={() => setDateFilter(f.key)} style={{
            padding: "0.4rem 0.9rem", borderRadius: "8px", fontSize: "0.82rem", fontWeight: dateFilter === f.key ? 700 : 500,
            border: dateFilter === f.key ? "2px solid #C62828" : "1.5px solid #E2E8F0",
            background: dateFilter === f.key ? "#C6282810" : "#fff", color: dateFilter === f.key ? "#C62828" : "#64748B", cursor: "pointer"
          }}>{f.label}</button>
        ))}
        {dateFilter === "custom" && (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <Calendar size={14} color="#94A3B8" />
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1.5px solid #E2E8F0", fontSize: "0.8rem" }} />
            <span style={{ color: "#94A3B8", fontSize: "0.8rem" }}>até</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1.5px solid #E2E8F0", fontSize: "0.8rem" }} />
          </div>
        )}
      </div>

      {/* KPI CARDS */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <Card title="FATURAMENTO" value={`R$ ${totalVendas.toFixed(2)}`} icon={DollarSign} color="#10B981" trend={crescimento} subtitle={`${totalPedidos} pedidos`} />
        <Card title="PEDIDOS" value={totalPedidos} icon={ShoppingCart} color="#3B82F6" subtitle={cancelados > 0 ? `${cancelados} cancelado(s)` : "Sem cancelamentos"} />
        <Card title="TICKET MÉDIO" value={`R$ ${ticketMedio.toFixed(2)}`} icon={TrendingUp} color="#8B5CF6" />
        <Card title="CLIENTES" value={new Set(activeOrders.map(o => o.customerPhone || o.customerName)).size} icon={Users} color="#F59E0B" subtitle="Clientes únicos" />
        <Card title="LUCRO LÍQUIDO" value={`R$ ${lucroLiquido.toFixed(2)}`} icon={DollarSign} color={lucroLiquido >= 0 ? "#059669" : "#EF4444"} subtitle={`Margem: ${margemLucro.toFixed(1)}% | Custos: R$ ${totalCost.toFixed(2)} | Taxas: R$ ${totalFees.toFixed(2)}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        {/* FORMAS DE PAGAMENTO */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>💳 Formas de Pagamento</h3>
          {byPayment.length === 0 ? (
            <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Sem dados no período</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {byPayment.map(([method, data]) => {
                const pct = totalVendas > 0 ? (data.total / totalVendas * 100) : 0;
                const cfg = PAYMENT_LABELS[method] || PAYMENT_LABELS.OUTRO;
                const Icon = cfg.icon;
                return (
                  <div key={method}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: `${cfg.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon size={15} color={cfg.color} />
                        </div>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{cfg.label}</span>
                          <span style={{ fontSize: "0.72rem", color: "#94A3B8", marginLeft: "6px" }}>{data.count} pedidos</span>
                        </div>
                      </div>
                      <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>R$ {data.total.toFixed(2)}</span>
                    </div>
                    <div style={{ height: "6px", borderRadius: "3px", background: "#F1F5F9", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: cfg.color, borderRadius: "3px", transition: "width 0.5s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* STATUS DOS PEDIDOS */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>📊 Status dos Pedidos</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            {byStatus.map(([status, count]) => {
              const cfg = STATUS_LABELS[status] || { label: status, emoji: "📋", color: "#64748B" };
              return (
                <div key={status} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.6rem", borderRadius: "10px", background: `${cfg.color}08`, border: `1px solid ${cfg.color}20` }}>
                  <span style={{ fontSize: "1.2rem" }}>{cfg.emoji}</span>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0, color: cfg.color }}>{count}</p>
                    <p style={{ fontSize: "0.7rem", color: "#64748B", margin: 0 }}>{cfg.label}</p>
                  </div>
                </div>
              );
            })}
            {/* Delivery vs Retirada */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.6rem", borderRadius: "10px", background: "#FFF7ED", border: "1px solid #FFEDD520" }}>
              <span style={{ fontSize: "1.2rem" }}>🛵</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0, color: "#EA580C" }}>{deliveryCount}</p>
                <p style={{ fontSize: "0.7rem", color: "#64748B", margin: 0 }}>Delivery</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.6rem", borderRadius: "10px", background: "#F0FDF4", border: "1px solid #DCFCE720" }}>
              <span style={{ fontSize: "1.2rem" }}>🏪</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0, color: "#16A34A" }}>{pickupCount}</p>
                <p style={{ fontSize: "0.7rem", color: "#64748B", margin: 0 }}>Retirada</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MAPA DE CALOR & DISTRIBUIÇÃO GEOGRÁFICA DE PEDIDOS POR FILTRO */}
      <StoreDashboardMap
        orders={filteredOrders}
        dateFilterLabel={
          dateFilter === "hoje"
            ? "Hoje"
            : dateFilter === "ontem"
            ? "Ontem"
            : dateFilter === "semana"
            ? "Últimos 7 dias"
            : dateFilter === "mes"
            ? "Este Mês"
            : "Período Personalizado"
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        {/* PEDIDOS POR HORA */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>🕐 Pedidos por Hora</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "120px" }}>
            {byHour.map((count, h) => (
              <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                <span style={{ fontSize: "0.55rem", color: "#94A3B8", fontWeight: 600 }}>{count > 0 ? count : ""}</span>
                <div style={{
                  width: "100%", borderRadius: "3px 3px 0 0",
                  height: `${Math.max(count / maxHour * 100, count > 0 ? 8 : 2)}%`,
                  background: count > 0 ? (h >= 11 && h <= 14 ? "#C62828" : h >= 18 && h <= 22 ? "#F59E0B" : "#3B82F6") : "#F1F5F9",
                  transition: "height 0.3s"
                }} />
                <span style={{ fontSize: "0.55rem", color: "#94A3B8" }}>{h}h</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.75rem", fontSize: "0.7rem" }}>
            <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#C62828", marginRight: "4px" }} />Almoço</span>
            <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#F59E0B", marginRight: "4px" }} />Jantar</span>
            <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "#3B82F6", marginRight: "4px" }} />Outros</span>
          </div>
        </div>

        {/* TOP PRODUTOS */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>🏆 Top Produtos</h3>
          {topProducts.length === 0 ? (
            <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Sem dados no período</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {topProducts.map((p, i) => {
                const margem = p.total > 0 && p.cost > 0 ? ((p.total - p.cost) / p.total * 100) : null;
                const margemColor = margem === null ? "#94A3B8" : margem >= 40 ? "#16A34A" : margem >= 20 ? "#F59E0B" : "#EF4444";
                return (
                  <div key={p.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.5rem", borderRadius: "8px", background: i === 0 ? "#FFF7ED" : "transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ width: "22px", height: "22px", borderRadius: "6px", background: i < 3 ? "#C62828" : "#E2E8F0", color: i < 3 ? "#fff" : "#64748B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700 }}>{i + 1}</span>
                      <span style={{ fontSize: "0.82rem", fontWeight: 500 }}>{p.name}</span>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{p.qty}x</span>
                      {margem !== null && (
                        <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "8px", background: margemColor + "18", color: margemColor }}>
                          {margem.toFixed(0)}% mg
                        </span>
                      )}
                      <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>R$ {p.total.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ÚLTIMOS PEDIDOS */}
      <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>📋 Últimos Pedidos</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #F1F5F9" }}>
                {["Pedido", ...(isAdmin && selectedStoreId === "todas" ? ["Loja"] : []), "Cliente", "Tipo", "Pagamento", "Status", "Valor", "Hora"].map(h => (
                  <th key={h} style={{ padding: "0.5rem", textAlign: "left", color: "#94A3B8", fontWeight: 600, fontSize: "0.75rem" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(o => {
                const st = STATUS_LABELS[o.status] || { emoji: "📋", label: o.status, color: "#64748B" };
                const pm = PAYMENT_LABELS[o.paymentMethod || "OUTRO"] || PAYMENT_LABELS.OUTRO;
                return (
                  <tr key={o.id} style={{ borderBottom: "1px solid #F8FAFC" }}>
                    <td style={{ padding: "0.5rem", fontWeight: 700 }}>#{o.id.slice(-6).toUpperCase()}</td>
                    {isAdmin && selectedStoreId === "todas" && (
                      <td style={{ padding: "0.5rem" }}>
                        <span style={{ fontSize: "0.75rem", background: "#F1F5F9", padding: "2px 8px", borderRadius: "8px", fontWeight: 600, color: "#475569" }}>
                          🏪 {o.storeName || "—"}
                        </span>
                      </td>
                    )}
                    <td style={{ padding: "0.5rem" }}>{o.customerName}</td>
                    <td style={{ padding: "0.5rem" }}>{o.deliveryType === "DELIVERY" ? "🛵" : "🏪"}</td>
                    <td style={{ padding: "0.5rem" }}><span style={{ color: pm.color, fontWeight: 600 }}>{pm.label}</span></td>
                    <td style={{ padding: "0.5rem" }}><span style={{ padding: "2px 8px", borderRadius: "12px", background: `${st.color}15`, color: st.color, fontWeight: 600, fontSize: "0.75rem" }}>{st.emoji} {st.label}</span></td>
                    <td style={{ padding: "0.5rem", fontWeight: 700 }}>R$ {o.totalAmount.toFixed(2)}</td>
                    <td style={{ padding: "0.5rem", color: "#94A3B8" }}>{new Date(o.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                );
              })}
              {recentOrders.length === 0 && (
                <tr><td colSpan={isAdmin && selectedStoreId === "todas" ? 8 : 7} style={{ padding: "2rem", textAlign: "center", color: "#94A3B8" }}>Nenhum pedido no período selecionado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
