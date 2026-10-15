/**
 * A SUBIDA na nuvem: abre a transação do Prisma e aplica o lote linha por
 * linha (subida-linha-a-linha.ts — cada linha num SAVEPOINT: a que o banco da
 * nuvem recusar vira conflito "recusada" e não trava as outras).
 */
import { prisma } from "@/lib/prisma";
import { colunasDaTabela } from "./servidor";
import { aplicarLote, type BancoDaSubida, type ResultadoDaSubida } from "./subida-linha-a-linha";
import type { LinhaDaSaida } from "./mescla";

export type { ResultadoDaSubida };

export async function aplicarSubida(
  lojaId: string,
  banco: string,
  lote: LinhaDaSaida[],
  episodio: { inicio: string; fim: string | null } | null,
  final: boolean,
): Promise<ResultadoDaSubida> {
  return prisma.$transaction(
    async (tx) => {
      const db: BancoDaSubida = {
        consultar: <T,>(sql: string, ...valores: unknown[]) => tx.$queryRawUnsafe<T[]>(sql, ...valores),
        executar: (sql, ...valores) => tx.$executeRawUnsafe(sql, ...valores),
        colunas: colunasDaTabela,
      };
      return aplicarLote(db, lojaId, banco, lote, episodio, final);
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}
