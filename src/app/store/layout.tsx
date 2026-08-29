import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CartProvider } from "@/components/CartProvider";
import StoreTopNav from "@/components/customer/StoreTopNav";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { prisma } from "@/lib/prisma";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";
import HideOnCompras from "@/components/HideOnCompras";
import AvisoRoboDesconectado from "@/components/customer/AvisoRoboDesconectado";
import AvisoCaixaAberto24h from "@/components/customer/AvisoCaixaAberto24h";
import GlobalPrintListener from "@/components/customer/GlobalPrintListener";
import HumanSupportFloatingWidget from "@/components/HumanSupportFloatingWidget";

export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch (err) {
    console.error("[StoreLayout] Erro ao obter sessão:", err);
    redirect("/login");
  }
  if (!session) redirect("/login");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  let user: any = null;
  try {
    user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, name: true, email: true, city: true, slug: true, role: true, ownerId: true, cpfCnpj: true, storeOpen: true, cashOpen: true, createdAt: true, isFranqueadoHakim: true, trialEndsAt: true, storeName: true },
    });
    console.log("[StoreLayout] Session Email:", session.user?.email, "| User Email from DB:", user?.email);
  } catch (err) {
    console.error("[StoreLayout] Erro ao buscar usuário:", err);
  }

  let storeOwner = user;
  if (user?.ownerId) {
    try {
      const owner = await prisma.user.findUnique({
        where: { id: user.ownerId },
        select: { id: true, name: true, email: true, city: true, slug: true, role: true, cpfCnpj: true, storeOpen: true, cashOpen: true, createdAt: true, isFranqueadoHakim: true, trialEndsAt: true, storeName: true },
      });
      if (owner) storeOwner = owner;
    } catch (e) {}
  }

  const isFranqueado = user?.role === "FRANCHISEE" || user?.role === "STAFF";
  const isAdmin = user?.role === "ADMIN";

  // === TRIAL / BENEFÍCIO: calcular dias restantes baseado na conta proprietária ===
  let trialDaysLeft = 0;
  let isInTrial = false;
  const ownerCreatedAt = storeOwner?.createdAt || user?.createdAt;
  const ownerTrialEndsAt = storeOwner?.trialEndsAt || user?.trialEndsAt;

  if (ownerTrialEndsAt) {
    const trialMsLeft = new Date(ownerTrialEndsAt).getTime() - Date.now();
    trialDaysLeft = Math.max(0, Math.ceil(trialMsLeft / (1000 * 60 * 60 * 24)));
    isInTrial = trialDaysLeft > 0;
  } else if (ownerCreatedAt) {
    const diffMs = Date.now() - new Date(ownerCreatedAt).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    trialDaysLeft = Math.max(0, FIREHUB_PLAN.TRIAL_DAYS - diffDays);
    isInTrial = trialDaysLeft > 0;
  }

  // === PAGAMENTO: verificar ciclo pendente da loja proprietária ===
  let pendingPayment: { amount: number; url: string | null; isOverdue: boolean; daysLeft: number } | null = null;
  const targetFranchiseeId = storeOwner?.id || user?.id;
  const userEmailClean = (storeOwner?.email || user?.email)?.toLowerCase().replace(/\s+/g, "");
  const isHakimStore = storeOwner?.isFranqueadoHakim === true || user?.isFranqueadoHakim === true || userEmailClean === "contatohakim@gmail.com";
  const isSpecialStore = isHakimStore || userEmailClean === "viniciusmenezes.ofc@gmail.com";

  if (isFranqueado && targetFranchiseeId && !isSpecialStore) {
    try {
      const closedCycle = await prisma.franchiseeBillingCycle.findFirst({
        where: {
          franchiseeId: targetFranchiseeId,
          status: "CLOSED",
          amountPending: { gt: 0 },
        },
        orderBy: { closedAt: "desc" },
      });

      if (closedCycle && closedCycle.amountPending > 0) {
        // Prazo: 10 dias após fechamento (ou dueDate se definido)
        const closedAt = closedCycle.closedAt ? new Date(closedCycle.closedAt) : new Date();
        const dueDate = (closedCycle as any).dueDate
          ? new Date((closedCycle as any).dueDate)
          : new Date(closedAt.getTime() + 10 * 24 * 60 * 60 * 1000);
        const now = new Date();
        const isOverdue = now > dueDate;
        const daysLeft = Math.max(0, Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

        pendingPayment = {
          amount: closedCycle.amountPending,
          url: closedCycle.asaasBoletoUrl,
          isOverdue,
          daysLeft,
        };
      }
    } catch (err) {
      console.error("[StoreLayout] Erro ao verificar pagamento:", err);
    }
  }

  const isBlocked = pendingPayment?.isOverdue === true;

  return (
    <CartProvider>
      <GlobalPrintListener />
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#F5F5F5" }}>
        {/* Só aparece quando a sessão nasceu do "Acessar" do admin. Fica ANTES
            da barra da loja porque o ponto é ser a primeira coisa que se vê:
            sem aviso, é questão de tempo até alguém do suporte fechar um caixa
            achando que está na própria conta. */}
        {(session.user as any)?.impersonatedBy && (
          <ImpersonationBanner storeName={storeOwner?.storeName || user?.storeName || session.user?.name || "esta loja"} />
        )}
        <StoreTopNav
          userName={session.user?.name || user?.name || ""}
          userCity={(session.user as any)?.city || storeOwner?.city || user?.city || ""}
          userSlug={storeOwner?.slug || user?.slug}
          showCompras={storeOwner?.isFranqueadoHakim === true}
          isAdmin={isAdmin}
          initialStoreOpen={storeOwner?.storeOpen ?? true}
          initialCashOpen={storeOwner?.cashOpen ?? false}
          showAntecipacao={session.user?.email?.toLowerCase() === "contatohakim@gmail.com" || storeOwner?.email?.toLowerCase() === "contatohakim@gmail.com"}
        />

        {/* ── AVISOS DA OPERAÇÃO ────────────────────────────────────────
            Ficavam só no painel inicial (/store). Quem passa o expediente na
            tela de pedidos ou no KDS — que é onde a loja realmente fica —
            nunca via. Os dois casos que motivaram isto estavam acontecendo ao
            mesmo tempo em 29/08/2026: a Pastel da Paulista com o robô caído
            desde a véspera e com o caixa aberto havia 8 dias.

            Cada faixa decide sozinha se aparece, e as duas somem quando não há
            o que avisar: faixa que fica na tela à toa vira paisagem, e aí não
            serve no dia em que importa. */}
        <HideOnCompras>
          <div style={{ padding: "1rem 1.5rem 0" }}>
            <AvisoCaixaAberto24h />
            <AvisoRoboDesconectado />
          </div>
        </HideOnCompras>

        {/* Banner: Trial ativo (esconde no módulo de compras via client-side) */}
        {isInTrial && isFranqueado && (
          <HideOnCompras>
            <div style={{
              background: "linear-gradient(135deg, #2563EB, #1d4ed8)",
              color: "white", padding: "10px 1.5rem", textAlign: "center",
              fontSize: ".85rem", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              🎁 Teste grátis — <strong>{trialDaysLeft} {trialDaysLeft === 1 ? "dia restante" : "dias restantes"}</strong>
              <span style={{ opacity: .7, fontSize: ".78rem", marginLeft: 4 }}>
                Aproveite todas as funcionalidades sem custo
              </span>
            </div>
          </HideOnCompras>
        )}

        {/* Banner: Pagamento pendente DENTRO DO PRAZO */}
        {pendingPayment && !pendingPayment.isOverdue && !isInTrial && (
          <HideOnCompras>
            <div style={{
              background: "linear-gradient(135deg, #F59E0B, #D97706)",
              color: "white", padding: "10px 1.5rem", textAlign: "center",
              fontSize: ".85rem", fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap",
            }}>
              <span>⚠️ Cobrança pendente de R$ {pendingPayment.amount.toFixed(2).replace(".", ",")} — <strong>Faltam {pendingPayment.daysLeft} {pendingPayment.daysLeft === 1 ? "dia" : "dias"}</strong> para o vencimento. Regularize para evitar bloqueios.</span>
              <a href="/store/financeiro#fatura" style={{
                background: "#fff", color: "#D97706", padding: "5px 16px",
                borderRadius: 8, fontWeight: 700, fontSize: ".8rem", textDecoration: "none",
              }}>
                Ver Fatura
              </a>
              {pendingPayment.url && (
                <a href={pendingPayment.url} target="_blank" rel="noopener noreferrer" style={{
                  background: "#fff", color: "#D97706", padding: "5px 16px",
                  borderRadius: 8, fontWeight: 700, fontSize: ".8rem", textDecoration: "none",
                }}>
                  Pagar Agora
                </a>
              )}
            </div>
          </HideOnCompras>
        )}

        {/* Tela de Bloqueio por Inadimplência — permite o login, mas bloqueia o uso até pagar */}
        {isBlocked && (
          <div style={{
            position: "fixed", top: 60, left: 0, right: 0, bottom: 0,
            background: "rgba(15, 23, 42, 0.85)", backdropFilter: "blur(8px)",
            zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem"
          }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "2.5rem", maxWidth: 500, width: "100%", textAlign: "center", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)" }}>
              <div style={{ fontSize: "3.5rem", marginBottom: "0.75rem" }}>🔒</div>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 900, color: "#0F172A", marginBottom: "0.5rem" }}>Sua conta está bloqueada</h2>
              <p style={{ color: "#64748B", fontSize: "0.92rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
                O prazo de 10 dias para pagamento da fatura do mês expirou. Para liberar o sistema imediatamente, efetue o pagamento do valor pendente.
              </p>

              <div style={{ background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 14, padding: "1.25rem", marginBottom: "1.5rem" }}>
                <div style={{ fontSize: "0.8rem", color: "#991B1B", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Para liberar pague o valor de:</div>
                <div style={{ fontSize: "2.4rem", fontWeight: 900, color: "#DC2626", marginTop: 4 }}>
                  R$ {pendingPayment!.amount.toFixed(2).replace(".", ",")}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <a href="/store/financeiro#fatura" style={{ width: "100%", background: "#DC2626", color: "#fff", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, textDecoration: "none", display: "inline-block" }}>
                  ⚡ Pagar e Liberar Conta →
                </a>
                <a href="https://wa.me/5522998851680?text=Preciso+de+ajuda+com+minha+conta+bloqueada" target="_blank" rel="noopener noreferrer" style={{ color: "#64748B", fontSize: "0.85rem", textDecoration: "underline" }}>
                  Falar com suporte via WhatsApp
                </a>
              </div>
            </div>
          </div>
        )}

        <main style={{ flex: 1 }}>
          {children}
        </main>

        <HumanSupportFloatingWidget />
      </div>
    </CartProvider>
  );
}
