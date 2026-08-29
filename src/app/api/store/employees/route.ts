import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { limiteDeDia } from "@/lib/timezone";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, accountGroupId: true, storeTimezone: true },
  });

  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const franchiseeId = user.ownerId || user.id;
  const masterId = user.accountGroupId || franchiseeId;

  // Busca lojas do grupo de conta
  const groupStores = await prisma.user.findMany({
    where: { OR: [{ id: masterId }, { accountGroupId: masterId }] },
    select: { id: true },
  });
  const validFranchiseeIds = groupStores.map((s) => s.id);

  // Parâmetros de data opcionais
  const fromDateStr = req.nextUrl.searchParams.get("fromDate");
  const toDateStr = req.nextUrl.searchParams.get("toDate");

  // Dia puro ("2026-08-29") ancorado no fuso da loja. Antes ia por `new Date()`,
  // que lê o dia como meia-noite em UTC — 21:00 da véspera em Brasília. O `lte`
  // então cortava o dia escolhido ANTES de ele começar, e filtrar "de hoje até
  // hoje" no fiado devolvia sempre lista vazia.
  const fuso = user.storeTimezone || "America/Sao_Paulo";
  const dateFilter: any = {};
  const inicioDoPeriodo = limiteDeDia(fromDateStr, fuso, "inicio");
  const fimDoPeriodo = limiteDeDia(toDateStr, fuso, "fim");
  if (inicioDoPeriodo) dateFilter.gte = inicioDoPeriodo;
  if (fimDoPeriodo) dateFilter.lte = fimDoPeriodo;

  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // Busca todos os funcionários ativos da loja/grupo
  const employees = await prisma.storeEmployee.findMany({
    where: { franchiseeId: { in: validFranchiseeIds } },
    orderBy: { name: "asc" },
  });

  // Para cada funcionário, calcular os saldos acumulados e do período
  const result = await Promise.all(
    employees.map(async (emp) => {
      // 1. Pedidos (fiados) acumulados totais
      const allOrdersAgg = await prisma.customerOrder.aggregate({
        where: {
          employeeId: emp.id,
          status: { not: "CANCELADO" },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      });

      // 2. Abatimentos acumulados totais
      const allPaymentsAgg = await prisma.employeePayment.aggregate({
        where: { employeeId: emp.id },
        _sum: { amount: true },
      });

      const totalOrdersAmount = allOrdersAgg._sum.totalAmount || 0;
      const totalPaymentsAmount = allPaymentsAgg._sum.amount || 0;
      const currentDebt = Math.max(0, totalOrdersAmount - totalPaymentsAmount);

      // 3. Se houver filtro por data, calcular métricas do período selecionado
      let periodOrdersAmount = totalOrdersAmount;
      let periodPaymentsAmount = totalPaymentsAmount;
      let periodOrdersCount = allOrdersAgg._count.id || 0;

      if (hasDateFilter) {
        const periodOrdersAgg = await prisma.customerOrder.aggregate({
          where: {
            employeeId: emp.id,
            status: { not: "CANCELADO" },
            createdAt: dateFilter,
          },
          _sum: { totalAmount: true },
          _count: { id: true },
        });

        const periodPaymentsAgg = await prisma.employeePayment.aggregate({
          where: {
            employeeId: emp.id,
            createdAt: dateFilter,
          },
          _sum: { amount: true },
        });

        periodOrdersAmount = periodOrdersAgg._sum.totalAmount || 0;
        periodPaymentsAmount = periodPaymentsAgg._sum.amount || 0;
        periodOrdersCount = periodOrdersAgg._count.id || 0;
      }

      return {
        ...emp,
        currentDebt,
        totalOrdersAmount,
        totalPaymentsAmount,
        totalOrdersCount: allOrdersAgg._count.id || 0,
        periodOrdersAmount,
        periodPaymentsAmount,
        periodOrdersCount,
      };
    })
  );

  return NextResponse.json({ employees: result });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });

  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const franchiseeId = user.ownerId || user.id;

  const { name, role, phone, cpf, creditLimit } = await req.json();

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Nome do funcionário é obrigatório" }, { status: 400 });
  }

  const newEmployee = await prisma.storeEmployee.create({
    data: {
      franchiseeId,
      name: name.trim(),
      role: role?.trim() || "Funcionário",
      phone: phone?.trim() || null,
      cpf: cpf?.trim() || null,
      creditLimit: creditLimit ? parseFloat(String(creditLimit)) : null,
      active: true,
    },
  });

  return NextResponse.json({ success: true, employee: newEmployee });
}
