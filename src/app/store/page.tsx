import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StoreDashboard from "@/components/customer/StoreDashboard";

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

  // ── ADMIN: acessa TODAS as lojas ─────────────────────────────────────────
  if (role === "ADMIN") {
    try {
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const franchisees = await prisma.user.findMany({
        where: { role: "FRANCHISEE" },
        select: { id: true, name: true, slug: true, storeLogo: true },
        orderBy: { name: "asc" },
      });

      const selectedId = resolvedParams.loja || "todas";

      const whereClause = selectedId === "todas"
        ? { createdAt: { gte: since } }
        : { franchiseeId: selectedId, createdAt: { gte: since } };

      const orders = await prisma.customerOrder.findMany({
        where: whereClause,
        include: {
          items: { include: { menuProduct: { select: { name: true, cost: true } } } },
          franchisee: { select: { name: true, slug: true } }
        },
        orderBy: { createdAt: "desc" },
      });

      const serialized = orders.map(o => ({
        id: o.id,
        totalAmount: o.totalAmount,
        status: o.status,
        deliveryType: o.deliveryType,
        paymentMethod: o.paymentMethod || undefined,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        customerAddress: o.customerAddress || undefined,
        ifoodReference: o.ifoodReference || undefined,
        openDeliveryReference: o.openDeliveryReference || undefined,
        source: o.source || undefined,
        notes: o.notes || undefined,
        createdAt: o.createdAt.toISOString(),
        storeName: (o as any).franchisee?.name || "—",
        storeSlug: (o as any).franchisee?.slug || "",
        items: o.items.map(i => {
          let itemName = i.menuProduct?.name || "";
          if (!itemName || itemName === "Item de Integração" || itemName === "Produto excluído") {
            if (i.comboSelections) {
              try {
                const cs = typeof i.comboSelections === "string" ? JSON.parse(i.comboSelections) : i.comboSelections;
                itemName = cs?.name || cs?.title || cs?.productName || cs?.itemTitle || "";
              } catch {}
            }
          }
          if (!itemName) itemName = "Item (Integração)";
          return {
            id: i.id, quantity: i.quantity, price: i.price,
            name: itemName,
            cost: i.menuProduct?.cost || null,
            menuProduct: { name: itemName }
          };
        })
      }));

      const storeList = [
        { id: "todas", name: "🏢 Todas as Lojas", slug: "" },
        ...franchisees.map(f => ({ id: f.id, name: f.name || f.slug || f.id, slug: f.slug || "" }))
      ];

      return (
        <StoreDashboard
          orders={serialized}
          paymentFees={{}}
          completedOnboardingSteps={["logo", "hours", "payment", "delivery", "first_order", "menu"]}
          isAdmin={true}
          storeList={storeList}
          selectedStoreId={selectedId}
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

  try {
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const menuCount = await prisma.menuProduct.count({ where: { franchiseeId: targetFranchiseeId } });

    const orders = await prisma.customerOrder.findMany({
      where: { franchiseeId: targetFranchiseeId, createdAt: { gte: since } },
      include: { items: { include: { menuProduct: { select: { name: true, cost: true } } } } },
      orderBy: { createdAt: "desc" }
    });

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

    if ((user.storeOrderCount || 0) > 0 || orders.length > 0) completedSteps.push("first_order");
    if (menuCount > 0) completedSteps.push("menu");
    if (menuCount >= 5) completedSteps.push("menu_menu_prod");

    const serialized = orders.map(o => ({
      id: o.id,
      totalAmount: o.totalAmount,
      status: o.status,
      deliveryType: o.deliveryType,
      paymentMethod: o.paymentMethod || undefined,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      customerAddress: o.customerAddress || undefined,
      ifoodReference: o.ifoodReference || undefined,
      openDeliveryReference: o.openDeliveryReference || undefined,
      source: o.source || undefined,
      notes: o.notes || undefined,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map(i => {
        let itemName = i.menuProduct?.name || "";
        if (!itemName || itemName === "Item de Integração" || itemName === "Produto excluído") {
          if (i.comboSelections) {
            try {
              const cs = typeof i.comboSelections === "string" ? JSON.parse(i.comboSelections) : i.comboSelections;
              itemName = cs?.name || cs?.title || cs?.productName || cs?.itemTitle || "";
            } catch {}
          }
        }
        if (!itemName) itemName = "Item (Integração)";
        return {
          id: i.id, quantity: i.quantity, price: i.price,
          name: itemName,
          cost: i.menuProduct?.cost || null,
          menuProduct: { name: itemName }
        };
      })
    }));

    return (
      <StoreDashboard
        orders={serialized}
        paymentFees={(user.paymentFees as any) || {}}
        completedOnboardingSteps={completedSteps}
      />
    );
  } catch (err: any) {
    console.error("[StorePage] Erro ao carregar dados:", err);
    return <ErrorPanel message={err?.message} />;
  }
}

function ErrorPanel({ message }: { message?: string }) {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2 style={{ color: "#DC2626", fontSize: "1.2rem", fontWeight: 800 }}>
        ⚠️ Erro ao carregar o painel
      </h2>
      <p style={{ color: "#64748b", margin: "0.5rem 0" }}>
        {message || "Ocorreu um erro inesperado. Tente recarregar a página."}
      </p>
      <a href="/store" style={{
        display: "inline-block", marginTop: "1rem",
        padding: "10px 24px", background: "#DC2626", color: "#fff",
        borderRadius: 10, fontWeight: 700, textDecoration: "none"
      }}>
        🔄 Recarregar
      </a>
    </div>
  );
}
