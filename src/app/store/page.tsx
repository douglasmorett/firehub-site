import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StoreDashboard from "@/components/customer/StoreDashboard";
import { lojaNoMapaPorId } from "@/lib/ponto-da-loja-servidor";
import { inicioDaJanela, pedidosDoInicio } from "@/lib/pedidos-do-inicio";
import { cookies } from "next/headers";
import { COOKIE_DA_LOJA_ATIVA, lojasDaVisao } from "@/lib/loja-ativa";

export const dynamic = "force-dynamic";

export default async function StorePage({ searchParams }: { searchParams: Promise<{ loja?: string }> }) {
  // Auth FORA de try/catch — redirect() não pode ser capturado
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[StorePage] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  const resolvedParams = await searchParams;

  // Só o que os filtros rápidos usam; "Período" mais antigo vem pela API.
  // Ver src/lib/pedidos-do-inicio.ts.
  const desde = inicioDaJanela();

  // ── ADMIN: acessa TODAS as lojas ─────────────────────────────────────────
  if (role === "ADMIN") {
    try {
      const franchisees = await prisma.user.findMany({
        where: { role: "FRANCHISEE" },
        select: { id: true, name: true, slug: true, storeLogo: true },
        orderBy: { name: "asc" },
      });

      const selectedId = resolvedParams.loja || "todas";

      const serialized = await pedidosDoInicio({
        franchiseeId: selectedId === "todas" ? null : selectedId,
        desde,
      });

      const storeList = [
        { id: "todas", name: "🏢 Todas as Lojas", slug: "" },
        ...franchisees.map(f => ({ id: f.id, name: f.name || f.slug || f.id, slug: f.slug || "" }))
      ];

      // Com uma loja escolhida, o mapa abre nela. Em "todas as lojas" não
      // existe um ponto só — o mapa se ajusta aos pedidos que já têm
      // coordenada e não sai procurando endereço sem âncora.
      const noMapa = selectedId !== "todas" ? await lojaNoMapaPorId(selectedId) : null;

      return (
        <StoreDashboard
          orders={serialized}
          carregadoDesde={desde.toISOString()}
          paymentFees={{}}
          completedOnboardingSteps={["logo", "hours", "payment", "delivery", "first_order", "menu"]}
          isAdmin={true}
          storeList={storeList}
          selectedStoreId={selectedId}
          pontoDaLoja={noMapa?.ponto || null}
          cidadeDaLoja={noMapa?.cidade || ""}
        />
      );
    } catch (err: any) {
      console.error("[StorePage/Admin] Erro ao carregar dados:", err);
      return <ErrorPanel message={err?.message} />;
    }
  }

  // ── FRANCHISEE / STAFF: busca FORA de try/catch para que redirect() propague ─────
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true, slug: true, ownerId: true,
      storeLogo: true, storeBanner: true, storeHours: true,
      paymentFees: true, deliveryZones: true, storeOrderCount: true,
    }
  }).catch((err) => {
    console.error("[StorePage] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  const targetFranchiseeId = (user as any).ownerId || user.id;
  // "Todas as Lojas" soma o grupo no Início; senão é a loja da sessão
  // (lib/loja-ativa.ts).
  const { lojaIds } = await lojasDaVisao(
    { id: user.id, ownerId: (user as any).ownerId, role: (session.user as any)?.role },
    (await cookies()).get(COOKIE_DA_LOJA_ATIVA)?.value,
  );

  try {
    // Independentes entre si: em paralelo, cada ida ao banco a menos é
    // tempo a menos com o clique esperando.
    const [menuCount, serialized, noMapa] = await Promise.all([
      prisma.menuProduct.count({ where: { franchiseeId: targetFranchiseeId } }),
      pedidosDoInicio({ franchiseeId: lojaIds, desde }),
      // Onde fica a loja: pino salvo ou, quando ele nunca foi salvo, o endereço
      // do cadastro. É daqui que o mapa de calor parte e é esta a âncora que
      // permite localizar os endereços das entregas.
      lojaNoMapaPorId(targetFranchiseeId),
    ]);

    const completedSteps: string[] = [];
    if (user.storeLogo) completedSteps.push("logo_logo_upload");
    if (user.storeBanner) completedSteps.push("logo_banner_upload");
    if (user.storeLogo || user.storeBanner) completedSteps.push("logo");

    // Horários: só considera concluído se já foi explicitamente configurado/salvo pelo lojista (Array com itens)
    if (user.storeHours && Array.isArray(user.storeHours) && user.storeHours.length > 0) {
      completedSteps.push("hours");
    }

    // Formas de Pagamento: só considera concluído se foi salvo pelo formulário com a configuração de taxas (PIX com objeto de taxas)
    if (
      user.paymentFees &&
      typeof user.paymentFees === "object" &&
      !Array.isArray(user.paymentFees) &&
      (user.paymentFees as any).PIX &&
      typeof (user.paymentFees as any).PIX === "object"
    ) {
      completedSteps.push("payment");
    }

    // Zonas de Entrega
    if (user.deliveryZones && Array.isArray(user.deliveryZones) && user.deliveryZones.length > 0) {
      completedSteps.push("delivery");
    }

    // A janela da tela é curta: a loja que vendeu antes dela também já fez o
    // primeiro pedido.
    const jaVendeu = (user.storeOrderCount || 0) > 0 || serialized.length > 0 ||
      !!(await prisma.customerOrder.findFirst({ where: { franchiseeId: targetFranchiseeId }, select: { id: true } }));
    if (jaVendeu) completedSteps.push("first_order");
    if (menuCount > 0) completedSteps.push("menu");
    if (menuCount >= 5) completedSteps.push("menu_menu_prod");

    return (
      <>
        <StoreDashboard
          orders={serialized}
          carregadoDesde={desde.toISOString()}
          paymentFees={(user.paymentFees as any) || {}}
          completedOnboardingSteps={completedSteps}
          pontoDaLoja={noMapa.ponto}
          cidadeDaLoja={noMapa.cidade}
        />
      </>
    );
  } catch (err: any) {
    console.error("[StorePage] Erro ao carregar dados:", err);
    return <ErrorPanel message={err?.message} />;
  }
}

function ErrorPanel({ message }: { message?: string }) {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2 style={{ color: "#C92E09", fontSize: "1.2rem", fontWeight: 800 }}>
        ⚠️ Erro ao carregar o painel
      </h2>
      <p style={{ color: "#64748b", margin: "0.5rem 0" }}>
        {message || "Ocorreu um erro inesperado. Tente recarregar a página."}
      </p>
      <a href="/store" style={{
        display: "inline-block", marginTop: "1rem",
        padding: "10px 24px", background: "#C92E09", color: "#fff",
        borderRadius: 10, fontWeight: 700, textDecoration: "none"
      }}>
        🔄 Recarregar
      </a>
    </div>
  );
}
