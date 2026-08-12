import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: Fetch the recipe for a product and the available stock items
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

    const { searchParams } = new URL(req.url);
    const menuProductId = searchParams.get("menuProductId");

    // Obter ingredientes cadastrados no estoque do franchisee
    const stockItems = await prisma.stockItem.findMany({
      where: { franchiseeId: user.id },
      orderBy: { name: "asc" }
    });

    if (menuProductId) {
      // Buscar receita específica desse produto
      const recipe = await prisma.productRecipe.findMany({
        where: {
          menuProductId,
          menuProduct: {
            franchiseeId: user.id
          }
        },
        include: {
          stockItem: {
            select: { name: true, unit: true }
          }
        }
      });
      return NextResponse.json({ success: true, recipe, stockItems });
    }

    // Se não informou ID de produto, retorna todos os produtos ativos reais do cardápio com suas receitas
    const junkCategories = ["IFOOD", "iFood", "Jotajá", "JOTAJA", "Jotaja", "ONLINE", "COMPLEMENTO", "COMPLEMENTOS", "OPCIONAL", "OPCIONAIS", "ADICIONAL", "ADICIONAIS", "INSUMO", "INSUMOS", "OCULTO"];
    
    const menuProducts = await prisma.menuProduct.findMany({
      where: {
        franchiseeId: user.id,
        active: true,
        category: {
          notIn: junkCategories
        },
        NOT: [
          { name: { startsWith: "IFOOD |" } },
          { name: { startsWith: "JOTAJÁ |" } },
          { name: { startsWith: "JOTAJA |" } },
          { name: { startsWith: "COMBOS |" } },
          { name: { startsWith: "Produto (R$" } }
        ]
      },
      include: {
        recipeItems: {
          include: {
            stockItem: {
              select: { name: true, unit: true }
            }
          }
        }
      },
      orderBy: { name: "asc" }
    });

    return NextResponse.json({ success: true, menuProducts, stockItems });
  } catch (error: any) {
    console.error("[Recipes GET] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// POST: Save/update the recipe for a product
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
    const { menuProductId, ingredients } = body; // ingredients = Array<{ stockItemId, quantityConsumed }>

    if (!menuProductId || !Array.isArray(ingredients)) {
      return NextResponse.json({ error: "Dados inválidos ou incompletos" }, { status: 400 });
    }

    // Verificar se o produto do cardápio pertence ao lojista
    const menuProduct = await prisma.menuProduct.findUnique({ where: { id: menuProductId } });
    if (!menuProduct || menuProduct.franchiseeId !== user.id) {
      return NextResponse.json({ error: "Produto do cardápio não encontrado" }, { status: 404 });
    }

    // Usar transação atômica do Prisma para limpar e salvar
    await prisma.$transaction(async (tx) => {
      // 1. Apagar receita anterior
      await tx.productRecipe.deleteMany({
        where: { menuProductId }
      });

      // 2. Criar novos itens de receita (se houver)
      if (ingredients.length > 0) {
        const recipeData = [];
        
        for (const ing of ingredients) {
          let stockItemId = ing.stockItemId;
          const qty = Number(ing.quantityConsumed);
          if (qty <= 0) continue;
          
          // Auto-create stock item if it's a new ingredient
          if (stockItemId === 'NEW' && ing.newItemName) {
            // Check if already exists (case-insensitive)
            const existing = await tx.stockItem.findFirst({
              where: {
                franchiseeId: user.id,
                name: { equals: ing.newItemName, mode: 'insensitive' }
              }
            });
            
            if (existing) {
              stockItemId = existing.id;
            } else {
              const newItem = await tx.stockItem.create({
                data: {
                  franchiseeId: user.id,
                  name: ing.newItemName,
                  quantity: 0,
                  unit: ing.newItemUnit || 'un',
                }
              });
              stockItemId = newItem.id;
            }
          }
          
          if (!stockItemId || stockItemId === 'NEW') continue;
          
          recipeData.push({
            menuProductId,
            stockItemId,
            quantityConsumed: qty
          });
        }

        if (recipeData.length > 0) {
          await tx.productRecipe.createMany({ data: recipeData });
        }
      }
    });

    // Retorna a receita salva
    const savedRecipe = await prisma.productRecipe.findMany({
      where: { menuProductId },
      include: {
        stockItem: {
          select: { name: true, unit: true }
        }
      }
    });

    return NextResponse.json({ success: true, recipe: savedRecipe });
  } catch (error: any) {
    console.error("[Recipes POST] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
