/**
 * PAUSAR (OU REATIVAR) PRODUTOS DO CARDÁPIO — a regra num lugar só.
 *
 * É o mesmo `MenuProduct.active` do ⏸ do painel (PUT api/admin/menu-products):
 * vale para o item avulso e para a opção dentro de todo combo, em todos os
 * canais (lib/opcao-pausada.ts). E leva junto o que aquela rota leva:
 *   - a meia pizza do mesmo sabor ("1/2 CALABRESA") pausa e volta com a
 *     inteira (Pizzaria Lapastine, 08/10/2026); pausar só a meia continua
 *     valendo sozinho;
 *   - a vitrine é revalidada na hora (o cache é de 60 s).
 *
 * Quem usa: o Bill (lib/assessor/cardapio.ts) e a pausa pelo estoque
 * (lib/pausa-pelo-estoque-no-banco.ts). O PUT do painel grava junto com os
 * outros campos do produto e por isso segue com a cópia dele, que faz o mesmo.
 */
import { prisma } from "@/lib/prisma";
import { PREFIXO_DA_MEIA } from "@/lib/meio-a-meio";

export type ProdutoMudado = { id: string; name: string };

export async function atualizarVitrineDaLoja(franchiseeId: string) {
  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { slug: true } }).catch(() => null);
  if (loja?.slug) {
    // Import dinâmico: este arquivo chega ao boot (instrumentation.ts) e ao
    // SSR de componente cliente pelo lib/stock.ts, onde o import estático de
    // "next/cache" derruba o `next build` ("only available in Server Components").
    try {
      const { revalidatePath } = await import("next/cache");
      revalidatePath(`/loja/${loja.slug}`);
    } catch {}
  }
}

/**
 * Põe `active = ativo` nos produtos da loja que ainda não estão assim e devolve
 * os que mudaram. Os que já estavam como pedido ficam de fora (pausar o que o
 * lojista já tinha pausado não é "pausa nova").
 */
export async function mudarPausaDosProdutos(franchiseeId: string, ids: string[], ativo: boolean): Promise<ProdutoMudado[]> {
  if (!ids.length) return [];
  const mudar = await prisma.menuProduct.findMany({
    where: { id: { in: ids }, franchiseeId, active: !ativo },
    select: { id: true, name: true },
  });
  if (!mudar.length) return [];

  await prisma.menuProduct.updateMany({
    where: { id: { in: mudar.map((p) => p.id) }, franchiseeId, active: !ativo },
    data: { active: ativo },
  });

  // A meia pizza do mesmo sabor vai junto (mesma regra do PUT do painel).
  const sabores = mudar.filter((p) => p.name && !p.name.startsWith(PREFIXO_DA_MEIA));
  if (sabores.length) {
    await prisma.menuProduct.updateMany({
      where: {
        franchiseeId,
        active: !ativo,
        OR: sabores.map((p) => ({ name: { equals: PREFIXO_DA_MEIA + p.name, mode: "insensitive" as const } })),
      },
      data: { active: ativo },
    });
  }

  await atualizarVitrineDaLoja(franchiseeId);
  return mudar;
}
