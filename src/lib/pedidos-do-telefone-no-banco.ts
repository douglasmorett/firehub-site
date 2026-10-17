/**
 * A busca de pedidos por telefone, no Postgres — a regra está em
 * lib/pedidos-do-telefone.ts (`mesmoTelefoneDoCardapio`).
 *
 * ── Por que SQL cru, e por que não pesa ──────────────────────────────────────
 *
 * "Só os dígitos" não se escreve no `where` do Prisma: é preciso o
 * `regexp_replace` do Postgres. A consulta devolve só os ids (do mais novo
 * para o mais velho, com teto), e o Prisma lê os campos depois por id — o
 * mesmo desenho de lib/cashback-no-banco.ts.
 *
 * O índice de `franchiseeId` corta para os pedidos DA LOJA, e o filtro roda
 * só sobre eles. Medido no Neon em 17/10/2026 (Pizzaria Lapastine, 102
 * pedidos): 0,30 ms com a busca nova, 0,18 ms com a antiga — as duas leem as
 * mesmas 101 páginas do índice; a diferença é o regexp em cada linha da loja.
 * Coluna normalizada com índice só valeria a pena com dezenas de milhares de
 * pedidos por loja.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { finalDoTelefone } from "./pedidos-do-telefone";

/** Os ids dos pedidos deste telefone nesta loja, do mais novo para o mais velho. */
export async function idsDosPedidosDoTelefone(
  franchiseeId: string,
  telefone: string,
  limite: number,
  excetoIds: string[] = [],
): Promise<string[]> {
  const final = finalDoTelefone(telefone);
  if (!final || !franchiseeId) return [];
  const fora = excetoIds.filter(Boolean);
  const linhas = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "CustomerOrder"
    WHERE "franchiseeId" = ${franchiseeId}
      AND regexp_replace(COALESCE("customerPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + final}
      ${fora.length ? Prisma.sql`AND "id" NOT IN (${Prisma.join(fora)})` : Prisma.empty}
    ORDER BY "createdAt" DESC
    LIMIT ${Math.max(1, Math.floor(limite))}`);
  return linhas.map((l) => l.id);
}

/**
 * Os pedidos deste telefone nesta loja, do jeito que o cardápio procura — para
 * o `where` de um `findMany` (que continua dizendo a ordem e o que ler).
 * `limite` é o teto da lista: passe o mesmo `take` da consulta.
 */
export async function ondeEstaoOsPedidosDoTelefone(
  franchiseeId: string,
  telefone: string,
  limite: number,
  excetoIds: string[] = [],
): Promise<Prisma.CustomerOrderWhereInput> {
  const ids = await idsDosPedidosDoTelefone(franchiseeId, telefone, limite, excetoIds);
  return { franchiseeId, id: { in: ids } };
}
