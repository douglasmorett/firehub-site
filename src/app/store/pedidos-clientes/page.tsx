import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
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

  // Busca do caixa aberto, motoboys e pedidos
  let orders: any[] = [];
  let activeCashSessionOpenedAt: string | null = null;
  let motoboys: any[] = [];
  try {
    const [ordersRes, cashSessionRes, motoboysRes] = await Promise.all([
      prisma.customerOrder.findMany({
        where: { franchiseeId: targetFranchiseeId },
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
        where: { franchiseeId: targetFranchiseeId, status: "OPEN" },
        select: { openedAt: true },
        orderBy: { openedAt: "desc" },
      }),
      prisma.motoboy.findMany({
        where: { franchiseeId: targetFranchiseeId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, phone: true },
      }),
    ]);
    // Numeração PERMANENTE E IMUTÁVEL baseada no dia do calendário (America/Sao_Paulo)
    // O pedido #195 será o 195 para sempre, independente de abrir ou fechar o caixa!
    const allRecentOrders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: targetFranchiseeId,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const dailyNumMap = new Map<string, number>();
    const dayCounters = new Map<string, number>();

    allRecentOrders.forEach((o: any) => {
      if (o.dailyOrderNumber && typeof o.dailyOrderNumber === "number") {
        dailyNumMap.set(o.id, o.dailyOrderNumber);
      } else {
        const dateKey = new Date(o.createdAt).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }).split(",")[0];
        const nextSeq = (dayCounters.get(dateKey) || 0) + 1;
        dayCounters.set(dateKey, nextSeq);
        dailyNumMap.set(o.id, nextSeq);
      }
    });

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
    />
  );
}
