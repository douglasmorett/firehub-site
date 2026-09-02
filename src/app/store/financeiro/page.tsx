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
      repasseConfig: true,
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
    // Prova de pagamento pelo gateway. Sem estes quatro campos aqui, a regra
    // de saldo do DREClient vira um `false` fixo: ela os lê no navegador e
    // eles chegariam sempre undefined, então o painel mostraria R$ 0,00 mesmo
    // com dinheiro real no gateway — sem erro nenhum para diagnosticar.
    gatewayProvider: (o as any).gatewayProvider || null,
    gatewayPaymentId: (o as any).gatewayPaymentId || null,
    pagarmeOrderId: (o as any).pagarmeOrderId || null,
    paymentPaidAt: (o as any).paymentPaidAt ? (o as any).paymentPaidAt.toISOString() : null,
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

  // ── CONTAS A PAGAR ────────────────────────────────────────────────────────
  //
  // A aba existia só com o formulário: o lojista lançava a conta, via
  // "registrado com sucesso" e nada aparecia — não havia consulta nenhuma no
  // servidor, então não existia lista para mostrar. É isto que traz os dados.
  //
  // As datas viajam como "YYYY-MM-DD" já recortado, e não como ISO completo,
  // porque o vencimento é uma DATA, não um instante: mandar o timestamp faz o
  // navegador em UTC-3 exibir "vence dia 09" numa conta gravada para o dia 10.
  let payables: any[] = [];
  try {
    payables = await prisma.payable.findMany({
      where: { franchiseeId: targetFranchiseeId },
      orderBy: { dueDate: "asc" },
      select: {
        id: true, supplierName: true, value: true, status: true,
        dueDate: true, receivedDate: true, paidDate: true,
        barcode: true, category: true, paymentType: true,
      },
    });
  } catch (err) {
    console.error("[Financeiro] Erro ao buscar contas a pagar:", err);
  }

  const payablesSerialized = payables.map((p) => ({
    id: p.id,
    supplierName: p.supplierName,
    value: p.value,
    status: p.status,
    category: p.category,
    paymentType: p.paymentType || null,
    barcode: p.barcode || null,
    dueDate: p.dueDate.toISOString().slice(0, 10),
    receivedDate: p.receivedDate ? p.receivedDate.toISOString().slice(0, 10) : null,
    paidDate: p.paidDate ? p.paidDate.toISOString().slice(0, 10) : null,
  }));

  return (
    <DREClient
      orders={serialized}
      paymentFees={(user.paymentFees as any) || {}}
      storeName={user.storeName || "Minha Loja"}
      storeCreatedAt={user.createdAt.toISOString()}
      produtosSemCusto={produtosSemCusto.map(p => ({ id: p.id, name: p.name || "Sem nome" }))}
      initialFixedCosts={fixedCosts}
      initialGoals={financialGoals}
      initialRepasseConfig={(user.repasseConfig as any) || {}}
      payables={payablesSerialized}
    />
  );
}
