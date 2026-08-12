import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: Fetch transaction history
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const email = session.user.email || "";
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });
    if (!user) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const transactions = await prisma.stockTransaction.findMany({
      where: {
        stockItem: {
          franchiseeId: user.id
        }
      },
      include: {
        stockItem: {
          select: { id: true, name: true, unit: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return NextResponse.json({ success: true, transactions });
  } catch (error: any) {
    console.error("[Stock Transactions GET] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// POST: Add a new manual transaction (INPUT / OUTPUT / WASTE)
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const email = session.user.email || "";
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true }
    });
    if (!user) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const body = await req.json();
    const { stockItemId, quantity, type, notes } = body;

    if (!stockItemId || quantity === undefined || !type) {
      return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    }

    // Verificar se o stockItem pertence ao franchisee
    const stockItem = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!stockItem || stockItem.franchiseeId !== user.id) {
      return NextResponse.json({ error: "Ingrediente não encontrado" }, { status: 404 });
    }

    const qtyVal = Number(quantity);
    if (isNaN(qtyVal)) return NextResponse.json({ error: "Quantidade inválida" }, { status: 400 });

    // Se for Saída (OUTPUT) ou Desperdício (WASTE), a transação é negativa
    const multiplier = (type === "OUTPUT" || type === "WASTE") ? -1 : 1;
    const finalQuantity = Math.abs(qtyVal) * multiplier;

    // Criar a transação
    const transaction = await prisma.stockTransaction.create({
      data: {
        stockItemId,
        quantity: finalQuantity,
        type,
        notes: notes || null
      }
    });

    // Atualizar o saldo do estoque
    const updatedItem = await prisma.stockItem.update({
      where: { id: stockItemId },
      data: {
        quantity: {
          increment: finalQuantity
        }
      }
    });

    return NextResponse.json({ success: true, transaction, currentQuantity: updatedItem.quantity });
  } catch (error: any) {
    console.error("[Stock Transactions POST] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
