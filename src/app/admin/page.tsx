import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";

export const metadata = { title: "FireHub Admin — Visão Geral" };

const TRIAL_DAYS = 15;
const daysSince = (d: Date) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  // ── Lojistas ──────────────────────────────────────────────
  const lojistas = await prisma.user.findMany({
    where: { role: "FRANCHISEE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, email: true, slug: true,
      storeName: true, city: true, createdAt: true, storeOpen: true,
      isFranqueadoHakim: true, mpAccessToken: true, celcoinAccountId: true,
      mpSellerId: true, storeLogo: true, storePhone: true,
    },
  });

  // ── Billing cycles ────────────────────────────────────────
  const billings = await prisma.franchiseeBillingCycle.findMany({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    select: {
      franchiseeId: true, amountDue: true, amountPending: true,
      amountOffset: true, closedAt: true, status: true,
    },
  });

  // ── KPIs gerais ───────────────────────────────────────────
  const totalLojistas = lojistas.length;
  const emTrial = lojistas.filter(l => daysSince(l.createdAt) < TRIAL_DAYS).length;
  const assinantes = lojistas.filter(l => daysSince(l.createdAt) >= TRIAL_DAYS).length;

  // Novos este mês
  const startOfMonth = new Date();
  startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
  const novosMes = lojistas.filter(l => new Date(l.createdAt) >= startOfMonth).length;

  // Novos esta semana
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7); startOfWeek.setHours(0, 0, 0, 0);
  const novosSemana = lojistas.filter(l => new Date(l.createdAt) >= startOfWeek).length;

  // MRR = soma dos amountDue do último billing de cada lojista
  const lastBillingMap: Record<string, number> = {};
  billings.forEach(b => {
    if (!lastBillingMap[b.franchiseeId]) {
      lastBillingMap[b.franchiseeId] = b.amountDue;
    }
  });
  const mrr = Object.values(lastBillingMap).reduce((sum, v) => sum + v, 0);

  // Total arrecadado = amountDue - amountPending (o que efetivamente foi pago)
  const totalArrecadado = billings.reduce((sum, b) => sum + Math.max(0, b.amountDue - b.amountPending), 0);

  // Pendências
  const pendingMap: Record<string, number> = {};
  billings.forEach(b => {
    if (!pendingMap[b.franchiseeId] && b.amountPending > 0) {
      pendingMap[b.franchiseeId] = b.amountPending;
    }
  });
  const totalPendente = Object.values(pendingMap).reduce((sum, v) => sum + v, 0);
  const comPendencia = Object.keys(pendingMap).length;

  // ── Série temporal: cadastros por mês (últimos 6 meses) ───
  const now = new Date();
  const monthlyGrowth = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const next = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 1);
    const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
    const count = lojistas.filter(l => {
      const c = new Date(l.createdAt);
      return c >= d && c < next;
    }).length;
    return { label, count };
  });

  // Serializa lojistas
  const serialized = lojistas.map(l => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
    diasCadastro: daysSince(l.createdAt),
    emTrial: daysSince(l.createdAt) < TRIAL_DAYS,
    pendente: pendingMap[l.id] || 0,
    temMP: !!(l.mpAccessToken || l.mpSellerId),
    temCelcoin: !!l.celcoinAccountId,
  }));

  return (
    <AdminDashboardClient
      adminName={session?.user?.name || "Admin"}
      kpis={{
        totalLojistas, emTrial, assinantes,
        novosMes, novosSemana,
        mrr, totalArrecadado, totalPendente, comPendencia,
      }}
      monthlyGrowth={monthlyGrowth}
      lojistas={serialized}
    />
  );
}
