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
      storeTimezone: true,
      allowScheduledOrders: true,
      // O que esta loja mostra na barra do painel. Ausente = tudo ligado.
      painelPedidosConfig: true,
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
    let [ordersRes, cashSessionRes, motoboysRes] = await Promise.all([
      prisma.customerOrder.findMany({
        where: {
          franchiseeId: { in: franchiseeIds },
          // CRIANDO_IA entra aqui de propósito.
          //
          // O painel TEM o cartão "🤖 IA criando pedido..." pronto
          // (StoreOrdersDashboard: rótulo, cor e o bucket de "novos"), e o feed
          // de polling (/api/customer-order/poll) devolve esses rascunhos. Só a
          // carga inicial da página os excluía — então, ao abrir o painel, o
          // pedido que a IA estava montando ficava invisível até o primeiro
          // poll. Era o relato do dono: "quando alguns começam a fazer o pedido
          // ele não demonstra na caixinha no nosso painel".
          //
          // Rascunho continua fora da impressão e da cozinha; quem cuida disso é
          // o GlobalPrintListener e o /api/kds, cada um com seu próprio filtro.
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
    ]);

    orders = ordersRes;

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
