import { NextRequest, NextResponse } from "next/server";
import { orderByCardapio } from "@/lib/menu-order";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado.", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const [categories, products] = await Promise.all([
    prisma.menuCategory.findMany({
      where: { franchiseeId: auth.franchiseeId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.menuProduct.findMany({
      where: { franchiseeId: auth.franchiseeId },
      include: {
        comboGroups: {
          include: {
            items: true,
          },
        },
      },
      orderBy: await orderByCardapio(),
    }),
  ]);

  return NextResponse.json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      sortOrder: c.sortOrder,
    })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      category: p.category,
      active: p.active,
      imageUrl: p.imageUrl,
      isCombo: p.isCombo,
      isBeverage: p.isBeverage,
      availableDays: p.availableDays,
      tags: p.tags,
      comboGroups: p.comboGroups.map((g) => ({
        id: g.id,
        title: g.title,
        maxQty: g.maxQty,
        items: g.items.map((i) => ({
          id: i.id,
          additionalPrice: i.additionalPrice,
        })),
      })),
    })),
  });
}
