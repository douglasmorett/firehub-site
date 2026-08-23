import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";
import { segredoObrigatorio } from "@/lib/segredos";

// Função, não constante: `segredoObrigatorio` lança quando a variável falta, e
// no topo do módulo isso quebraria o BUILD (o Next avalia os módulos ao gerar
// as páginas). Avaliado só no uso, falha apenas a requisição — e com mensagem.
const obterSegredo = () => new TextEncoder().encode(segredoObrigatorio("NEXTAUTH_SECRET"));

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return NextResponse.json({ error: "Token obrigatório" }, { status: 400 });

    let payload: any;
    try {
      const result = await jwtVerify(token, obterSegredo());
      payload = result.payload;
    } catch {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const license = await prisma.totemLicense.findUnique({
      where: { id: payload.licenseId },
      select: { franchiseeId: true, active: true }
    });

    if (!license || !license.active) {
      return NextResponse.json({ error: "Licença inválida" }, { status: 403 });
    }

    // Buscar produtos ativos para o totem
    const products = await prisma.menuProduct.findMany({
      where: {
        franchiseeId: license.franchiseeId,
        active: true,
        activeTotem: true, // Apenas produtos habilitados para Totem (padrão true para todos os ativos)
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, description: true, price: true, imageUrl: true,
        category: true, isCombo: true, isBeverage: true, tags: true, availableDays: true,
        comboGroups: {
          orderBy: { sortOrder: "asc" },
          include: {
            items: {
              include: {
                menuProduct: { select: { id: true, name: true, active: true, imageUrl: true, price: true } }
              }
            }
          }
        }
      }
    });

    // Buscar categorias cadastradas no banco
    const dbCategories = await prisma.menuCategory.findMany({
      where: { franchiseeId: license.franchiseeId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, emoji: true, imageUrl: true, color: true, sortOrder: true }
    });

    // Sintetizar categorias de produtos caso não estejam na tabela MenuCategory
    const categoryNames = new Set(dbCategories.map(c => c.name.toLowerCase().trim()));
    const extraCategories: any[] = [];
    
    products.forEach(p => {
      if (p.category && !categoryNames.has(p.category.toLowerCase().trim())) {
        categoryNames.add(p.category.toLowerCase().trim());
        extraCategories.push({
          id: `cat_${p.category.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
          name: p.category,
          emoji: "🍽️",
          imageUrl: null,
          color: "#E8360C",
          sortOrder: 99
        });
      }
    });

    const categories = [...dbCategories, ...extraCategories];

    // Filtrar por dia da semana
    const dayMap: Record<number, string> = { 0: "DOM", 1: "SEG", 2: "TER", 3: "QUA", 4: "QUI", 5: "SEX", 6: "SAB" };
    const today = dayMap[new Date().getDay()];
    const filtered = products.filter(p => {
      if (!p.availableDays) return true;
      try {
        const days = JSON.parse(p.availableDays as string);
        return !Array.isArray(days) || days.length === 0 || days.includes(today);
      } catch { return true; }
    });

    return NextResponse.json({ products: filtered, categories });
  } catch (err) {
    console.error("[Totem Menu] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
