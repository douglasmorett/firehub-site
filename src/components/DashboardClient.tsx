"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { TrendingUp, Clock, AlertTriangle, Users, ShoppingBag, DollarSign, CalendarCheck } from "lucide-react";

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function StatCard({
  title, value, subtitle, icon, color, bg
}: {
  title: string; value: string; subtitle?: string; icon: React.ReactNode; color: string; bg: string;
}) {
  return (
    <div className="card" style={{ display: "flex", alignItems: "flex-start", gap: "1rem", borderLeft: `4px solid ${color}` }}>
      <div style={{ padding: "0.75rem", borderRadius: "10px", backgroundColor: bg, color, flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>{title}</p>
        <p style={{ fontSize: "1.5rem", fontWeight: "bold", color }}>{value}</p>
        {subtitle && <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{subtitle}</p>}
      </div>
    </div>
  );
}

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR");

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING_PAYMENT: { label: "Aguardando Pgto.", color: "#f59e0b" },
  PAID: { label: "Pago", color: "#10b981" },
  CANCELLED: { label: "Cancelado", color: "#ef4444" },
};

export default function DashboardClient({
  session, month, year, totalFranchisees, totalOrders,
  recentOrders, pendingPayables, overduePayables, totalPayablesToday, asaasData
}: any) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Polling para atualização em tempo real (a cada 10 segundos)
    const interval = setInterval(() => {
      router.refresh();
    }, 10000);
    
    return () => clearInterval(interval);
  }, [router]);

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [m, y] = e.target.value.split("-");
    router.push(`/admin?month=${m}&year=${y}`);
  };

  const currentValue = `${month}-${year}`;

  // Gerar últimos 12 meses para o select
  const monthOptions = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    monthOptions.push({ value: `${m}-${y}`, label: `${MONTHS[m - 1]} / ${y}` });
  }

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 className="font-bold" style={{ fontSize: "1.75rem" }}>Dashboard</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Bem-vindo, {session?.user?.name} 👋</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label style={{ fontSize: "0.85rem", fontWeight: "bold" }}>Período:</label>
          <select className="input" style={{ width: "auto" }} value={currentValue} onChange={handleMonthChange}>
            {monthOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Seção: A Receber (Asaas) */}
      <h2 style={{ fontSize: "1rem", fontWeight: "bold", marginBottom: "1rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        📊 Cobranças de Lojistas (Asaas) — {MONTHS[month - 1]} {year}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard
          title="Recebido no Período"
          value={formatCurrency(asaasData?.received?.value || 0)}
          subtitle={`${asaasData?.received?.count || 0} cobranças pagas`}
          icon={<TrendingUp size={22} />}
          color="#10b981"
          bg="rgba(16,185,129,0.1)"
        />
        <StatCard
          title="Pendente a Receber"
          value={formatCurrency(asaasData?.pending?.value || 0)}
          subtitle={`${asaasData?.pending?.count || 0} cobranças em aberto`}
          icon={<Clock size={22} />}
          color="#f59e0b"
          bg="rgba(245,158,11,0.1)"
        />
        <StatCard
          title="Cobranças Vencidas"
          value={formatCurrency(asaasData?.overdue?.value || 0)}
          subtitle={`${asaasData?.overdue?.count || 0} lojistas inadimplentes`}
          icon={<AlertTriangle size={22} />}
          color="#ef4444"
          bg="rgba(239,68,68,0.1)"
        />
      </div>

      {/* Seção: Resumo Geral */}
      <h2 style={{ fontSize: "1rem", fontWeight: "bold", marginBottom: "1rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        🏢 Resumo Geral do Sistema
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard
          title="Lojistas Ativos"
          value={String(totalFranchisees)}
          subtitle="Cadastrados no sistema"
          icon={<Users size={22} />}
          color="#6366f1"
          bg="rgba(99,102,241,0.1)"
        />
        <StatCard
          title="Total de Pedidos"
          value={String(totalOrders)}
          subtitle="Desde o início"
          icon={<ShoppingBag size={22} />}
          color="#0ea5e9"
          bg="rgba(14,165,233,0.1)"
        />
        <StatCard
          title="Contas a Pagar — Hoje"
          value={formatCurrency(totalPayablesToday)}
          subtitle={overduePayables > 0 ? `⚠️ ${overduePayables} conta(s) atrasada(s)!` : "Sem atrasos"}
          icon={<CalendarCheck size={22} />}
          color={overduePayables > 0 ? "#ef4444" : "#10b981"}
          bg={overduePayables > 0 ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)"}
        />
        <StatCard
          title="Contas Futuras Pendentes"
          value={String(pendingPayables)}
          subtitle="Ainda não pagas"
          icon={<DollarSign size={22} />}
          color="#f59e0b"
          bg="rgba(245,158,11,0.1)"
        />
      </div>

      {/* Pedidos Recentes */}
      <h2 style={{ fontSize: "1rem", fontWeight: "bold", marginBottom: "1rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        🛒 Últimos 5 Pedidos
      </h2>
      <div className="card">
        {recentOrders.length === 0 ? (
          <p className="text-muted text-sm">Nenhum pedido ainda.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)", textAlign: "left" }}>
                <th style={{ padding: "0.5rem" }}>Lojista</th>
                <th style={{ padding: "0.5rem" }}>Cidade</th>
                <th style={{ padding: "0.5rem" }}>Valor</th>
                <th style={{ padding: "0.5rem" }}>Data</th>
                <th style={{ padding: "0.5rem" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((order: any) => {
                const st = STATUS_MAP[order.status] || { label: order.status, color: "#888" };
                return (
                  <tr key={order.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "0.5rem", fontWeight: "bold" }}>{order.user?.name}</td>
                    <td style={{ padding: "0.5rem", color: "var(--text-muted)" }}>{order.user?.city || "-"}</td>
                    <td style={{ padding: "0.5rem" }}>{formatCurrency(order.totalAmount)}</td>
                    <td style={{ padding: "0.5rem" }}>{mounted ? formatDate(order.createdAt) : ""}</td>
                    <td style={{ padding: "0.5rem" }}>
                      <span style={{ color: st.color, fontWeight: "bold", fontSize: "0.8rem" }}>● {st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
