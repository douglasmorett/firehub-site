/**
 * O ESTOQUE IDEAL do insumo (`StockItem.idealQuantity`): até quanto a lista de
 * compras compra (lib/relatorios/sugestao-de-compras.ts).
 *
 * A coluna nasce no boot (lib/cmv/estrutura-no-banco.ts) e entra no
 * schema.prisma no mesmo commit. Lida e gravada por SQL, não pelo cliente do
 * Prisma: funciona igual com o cliente gerado antes e depois da coluna, e a
 * falta dela (boot que não rodou) não derruba o estoque — a leitura volta
 * vazia e a lista sugere o ideal pelo consumo.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lerNumeroBr } from "@/lib/cmv/numero";

/** insumoId → ideal (só os que têm). */
export async function idealDosInsumos(ids: string[]): Promise<Map<string, number>> {
  const saida = new Map<string, number>();
  if (!ids.length) return saida;
  try {
    for (let i = 0; i < ids.length; i += 1000) {
      const lote = ids.slice(i, i + 1000);
      const linhas = await prisma.$queryRaw<{ id: string; ideal: number | null }[]>`
        SELECT "id", "idealQuantity" AS ideal FROM "StockItem" WHERE "id" IN (${Prisma.join(lote)})`;
      for (const l of linhas) if (l.ideal != null && Number(l.ideal) > 0) saida.set(l.id, Number(l.ideal));
    }
  } catch (err: any) {
    console.warn(`[Estoque] Não li o estoque ideal (coluna ainda não criada?): ${err?.message}`);
  }
  return saida;
}

/** O ideal que veio da tela: texto pt-BR ("2,5"); vazio ou zero = sem ideal (volta a sugerir pelo consumo). */
export function lerIdeal(bruto: unknown): { ideal: number | null } | { erro: string } {
  if (bruto === "" || bruto === null || bruto === undefined) return { ideal: null };
  const n = lerNumeroBr(bruto);
  if (!Number.isFinite(n) || n < 0) return { erro: "Estoque ideal inválido." };
  return { ideal: n > 0 ? n : null };
}

/** Grava o ideal do insumo, só se ele for de uma das lojas. Devolve se achou o insumo. */
export async function gravarIdeal(lojaIds: string[], insumoId: string, ideal: number | null): Promise<boolean> {
  if (!lojaIds.length || !insumoId) return false;
  const n = await prisma.$executeRaw`
    UPDATE "StockItem" SET "idealQuantity" = ${ideal}, "updatedAt" = NOW()
    WHERE "id" = ${insumoId} AND "franchiseeId" IN (${Prisma.join(lojaIds)})`;
  return n > 0;
}
