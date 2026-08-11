import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id: employeeId } = await params;
  const { amount, notes } = await req.json();

  const numericAmount = parseFloat(String(amount));
  if (isNaN(numericAmount) || numericAmount <= 0) {
    return NextResponse.json({ error: "Valor do abatimento inválido" }, { status: 400 });
  }

  const employee = await prisma.storeEmployee.findUnique({
    where: { id: employeeId },
    select: { id: true, franchiseeId: true, name: true },
  });

  if (!employee) {
    return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  }

  // Cria o registro do abatimento de dívida
  const payment = await prisma.employeePayment.create({
    data: {
      franchiseeId: employee.franchiseeId,
      employeeId,
      amount: numericAmount,
      notes: notes?.trim() || null,
    },
  });

  // Calcula novo saldo devedor atualizado
  const allOrdersAgg = await prisma.customerOrder.aggregate({
    where: { employeeId, status: { not: "CANCELADO" } },
    _sum: { totalAmount: true },
  });

  const allPaymentsAgg = await prisma.employeePayment.aggregate({
    where: { employeeId },
    _sum: { amount: true },
  });

  const totalOrdersAmount = allOrdersAgg._sum.totalAmount || 0;
  const totalPaymentsAmount = allPaymentsAgg._sum.amount || 0;
  const remainingDebt = Math.max(0, totalOrdersAmount - totalPaymentsAmount);

  return NextResponse.json({
    success: true,
    payment,
    remainingDebt,
    message: `Abatimento de R$ ${numericAmount.toFixed(2).replace(".", ",")} registrado para ${employee.name}. Saldo restante: R$ ${remainingDebt.toFixed(2).replace(".", ",")}`,
  });
}
