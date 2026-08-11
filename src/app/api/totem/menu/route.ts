import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || "fallback-secret");

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return NextResponse.json({ error: "Token obrigatório" }, { status: 400 });

    let payload: any;
    try {
      const result = await jwtVerify(token, secret);
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
        activeTotem: true, // Apenas produtos habilitados para Totem
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

    // Buscar categorias
    const categories = await prisma.menuCategory.findMany({
      where: { franchiseeId: license.franchiseeId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, emoji: true, color: true, sortOrder: true }
    });

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
