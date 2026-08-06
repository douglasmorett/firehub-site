import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import StoreOrdersDashboard from "@/components/customer/StoreOrdersDashboard";

export const dynamic = "force-dynamic";

export default async function FranchiseeCustomerOrdersPage() {
  // Autenticação FORA de try/catch — redirect() não pode ser capturado
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[PedidosClientes] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  // Busca do usuário FORA do try/catch — redirect() precisa propagar
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true,
      name: true,
      storeName: true,
      storeAddress: true,
      storePhone: true,
      slug: true,
      city: true,
      role: true,
      ownerId: true,
      storeHours: true,
      storeDeliveryOnly: true,
      storeLogo: true,
      storeLatLng: true,
    },
  }).catch((err) => {
    console.error("[PedidosClientes] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  const targetFranchiseeId = (user as any).ownerId || user.id;

  // === MULTI-LOJAS: Resolver IDs das lojas ativas ===
  const cookieStore = await cookies();
  const activeStore = cookieStore.get('firehub_active_store')?.value;

  let franchiseeIds: string[] = [targetFranchiseeId];

  if (activeStore === 'all') {
    const groupStores = await prisma.user.findMany({
      where: { OR: [{ id: targetFranchiseeId }, { accountGroupId: targetFranchiseeId }] },
      select: { id: true }
    });
    if (groupStores.length > 0) franchiseeIds = groupStores.map(s => s.id);
  } else if (activeStore && activeStore !== targetFranchiseeId) {
    const targetStore = await prisma.user.findUnique({ where: { id: activeStore }, select: { id: true, accountGroupId: true } });
    if (targetStore && (targetStore.id === targetFranchiseeId || targetStore.accountGroupId === targetFranchiseeId)) {
      franchiseeIds = [activeStore];
    }
  }

  // Busca do caixa aberto, motoboys e pedidos
  let orders: any[] = [];
  let activeCashSessionOpenedAt: string | null = null;
  let motoboys: any[] = [];
  try {
    const [ordersRes, cashSessionRes, motoboysRes, allRecentOrders, allCashSessions] = await Promise.all([
      prisma.customerOrder.findMany({
        where: {
          franchiseeId: { in: franchiseeIds },
          status: { not: "CRIANDO_IA" },
        },
        include: {
          items: {
            include: {
              menuProduct: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  imageUrl: true,
                  category: true,
                  active: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.cashSession.findFirst({
        where: { franchiseeId: { in: franchiseeIds }, status: "OPEN" },
        select: { openedAt: true },
        orderBy: { openedAt: "desc" },
      }),
      prisma.motoboy.findMany({
        where: { franchiseeId: { in: franchiseeIds }, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, phone: true },
      }),
      prisma.customerOrder.findMany({
        where: {
          franchiseeId: { in: franchiseeIds },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.cashSession.findMany({
        where: { franchiseeId: { in: franchiseeIds } },
        select: { id: true, openedAt: true, closedAt: true },
        orderBy: { openedAt: "asc" },
        take: 100,
      }),
    ]);

    const { buildSessionOrderNumberMap } = await import("@/lib/order-sequence");
    const dailyNumMap = buildSessionOrderNumberMap(allRecentOrders, allCashSessions);

    orders = ordersRes.map((o: any) => ({
      ...o,
      dailyOrderNumber: o.dailyOrderNumber || dailyNumMap.get(o.id) || null,
    }));

    motoboys = motoboysRes;
    if (cashSessionRes?.openedAt) {
      activeCashSessionOpenedAt = cashSessionRes.openedAt.toISOString();
    }
  } catch (err) {
    console.error("[PedidosClientes] Erro ao buscar pedidos/caixa/motoboys:", err);
    orders = [];
  }

  return (
    <StoreOrdersDashboard
      user={user}
      orders={orders}
      isFranqueado={user.role === "FRANCHISEE" || user.role === "STAFF"}
      initialCashSessionOpenedAt={activeCashSessionOpenedAt}
      initialMotoboys={motoboys}
      activeStoreId={activeStore || targetFranchiseeId}
    />
  );
}
