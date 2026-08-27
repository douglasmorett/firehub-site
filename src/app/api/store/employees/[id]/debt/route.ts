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
    return NextResponse.json({ error: "Valor da dívida inválido" }, { status: 400 });
  }


  // ── O FUNCIONÁRIO PRECISA SER DESTA LOJA ────────────────────────────────
  //
  // Só se conferia "existe sessão": qualquer lojista logado mandava o id de um
  // funcionário de OUTRA loja e editava/desativava o cadastro dele — ou, no
  // caso do fiado, lançava dívida e baixa em nome da loja alheia (dinheiro).
  const _usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!_usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const _lojaDaSessao = _usuario.ownerId || _usuario.id;

  const employee = await prisma.storeEmployee.findUnique({
    where: { id: employeeId },
    select: { id: true, franchiseeId: true, name: true, phone: true },
  });

  if (!employee) {
    return NextResponse.json({ error: "Cliente fiado não encontrado" }, { status: 404 });
  }
  if (_usuario.role !== "ADMIN" && employee.franchiseeId !== _lojaDaSessao) {
    console.warn(`[fiado] 🚫 ${_usuario.id} tentou lançar dívida em funcionário da loja ${employee.franchiseeId}.`);
    return NextResponse.json({ error: "Este cadastro não é desta loja" }, { status: 403 });
  }

  // Cria o registro da dívida manual como um CustomerOrder (fiado) sem itens
  const order = await prisma.customerOrder.create({
    data: {
      franchiseeId: employee.franchiseeId,
      employeeId,
      customerName: employee.name,
      customerPhone: employee.phone || "",
      status: "ENTREGUE",
      source: "PDV",
      paymentMethod: "FIADO",
      totalAmount: numericAmount,
      notes: notes?.trim() || null,
      items: { create: [] }, // Sem itens vinculados
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
    order,
    remainingDebt,
    message: `Dívida manual de R$ ${numericAmount.toFixed(2).replace(".", ",")} registrada para ${employee.name}. Novo saldo devedor: R$ ${remainingDebt.toFixed(2).replace(".", ",")}`,
  });
}
