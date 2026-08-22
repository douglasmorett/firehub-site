import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─── ESCOPO POR LOJA (isolamento multi-tenant) ──────────────────────────────
// O que era explorável antes: PUT e DELETE já conferiam o dono, mas o PATCH
// (reordenar/renomear em lote) e a leitura do ADMIN não conferiam nada. Um
// ADMIN operando dentro de uma loja específica reordenava/renomeava/criava
// categoria em TODAS as franquias — e o updateMany/findFirst por nome sem
// filtro chegava a alterar a categoria homônima do vizinho. Agora todo verbo
// resolve a loja da sessão (ownerId || id) e o ADMIN respeita o cookie
// firehub_active_store, mesmo padrão de /api/store/dynamic-eta.

type Scope = {
  id: string;
  role: string;
  isAdmin: boolean;
  targetFranchiseeId: string;  // loja do usuário logado (funcionário usa a do dono)
  adminStoreId: string | null; // loja ativa escolhida pelo ADMIN
};

async function getScope(
  req: NextRequest
): Promise<{ scope: Scope; error: null } | { scope: null; error: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { scope: null, error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) {
    return { scope: null, error: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  }

  const isAdmin = user.role === "ADMIN";
  const activeStoreId =
    req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null;

  return {
    scope: {
      id: user.id,
      role: user.role,
      isAdmin,
      targetFranchiseeId: user.ownerId || user.id,
      adminStoreId: isAdmin && activeStoreId && activeStoreId !== "all" ? activeStoreId : null,
    },
    error: null,
  };
}

// Filtro de leitura/edição em lote. Franqueado: só a própria loja. ADMIN dentro
// de uma loja: aquela loja + as categorias globais (franchiseeId null), que são
// as que o próprio ADMIN cria — se elas sumissem da lista, o cadastro de
// produto travaria ("cadastre pelo menos uma categoria"). ADMIN sem loja ativa:
// visão global de antes.
function scopeFilter(scope: Scope): any {
  if (!scope.isAdmin) return { franchiseeId: scope.targetFranchiseeId };
  if (scope.adminStoreId) {
    return { OR: [{ franchiseeId: scope.adminStoreId }, { franchiseeId: null }] };
  }
  return {};
}

// Loja em que novas categorias devem nascer.
function writeFranchiseeId(scope: Scope): string | null {
  return scope.isAdmin ? scope.adminStoreId : scope.targetFranchiseeId;
}

// Posse de uma categoria já existente. ADMIN (matriz FireHub) segue com acesso
// global no registro individual, porque as telas de suporte listam todas as
// lojas para ele; só fica o aviso no log quando é fora da loja ativa.
function canTouch(scope: Scope, franchiseeId: string | null): boolean {
  if (!scope.isAdmin) return franchiseeId === scope.targetFranchiseeId;
  if (scope.adminStoreId && franchiseeId !== scope.adminStoreId && franchiseeId !== null) {
    console.warn(
      `[categories] ADMIN ${scope.id} alterando categoria da loja ${franchiseeId} com a loja ativa ${scope.adminStoreId}.`
    );
  }
  return true;
}

// GET — lista categorias do franchisee ordenadas por sortOrder
export async function GET(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;

  const categories = await prisma.menuCategory.findMany({
    where: scopeFilter(scope),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(categories);
}

// POST — criar categoria
export async function POST(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;

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
      // franchiseeId nunca vem do corpo: é sempre a loja da sessão.
      franchiseeId: writeFranchiseeId(scope),
    },
  });

  return NextResponse.json(category);
}

// PUT — editar categoria
export async function PUT(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;

  const { id, name, emoji, color, sortOrder, imageUrl } = await req.json();
  if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const existing = await prisma.menuCategory.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
  if (!canTouch(scope, existing.franchiseeId)) {
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
export async function PATCH(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;

  const body = await req.json();
  const { orderedIds, orderedCategories } = body;
  // Filtro de posse aplicado em TODO update/busca do lote. Antes, para ADMIN
  // isso era `null` (nenhum filtro) e o lote saía escrevendo em qualquer loja.
  const ownFilter = scopeFilter(scope);
  const targetFranchiseeId = writeFranchiseeId(scope);

  if (Array.isArray(orderedCategories) && orderedCategories.length > 0) {
    for (let index = 0; index < orderedCategories.length; index++) {
      const cat = orderedCategories[index];
      const catName = (cat.name || "").trim();
      if (!catName) continue;

      if (cat.id && !cat.id.startsWith("virtual-")) {
        // Tentar atualizar por ID (só acerta se a categoria for da loja)
        const updated = await prisma.menuCategory.updateMany({
          where: {
            id: cat.id,
            ...ownFilter
          },
          data: {
            sortOrder: index,
            ...(cat.emoji ? { emoji: cat.emoji } : {}),
            ...(cat.color ? { color: cat.color } : {})
          }
        });
        if (updated.count > 0) continue;

        // ID real que não é desta loja: ignora em silêncio. Antes o fluxo caía
        // na busca por nome sem filtro e acabava renomeando/reordenando a
        // categoria homônima da outra franquia; criar uma cópia aqui também
        // encheria o cardápio de duplicatas. Melhor não fazer nada.
        console.warn(`[categories] PATCH ignorou a categoria ${cat.id} — fora do escopo da loja.`);
        continue;
      }

      // ID virtual (categoria que só existe como texto no produto): buscar por
      // nome DENTRO da loja e criar se não existir
      const existing = await prisma.menuCategory.findFirst({
        where: {
          name: { equals: catName, mode: "insensitive" },
          ...ownFilter
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
      where: scopeFilter(scope),
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
          ...ownFilter
        },
        data: { sortOrder: index }
      });
    }

    const categories = await prisma.menuCategory.findMany({
      where: scopeFilter(scope),
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, categories });
  }

  return NextResponse.json({ error: "orderedCategories ou orderedIds é obrigatório" }, { status: 400 });
}

// DELETE — excluir categoria
export async function DELETE(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const existing = await prisma.menuCategory.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
  if (!canTouch(scope, existing.franchiseeId)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  await prisma.menuCategory.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
