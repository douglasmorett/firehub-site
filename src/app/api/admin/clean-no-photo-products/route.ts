import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Apaga produtos sem foto do cardápio da PRÓPRIA loja.
 *
 * ── O QUE ESTAVA ERRADO AQUI ────────────────────────────────────────────────
 *
 * Era um GET sem autenticação e com um fallback fatal: quando NÃO havia sessão,
 * o código caía na conta `contatohakim` — a loja do dono — e apagava os
 * produtos dela. Bastava alguém abrir a URL (ou embutir `<img src="...">` num
 * site qualquer, que o navegador de qualquer pessoa dispararia) para o cardápio
 * do dono perder itens, sem login nenhum e sem rastro de quem foi.
 *
 * Agora: exige sessão, age SEMPRE na loja de quem chamou (fallback removido) e
 * responde a POST — GET é o método que um `<img>` consegue disparar sozinho.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    let franchiseeId: string | null = null;
    const u = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true }
    });
    if (u) franchiseeId = u.ownerId || u.id;

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
