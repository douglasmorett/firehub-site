import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const fmtDate = (d: Date) => new Date(d).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
const fmtDur = (open: Date, close: Date) => {
  const m = Math.round((new Date(close).getTime() - new Date(open).getTime()) / 60000);
  return m < 60 ? `${m}min` : `${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}`;
};

export const metadata = { title: "Histórico de Caixas — FireHub" };

export default async function CaixaHistoricoPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" }, select: { id: true, role: true } });
  if (!user) redirect("/login");

  const sessions = await prisma.cashSession.findMany({
    where: { franchiseeId: user.id, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: 60,
  });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1rem", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem" }}>
        <a href="/store/venda-presencial" style={{ color: "#64748B", textDecoration: "none", fontSize: "0.85rem" }}>← Voltar</a>
        <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 900, color: "#0F172A" }}>🏦 Histórico de Caixas</h1>
      </div>

      {sessions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94A3B8", background: "#F8FAFC", borderRadius: 16 }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>📭</div>
          <p style={{ margin: 0, fontWeight: 600 }}>Nenhum caixa encerrado ainda.</p>
        </div>
      ) : sessions.map((s, idx) => {
        const hasData = (s as any).expectedTotal > 0;
        const diff = (s as any).difference || 0;
        const ok = Math.abs(diff) < 0.01;
        return (
          <div key={s.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            {/* Header */}
            <div style={{ background: ok ? "#F0FDF4" : "#FEF2F2", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: "1.3rem" }}>{ok ? "✅" : "⚠️"}</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>
                    Caixa #{sessions.length - idx} — {s.closedAt ? fmtDate(s.closedAt) : "—"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                    Aberto: {fmtDate(s.openedAt)} {s.closedAt ? `• Duração: ${fmtDur(s.openedAt, s.closedAt)}` : ""}
                    {s.closedBy ? ` • Encerrado por: ${s.closedBy}` : ""}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.72rem", color: "#64748B" }}>TOTAL</div>
                <div style={{ fontWeight: 900, fontSize: "1.1rem", color: ok ? "#16A34A" : "#DC2626" }}>
                  {fmt((s as any).expectedTotal || 0)}
                </div>
                {!ok && <div style={{ fontSize: "0.72rem", color: diff < 0 ? "#DC2626" : "#D97706", fontWeight: 700 }}>
                  {diff < 0 ? `Faltou ${fmt(Math.abs(diff))}` : `Sobrou ${fmt(diff)}`}
                </div>}
              </div>
            </div>

            {/* Tabela detalhada */}
            {hasData && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={{ padding: "8px 16px", textAlign: "left", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>Forma</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>Sistema</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>Contado</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>Dif.</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "💵 Dinheiro", exp: (s as any).expectedCash, cnt: (s as any).closingCash },
                    { label: "💳 Débito",   exp: (s as any).expectedDebit, cnt: (s as any).closingDebit },
                    { label: "💳 Crédito",  exp: (s as any).expectedCredit, cnt: (s as any).closingCredit },
                    { label: "⚡ PIX",      exp: (s as any).expectedPix, cnt: (s as any).closingPix },
                    { label: "🎟️ Voucher",  exp: (s as any).expectedVoucher, cnt: (s as any).closingVoucher },
                  ].filter(r => (r.exp || 0) > 0 || (r.cnt || 0) > 0).map(r => {
                    const d = (r.cnt || 0) - (r.exp || 0);
                    return (
                      <tr key={r.label} style={{ borderBottom: "1px solid #F1F5F9" }}>
                        <td style={{ padding: "7px 16px", fontWeight: 600, color: "#374151" }}>{r.label}</td>
                        <td style={{ padding: "7px 16px", textAlign: "right", color: "#64748B" }}>{fmt(r.exp || 0)}</td>
                        <td style={{ padding: "7px 16px", textAlign: "right", color: "#374151", fontWeight: 700 }}>{fmt(r.cnt || 0)}</td>
                        <td style={{ padding: "7px 16px", textAlign: "right", fontWeight: 700, color: Math.abs(d) < 0.01 ? "#16A34A" : d < 0 ? "#DC2626" : "#D97706" }}>
                          {Math.abs(d) < 0.01 ? "✓" : d > 0 ? `+${fmt(d)}` : fmt(d)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: ok ? "#F0FDF4" : "#FEF2F2" }}>
                    <td style={{ padding: "8px 16px", fontWeight: 900 }}>TOTAL</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 700 }}>{fmt((s as any).expectedTotal || 0)}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 900, color: ok ? "#16A34A" : "#DC2626" }}>{fmt((s as any).closingCash + (s as any).closingDebit + (s as any).closingCredit + (s as any).closingPix + (s as any).closingVoucher || 0)}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 900, color: ok ? "#16A34A" : diff < 0 ? "#DC2626" : "#D97706" }}>
                      {ok ? "✅ OK" : diff > 0 ? `+${fmt(diff)}` : fmt(diff)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            <div style={{ padding: "8px 16px", fontSize: "0.75rem", color: "#94A3B8", borderTop: "1px solid #F1F5F9" }}>
              Abertura: {fmt(s.openingAmount || 0)} em troco inicial
            </div>
          </div>
        );
      })}
    </div>
  );
}
