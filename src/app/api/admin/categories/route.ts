import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getUser(session: any) {
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) return null;
  return { ...user, targetFranchiseeId: user.ownerId || user.id };
}

// GET — lista categorias do franchisee ordenadas por sortOrder
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const where = user.role === "ADMIN" ? {} : { franchiseeId: user.targetFranchiseeId };

  const categories = await prisma.menuCategory.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(categories);
}

// POST — criar categoria
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { name, emoji = "🍽️", color = "#64748B", sortOrder = 0, imageUrl = null } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome da categoria é obrigatório" }, { status: 400 });
  }

  const category = await prisma.menuCategory.create({
    data: {
      name: name.trim(),
      emoji,
      color,
      imageUrl,
      sortOrder,
      franchiseeId: user.role === "ADMIN" ? null : user.targetFranchiseeId,
    },
  });

  return NextResponse.json(category);
}

// PUT — editar categoria
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { id, name, emoji, color, sortOrder, imageUrl } = await req.json();
  if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const existing = await prisma.menuCategory.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
  if (user.role !== "ADMIN" && existing.franchiseeId !== user.targetFranchiseeId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const updated = await prisma.menuCategory.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(emoji !== undefined && { emoji }),
      ...(color !== undefined && { color }),
      ...(imageUrl !== undefined && { imageUrl }),
      ...(sortOrder !== undefined && { sortOrder }),
    },
  });

  return NextResponse.json(updated);
}

// PATCH — reordenar categorias em lote
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { orderedIds } = await req.json();
  if (!Array.isArray(orderedIds)) {
    return NextResponse.json({ error: "orderedIds deve ser um array" }, { status: 400 });
  }

  await prisma.$transaction(
    orderedIds.map((id: string, index: number) =>
      prisma.menuCategory.update({
        where: { id },
        data: { sortOrder: index }
      })
    )
  );

  return NextResponse.json({ success: true });
}

// DELETE — excluir categoria
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await getUser(session);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const existing = await prisma.menuCategory.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
  if (user.role !== "ADMIN" && existing.franchiseeId !== user.targetFranchiseeId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  await prisma.menuCategory.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
