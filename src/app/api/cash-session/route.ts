import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

async function getUser(session: any) {
  return prisma.user.findUnique({ where: { email: session.user?.email || "" } });
}

// GET - retorna sessão aberta atual e pedidos presenciais do período
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Sessão aberta atual
  const openSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  // Se tem sessão aberta, calcular os valores esperados com base em TODOS os pedidos do período
  let expected = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, total: 0 };
  if (openSession) {
    const orders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: user.id,
        status: { notIn: ["CANCELADO"] },
        createdAt: { gte: openSession.openedAt },
      },
      select: { paymentMethod: true, totalAmount: true, source: true, paymentPaidAt: true, gatewayProvider: true, deliveryFee: true, discountIfood: true },
    });

    for (const o of orders) {
      const pm = (o.paymentMethod || "").toLowerCase();
      const val = (o.totalAmount || 0) + (o.deliveryFee || 0) + (o.discountIfood || 0);
      const src = ((o as any).source || "").toUpperCase();
      const isPaidOnline = !!(o.paymentPaidAt || o.gatewayProvider);

      // iFood orders paid online — count but under the correct method
      // For iFood paid on delivery (Dinheiro), count as cash
      if (pm.includes("dinheiro") || pm.includes("cash")) {
        expected.cash += val;
      } else if (pm.includes("débito") || pm.includes("debito") || pm.includes("debit")) {
        expected.debit += val;
      } else if (pm.includes("crédito") || pm.includes("credito") || pm.includes("credit")) {
        expected.credit += val;
      } else if (pm.includes("pix")) {
        expected.pix += val;
      } else if (pm.includes("voucher") || pm.includes("vale") || pm.includes("meal") || pm.includes("food")) {
        expected.voucher += val;
      } else if (src === "IFOOD" && isPaidOnline) {
        // iFood online payment (credit card via app) — categorize as credit
        expected.credit += val;
      } else if (src === "JOTAJA" && isPaidOnline) {
        // Jotajá online payment — categorize as credit
        expected.credit += val;
      } else {
        // Unknown method — count as credit (most common online)
        expected.credit += val;
      }
      expected.total += val;
    }
    // Adicionar o troco inicial ao dinheiro esperado
    expected.cash += openSession.openingAmount;
  }

  return NextResponse.json({ session: openSession, expected, cashOpen: user.cashOpen });
}

// POST - abrir caixa com valor inicial
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { openingAmount = 0 } = await req.json();

  // Fechar qualquer sessão aberta anterior
  await prisma.cashSession.updateMany({
    where: { franchiseeId: user.id, status: "OPEN" },
    data: { status: "CLOSED", closedAt: new Date() },
  });

  // Criar nova sessão
  const cashSession = await prisma.cashSession.create({
    data: { franchiseeId: user.id, openingAmount: Number(openingAmount), status: "OPEN" },
  });

  // Marcar caixa como aberto no user
  await prisma.user.update({ where: { id: user.id }, data: { cashOpen: true } });

  return NextResponse.json({ success: true, session: cashSession });
}

// PUT - fechar caixa com valores contados
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const body = await req.json();
  const { closingCash, closingDebit, closingCredit, closingPix, closingVoucher,
    expectedCash, expectedDebit, expectedCredit, expectedPix, expectedVoucher, expectedTotal,
    justification } = body;

  const totalInformed = (closingCash || 0) + (closingDebit || 0) + (closingCredit || 0) +
    (closingPix || 0) + (closingVoucher || 0);
  const difference = totalInformed - (expectedTotal || 0);

  const openSession = await prisma.cashSession.findFirst({
    where: { franchiseeId: user.id, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });

  if (openSession) {
    await prisma.cashSession.update({
      where: { id: openSession.id },
      data: {
        status: "CLOSED", closedAt: new Date(),
        closingCash: Number(closingCash || 0),
        closingDebit: Number(closingDebit || 0),
        closingCredit: Number(closingCredit || 0),
        closingPix: Number(closingPix || 0),
        closingVoucher: Number(closingVoucher || 0),
        expectedCash: Number(expectedCash || 0),
        expectedDebit: Number(expectedDebit || 0),
        expectedCredit: Number(expectedCredit || 0),
        expectedPix: Number(expectedPix || 0),
        expectedVoucher: Number(expectedVoucher || 0),
        expectedTotal: Number(expectedTotal || 0),
        difference: Number(difference.toFixed(2)),
        justification: justification || null,
        closedBy: session.user?.name || session.user?.email || "",
      },
    });
  }

  // Marcar caixa como fechado no user
  await prisma.user.update({ where: { id: user.id }, data: { cashOpen: false } });

  return NextResponse.json({ success: true, difference });
}
