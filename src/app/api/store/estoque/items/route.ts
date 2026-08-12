import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Helper to get franchiseeId from session
async function getFranchiseeId(session: any) {
  const email = session.user.email;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true }
  });
  return user?.id || null;
}

// GET: List all stock items for the logged-in franchisee
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const items = await prisma.stockItem.findMany({
      where: { franchiseeId },
      orderBy: { name: "asc" }
    });

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error("[Stock Items GET] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// POST: Create a new stock item
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const body = await req.json();
    const { name, quantity, unit, minQuantity, unitCost } = body;

    if (!name) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

    // Verificar duplicado
    const existing = await prisma.stockItem.findFirst({
      where: { franchiseeId, name: { equals: name, mode: "insensitive" } }
    });

    if (existing) {
      return NextResponse.json({ error: "Já existe um item com este nome no estoque." }, { status: 400 });
    }

    const item = await prisma.stockItem.create({
      data: {
        franchiseeId,
        name,
        quantity: Number(quantity) || 0,
        unit: unit || "un",
        minQuantity: minQuantity !== undefined && minQuantity !== "" ? Number(minQuantity) : null,
        unitCost: unitCost !== undefined && unitCost !== "" ? Number(unitCost) : null
      }
    });

    // Se a quantidade inicial for diferente de zero, registrar transação inicial
    if (Number(quantity) !== 0) {
      await prisma.stockTransaction.create({
        data: {
          stockItemId: item.id,
          quantity: Number(quantity),
          type: "INPUT",
          notes: "Saldo inicial de estoque"
        }
      });
    }

    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    console.error("[Stock Items POST] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// PUT: Update an existing stock item
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const body = await req.json();
    const { id, name, unit, minQuantity } = body;

    if (!id) return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 });

    const existing = await prisma.stockItem.findUnique({ where: { id } });
    if (!existing || existing.franchiseeId !== franchiseeId) {
      return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });
    }

    const updated = await prisma.stockItem.update({
      where: { id },
      data: {
        name: name || existing.name,
        unit: unit || existing.unit,
        minQuantity: minQuantity !== undefined ? (minQuantity !== "" ? Number(minQuantity) : null) : existing.minQuantity
      }
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error: any) {
    console.error("[Stock Items PUT] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// DELETE: Delete a stock item
export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 });

    const existing = await prisma.stockItem.findUnique({ where: { id } });
    if (!existing || existing.franchiseeId !== franchiseeId) {
      return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });
    }

    await prisma.stockItem.delete({ where: { id } });

    return NextResponse.json({ success: true, message: "Item removido com sucesso." });
  } catch (error: any) {
    console.error("[Stock Items DELETE] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
