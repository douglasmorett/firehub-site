import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import DREClient from "./DREClient";

export default async function StoreFinanceiroPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/");
  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN") redirect("/");

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true, paymentFees: true, storeName: true,
      storeOrderCount: true, createdAt: true,
      fixedCosts: true, financialGoals: true
    }
  });
  if (!user) redirect("/");

  const since = new Date();
  since.setDate(since.getDate() - 365);

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id, createdAt: { gte: since } },
    include: {
      items: { include: { menuProduct: { select: { name: true, cost: true } } } },
      motoboy: { select: { name: true, paymentType: true, perDeliveryRate: true, dailyRate: true, perKmRate: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  const produtosSemCusto = await prisma.menuProduct.findMany({
    where: { OR: [{ cost: null }, { cost: 0 }] },
    select: { name: true, id: true }
  });

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
    items: o.items.map(i => ({
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
