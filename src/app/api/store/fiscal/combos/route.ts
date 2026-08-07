import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;

    // Buscar todos os produtos do tipo combo da loja
    const combos = await prisma.menuProduct.findMany({
      where: {
        franchiseeId,
        isCombo: true,
      },
      include: {
        comboGroups: {
          include: {
            items: {
              include: {
                menuProduct: {
                  select: { id: true, name: true, price: true, category: true }
                }
              }
            }
          }
        }
      },
      orderBy: { name: "asc" }
    });

    return NextResponse.json({ success: true, combos });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
