import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const junkCategories = ["IFOOD", "iFood", "Jotajá", "JOTAJA", "Jotaja", "ONLINE", "COMPLEMENTO", "COMPLEMENTOS", "OPCIONAL", "OPCIONAIS", "ADICIONAL", "ADICIONAIS", "INSUMO", "INSUMOS", "OCULTO"];

    // 1. Buscar todos os produtos lixo auto-gerados
    const junkProducts = await prisma.menuProduct.findMany({
      where: {
        OR: [
          { category: { in: junkCategories } },
          { name: { startsWith: "IFOOD |" } },
          { name: { startsWith: "JOTAJÁ |" } },
          { name: { startsWith: "JOTAJA |" } },
          { name: { startsWith: "COMBOS |" } },
          { name: { startsWith: "Produto (R$" } },
        ],
      },
      select: { id: true, name: true, category: true },
    });

    const junkIds = junkProducts.map((p) => p.id);

    if (junkIds.length === 0) {
      return NextResponse.json({ message: "Nenhum produto lixo encontrado. Cardápio já está limpo!", deletedCount: 0 });
    }

    // 2. Desvincular itens de pedidos que apontavam para esses produtos (definir menuProductId = null para preservar o histórico)
    await prisma.customerOrderItem.updateMany({
      where: { menuProductId: { in: junkIds } },
      data: { menuProductId: null },
    });

    // 3. Deletar os 267 produtos lixo do banco de dados
    const deleteResult = await prisma.menuProduct.deleteMany({
      where: { id: { in: junkIds } },
    });

    // 4. Limpar categorias vazias que sobraram (IFOOD, Jotajá, ONLINE)
    await prisma.menuCategory.deleteMany({
      where: { name: { in: junkCategories } },
    });

    // 5. Obter resumo dos produtos limpos restantes
    const cleanProducts = await prisma.menuProduct.findMany({
      select: { category: true },
    });

    const categoriesCount: Record<string, number> = {};
    cleanProducts.forEach((p) => {
      categoriesCount[p.category] = (categoriesCount[p.category] || 0) + 1;
    });

    return NextResponse.json({
      success: true,
      message: `Sucesso! ${deleteResult.count} produtos duplicados/auto-gerados (IFOOD, Jotajá, ONLINE) foram removidos.`,
      deletedCount: deleteResult.count,
      remainingProductsCount: cleanProducts.length,
      cleanCategoriesDistribution: categoriesCount,
    });
  } catch (err: any) {
    console.error("[CleanMenuDuplicates] Erro ao limpar cardápio:", err);
    return NextResponse.json({ error: err.message || "Erro ao limpar produtos" }, { status: 500 });
  }
}
