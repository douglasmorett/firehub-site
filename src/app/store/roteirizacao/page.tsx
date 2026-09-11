import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import RoteirizacaoIndependente from "@/components/customer/RoteirizacaoIndependente";

export const dynamic = "force-dynamic";

/**
 * Roteirização numa aba só dela.
 *
 * O módulo de roteirização sempre foi um modal em cima do painel de pedidos
 * (/store/pedidos-clientes). Quem despacha à noite quer o mapa aberto num
 * monitor e os pedidos em outro, sem um fechar o outro. Esta página monta o
 * MESMO componente (RoteirizacaoModal) em tela cheia, com a lista de pedidos
 * vinda do mesmo feed que o painel usa (/api/customer-order/poll) — nada de
 * segunda fonte de verdade.
 *
 * A carga inicial e a resolução de multi-lojas (cookie firehub_active_store)
 * seguem exatamente o que faz pedidos-clientes/page.tsx.
 */
export default async function RoteirizacaoPage() {
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[Roteirizacao] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true,
      name: true,
      storeName: true,
      storeAddress: true,
      slug: true,
      city: true,
      role: true,
      ownerId: true,
      storeLatLng: true,
    },
  }).catch((err) => {
    console.error("[Roteirizacao] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  const targetFranchiseeId = (user as any).ownerId || user.id;

  const cookieStore = await cookies();
  const activeStore = cookieStore.get("firehub_active_store")?.value;

  let franchiseeIds: string[] = [targetFranchiseeId];
  if (activeStore === "all") {
    const groupStores = await prisma.user.findMany({
      where: { OR: [{ id: targetFranchiseeId }, { accountGroupId: targetFranchiseeId }] },
      select: { id: true },
    });
    if (groupStores.length > 0) franchiseeIds = groupStores.map((s) => s.id);
  } else if (activeStore && activeStore !== targetFranchiseeId) {
    const targetStore = await prisma.user.findUnique({ where: { id: activeStore }, select: { id: true, accountGroupId: true } });
    if (targetStore && (targetStore.id === targetFranchiseeId || targetStore.accountGroupId === targetFranchiseeId)) {
      franchiseeIds = [activeStore];
    }
  }

  let orders: any[] = [];
  try {
    orders = await prisma.customerOrder.findMany({
      where: { franchiseeId: { in: franchiseeIds } },
      include: {
        items: {
          include: {
            menuProduct: {
              select: { id: true, name: true, price: true, imageUrl: true, category: true, active: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  } catch (err) {
    console.error("[Roteirizacao] Erro ao buscar pedidos:", err);
  }

  return (
    <RoteirizacaoIndependente
      user={{
        id: user.id,
        storeAddress: user.storeAddress,
        city: user.city,
        slug: user.slug,
        storeLatLng: user.storeLatLng,
        storeName: user.storeName || user.name,
      }}
      initialOrders={orders}
    />
  );
}
