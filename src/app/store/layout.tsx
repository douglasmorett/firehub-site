import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CartProvider } from "@/components/CartProvider";
import StoreTopNav from "@/components/customer/StoreTopNav";
import { prisma } from "@/lib/prisma";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";
import HideOnCompras from "@/components/HideOnCompras";

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
      select: { id: true, name: true, email: true, city: true, slug: true, role: true, ownerId: true, cpfCnpj: true, storeOpen: true, cashOpen: true, createdAt: true, isFranqueadoHakim: true },
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
        select: { id: true, name: true, email: true, city: true, slug: true, role: true, cpfCnpj: true, storeOpen: true, cashOpen: true, createdAt: true, isFranqueadoHakim: true },
      });
      if (owner) storeOwner = owner;
    } catch (e) {}
  }

  const isFranqueado = user?.role === "FRANCHISEE" || user?.role === "STAFF";
  const isAdmin = user?.role === "ADMIN";

  // === TRIAL: calcular dias restantes ===
  let trialDaysLeft = 0;
  let isInTrial = false;
  if (user?.createdAt) {
    const diffMs = Date.now() - new Date(user.createdAt).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    trialDaysLeft = Math.max(0, FIREHUB_PLAN.TRIAL_DAYS - diffDays);
    isInTrial = trialDaysLeft > 0;
  }

  // === PAGAMENTO: verificar ciclo pendente ===
  let pendingPayment: { amount: number; url: string | null; isOverdue: boolean } | null = null;
  const userEmailClean = user?.email?.toLowerCase().replace(/\s+/g, "");
  const isSpecialStore = userEmailClean === "viniciusmenezes.ofc@gmail.com";

  if (isFranqueado && user && !isSpecialStore) {
    try {
      const closedCycle = await prisma.franchiseeBillingCycle.findFirst({
        where: {
          franchiseeId: user.id,
          status: "CLOSED",
          amountPending: { gt: 0 },
        },
        orderBy: { closedAt: "desc" },
      });

      if (closedCycle && closedCycle.amountPending > 0) {
        // Verifica se o boleto já venceu (7 dias após fechamento)
        const closedAt = closedCycle.closedAt ? new Date(closedCycle.closedAt) : new Date();
        const dueDate = new Date(closedAt);
        dueDate.setDate(dueDate.getDate() + 7);
        const isOverdue = new Date() > dueDate;

        pendingPayment = {
          amount: closedCycle.amountPending,
          url: closedCycle.asaasBoletoUrl,
          isOverdue, // true = vencido = BLOQUEIA | false = dentro do prazo = só avisa
        };
      }
    } catch (err) {
      console.error("[StoreLayout] Erro ao verificar pagamento:", err);
    }
  }

  const isBlocked = pendingPayment?.isOverdue === true;

  return (
    <CartProvider>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#F5F5F5" }}>
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
              <span>💳 Pagamento de R$ {pendingPayment.amount.toFixed(2).replace(".", ",")} pendente — pague dentro do prazo para manter seu acesso</span>
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

        {/* Banner: BOLETO VENCIDO — sistema bloqueado */}
        {isBlocked && (
          <div style={{
            background: "linear-gradient(135deg, #DC2626, #B91C1C)",
            color: "white", padding: "14px 1.5rem", textAlign: "center",
            fontSize: ".9rem", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap",
          }}>
            <span>🔒 Seu sistema está bloqueado — pagamento de R$ {pendingPayment!.amount.toFixed(2).replace(".", ",")} vencido</span>
            {pendingPayment!.url && (
              <a href={pendingPayment!.url} target="_blank" rel="noopener noreferrer" style={{
                background: "#fff", color: "#DC2626", padding: "6px 20px",
                borderRadius: 8, fontWeight: 800, fontSize: ".85rem", textDecoration: "none",
              }}>
                ⚡ Pagar e Desbloquear
              </a>
            )}
          </div>
        )}

        <main style={{ flex: 1, opacity: isBlocked ? 0.4 : 1, pointerEvents: isBlocked ? "none" : "auto" }}>
          {children}
        </main>
      </div>
    </CartProvider>
  );
}
