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

  const body = await req.json();
  const { orderedIds, orderedCategories } = body;
  const targetFranchiseeId = user.role === "ADMIN" ? null : user.targetFranchiseeId;

  if (Array.isArray(orderedCategories) && orderedCategories.length > 0) {
    for (let index = 0; index < orderedCategories.length; index++) {
      const cat = orderedCategories[index];
      const catName = (cat.name || "").trim();
      if (!catName) continue;

      if (cat.id && !cat.id.startsWith("virtual-")) {
        // Tentar atualizar por ID
        const updated = await prisma.menuCategory.updateMany({
          where: { 
            id: cat.id,
            ...(targetFranchiseeId ? { franchiseeId: targetFranchiseeId } : {})
          },
          data: { 
            sortOrder: index,
            ...(cat.emoji ? { emoji: cat.emoji } : {}),
            ...(cat.color ? { color: cat.color } : {})
          }
        });
        if (updated.count > 0) continue;
      }

      // Se não encontrou por ID ou ID é virtual, buscar por nome
      const existing = await prisma.menuCategory.findFirst({
        where: {
          name: { equals: catName, mode: "insensitive" },
          ...(targetFranchiseeId ? { franchiseeId: targetFranchiseeId } : {})
        }
      });

      if (existing) {
        await prisma.menuCategory.update({
          where: { id: existing.id },
          data: { 
            sortOrder: index,
            ...(cat.emoji ? { emoji: cat.emoji } : {}),
            ...(cat.color ? { color: cat.color } : {})
          }
        });
      } else {
        await prisma.menuCategory.create({
          data: {
            name: catName,
            emoji: cat.emoji || "🍽️",
            color: cat.color || "#64748B",
            sortOrder: index,
            franchiseeId: targetFranchiseeId
          }
        });
      }
    }

    const categories = await prisma.menuCategory.findMany({
      where: user.role === "ADMIN" ? {} : { franchiseeId: user.targetFranchiseeId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, categories });
  }

  if (Array.isArray(orderedIds)) {
    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      if (!id || id.startsWith("virtual-")) continue;
      await prisma.menuCategory.updateMany({
        where: { 
          id,
          ...(targetFranchiseeId ? { franchiseeId: targetFranchiseeId } : {})
        },
        data: { sortOrder: index }
      });
    }

    const categories = await prisma.menuCategory.findMany({
      where: user.role === "ADMIN" ? {} : { franchiseeId: user.targetFranchiseeId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, categories });
  }

  return NextResponse.json({ error: "orderedCategories ou orderedIds é obrigatório" }, { status: 400 });
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
