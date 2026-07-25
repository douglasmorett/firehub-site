import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    let franchiseeId: string | null = null;

    if (session?.user?.email) {
      const u = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, ownerId: true }
      });
      if (u) franchiseeId = u.ownerId || u.id;
    }

    if (!franchiseeId) {
      const hakimUser = await prisma.user.findFirst({
        where: { email: { contains: "contatohakim" } },
        select: { id: true, ownerId: true }
      });
      if (hakimUser) franchiseeId = hakimUser.ownerId || hakimUser.id;
    }

    if (!franchiseeId) {
      return NextResponse.json({ error: "Franqueado não encontrado" }, { status: 404 });
    }

    // Buscar todos os produtos do franqueado que NÃO possuem foto (imageUrl é null ou string vazia)
    const noPhotoProducts = await prisma.menuProduct.findMany({
      where: {
        franchiseeId,
        OR: [
          { imageUrl: null },
          { imageUrl: "" }
        ]
      },
      select: { id: true, name: true, category: true, price: true }
    });

    const deletedNames: string[] = [];

    for (const p of noPhotoProducts) {
      // 1. Remover vínculo com combos
      await prisma.comboGroupItem.deleteMany({
        where: { menuProductId: p.id }
      });

      // 2. Deletar produto
      try {
        await prisma.menuProduct.delete({ where: { id: p.id } });
        deletedNames.push(p.name);
      } catch (err) {
        // Se houver pedido antigo vinculado, desativa (soft delete)
        await prisma.menuProduct.update({
          where: { id: p.id },
          data: { active: false, activePDV: false, activeDelivery: false }
        });
        deletedNames.push(`${p.name} (desativado)`);
      }
    }

    return NextResponse.json({
      ok: true,
      count: deletedNames.length,
      deletedProducts: deletedNames,
      message: `Sucesso! ${deletedNames.length} produtos sem foto foram excluídos.`
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req);
}
