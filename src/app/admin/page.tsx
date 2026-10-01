import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";
import { getCurrentYearMonth, intervaloDoMes, isExemptAccount } from "@/lib/billing";
import { inicioDoDiaDaLojaAtras } from "@/lib/fuso";
import { atividadeDasLojas } from "@/lib/atividade-da-loja";

export const dynamic = "force-dynamic";
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
      mpSellerId: true, storeLogo: true, storePhone: true, trialEndsAt: true,
      cpfCnpj: true, repasseConfig: true, onboardingData: true,
      vendedorId: true, vendedorStatus: true, vendedorAtribuidoEm: true,
      ambassadorId: true, accountGroupId: true,
    },
  });

  // Loja aberta pelo "Nova loja" do painel nasce com e-mail virtual
  // (…@stores.firehub.app) dentro da conta da loja principal (accountGroupId).
  // A lista mostra o e-mail e o telefone de quem é o dono da conta, e marca
  // as duas pontas: "loja extra de X" e "+N lojas na conta".
  const porId = new Map(lojistas.map(l => [l.id, l]));
  const contaPrincipalDe = (l: (typeof lojistas)[number]) =>
    l.accountGroupId && l.accountGroupId !== l.id ? porId.get(l.accountGroupId) ?? null : null;
  const lojasExtras = new Map<string, number>();
  for (const l of lojistas) {
    const principal = contaPrincipalDe(l);
    if (principal) lojasExtras.set(principal.id, (lojasExtras.get(principal.id) || 0) + 1);
  }

  // Está usando? O último pedido de cada loja, para achar quem parou.
  const atividade = await atividadeDasLojas(lojistas.map(l => l.id));

  // A equipe de vendas, para o seletor ao lado de cada loja (lib/vendedores.ts).
  const vendedores = await prisma.ambassador.findMany({
    where: { isVendedor: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, active: true },
  });

  // Todos os embaixadores, para o seletor "quem indicou" ao lado do vendedor
  // (api/admin/lojistas/[id]/embaixador).
  const embaixadores = await prisma.ambassador.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, active: true },
  });

  // Lojistas isentos de cobrança do FireHub — as mesmas regras do fechamento
  // (lib/billing.ts). Só `isFranqueadoHakim` deixava a Hakim Centro (isenta
  // pelo e-mail) somar um boleto cancelado de julho em "Pendências" e no MRR.
  const exemptSet = new Set(
    lojistas.filter(l => l.isFranqueadoHakim || isExemptAccount(l.email)).map(l => l.id)
  );

  // ── Billing cycles ────────────────────────────────────────
  // Só os ciclos que viraram BOLETO. Paga, a mensalidade passa a PAID
  // (lib/pagamento-da-mensalidade.ts): ler só CLOSED fazia a loja que pagou
  // sumir do MRR e deixava "Total arrecadado" em zero para sempre.
  const billings = await prisma.franchiseeBillingCycle.findMany({
    where: { asaasPaymentId: { not: null }, status: { in: ["CLOSED", "PAID"] } },
    orderBy: { closedAt: "desc" },
    select: {
      franchiseeId: true, yearMonth: true, amountDue: true, amountPending: true,
      closedAt: true, status: true, paidAt: true, paidValue: true, asaasStatus: true,
    },
  });
  // O valor do boleto: mensalidade + lojas adicionais no iFood/99 + tráfego +
  // totem. `amountDue` é só a mensalidade — somar ele deixava de fora R$ 400
  // das taxas de setembro/2026.
  const valorDoBoleto = (b: (typeof billings)[number]) =>
    b.status === "PAID" ? (b.paidValue ?? b.amountDue) : b.amountPending;
  const boletoCancelado = (b: (typeof billings)[number]) => ["DELETED", "REFUNDED"].includes(String(b.asaasStatus || ""));

  const isLojistaInTrial = (l: { createdAt: Date; trialEndsAt: Date | null }) => {
    if (l.trialEndsAt) {
      return new Date(l.trialEndsAt) > new Date();
    }
    return daysSince(l.createdAt) < TRIAL_DAYS;
  };

  const getTrialDaysLeft = (l: { createdAt: Date; trialEndsAt: Date | null }) => {
    if (l.trialEndsAt) {
      const diff = new Date(l.trialEndsAt).getTime() - Date.now();
      return Math.max(0, Math.ceil(diff / 86400000));
    }
    return Math.max(0, TRIAL_DAYS - daysSince(l.createdAt));
  };

  // ── KPIs gerais ───────────────────────────────────────────
  const totalLojistas = lojistas.length;
  const emTrial = lojistas.filter(l => isLojistaInTrial(l)).length;
  const assinantes = lojistas.filter(l => !isLojistaInTrial(l)).length;

  // Novos este mês
  // Fronteiras EM BRASÍLIA — setHours/getMonth respondem no fuso do container (UTC).
  const { monthStart: startOfMonth } = intervaloDoMes(getCurrentYearMonth());
  const novosMes = lojistas.filter(l => new Date(l.createdAt) >= startOfMonth).length;

  // Novos esta semana
  const startOfWeek = inicioDoDiaDaLojaAtras(7);
  const novosSemana = lojistas.filter(l => new Date(l.createdAt) >= startOfWeek).length;

  // MRR = o último boleto de cada lojista (mais recente primeiro).
  const lastBillingMap: Record<string, number> = {};
  billings.forEach(b => {
    if (!exemptSet.has(b.franchiseeId) && !boletoCancelado(b) && lastBillingMap[b.franchiseeId] === undefined) {
      lastBillingMap[b.franchiseeId] = valorDoBoleto(b);
    }
  });
  const mrr = Object.values(lastBillingMap).reduce((sum, v) => sum + v, 0);
  const pagantes = Object.keys(lastBillingMap).length;

  // Total arrecadado = boletos que o Asaas confirmou pagos.
  const totalArrecadado = billings.reduce((sum, b) => sum + (b.status === "PAID" && b.paidAt ? valorDoBoleto(b) : 0), 0);

  // Pendências: TODO boleto em aberto da loja (de qualquer mês), menos isentas
  // e boleto cancelado no Asaas.
  const pendingMap: Record<string, number> = {};
  billings.forEach(b => {
    if (!exemptSet.has(b.franchiseeId) && b.status === "CLOSED" && b.amountPending > 0 && !boletoCancelado(b)) {
      pendingMap[b.franchiseeId] = (pendingMap[b.franchiseeId] || 0) + b.amountPending;
    }
  });
  const totalPendente = Object.values(pendingMap).reduce((sum, v) => sum + v, 0);
  const comPendencia = Object.keys(pendingMap).length;

  // ── Série temporal: cadastros por mês (últimos 6 meses) ───
  const monthlyGrowth = Array.from({ length: 6 }, (_, i) => {
    const { monthStart: d, monthEnd: next } = intervaloDoMes(getCurrentYearMonth(-(5 - i)));
    const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "America/Sao_Paulo" });
    const count = lojistas.filter(l => {
      const c = new Date(l.createdAt);
      return c >= d && c < next;
    }).length;
    return { label, count };
  });

  // Serializa lojistas (sem expor tokens sensíveis ao client)
  const serialized = lojistas.map(l => ({
    id: l.id,
    name: l.name,
    email: contaPrincipalDe(l)?.email || l.email,
    slug: l.slug,
    storeName: l.storeName,
    city: l.city,
    createdAt: l.createdAt.toISOString(),
    storeOpen: l.storeOpen,
    isFranqueadoHakim: l.isFranqueadoHakim,
    storeLogo: l.storeLogo,
    storePhone: l.storePhone || contaPrincipalDe(l)?.storePhone || null,
    contaPrincipal: (p => p ? { id: p.id, nome: p.storeName || p.name || p.email } : null)(contaPrincipalDe(l)),
    lojasExtras: lojasExtras.get(l.id) || 0,
    cpfCnpj: l.cpfCnpj,
    repasseConfig: l.repasseConfig,
    onboardingData: l.onboardingData,
    mpSellerId: l.mpSellerId,
    trialEndsAt: l.trialEndsAt ? l.trialEndsAt.toISOString() : null,
    diasCadastro: daysSince(l.createdAt),
    emTrial: isLojistaInTrial(l),
    diasRestantesTrial: getTrialDaysLeft(l),
    pendente: exemptSet.has(l.id) ? 0 : (pendingMap[l.id] || 0),
    temMP: !!(l.mpAccessToken || l.mpSellerId),
    temCelcoin: !!l.celcoinAccountId,
    vendedorId: l.vendedorId,
    vendedorStatus: l.vendedorStatus,
    vendedorAtribuidoEm: l.vendedorAtribuidoEm ? l.vendedorAtribuidoEm.toISOString() : null,
    ambassadorId: l.ambassadorId,
    atividade: atividade.get(l.id) || null,
  }));

  return (
    <AdminDashboardClient
      adminName={session?.user?.name || "Admin"}
      kpis={{
        totalLojistas, emTrial, assinantes, pagantes,
        novosMes, novosSemana,
        mrr, totalArrecadado, totalPendente, comPendencia,
      }}
      monthlyGrowth={monthlyGrowth}
      lojistas={serialized}
      vendedores={vendedores}
      embaixadores={embaixadores}
    />
  );
}
