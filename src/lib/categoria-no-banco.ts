/**
 * RENOMEAR CATEGORIA NO BANCO — a gravação do PUT de api/admin/categories,
 * fora da rota para o Bill renomear pelo mesmo caminho da tela
 * (lib/assessor/modulos/cardapio.ts, 18/11/2026). A regra (o plano) continua
 * em lib/categoria-renomear.ts.
 */
import { prisma } from "@/lib/prisma";
import { chaveDaCategoria, renomearNasConfigs, type PlanoDeRenomear } from "@/lib/categoria-renomear";

export type PlanoValido = Extract<PlanoDeRenomear, { nomeFinal: string }>;

// Ids dos produtos da loja nesta categoria. A comparação é sem maiúscula e sem
// espaço nas pontas, como a tela agrupa — o `equals insensitive` do Prisma não
// apara espaço, e o produto importado com "Pizzas " ficaria para trás.
export async function produtosDaCategoria(loja: string, nome: string): Promise<string[]> {
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId: loja },
    select: { id: true, category: true },
  });
  const chave = chaveDaCategoria(nome);
  return produtos.filter((p) => chaveDaCategoria(p.category) === chave).map((p) => p.id);
}

// Impressora por categoria, telas do KDS e "só na finalização" guardam a
// categoria pelo NOME: sem isto, renomear tirava a categoria da impressora e
// da tela da cozinha sem ninguém perceber.
export async function renomearNasConfigsDaLoja(tx: any, loja: string, antigo: string, novo: string) {
  if (antigo.trim() === novo.trim()) return;
  const dono = await tx.user.findUnique({
    where: { id: loja },
    select: { printerConfig: true, kdsScreens: true, kdsConfig: true },
  });
  if (!dono) return;
  const mudou = renomearNasConfigs(dono, antigo, novo);
  if (Object.keys(mudou).length === 0) return;
  await tx.user.update({ where: { id: loja }, data: mudou });
}

/**
 * Leva os produtos e as configs para o nome novo e muda (ou junta, ou cria) a
 * linha de MenuCategory, numa transação. `visual` = emoji/cor/foto/ordem que
 * vieram junto; `nova` = como nasce a linha da categoria virtual.
 */
export async function gravarRenomeioDaCategoria(
  loja: string,
  plano: PlanoValido,
  visual: Record<string, unknown>,
  nova: { emoji?: string; color?: string; imageUrl?: string | null; sortOrder: number }
) {
  const ids = await produtosDaCategoria(loja, plano.nomeAntigo);

  const categoria = await prisma.$transaction(async (tx) => {
    if (ids.length > 0) {
      await tx.menuProduct.updateMany({ where: { id: { in: ids }, franchiseeId: loja }, data: { category: plano.nomeFinal } });
    }
    await renomearNasConfigsDaLoja(tx, loja, plano.nomeAntigo, plano.nomeFinal);

    if (plano.juntarEm) {
      if (plano.apagarId) await tx.menuCategory.delete({ where: { id: plano.apagarId } });
      return tx.menuCategory.findUnique({ where: { id: plano.juntarEm } });
    }
    if (plano.renomearId) {
      return tx.menuCategory.update({ where: { id: plano.renomearId }, data: { ...visual, name: plano.nomeFinal } });
    }
    // Virtual: nasce a linha, no lugar em que a tela já mostrava a categoria.
    return tx.menuCategory.create({
      data: {
        name: plano.nomeFinal,
        emoji: nova.emoji || "🍽️",
        color: nova.color || "#64748B",
        imageUrl: nova.imageUrl ?? null,
        sortOrder: nova.sortOrder,
        franchiseeId: loja,
      },
    });
  });

  return { categoria, ids };
}
