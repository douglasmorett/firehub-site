import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id: employeeId } = await params;

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const targetFranchiseeId = user.ownerId || user.id;

  const employee = await prisma.storeEmployee.findFirst({
    where: { id: employeeId, franchiseeId: targetFranchiseeId },
  });

  if (!employee) {
    return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  }

  const fromDateStr = req.nextUrl.searchParams.get("fromDate");
  const toDateStr = req.nextUrl.searchParams.get("toDate");

  const dateFilter: any = {};
  if (fromDateStr) dateFilter.gte = new Date(fromDateStr);
  if (toDateStr) dateFilter.lte = new Date(toDateStr);

  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // Busca pedidos (fiados)
  const orders = await prisma.customerOrder.findMany({
    where: {
      employeeId,
      status: { not: "CANCELADO" },
      ...(hasDateFilter && { createdAt: dateFilter }),
    },
    select: {
      id: true,
      ifoodReference: true,
      totalAmount: true,
      createdAt: true,
      status: true,
      notes: true,
      items: {
        select: {
          quantity: true,
          price: true,
          menuProduct: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Busca baixas/abatimentos
  const payments = await prisma.employeePayment.findMany({
    where: {
      employeeId,
      ...(hasDateFilter && { createdAt: dateFilter }),
    },
    select: {
      id: true,
      amount: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Unifica em um extrato cronológico único
  const statementItems = [
    ...orders.map((o) => ({
      id: o.id,
      type: "ORDER" as const,
      title: o.items.length === 0 ? "Inclusão de Dívida Manual" : `Pedido #${o.ifoodReference || o.id.slice(-4).toUpperCase()}`,
      amount: o.totalAmount,
      date: o.createdAt,
      notes: o.notes,
      itemsSummary: o.items.length === 0 ? o.notes : o.items.map((i) => `${i.quantity}x ${i.menuProduct?.name || "Item"}`).join(", "),
    })),
    ...payments.map((p) => ({
      id: p.id,
      type: "PAYMENT" as const,
      title: "Abatimento de Dívida",
      amount: p.amount,
      date: p.createdAt,
      notes: p.notes,
      itemsSummary: null,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Saldo geral acumulado
  const allOrdersAgg = await prisma.customerOrder.aggregate({
    where: { employeeId, status: { not: "CANCELADO" } },
    _sum: { totalAmount: true },
  });

  const allPaymentsAgg = await prisma.employeePayment.aggregate({
    where: { employeeId },
    _sum: { amount: true },
  });

  const totalOrders = allOrdersAgg._sum.totalAmount || 0;
  const totalPayments = allPaymentsAgg._sum.amount || 0;
  const currentDebt = Math.max(0, totalOrders - totalPayments);

  return NextResponse.json({
    employee,
    currentDebt,
    totalOrders,
    totalPayments,
    statement: statementItems,
  });
}
