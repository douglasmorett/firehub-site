import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import RelatoriosClient from "./RelatoriosClient";
import { lojasDeOrigemDaConta } from "@/lib/lojas-de-origem-da-conta";

export const dynamic = "force-dynamic";

export default async function StoreRelatoriosPage() {
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[Relatorios] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true,
      storeName: true,
      role: true,
      ownerId: true,
      timeAlertConfig: true,
      // Para montar o filtro "de qual loja veio" (lib/lojas-de-origem-da-conta.ts).
      accountGroupId: true,
    }
  }).catch((err) => {
    console.error("[Relatorios] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  const targetFranchiseeId = (user as any).ownerId || user.id;

  const since = new Date();
  since.setDate(since.getDate() - 365); // Últimos 365 dias

  const franchiseeFilter = user.role === "ADMIN"
    ? { createdAt: { gte: since } }
    : { franchiseeId: targetFranchiseeId, createdAt: { gte: since } };

  let orders: any[] = [];
  let products: any[] = [];

  try {
    orders = await prisma.customerOrder.findMany({
      where: franchiseeFilter,
      include: {
        items: {
          include: {
            menuProduct: {
              select: {
                id: true,
                name: true,
                category: true,
                cost: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const menuFilter = user.role === "ADMIN"
      ? {}
      : { franchiseeId: targetFranchiseeId };

    products = await prisma.menuProduct.findMany({
      where: menuFilter,
      select: {
        id: true,
        name: true,
        category: true,
        price: true,
        cost: true,
        active: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    });
  } catch (err) {
    console.error("[Relatorios] Erro ao carregar dados:", err);
  }

  // Serializa os pedidos para passar para o Client Component
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  const serializedOrders = orders.map(o => ({
    id: o.id,
    totalAmount: o.totalAmount,
    deliveryFee: o.deliveryFee || 0,
    status: o.status,
    deliveryType: o.deliveryType,
    paymentMethod: o.paymentMethod || "Não informado",
    source: o.source || "ONLINE",
    // ── DE QUAL LOJA VEIO ────────────────────────────────────────────────
    // As chaves que lib/loja-de-origem.ts lê para dizer se este pedido é da
    // Ragnar Pizza ou da Ragnar Burguer. São os MESMOS campos que o painel e
    // o roteamento de impressão usam — nada exclusivo do relatório.
    franchiseeId: o.franchiseeId,
    ifoodStoreMerchant: o.ifoodStoreMerchant || null,
    food99AppShopId: o.food99AppShopId || null,
    food99ShopId: o.food99ShopId || null,
    createdAt: o.createdAt.toISOString(),
    // Marcos da operação (ver src/lib/order-stages.ts). Nulos nos pedidos
    // anteriores à medição — o relatório conta só o que foi medido.
    acceptedAt: iso(o.acceptedAt),
    readyAt: iso(o.readyAt),
    dispatchedAt: iso(o.dispatchedAt),
    deliveredAt: iso(o.deliveredAt),
    kdsProductionAt: iso(o.kdsProductionAt),
    kdsFinishingAt: iso(o.kdsFinishingAt),
    // O prazo do pedido agendado não é createdAt + 45min; sem isto o relatório
    // acusaria atraso em pedido que o cliente marcou para dali a duas horas.
    scheduledDatetime: iso(o.scheduledDatetime),
    items: o.items.map((i: any) => ({
      id: i.id,
      quantity: i.quantity,
      price: i.price,
      productId: i.menuProductId,
      productName: i.menuProduct?.name || "Produto Removido",
      productCategory: i.menuProduct?.category || "Outros",
      productCost: i.menuProduct?.cost || 0,
    })),
  }));

  const serializedProducts = products.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    cost: p.cost || 0,
    active: p.active,
  }));

  // As lojas de origem da conta, com nome. Volta VAZIA quando não há o que
  // separar (uma loja no iFood, uma no 99, sem grupo) — e aí o filtro por loja
  // some da tela sozinho, em vez de oferecer uma opção só.
  const lojasDeOrigem = await lojasDeOrigemDaConta(targetFranchiseeId, (user as any).accountGroupId || null)
    .catch((err) => {
      console.error("[Relatorios] Erro ao montar as lojas de origem:", err);
      return [];
    });

  return (
    <RelatoriosClient
      orders={serializedOrders}
      products={serializedProducts}
      storeName={user.storeName || "Minha Loja"}
      timeAlertConfig={(user as any).timeAlertConfig || null}
      lojasDeOrigem={lojasDeOrigem}
    />
  );
}
