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
    // Compute server-authoritative daily sequence numbers starting at 00:00 AM Brazil time (matching KDS)
    const now = new Date();
    const yearStr = now.toLocaleDateString("en-US", { timeZone: "America/Sao_Paulo", year: "numeric" });
    const monthStr = now.toLocaleDateString("en-US", { timeZone: "America/Sao_Paulo", month: "2-digit" });
    const dayStr = now.toLocaleDateString("en-US", { timeZone: "America/Sao_Paulo", day: "2-digit" });
    const startOfTodayBrazil = new Date(`${yearStr}-${monthStr}-${dayStr}T00:00:00-03:00`);

    const storeOrdersToday = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: targetFranchiseeId,
        createdAt: { gte: startOfTodayBrazil },
      },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const dailyNumMap = new Map<string, number>();
    storeOrdersToday.forEach((o, i) => dailyNumMap.set(o.id, i + 1));

    orders = ordersRes.map((o: any) => ({
      ...o,
      dailyOrderNumber: dailyNumMap.get(o.id) || null,
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
