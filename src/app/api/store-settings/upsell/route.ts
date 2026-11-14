import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerUpsellConfig } from "@/lib/upsell-config";

/**
 * Grava o upsell da sacola (lib/upsell-config.ts) — a tela é
 * /store/cardapio/upsell. Sempre na loja do DONO (`ownerId || id`), como a
 * config do balcão: funcionário do cardápio configura a mesma oferta.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const eu = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true, role: true } });
  if (!eu || !["FRANCHISEE", "STAFF", "ADMIN"].includes(eu.role)) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  const lojaId = eu.ownerId || eu.id;

  // Passa pelo mesmo leitor do site e da rota do pedido; e só fica produto
  // DESTA loja — id de outra loja ou apagado sai calado.
  const config = lerUpsellConfig(await req.json().catch(() => null));
  const daLoja = await prisma.menuProduct.findMany({
    where: { id: { in: config.itens.map((i) => i.produtoId) }, franchiseeId: lojaId },
    select: { id: true },
  });
  const ids = new Set(daLoja.map((p) => p.id));
  config.itens = config.itens.filter((i) => ids.has(i.produtoId));

  try {
    await prisma.user.update({ where: { id: lojaId }, data: { upsellConfig: config } as any });
  } catch (err) {
    console.error("[Upsell] gravação da config:", (err as any)?.code || err);
    return NextResponse.json(
      { error: "Não consegui salvar agora. Se acabou de sair uma atualização, tente de novo em um minuto." },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true, ...config });
}
