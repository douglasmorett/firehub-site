import { prisma } from "@/lib/prisma";
import ToggleFranqueadoHakim from "@/components/ToggleFranqueadoHakim";
import ToggleAdmin from "@/components/ToggleAdmin";
import { ImpersonateButton } from "@/components/FranchiseeForm";
import GrantDaysButton from "@/components/admin/GrantDaysButton";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Lojistas — Admin FireHub" };

const fmt = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const fmtDate = (d: Date | null) => d ? new Date(d).toLocaleDateString("pt-BR") : "—";
const daysSince = (d: Date) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
const TRIAL_DAYS = 15;

export default async function AdminLojistasPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const me = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { role: true },
  });
  if (me?.role !== "ADMIN") redirect("/store");

  const lojistas = await prisma.user.findMany({
    where: { role: { in: ["FRANCHISEE", "ADMIN"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, email: true, slug: true, role: true,
      storeName: true, city: true, createdAt: true, storeOpen: true,
      isFranqueadoHakim: true, mpAccessToken: true, celcoinAccountId: true,
      mpSellerId: true, cashOpen: true, storeLogo: true, trialEndsAt: true,
      _count: { select: { menuProducts: true, customerOrders: true } },
    },
  });

  const hakimSet = new Set(lojistas.filter(l => l.isFranqueadoHakim || l.email?.toLowerCase() === "contatohakim@gmail.com").map(l => l.id));

  // Pega billing de cada lojista
  const billings = await prisma.franchiseeBillingCycle.findMany({
    where: { franchiseeId: { in: lojistas.map(l => l.id) }, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    select: { franchiseeId: true, amountPending: true, status: true },
  });
  const billingMap: Record<string, number> = {};
  billings.forEach(b => {
    if (!hakimSet.has(b.franchiseeId) && !billingMap[b.franchiseeId]) billingMap[b.franchiseeId] = b.amountPending;
  });

  const isLojistaInTrial = (l: typeof lojistas[0]) => {
    if (l.trialEndsAt) return new Date(l.trialEndsAt) > new Date();
    return daysSince(l.createdAt) < TRIAL_DAYS;
  };

  const getTrialDaysLeft = (l: typeof lojistas[0]) => {
    if (l.trialEndsAt) {
      const diff = new Date(l.trialEndsAt).getTime() - Date.now();
      return Math.max(0, Math.ceil(diff / 86400000));
    }
    return Math.max(0, TRIAL_DAYS - daysSince(l.createdAt));
  };

  const totalLojistas = lojistas.length;
  const emTrial = lojistas.filter(l => isLojistaInTrial(l)).length;
  const ativos = lojistas.filter(l => !isLojistaInTrial(l)).length;
  const comMP = lojistas.filter(l => l.mpAccessToken || l.mpSellerId).length;
  const comPendencia = Object.values(billingMap).filter(v => v > 0).length;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem 1rem", fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <a href="/admin" style={{ color: "#64748B", textDecoration: "none", fontSize: "0.85rem" }}>← Voltar para Visão Geral</a>
        <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>
          🏪 Gestão de Lojistas
        </h1>
        <span style={{ background: "#EF4444", color: "#fff", fontSize: "0.7rem", fontWeight: 800, padding: "3px 10px", borderRadius: 99 }}>
          ADMIN
        </span>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Total Lojistas", value: totalLojistas, color: "#2563EB", icon: "🏪" },
          { label: "Em Trial / Benefício", value: emTrial, color: "#F59E0B", icon: "🎁" },
          { label: "Assinantes", value: ativos, color: "#10B981", icon: "✅" },
          { label: "Com Mercado Pago", value: comMP, color: "#8B5CF6", icon: "💳" },
          { label: "Com Pendência", value: comPendencia, color: "#EF4444", icon: "⚠️" },
        ].map(k => (
          <div key={k.label} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 4 }}>{k.icon}</div>
            <div style={{ fontSize: "1.8rem", fontWeight: 900, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: "0.72rem", color: "#64748B", textTransform: "uppercase", letterSpacing: 0.5 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Todos os Lojistas ({totalLojistas})</span>
          <a href="/store/admin/lojistas/novo" style={{ background: "#EF4444", color: "#fff", padding: "6px 16px", borderRadius: 8, fontWeight: 700, fontSize: "0.8rem", textDecoration: "none" }}>
            + Novo Lojista
          </a>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["Lojista", "Email", "Cidade", "Cadastro", "Status", "Produtos", "Pedidos", "Admin", "Hakim", "Ações de Suporte"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lojistas.map(l => {
                const emTrialL = isLojistaInTrial(l);
                const diasRestantes = getTrialDaysLeft(l);
                const pendencia = hakimSet.has(l.id) ? 0 : (billingMap[l.id] || 0);

                return (
                  <tr key={l.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {l.storeLogo
                          ? <img src={l.storeLogo} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover" }} />
                          : <div style={{ width: 28, height: 28, borderRadius: 6, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem" }}>🏪</div>
                        }
                        <div>
                          <div style={{ fontWeight: 700, color: "#0F172A" }}>{l.storeName || l.name}</div>
                          {l.slug && <div style={{ fontSize: "0.7rem", color: "#94A3B8" }}>/{l.slug}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px", color: "#374151" }}>{l.email}</td>
                    <td style={{ padding: "10px 12px", color: "#64748B" }}>{l.city || "—"}</td>
                    <td style={{ padding: "10px 12px", color: "#64748B", whiteSpace: "nowrap" }}>{fmtDate(l.createdAt)}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {l.isFranqueadoHakim ? (
                        <span style={{ background: "#EEF2FF", color: "#4F46E5", padding: "3px 8px", borderRadius: 6, fontWeight: 700, fontSize: "0.75rem" }}>
                          🛡️ Isento (Hakim)
                        </span>
                      ) : pendencia > 0 ? (
                        <span style={{ background: "#FEF2F2", color: "#DC2626", padding: "3px 8px", borderRadius: 6, fontWeight: 700, fontSize: "0.75rem" }}>
                          ⚠️ {fmt(pendencia)}
                        </span>
                      ) : emTrialL ? (
                        <span style={{ background: "#FEF9C3", color: "#92400E", padding: "3px 8px", borderRadius: 6, fontWeight: 700, fontSize: "0.75rem" }}>
                          🎁 Trial {diasRestantes}d
                        </span>
                      ) : (
                        <span style={{ background: "#F0FDF4", color: "#16A34A", padding: "3px 8px", borderRadius: 6, fontWeight: 700, fontSize: "0.75rem" }}>
                          ✅ Ativo
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>{l._count.menuProducts}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center", fontWeight: 700 }}>{l._count.customerOrders}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <ToggleAdmin userId={l.id} initialValue={l.role === "ADMIN"} />
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <ToggleFranqueadoHakim userId={l.id} initialValue={l.isFranqueadoHakim} />
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {l.slug && (
                          <a href={`/loja/${l.slug}`} target="_blank" style={{ fontSize: "0.75rem", color: "#2563EB", fontWeight: 600, textDecoration: "none" }} title="Ver loja">🔗 Cardápio</a>
                        )}
                        <ImpersonateButton id={l.id} />
                        <GrantDaysButton userId={l.id} storeName={l.storeName || l.name} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
