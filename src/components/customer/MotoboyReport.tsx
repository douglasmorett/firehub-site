"use client";
import { useState, useCallback } from "react";
import { Calendar, Download, Filter, Bike, TrendingUp, DollarSign, MapPin, Loader2, X } from "lucide-react";

type Motoboy = { id: string; name: string; paymentType: string; dailyRate?: number; perDeliveryRate?: number; perKmRate?: number; active: boolean };

const fmt = (v: number) => `R$ ${(v || 0).toFixed(2).replace(".", ",")}`;
const PERIODS = [
  { label: "Hoje", value: "today" },
  { label: "Esta semana", value: "week" },
  { label: "Este mês", value: "month" },
  { label: "Personalizado", value: "custom" },
];

function getBrasilDateString(d: Date = new Date()): string {
  const spDate = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const yyyy = spDate.getFullYear();
  const mm = String(spDate.getMonth() + 1).padStart(2, "0");
  const dd = String(spDate.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getRange(period: string) {
  const now = new Date();
  if (period === "today") return { from: getBrasilDateString(now), to: getBrasilDateString(now) };
  if (period === "week") {
    const spNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const start = new Date(spNow);
    start.setDate(spNow.getDate() - spNow.getDay());
    return { from: getBrasilDateString(start), to: getBrasilDateString(now) };
  }
  if (period === "month") {
    const spNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const start = new Date(spNow.getFullYear(), spNow.getMonth(), 1);
    return { from: getBrasilDateString(start), to: getBrasilDateString(now) };
  }
  return null;
}

export default function MotoboyReport({ motoboys }: { motoboys: Motoboy[] }) {
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedMotoboy, setSelectedMotoboy] = useState("all");
  const [calcMode, setCalcMode] = useState<"all" | "fee_only">("all");
  const [report, setReport] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [periodInfo, setPeriodInfo] = useState<any>(null);
  const [selectedOrderModal, setSelectedOrderModal] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const range = period === "custom" ? { from: customFrom, to: customTo } : getRange(period);
    if (!range?.from || !range?.to) { setLoading(false); return; }

    const params = new URLSearchParams({ from: range.from, to: range.to, calcMode });
    if (selectedMotoboy !== "all") params.set("motoboyId", selectedMotoboy);

    const res = await fetch(`/api/motoboy-report?${params}`);
    if (res.ok) {
      const data = await res.json();
      setReport(data.report);
      setPeriodInfo(data.period);
      setLoaded(true);
    }
    setLoading(false);
  }, [period, customFrom, customTo, selectedMotoboy, calcMode]);

  const getMotoboyPay = (r: any) => calcMode === "fee_only" ? r.stats.totalFeeOnly : r.stats.totalWithDaily;
  const totalPay = report.reduce((s, r) => s + getMotoboyPay(r), 0);
  const totalDeliveries = report.reduce((s, r) => s + r.stats.totalDeliveries, 0);
  const totalCashCollected = report.reduce((s, r) => s + (r.stats.cashCollectedSum || 0), 0);
  const totalCardPos = report.reduce((s, r) => s + (r.stats.cardPosTotal || 0), 0);

  const PAYMENT_TYPE_LABEL: Record<string, string> = {
    PER_DELIVERY: "Por entrega",
    DAILY_RATE: "Diária Fixa",
    BOTH: "Diária + Entrega",
    DAILY_PLUS_FEE: "Diária + Taxa do Pedido",
    PER_KM: "Por KM",
  };

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Filtros */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Filter size={18} color="#C62828" /> Filtros do Relatório
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
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

        {/* Componentes do Pagamento a apurar */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Composição de Cálculo</label>
          <div style={{ display: "flex", gap: 8, maxWidth: 400 }}>
            <button onClick={() => setCalcMode("all")}
              style={{ flex: 1, padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${calcMode === "all" ? "#C62828" : "#E2E8F0"}`, background: calcMode === "all" ? "#FEF2F2" : "#fff", color: calcMode === "all" ? "#C62828" : "#475569", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              💵 Diária + Taxa
            </button>
            <button onClick={() => setCalcMode("fee_only")}
              style={{ flex: 1, padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${calcMode === "fee_only" ? "#C62828" : "#E2E8F0"}`, background: calcMode === "fee_only" ? "#FEF2F2" : "#fff", color: calcMode === "fee_only" ? "#C62828" : "#475569", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              🛵 Só Taxa
            </button>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total Entregas", value: totalDeliveries.toString(), icon: Bike, color: "#3B82F6" },
              { label: "Dinheiro a Entregar", value: fmt(totalCashCollected), icon: DollarSign, color: "#16A34A" },
              { label: "Maquininhas Cartão", value: fmt(totalCardPos), icon: DollarSign, color: "#6D28D9" },
              { label: "Taxas/Diárias (Motoboy)", value: fmt(totalPay), icon: DollarSign, color: "#C62828" },
            ].map(card => (
              <div key={card.label} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: card.color + "15", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <card.icon size={15} color={card.color} />
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600 }}>{card.label}</span>
                </div>
                <div style={{ fontWeight: 900, fontSize: "1.15rem", color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Cards por motoboy */}
          {report.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#94A3B8", background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0" }}>
              <Bike size={40} style={{ margin: "0 auto 10px" }} color="#CBD5E1" />
              <p>Nenhuma entrega encontrada no período.</p>
            </div>
          ) : report.map(r => {
            const payAmount = getMotoboyPay(r);
            return (
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
                    <div style={{ fontSize: "0.7rem", color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>
                      Total a pagar ao motoboy {calcMode === "fee_only" ? "(Só Taxa)" : ""}
                    </div>
                    <div style={{ fontWeight: 900, fontSize: "1.4rem", color: "#C62828" }}>{fmt(payAmount)}</div>
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

                {/* Conferência Unificada do Motoboy */}
                <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: 16, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 900, color: "#0F172A", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                      📋 CONFERÊNCIA DO MOTOBOY ({r.stats.totalDeliveries} entregas)
                    </span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "#166534", background: "#DCFCE7", padding: "4px 10px", borderRadius: 20 }}>
                        💵 Entregar Dinheiro: {fmt(r.stats.cashCollectedSum || 0)}
                      </span>
                      <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "#6D28D9", background: "#F3E8FF", padding: "4px 10px", borderRadius: 20 }}>
                        💳 Total Maquininha: {fmt(r.stats.cardPosTotal || 0)}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                    {/* Quadrado Dinheiro */}
                    <div style={{ background: (r.stats.cashCollectedSum || 0) > 0 ? "#F0FDF4" : "#fff", border: `1.5px solid ${(r.stats.cashCollectedSum || 0) > 0 ? "#86EFAC" : "#CBD5E1"}`, borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.72rem", color: (r.stats.cashCollectedSum || 0) > 0 ? "#166534" : "#64748B", fontWeight: 700 }}>💵 Dinheiro (em mãos)</div>
                      <div style={{ fontWeight: 900, fontSize: "1.05rem", color: (r.stats.cashCollectedSum || 0) > 0 ? "#15803D" : "#0F172A", marginTop: 2 }}>{fmt(r.stats.cashCollectedSum || 0)}</div>
                      <div style={{ fontSize: "0.68rem", color: (r.stats.cashCollectedSum || 0) > 0 ? "#166534" : "#94A3B8", marginTop: 2 }}>{r.stats.cashOrdersCount || 0} pedido(s)</div>
                    </div>

                    {/* Quadrado Débito */}
                    <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700 }}>💳 Débito (Máquina)</div>
                      <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F172A", marginTop: 2 }}>{fmt(r.stats.debitTotal || 0)}</div>
                      <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>{r.stats.debitCount || 0} pedido(s)</div>
                    </div>

                    {/* Quadrado Crédito */}
                    <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700 }}>💳 Crédito (Máquina)</div>
                      <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F172A", marginTop: 2 }}>{fmt(r.stats.creditTotal || 0)}</div>
                      <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>{r.stats.creditCount || 0} pedido(s)</div>
                    </div>

                    {/* Quadrado Voucher */}
                    <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700 }}>🎟️ Voucher (Vale)</div>
                      <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F172A", marginTop: 2 }}>{fmt(r.stats.voucherTotal || 0)}</div>
                      <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>{r.stats.voucherCount || 0} pedido(s)</div>
                    </div>

                    {/* Quadrado Pago Online */}
                    {r.stats.onlineTotal > 0 && (
                      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: "0.72rem", color: "#166534", fontWeight: 700 }}>⚡ Pago Online</div>
                        <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#15803D", marginTop: 2 }}>{fmt(r.stats.onlineTotal)}</div>
                        <div style={{ fontSize: "0.68rem", color: "#166534", marginTop: 2 }}>{r.stats.onlineCount} pedido(s) site/app</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Breakdown pagamento */}
                <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 10 }}>
                  <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Composição do Pagamento</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {r.stats.dailyTotal > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", opacity: calcMode === "fee_only" ? 0.45 : 1 }}>
                        <span style={{ textDecoration: calcMode === "fee_only" ? "line-through" : "none" }}>
                          Diária: {fmt(r.motoboy.dailyRate || 0)} × {r.stats.uniqueDays} dias {calcMode === "fee_only" ? "(Desconsiderada)" : ""}
                        </span>
                        <span style={{ fontWeight: 700, textDecoration: calcMode === "fee_only" ? "line-through" : "none" }}>{fmt(r.stats.dailyTotal)}</span>
                      </div>
                    )}
                    {r.stats.perDeliveryTotal > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem" }}>
                        <span>
                          {r.motoboy.paymentType === "DAILY_PLUS_FEE" ? `Taxa dos Pedidos (${r.stats.totalDeliveries} entregas)` : `Por entrega: ${fmt(r.motoboy.perDeliveryRate || 0)} × ${r.stats.totalDeliveries}`}
                        </span>
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
                      <span>TOTAL {calcMode === "fee_only" ? "(SÓ TAXAS)" : "(DIÁRIA + TAXAS)"}</span>
                      <span style={{ color: "#C62828" }}>{fmt(payAmount)}</span>
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
                      {r.orders.map((o: any) => {
                        const isCash = (o.paymentMethod || "").toUpperCase() === "CASH" || (o.paymentMethod || "").toUpperCase() === "DINHEIRO";
                        return (
                          <div key={o.id} style={{ display: "grid", gridTemplateColumns: "85px 1fr 130px auto auto auto", gap: 8, padding: "8px 10px", background: "#F8FAFC", borderRadius: 8, fontSize: "0.78rem", alignItems: "center" }}>
                            <span style={{ color: "#64748B" }}>{new Date(o.date).toLocaleDateString("pt-BR")}</span>
                            <span style={{ fontWeight: 600 }}>{o.customerName} {o.customerAddress ? `— ${o.customerAddress.substring(0, 20)}...` : ""}</span>
                            <span>
                              <span style={{ background: isCash ? "#FEF3C7" : "#E2E8F0", color: isCash ? "#B45309" : "#475569", padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontSize: "0.7rem" }}>
                                {isCash ? `💵 Dinheiro (${fmt(o.totalAmount)})` : `💳 ${o.paymentMethod}`}
                              </span>
                            </span>
                            {o.deliveryDistance ? <span style={{ color: "#3B82F6", fontWeight: 600 }}>{o.deliveryDistance} km</span> : <span />}
                            <span style={{ fontWeight: 700, color: "#16A34A" }}>Taxa: {fmt(o.deliveryFee)}</span>
                            <button
                              onClick={() => setSelectedOrderModal(o)}
                              style={{ padding: "4px 8px", background: "#EFF6FF", color: "#2563EB", border: "1px solid #BFDBFE", borderRadius: 6, fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                            >
                              👁️ Ver Pedido
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── MODAL DETALHES DO PEDIDO ── */}
      {selectedOrderModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setSelectedOrderModal(null)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 500, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", position: "relative" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedOrderModal(null)} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><X size={16} color="#64748B" /></button>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ background: "#FEF2F2", color: "#C62828", width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: "1.2rem" }}>
                📦
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>Pedido #{selectedOrderModal.id.slice(-6).toUpperCase()}</h3>
                <span style={{ fontSize: "0.78rem", color: "#64748B" }}>
                  {new Date(selectedOrderModal.date).toLocaleDateString("pt-BR")} às {new Date(selectedOrderModal.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>

            {/* Informações do Cliente */}
            <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 4 }}>👤 Cliente & Entrega</div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>{selectedOrderModal.customerName}</div>
              {selectedOrderModal.customerPhone && (
                <div style={{ fontSize: "0.82rem", color: "#2563EB", fontWeight: 600, marginTop: 2 }}>📞 {selectedOrderModal.customerPhone}</div>
              )}
              {selectedOrderModal.customerAddress && (
                <div style={{ fontSize: "0.82rem", color: "#475569", marginTop: 4, lineHeight: 1.4 }}>
                  📍 {selectedOrderModal.customerAddress}
                </div>
              )}
            </div>

            {/* Resumo do Pagamento */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div style={{ background: "#F1F5F9", borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700 }}>FORMA DE PGTO</span>
                <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A", marginTop: 2 }}>{selectedOrderModal.paymentMethod}</div>
              </div>
              <div style={{ background: "#F1F5F9", borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700 }}>VALOR TOTAL</span>
                <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#16A34A", marginTop: 2 }}>{fmt(selectedOrderModal.totalAmount)}</div>
              </div>
            </div>

            {/* Itens do Pedido */}
            {selectedOrderModal.items && Array.isArray(selectedOrderModal.items) && selectedOrderModal.items.length > 0 && (
              <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>🍔 Itens do Pedido</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {selectedOrderModal.items.map((it: any, idx: number) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#334155" }}>
                      <span>{it.quantity}x {it.name || it.productName}</span>
                      <strong>{fmt((it.price || it.unitPrice || 0) * (it.quantity || 1))}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedOrderModal.notes && (
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: "0.8rem", color: "#92400E" }}>
                📝 <strong>Obs:</strong> {selectedOrderModal.notes}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <a
                href="/store/pedidos-clientes"
                style={{ flex: 1, padding: "10px", background: "#2563EB", color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem", textDecoration: "none", textAlign: "center" }}
              >
                📋 Abrir no Gerenciador ↗
              </a>
              <button
                onClick={() => setSelectedOrderModal(null)}
                style={{ padding: "10px 18px", background: "#F1F5F9", color: "#475569", border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}
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
