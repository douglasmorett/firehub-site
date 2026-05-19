import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StoreDashboard from "@/components/customer/StoreDashboard";

export default async function StorePage({ searchParams }: { searchParams: Promise<{ loja?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN") redirect("/");

  const resolvedParams = await searchParams;

  const since = new Date();
  since.setDate(since.getDate() - 90);

  // ── ADMIN: acessa TODAS as lojas ─────────────────────────────────────────
  if (role === "ADMIN") {
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
      createdAt: o.createdAt.toISOString(),
      storeName: (o as any).franchisee?.name || "—",
      storeSlug: (o as any).franchisee?.slug || "",
      items: o.items.map(i => ({
        id: i.id, quantity: i.quantity, price: i.price,
        cost: i.menuProduct?.cost || null,
        menuProduct: { name: i.menuProduct?.name || "Produto excluído" }
      }))
    }));

    const storeList = [
      { id: "todas", name: "🏢 Todas as Lojas", slug: "" },
      ...franchisees.map(f => ({ id: f.id, name: f.name || f.slug || f.id, slug: f.slug || "" }))
    ];

    return (
      <StoreDashboard
        orders={serialized}
        paymentFees={{}}
        completedOnboardingSteps={["logo","hours","payment","delivery","first_order","menu"]}
        isAdmin={true}
        storeList={storeList}
        selectedStoreId={selectedId}
      />
    );
  }

  // ── FRANCHISEE: só vê sua própria loja ──────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true, slug: true,
      storeLogo: true, storeBanner: true, storeHours: true,
      paymentFees: true, deliveryZones: true, storeOrderCount: true,
    }
  });
  if (!user) redirect("/");

  const menuCount = await prisma.menuProduct.count({ where: { franchiseeId: user.id } });

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id, createdAt: { gte: since } },
    include: { items: { include: { menuProduct: { select: { name: true, cost: true } } } } },
    orderBy: { createdAt: "desc" }
  });

  const completedSteps: string[] = [];
  if (user.storeLogo) completedSteps.push("logo_logo_upload");
  if (user.storeBanner) completedSteps.push("logo_banner_upload");
  if (user.storeLogo || user.storeBanner) completedSteps.push("logo");
  if (user.storeHours) completedSteps.push("hours");
  if (user.paymentFees && Object.keys((user.paymentFees as object) || {}).length > 0) completedSteps.push("payment");
  if (user.deliveryZones) completedSteps.push("delivery");
  if ((user.storeOrderCount || 0) > 0) completedSteps.push("first_order");
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
    createdAt: o.createdAt.toISOString(),
    items: o.items.map(i => ({
      id: i.id, quantity: i.quantity, price: i.price,
      cost: i.menuProduct?.cost || null,
      menuProduct: { name: i.menuProduct?.name || "Produto excluído" }
    }))
  }));

  return (
    <StoreDashboard
      orders={serialized}
      paymentFees={(user.paymentFees as any) || {}}
      completedOnboardingSteps={completedSteps}
    />
  );
}
