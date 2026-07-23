import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import DREClient from "./DREClient";

export const dynamic = "force-dynamic";

export default async function StoreFinanceiroPage() {
  // Auth FORA de try/catch — redirect() não pode ser capturado
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[Financeiro] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  // Busca do usuário FORA de try/catch
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true, paymentFees: true, storeName: true,
      storeOrderCount: true, createdAt: true,
      fixedCosts: true, financialGoals: true, role: true, ownerId: true,
    }
  }).catch((err) => {
    console.error("[Financeiro] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  const targetFranchiseeId = (user as any).ownerId || user.id;

  const since = new Date();
  since.setDate(since.getDate() - 365);

  // ADMIN vê tudo, FRANCHISEE / STAFF vê os produtos da sua loja
  const franchiseeFilter = user.role === "ADMIN"
    ? { createdAt: { gte: since } }
    : { franchiseeId: targetFranchiseeId, createdAt: { gte: since } };

  let orders: any[] = [];
  let produtosSemCusto: any[] = [];

  try {
    orders = await prisma.customerOrder.findMany({
      where: franchiseeFilter,
      include: {
        items: { include: { menuProduct: { select: { name: true, cost: true } } } },
        motoboy: { select: { name: true, paymentType: true, perDeliveryRate: true, dailyRate: true, perKmRate: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    // Produtos sem custo filtrados por franqueado
    const produtoFilter = user.role === "ADMIN"
      ? { OR: [{ cost: null }, { cost: 0 }] }
      : { franchiseeId: targetFranchiseeId, OR: [{ cost: null }, { cost: 0 }] };

    produtosSemCusto = await prisma.menuProduct.findMany({
      where: produtoFilter,
      select: { name: true, id: true }
    });
  } catch (err) {
    console.error("[Financeiro] Erro ao buscar dados:", err);
    orders = [];
    produtosSemCusto = [];
  }

  const serialized = orders.map(o => ({
    id: o.id,
    totalAmount: o.totalAmount,
    deliveryFee: o.deliveryFee || 0,
    motoboyFee: o.motoboyFee || 0,
    deliveryDistance: o.deliveryDistance || 0,
    status: o.status,
    deliveryType: o.deliveryType,
    paymentMethod: o.paymentMethod || "",
    pagarmeMethod: (o as any).pagarmeMethod || null,
    source: o.source || "ONLINE",
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((i: any) => ({
      quantity: i.quantity,
      price: i.price,
      cost: i.menuProduct?.cost || 0,
      name: i.menuProduct?.name || "Produto"
    })),
    motoboy: o.motoboy ? {
      name: o.motoboy.name,
      paymentType: o.motoboy.paymentType,
      perDeliveryRate: o.motoboy.perDeliveryRate || 0,
    } : null
  }));

  const fixedCosts = Array.isArray(user.fixedCosts) ? (user.fixedCosts as any[]) : [];
  const financialGoals = (user.financialGoals as any) || {};

  return (
    <DREClient
      orders={serialized}
      paymentFees={(user.paymentFees as any) || {}}
      storeName={user.storeName || "Minha Loja"}
      storeCreatedAt={user.createdAt.toISOString()}
      produtosSemCusto={produtosSemCusto.map(p => ({ id: p.id, name: p.name || "Sem nome" }))}
      initialFixedCosts={fixedCosts}
      initialGoals={financialGoals}
    />
  );
}
