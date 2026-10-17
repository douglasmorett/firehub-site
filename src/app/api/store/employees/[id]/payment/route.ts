import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { totalDasMesasNoFiado } from "@/lib/fiado-da-mesa";
import { saldoDoFiado } from "@/lib/fiado-da-mesa-regras";

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

  // ── O FUNCIONÁRIO PRECISA SER DESTA LOJA ────────────────────────────────
  //
  // A rota só exigia sessão: qualquer lojista logado registrava abatimento de
  // dívida (fiado) no cliente de OUTRA loja — apagando dívida real de dinheiro
  // no caixa alheio.
  const _usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!_usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const _lojaDaSessao = _usuario.ownerId || _usuario.id;

  const employee = await prisma.storeEmployee.findUnique({
    where: { id: employeeId },
    select: { id: true, franchiseeId: true, name: true },
  });

  if (!employee) {
    return NextResponse.json({ error: "Funcionário não encontrado" }, { status: 404 });
  }
  if (_usuario.role !== "ADMIN" && employee.franchiseeId !== _lojaDaSessao) {
    console.warn(`[fiado] 🚫 ${_usuario.id} tentou abater dívida em cliente da loja ${employee.franchiseeId}.`);
    return NextResponse.json({ error: "Este cadastro não é desta loja" }, { status: 403 });
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

  // As contas de mesa no fiado também são dívida (lib/fiado-da-mesa.ts).
  const remainingDebt = saldoDoFiado({
    pedidos: allOrdersAgg._sum.totalAmount || 0,
    mesas: await totalDasMesasNoFiado([employeeId]),
    baixas: allPaymentsAgg._sum.amount || 0,
  });

  return NextResponse.json({
    success: true,
    payment,
    remainingDebt,
    message: `Abatimento de R$ ${numericAmount.toFixed(2).replace(".", ",")} registrado para ${employee.name}. Saldo restante: R$ ${remainingDebt.toFixed(2).replace(".", ",")}`,
  });
}
