"use client";

/**
 * "Meu relatório" no app do entregador: o MESMO filtro de data e hora do
 * relatório da loja (Motoboys → Relatório) e a mesma conta
 * (lib/relatorio-do-entregador.ts, via /api/motoboys/relatorio).
 *
 * Existe para a loja e o motoboy conferirem o mesmo período e chegarem no
 * mesmo número — a Frangoso via 9 entregas e o motoboy 10 (02/10/2026).
 * Hora em branco vale o expediente inteiro, das 5h às 5h do dia seguinte,
 * igual à loja; com hora, fecha exatamente o turno (18:00 do dia 1 às 02:00
 * do dia 2).
 */
import { useState, type CSSProperties } from "react";
import { Loader2, X } from "lucide-react";

const reais = (v: number | null | undefined) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

/** O dia do EXPEDIENTE no relógio do celular: antes das 5h ainda é ontem. */
function diaDoExpediente(deslocarDias = 0): string {
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
  d.setDate(d.getDate() + deslocarDias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Resposta = {
  period: { from: string; to: string };
  stats: null | {
    totalDeliveries: number; uniqueDays: number; feeTotal: number; dailyTotal: number; totalWithDaily: number;
    cashCollectedSum: number; cashOrdersCount: number; changeGivenSum: number;
  };
  motoboy?: { dailyRate: number; entregasSemDistancia: number };
  cancelados: { qtd: number };
  orders: {
    id: string; createdAt: string; dailyOrderNumber: number | null; ifoodReference: string | null;
    openDeliveryReference: string | null; customerName: string | null; paymentMethod: string | null;
    totalAmount: number; cashToDeliver: number; ganhoDoMotoboy: number; status: string;
  }[];
  error?: string;
};

export default function MeuRelatorio({ motoboyId, storeId, aoFechar }: { motoboyId: string; storeId: string; aoFechar: () => void }) {
  const [deDia, setDeDia] = useState(diaDoExpediente());
  const [ateDia, setAteDia] = useState(diaDoExpediente());
  const [deHora, setDeHora] = useState("");
  const [ateHora, setAteHora] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [dados, setDados] = useState<Resposta | null>(null);

  async function buscar(de = deDia, ate = ateDia, hDe = deHora, hAte = ateHora) {
    setCarregando(true);
    setErro("");
    try {
      const q = new URLSearchParams({
        motoboyId, storeId,
        from: de + (hDe ? `T${hDe}` : ""),
        to: ate + (hAte ? `T${hAte}` : ""),
      });
      const res = await fetch(`/api/motoboys/relatorio?${q}`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as Resposta;
      if (!res.ok) { setErro(j?.error || "Não consegui buscar agora."); setDados(null); return; }
      setDados(j);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }

  const atalho = (dias: number) => {
    const d = diaDoExpediente(dias);
    setDeDia(d); setAteDia(d); setDeHora(""); setAteHora("");
    buscar(d, d, "", "");
  };

  const campo: CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 10,
    border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontFamily: "inherit", background: "#fff",
  };
  const rotulo: CSSProperties = { fontSize: "0.72rem", fontWeight: 800, color: "#64748B", marginBottom: 4, display: "block" };
  const s = dados?.stats;

  return (
    <div onClick={aoFechar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#F8FAFC", width: "100%", maxWidth: 600, maxHeight: "92vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "16px 16px 28px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 900, color: "#0F172A" }}>Meu relatório</h2>
          <button onClick={aoFechar} aria-label="Fechar" style={{ background: "none", border: "none", padding: 6, cursor: "pointer" }}><X size={22} color="#475569" /></button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => atalho(0)} style={{ flex: 1, padding: "9px", borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>Hoje</button>
          <button onClick={() => atalho(-1)} style={{ flex: 1, padding: "9px", borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>Ontem</button>
        </div>

        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: 12, marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8, marginBottom: 8 }}>
            <label><span style={rotulo}>DE (dia)</span><input type="date" value={deDia} onChange={(e) => setDeDia(e.target.value)} style={campo} /></label>
            <label><span style={rotulo}>HORA</span><input type="time" value={deHora} onChange={(e) => setDeHora(e.target.value)} style={campo} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8, marginBottom: 8 }}>
            <label><span style={rotulo}>ATÉ (dia)</span><input type="date" value={ateDia} onChange={(e) => setAteDia(e.target.value)} style={campo} /></label>
            <label><span style={rotulo}>HORA</span><input type="time" value={ateHora} onChange={(e) => setAteHora(e.target.value)} style={campo} /></label>
          </div>
          <div style={{ fontSize: "0.72rem", color: "#64748B", lineHeight: 1.45, marginBottom: 10 }}>
            Hora em branco vale o dia inteiro do expediente: das <strong>5h</strong> até as <strong>5h</strong> do dia seguinte.
            Para um turno exato, use por exemplo <strong>18:00</strong> no dia 1 e <strong>02:00</strong> no dia 2 — o mesmo filtro da loja.
          </div>
          <button onClick={() => buscar()} disabled={carregando} style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", background: "#0F172A", color: "#fff", fontWeight: 900, fontSize: "0.95rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {carregando ? <Loader2 size={18} className="animate-spin" /> : null} Ver relatório
          </button>
        </div>

        {erro && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 12, padding: 10, fontWeight: 700, fontSize: "0.85rem", marginBottom: 12 }}>{erro}</div>}

        {dados && (
          <>
            <div style={{ fontSize: "0.75rem", color: "#64748B", marginBottom: 8, textAlign: "center" }}>
              {new Date(dados.period.from).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              {" até "}
              {new Date(dados.period.to).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[
                { t: "ENTREGAS", v: String(s?.totalDeliveries ?? 0), cor: "#16A34A" },
                { t: "A RECEBER", v: reais(s?.totalWithDaily), cor: "#0F172A" },
                { t: "POR ENTREGA", v: reais(s?.feeTotal), cor: "#334155" },
                { t: s && s.uniqueDays > 0 && (dados.motoboy?.dailyRate || 0) > 0 ? `DIÁRIA (${s.uniqueDays} dia${s.uniqueDays > 1 ? "s" : ""})` : "DIÁRIA", v: reais(s?.dailyTotal), cor: "#334155" },
              ].map((c) => (
                <div key={c.t} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#64748B" }}>{c.t}</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 900, color: c.cor, marginTop: 2 }}>{c.v}</div>
                </div>
              ))}
            </div>
            {s && s.cashOrdersCount > 0 && (
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: 10, fontSize: "0.85rem", color: "#92400E", fontWeight: 700, marginBottom: 12 }}>
                Dinheiro para entregar na loja: {reais(s.cashCollectedSum)} ({s.cashOrdersCount} pedido{s.cashOrdersCount > 1 ? "s" : ""}
                {s.changeGivenSum > 0 ? `, ${reais(s.changeGivenSum)} saíram de troco` : ""})
              </div>
            )}
            {dados.cancelados.qtd > 0 && (
              <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: 10 }}>
                {dados.cancelados.qtd} pedido{dados.cancelados.qtd > 1 ? "s" : ""} cancelado{dados.cancelados.qtd > 1 ? "s" : ""} no período — fora da conta.
              </div>
            )}
            {(dados.motoboy?.entregasSemDistancia || 0) > 0 && (
              <div style={{ fontSize: "0.78rem", color: "#B45309", marginBottom: 10 }}>
                {dados.motoboy!.entregasSemDistancia} entrega(s) sem distância calculada — confira com a loja.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {dados.orders.map((o) => (
                <div key={o.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "9px 11px", display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: "0.88rem", color: "#0F172A" }}>
                      #{o.dailyOrderNumber ?? o.ifoodReference ?? o.openDeliveryReference ?? "—"}{" "}
                      <span style={{ fontWeight: 600, color: "#64748B" }}>
                        {new Date(o.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {o.customerName || "Cliente"} · {o.paymentMethod || "—"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: "0.9rem", color: "#16A34A" }}>{reais(o.ganhoDoMotoboy)}</div>
                    {o.cashToDeliver > 0 && <div style={{ fontSize: "0.72rem", color: "#92400E", fontWeight: 700 }}>💵 {reais(o.cashToDeliver)}</div>}
                  </div>
                </div>
              ))}
              {dados.orders.length === 0 && (
                <div style={{ textAlign: "center", color: "#64748B", fontSize: "0.85rem", padding: 16 }}>Nenhuma entrega nesse período.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
