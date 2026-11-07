import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resolveScope, canTouch } from "@/lib/escopo-do-cardapio";

/**
 * "Criar grupo de complementos" (aba Complementos, modelo do iFood): UMA
 * pergunta nova, com as opções já escolhidas, posta no fim das perguntas de
 * vários produtos de uma vez.
 *
 *   POST { produtoIds: string[], title, minQty, maxQty, items: [{ menuProductId, additionalPrice }] }
 *   → { criados, recusados: [{ id, motivo }] }
 *
 * A pergunta é COPIADA em cada produto (como em copiar-pergunta): o FireHub
 * não tem grupo compartilhado, cada produto é dono das suas perguntas.
 */
export async function POST(req: NextRequest) {
  const { scope, error } = await resolveScope(req, true);
  if (!scope) return error;

  const body = await req.json().catch(() => null);
  const produtoIds: string[] = Array.isArray(body?.produtoIds)
    ? Array.from(new Set(body.produtoIds.filter((id: unknown) => typeof id === "string" && id)))
    : [];
  const title = String(body?.title || "").trim();
  const minQty = Math.max(0, Math.floor(Number(body?.minQty) || 0));
  const maxQty = Math.max(1, Math.floor(Number(body?.maxQty) || 1));
  const items: { menuProductId: string; additionalPrice: number }[] = Array.isArray(body?.items)
    ? body.items
      .filter((it: any) => typeof it?.menuProductId === "string" && it.menuProductId)
      .map((it: any) => ({ menuProductId: it.menuProductId, additionalPrice: Math.max(0, Number(it.additionalPrice) || 0) }))
    : [];
  if (!title) return NextResponse.json({ error: "Dê um nome à pergunta" }, { status: 400 });
  if (minQty > maxQty) return NextResponse.json({ error: "O mínimo não pode passar do máximo" }, { status: 400 });
  if (items.length === 0) return NextResponse.json({ error: "Escolha pelo menos uma opção" }, { status: 400 });
  if (produtoIds.length === 0) return NextResponse.json({ error: "Escolha pelo menos um produto" }, { status: 400 });

  const ids = [...produtoIds, ...items.map((it) => it.menuProductId)];
  const produtos = await prisma.menuProduct.findMany({
    where: { id: { in: ids } },
    select: { id: true, franchiseeId: true, comboGroups: { select: { sortOrder: true } } },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const lojas = new Set(produtos.map((p) => p.franchiseeId));
  // Tudo da mesma loja, e uma loja que o usuário pode mexer.
  if (lojas.size !== 1 || produtos.length !== new Set(ids).size) {
    return NextResponse.json({ error: "Produto de outra loja ou inexistente" }, { status: 400 });
  }
  const loja = [...lojas][0];
  if (!loja || !canTouch(scope, loja)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let criados = 0;
  const recusados: { id: string; motivo: string }[] = [];
  for (const id of produtoIds) {
    if (items.some((it) => it.menuProductId === id)) { recusados.push({ id, motivo: "O produto não pode ser opção dele mesmo" }); continue; }
    const p = porId.get(id)!;
    const sortOrder = p.comboGroups.reduce((m, g) => Math.max(m, (g.sortOrder ?? 0) + 1), 0);
    await prisma.comboGroup.create({
      data: {
        menuProductId: id, title, minQty, maxQty, sortOrder,
        items: { create: items.map((it, k) => ({ menuProductId: it.menuProductId, additionalPrice: it.additionalPrice, sortOrder: k })) },
      },
    });
    criados++;
  }

  if (criados > 0) {
    const dona = await prisma.user.findUnique({ where: { id: loja }, select: { slug: true } }).catch(() => null);
    if (dona?.slug) { try { revalidatePath(`/loja/${dona.slug}`); } catch {} }
  }
  return NextResponse.json({ criados, recusados });
}
