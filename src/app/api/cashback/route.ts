/**
 * FireHub — API de Cashback
 * GET  /api/cashback?phone=xx  → saldo do cliente
 * POST /api/cashback            → acumular ou resgatar cashback
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const phone = req.nextUrl.searchParams.get("phone");
  const storeSlug = req.nextUrl.searchParams.get("store");
  if (!phone) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  const customer = await prisma.storeCustomer.findUnique({
    where: { phone },
    select: { id: true, name: true, cashbackBalance: true, cashbackHistory: true }
  });

  if (!customer) return NextResponse.json({ balance: 0, history: [] });

  // Filtra histórico por loja se informado
  const history = (customer.cashbackHistory as any[]) || [];
  const filtered = storeSlug
    ? history.filter((h: any) => h.storeId === storeSlug)
    : history;

  return NextResponse.json({
    id: customer.id,
    name: customer.name,
    balance: customer.cashbackBalance,
    history: filtered.slice(-10), // últimos 10 eventos
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const body = await req.json();
  const { phone, orderId, type, amount, storeId } = body;
  // type: "earn" | "redeem"

  if (!phone || !type || !amount || amount <= 0) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }

  const customer = await prisma.storeCustomer.findUnique({ where: { phone } });
  if (!customer) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const history = (customer.cashbackHistory as any[]) || [];
  const event = {
    orderId: orderId || null,
    amount,
    type,  // earn | redeem
    storeId: storeId || null,
    date: new Date().toISOString(),
  };

  const newBalance = type === "earn"
    ? customer.cashbackBalance + amount
    : Math.max(0, customer.cashbackBalance - amount);

  await prisma.storeCustomer.update({
    where: { phone },
    data: {
      cashbackBalance: newBalance,
      cashbackHistory: [...history, event],
    }
  });

  // Atualiza o pedido se informado
  if (orderId) {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: type === "earn"
        ? { cashbackEarned: amount }
        : { cashbackUsed: amount }
    }).catch(() => {}); // ignora se pedido não encontrado
  }

  return NextResponse.json({ ok: true, newBalance, event });
}
