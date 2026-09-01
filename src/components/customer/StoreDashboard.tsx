"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, DollarSign, ShoppingCart, Users, CreditCard, Banknote, Smartphone, ArrowUpRight, ArrowDownRight, Filter, Calendar, Store as StoreIcon } from "lucide-react";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import StoreDashboardMap from "@/components/customer/StoreDashboardMap";
import { parseComboSelections, safeParseCombo } from "@/lib/parse-combo";
import { nomeDoItem } from "@/lib/nome-do-item";

type Order = {
  id: string; totalAmount: number; status: string; deliveryType: string;
  paymentMethod?: string; customerName: string; customerPhone?: string;
  customerAddress?: string; ifoodReference?: string; openDeliveryReference?: string;
  source?: string; notes?: string;
  createdAt: string; items?: any[]; storeName?: string; storeSlug?: string;
};
type StoreOption = { id: string; name: string; slug: string };

const formatBRL = (val: number) => {
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

// Normalizador unificado de Formas de Pagamento para evitar linhas duplicadas de "Outro"
function normalizePaymentMethod(rawMethod?: string): { key: string; label: string; icon: any; color: string } {
  const m = (rawMethod || "").toUpperCase().trim();

  if (m.includes("PIX")) {
    return { key: "PIX", label: "Pix", icon: Smartphone, color: "#00BFA5" };
  }
  if (m.includes("CREDIT") || m.includes("CREDITO") || m.includes("CRÉDITO")) {
    return { key: "CREDITO", label: "Cartão de Crédito", icon: CreditCard, color: "#9C27B0" };
  }
  if (m.includes("DEBIT") || m.includes("DEBITO") || m.includes("DÉBITO")) {
    return { key: "DEBITO", label: "Cartão de Débito", icon: CreditCard, color: "#2196F3" };
  }
  if (m.includes("DINHEIRO") || m.includes("MONEY") || m.includes("ESPECIE") || m.includes("ESPÉCIE")) {
    return { key: "DINHEIRO", label: "Dinheiro", icon: Banknote, color: "#4CAF50" };
  }
  if (m.includes("IFOOD") || m.includes("JOTAJA") || m.includes("ONLINE") || m.includes("PREPAID") || m.includes("PAGO")) {
    return { key: "ONLINE", label: "Pago Online (iFood / Site)", icon: Smartphone, color: "#EA1D2C" };
  }
  if (m.includes("VOUCHER") || m.includes("VR") || m.includes("VA") || m.includes("SODEXO") || m.includes("ALELO") || m.includes("TICKET")) {
    return { key: "VOUCHER", label: "Vale Refeição (VR/VA)", icon: DollarSign, color: "#E65100" };
  }
  return { key: "OUTRO", label: "Outros Meios / Balcão", icon: DollarSign, color: "#64748B" };
}

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

  // Formas de pagamento agrupadas e categorizadas corretamente
  const byPayment = useMemo(() => {
    const map: Record<string, { key: string; label: string; icon: any; color: string; count: number; total: number }> = {};
    activeOrders.forEach(o => {
      const cfg = normalizePaymentMethod(o.paymentMethod);
      if (!map[cfg.key]) {
        map[cfg.key] = { key: cfg.key, label: cfg.label, icon: cfg.icon, color: cfg.color, count: 0, total: 0 };
      }
      map[cfg.key].count++;
      map[cfg.key].total += o.totalAmount;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
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

  // Top produtos com nome limpo e margem
  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; qty: number; total: number; cost: number }> = {};
    activeOrders.forEach(o => {
      o.items?.forEach((item: any) => {
        let name = nomeDoItem(item, "");
        if (!name || name === "Item de Integração" || name === "Produto excluído" || name === "—") {
          if (item.comboSelections) {
              const cs = safeParseCombo(item.comboSelections);
              const first: any = Array.isArray(cs) ? cs[0] : cs;
              name = first?.name || first?.title || first?.productName || first?.itemTitle || "";
          }
        }
        if (!name) name = "Item (Integração)";

        if (!map[name]) map[name] = { name, qty: 0, total: 0, cost: 0 };
        map[name].qty += item.quantity;
        map[name].total += item.price * item.quantity;
        map[name].cost += (item.cost || 0) * item.quantity;
      });
    });
    return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [activeOrders]);

  // Pedidos por hora com distribuição por horário
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
          <p style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0, color: "#1E293B" }}>{value}</p>
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

      {/* KPI CARDS (Formatação em Real BRL brasileira: R$ 31.428,71) */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <Card title="FATURAMENTO" value={formatBRL(totalVendas)} icon={DollarSign} color="#10B981" trend={crescimento} subtitle={`${totalPedidos} pedidos`} />
        <Card title="PEDIDOS" value={totalPedidos} icon={ShoppingCart} color="#3B82F6" subtitle={cancelados > 0 ? `${cancelados} cancelado(s)` : "Sem cancelamentos"} />
        <Card title="TICKET MÉDIO" value={formatBRL(ticketMedio)} icon={TrendingUp} color="#8B5CF6" />
        <Card title="CLIENTES" value={new Set(activeOrders.map(o => o.customerPhone || o.customerName)).size} icon={Users} color="#F59E0B" subtitle="Clientes únicos" />
        <Card title="LUCRO LÍQUIDO" value={formatBRL(lucroLiquido)} icon={DollarSign} color={lucroLiquido >= 0 ? "#059669" : "#EF4444"} subtitle={`Margem: ${margemLucro.toFixed(1)}% | Custos: ${formatBRL(totalCost)} | Taxas: ${formatBRL(totalFees)}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        {/* FORMAS DE PAGAMENTO (Categorizadas e Agrupadas) */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>💳 Formas de Pagamento</h3>
          {byPayment.length === 0 ? (
            <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Sem dados no período</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {byPayment.map((data) => {
                const pct = totalVendas > 0 ? (data.total / totalVendas * 100) : 0;
                const Icon = data.icon;
                return (
                  <div key={data.key}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `${data.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon size={16} color={data.color} />
                        </div>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0F172A" }}>{data.label}</span>
                          <span style={{ fontSize: "0.75rem", color: "#64748B", marginLeft: "6px" }}>{data.count} pedidos ({pct.toFixed(1)}%)</span>
                        </div>
                      </div>
                      <span style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A" }}>{formatBRL(data.total)}</span>
                    </div>
                    <div style={{ height: "7px", borderRadius: "4px", background: "#F1F5F9", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: data.color, borderRadius: "4px", transition: "width 0.5s" }} />
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
        {/* PEDIDOS POR HORA (Design de Barras Vertical de Alta Definição) */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0, color: "#1E293B" }}>🕐 Pedidos por Hora (Pico do Dia)</h3>
            <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.72rem", fontWeight: 600 }}>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#EF4444" }} />Almoço (11h-14h)
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#F59E0B" }} />Jantar (18h-22h)
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#3B82F6" }} />Outros
              </span>
            </div>
          </div>

          {/* Gráfico de Barras com altura 100% garantida no container */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "150px", padding: "10px 0 5px" }}>
            {byHour.map((count, h) => {
              const heightPct = count > 0 ? Math.max((count / maxHour) * 100, 10) : 4;
              const barColor = h >= 11 && h <= 14 ? "#EF4444" : h >= 18 && h <= 22 ? "#F59E0B" : "#3B82F6";

              return (
                <div key={h} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }} title={`${h}h: ${count} pedido(s)`}>
                  {count > 0 && (
                    <span style={{ fontSize: "0.62rem", color: "#1E293B", fontWeight: 800, marginBottom: "3px" }}>
                      {count}
                    </span>
                  )}
                  <div style={{
                    width: "100%",
                    height: `${heightPct}%`,
                    borderRadius: "4px 4px 0 0",
                    background: count > 0 ? `linear-gradient(to top, ${barColor}, ${barColor}DD)` : "#F1F5F9",
                    transition: "all 0.3s ease",
                    boxShadow: count > 0 ? `0 2px 6px ${barColor}40` : "none"
                  }} />
                  <span style={{ fontSize: "0.6rem", color: "#64748B", fontWeight: h % 3 === 0 || count > 0 ? 700 : 500, marginTop: "4px" }}>
                    {h}h
                  </span>
                </div>
              );
            })}
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
                      <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#1E293B" }}>{p.name}</span>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{p.qty}x</span>
                      {margem !== null && (
                        <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "8px", background: margemColor + "18", color: margemColor }}>
                          {margem.toFixed(0)}% mg
                        </span>
                      )}
                      <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}>{formatBRL(p.total)}</span>
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
                const pm = normalizePaymentMethod(o.paymentMethod);
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
                    <td style={{ padding: "0.5rem", fontWeight: 800 }}>{formatBRL(o.totalAmount)}</td>
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
