"use client";
import { useState, useCallback } from "react";
import { Calendar, Download, Filter, Bike, TrendingUp, DollarSign, MapPin, Loader2 } from "lucide-react";

type Motoboy = { id: string; name: string; paymentType: string; dailyRate?: number; perDeliveryRate?: number; perKmRate?: number; active: boolean };

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const PERIODS = [
  { label: "Hoje", value: "today" },
  { label: "Esta semana", value: "week" },
  { label: "Este mês", value: "month" },
  { label: "Personalizado", value: "custom" },
];

function getRange(period: string) {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  if (period === "today") return { from: fmt(now), to: fmt(now) };
  if (period === "week") {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay());
    return { from: fmt(start), to: fmt(now) };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: fmt(start), to: fmt(now) };
  }
  return null;
}

export default function MotoboyReport({ motoboys }: { motoboys: Motoboy[] }) {
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedMotoboy, setSelectedMotoboy] = useState("all");
  const [report, setReport] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [periodInfo, setPeriodInfo] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const range = period === "custom" ? { from: customFrom, to: customTo } : getRange(period);
    if (!range?.from || !range?.to) { setLoading(false); return; }

    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (selectedMotoboy !== "all") params.set("motoboyId", selectedMotoboy);

    const res = await fetch(`/api/motoboy-report?${params}`);
    if (res.ok) {
      const data = await res.json();
      setReport(data.report);
      setPeriodInfo(data.period);
      setLoaded(true);
    }
    setLoading(false);
  }, [period, customFrom, customTo, selectedMotoboy]);

  const totalPay = report.reduce((s, r) => s + r.stats.totalToPay, 0);
  const totalDeliveries = report.reduce((s, r) => s + r.stats.totalDeliveries, 0);

  const PAYMENT_TYPE_LABEL: Record<string, string> = {
    PER_DELIVERY: "Por entrega",
    DAILY_RATE: "Diária",
    BOTH: "Diária + Entrega",
    PER_KM: "Por KM",
  };

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Filtros */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Filter size={18} color="#C62828" /> Filtros do Relatório
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          {/* Período */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Período</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PERIODS.map(p => (
                <button key={p.value} onClick={() => setPeriod(p.value)}
                  style={{ padding: "6px 14px", borderRadius: 20, border: `1.5px solid ${period === p.value ? "#C62828" : "#E2E8F0"}`, background: period === p.value ? "#C62828" : "#fff", color: period === p.value ? "#fff" : "#475569", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
                  {p.label}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.82rem" }} />
                <span style={{ alignSelf: "center", color: "#94A3B8" }}>até</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.82rem" }} />
              </div>
            )}
          </div>

          {/* Motoboy */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Motoboy</label>
            <select value={selectedMotoboy} onChange={e => setSelectedMotoboy(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none", background: "#fff" }}>
              <option value="all">Todos os motoboys</option>
              {motoboys.map(mb => <option key={mb.id} value={mb.id}>{mb.name}</option>)}
            </select>
          </div>
        </div>

        <button onClick={load} disabled={loading}
          style={{ padding: "10px 24px", background: "#C62828", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <TrendingUp size={16} />}
          {loading ? "Carregando..." : "Gerar Relatório"}
        </button>
      </div>

      {/* Resultados */}
      {loaded && !loading && (
        <>
          {/* Totais */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total de Entregas", value: totalDeliveries.toString(), icon: Bike, color: "#3B82F6" },
              { label: "Motoboys no período", value: report.filter(r => r.stats.totalDeliveries > 0).length.toString(), icon: Filter, color: "#8B5CF6" },
              { label: "Total a Pagar", value: fmt(totalPay), icon: DollarSign, color: "#C62828" },
            ].map(card => (
              <div key={card.label} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: card.color + "15", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <card.icon size={16} color={card.color} />
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}>{card.label}</span>
                </div>
                <div style={{ fontWeight: 900, fontSize: "1.3rem", color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Cards por motoboy */}
          {report.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#94A3B8", background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0" }}>
              <Bike size={40} style={{ margin: "0 auto 10px" }} color="#CBD5E1" />
              <p>Nenhuma entrega encontrada no período.</p>
            </div>
          ) : report.map(r => (
            <div key={r.motoboy.id} style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: 20, marginBottom: 14 }}>
              {/* Header motoboy */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 44, height: 44, background: "#FEF3E2", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Bike size={22} color="#C62828" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "1rem" }}>{r.motoboy.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748B" }}>{PAYMENT_TYPE_LABEL[r.motoboy.paymentType] || r.motoboy.paymentType}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "0.7rem", color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>Total a pagar</div>
                  <div style={{ fontWeight: 900, fontSize: "1.4rem", color: "#C62828" }}>{fmt(r.stats.totalToPay)}</div>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, background: "#F8FAFC", borderRadius: 10, padding: 12, marginBottom: 14 }}>
                {[
                  { label: "Entregas", value: r.stats.totalDeliveries },
                  { label: "Dias trab.", value: r.stats.uniqueDays },
                  { label: "KM total", value: r.stats.totalDistance + " km" },
                  { label: "Taxa/KM", value: r.motoboy.perKmRate ? fmt(r.motoboy.perKmRate) + "/km" : "-" },
                ].map(s => (
                  <div key={s.label} style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 800, fontSize: "1rem", color: "#1E293B" }}>{s.value}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94A3B8", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Breakdown pagamento */}
              <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 10 }}>
                <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Composição do Pagamento</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {r.stats.dailyTotal > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                      <span>Diária: {fmt(r.motoboy.dailyRate || 0)} × {r.stats.uniqueDays} dias</span>
                      <span style={{ fontWeight: 700 }}>{fmt(r.stats.dailyTotal)}</span>
                    </div>
                  )}
                  {r.stats.perDeliveryTotal > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                      <span>Por entrega: {fmt(r.motoboy.perDeliveryRate || 0)} × {r.stats.totalDeliveries}</span>
                      <span style={{ fontWeight: 700 }}>{fmt(r.stats.perDeliveryTotal)}</span>
                    </div>
                  )}
                  {r.stats.perKmTotal > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                      <span>Por KM: {fmt(r.motoboy.perKmRate || 0)} × {r.stats.totalDistance} km</span>
                      <span style={{ fontWeight: 700 }}>{fmt(r.stats.perKmTotal)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "0.95rem", borderTop: "2px solid #1E293B", paddingTop: 6, marginTop: 4 }}>
                    <span>TOTAL</span>
                    <span style={{ color: "#C62828" }}>{fmt(r.stats.totalToPay)}</span>
                  </div>
                </div>
              </div>

              {/* Entregas detalhadas */}
              {r.orders.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: "0.8rem", fontWeight: 700, color: "#64748B", cursor: "pointer" }}>
                    📦 Ver {r.orders.length} entrega(s) detalhada(s)
                  </summary>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {r.orders.map((o: any) => (
                      <div key={o.id} style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 8, padding: "5px 8px", background: "#F8FAFC", borderRadius: 8, fontSize: "0.78rem" }}>
                        <span style={{ color: "#64748B" }}>{new Date(o.date).toLocaleDateString("pt-BR")}</span>
                        <span style={{ fontWeight: 600 }}>{o.customerName} {o.customerAddress ? `— ${o.customerAddress.substring(0, 30)}...` : ""}</span>
                        <span style={{ fontWeight: 700, color: o.deliveryDistance ? "#3B82F6" : "#94A3B8" }}>
                          {o.deliveryDistance ? `${o.deliveryDistance} km` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
