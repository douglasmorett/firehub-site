"use client";
import { useState, useEffect, useCallback } from "react";

type IfoodStatus = {
  merchantId: string;
  fetchedAt: string;
  status: any;
  openingHours: any;
  interruptions: any;
  error?: string;
};

function StatusBadge({ value, trueLabel = "Sim", falseLabel = "Não" }: { value: boolean; trueLabel?: string; falseLabel?: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 12px", borderRadius: 20, fontSize: "0.8rem", fontWeight: 700,
      background: value ? "#DCFCE7" : "#FEE2E2", color: value ? "#16A34A" : "#DC2626",
      border: `1px solid ${value ? "#86EFAC" : "#FCA5A5"}`
    }}>
      {value ? `✅ ${trueLabel}` : `❌ ${falseLabel}`}
    </span>
  );
}

export default function IfoodStatusDashboard() {
  const [data, setData] = useState<IfoodStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.fetch("/api/ifood/status");
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
    } catch { }
    setLoading(false);
  }, []);

  // Auto-refresh every 5s when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    fetch();
    const interval = setInterval(fetch, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetch]);

  useEffect(() => { fetch(); }, [fetch]);

  const s = data?.status;
  const interruptions = data?.interruptions ?? [];
  const hours = data?.openingHours ?? [];
  const activeInterruption = Array.isArray(interruptions)
    ? interruptions.find((i: any) => i.active || i.status === "ACTIVE")
    : null;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#EA1D2C", margin: 0 }}>📡 Status ao Vivo — iFood</h1>
          <p style={{ color: "#64748B", fontSize: "0.85rem", margin: "4px 0 0" }}>
            Dados direto da API iFood · Merchant: <code style={{ background: "#F1F5F9", padding: "2px 6px", borderRadius: 4 }}>{data?.merchantId ?? "..."}</code>
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (5s)
          </label>
          <button
            onClick={fetch}
            disabled={loading}
            style={{ padding: "8px 18px", background: "#EA1D2C", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
          >
            {loading ? "⏳ Buscando..." : "🔄 Atualizar"}
          </button>
        </div>
      </div>

      {lastRefresh && (
        <p style={{ fontSize: "0.78rem", color: "#94A3B8", marginBottom: "1.5rem" }}>
          ⏱ Última atualização: {lastRefresh.toLocaleTimeString("pt-BR")}
        </p>
      )}

      {!data && !loading && (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94A3B8" }}>Clique em Atualizar para buscar os dados do iFood</div>
      )}

      {data?.error && (
        <div style={{ padding: "1rem", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, color: "#DC2626", marginBottom: "1.5rem" }}>
          ❌ Erro ao buscar dados: {data.error}
        </div>
      )}

      {data && !data.error && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* Loja Status */}
          <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "1.25rem" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "1rem", color: "#1E293B" }}>🏪 Status da Loja</h2>
            {s ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Estado</div>
                  <span style={{
                    display: "inline-block", padding: "5px 16px", borderRadius: 20, fontWeight: 800, fontSize: "0.9rem",
                    background: s.available ? "#DCFCE7" : "#FEE2E2",
                    color: s.available ? "#16A34A" : "#DC2626",
                    border: `2px solid ${s.available ? "#86EFAC" : "#FCA5A5"}`
                  }}>
                    {s.available ? "🟢 ABERTA" : "🔴 FECHADA"}
                  </span>
                </div>
                <div><div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Aceitando pedidos</div><StatusBadge value={s.acceptingOrders ?? s.available} trueLabel="Sim" falseLabel="Não" /></div>
                <div><div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Validado</div><StatusBadge value={s.validated ?? false} /></div>
                {s.message && <div style={{ width: "100%", fontSize: "0.82rem", color: "#64748B", background: "#F8FAFC", padding: "8px 12px", borderRadius: 8 }}>💬 {s.message}</div>}
              </div>
            ) : (
              <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Status não disponível</p>
            )}
          </div>

          {/* Pausas/Interrupções */}
          <div style={{ background: "#fff", border: `1.5px solid ${activeInterruption ? "#FCD34D" : "#E2E8F0"}`, borderRadius: 14, padding: "1.25rem" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "1rem", color: "#1E293B" }}>⏸️ Pausas Programadas</h2>
            {Array.isArray(interruptions) && interruptions.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {interruptions.map((i: any, idx: number) => (
                  <div key={idx} style={{ padding: "10px 14px", background: i.active ? "#FFFBEB" : "#F8FAFC", borderRadius: 10, border: `1px solid ${i.active ? "#FCD34D" : "#E2E8F0"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{i.description ?? "Pausa"}</span>
                      <StatusBadge value={i.active ?? false} trueLabel="Ativa" falseLabel="Inativa" />
                    </div>
                    {(i.start || i.startTime) && <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 4 }}>⏰ {i.start ?? i.startTime} → {i.end ?? i.endTime}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>✅ Nenhuma pausa ativa no momento</p>
            )}
          </div>

          {/* Horários */}
          <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "1.25rem" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "1rem", color: "#1E293B" }}>🕐 Horários de Funcionamento</h2>
            {Array.isArray(hours) && hours.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {hours.map((h: any, idx: number) => (
                  <div key={idx} style={{ padding: "10px 14px", background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0" }}>
                    <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1E293B", marginBottom: 4 }}>
                      {h.dayOfWeek ?? h.day ?? `Dia ${idx + 1}`}
                    </div>
                    {h.shifts?.map((shift: any, si: number) => (
                      <div key={si} style={{ fontSize: "0.8rem", color: "#3B82F6" }}>🕐 {shift.startTime} → {shift.endTime}</div>
                    ))}
                    {!h.shifts && <div style={{ fontSize: "0.8rem", color: "#3B82F6" }}>🕐 {h.startTime} → {h.endTime}</div>}
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Horários não disponíveis</p>
            )}
          </div>

          {/* Raw JSON toggle */}
          <details style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.85rem", color: "#475569" }}>🔍 Ver resposta JSON completa do iFood</summary>
            <pre style={{ fontSize: "0.72rem", color: "#334155", marginTop: "0.75rem", overflow: "auto", maxHeight: 400 }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
