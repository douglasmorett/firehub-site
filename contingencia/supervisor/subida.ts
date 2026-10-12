/**
 * A VOLTA, do lado do computador: manda a saída para a nuvem em lotes, em
 * ordem, e apaga só o que a nuvem confirmou (`aplicadoAte`). Se a conexão
 * cair no meio, a próxima rodada manda de novo — a nuvem pula o que já entrou.
 */
import type pg from "pg";
import type { Nuvem } from "./nuvem";
import { idDoBanco } from "./esquema";

const LOTE = 200;

export type ResultadoDaVolta = { subiram: number; conflitos: number; recusadas: number; restam: number };

export async function subirSaida(
  pool: pg.Pool,
  nuvem: Nuvem,
  episodio: { inicio: string; fim: string | null } | null,
  registro: (l: string) => void,
): Promise<ResultadoDaVolta> {
  const banco = await idDoBanco(pool);
  const total: ResultadoDaVolta = { subiram: 0, conflitos: 0, recusadas: 0, restam: 0 };
  for (let voltas = 0; voltas < 1000; voltas++) {
    const r = await pool.query(
      `SELECT "seq"::text AS seq, "tabela", "registro", "operacao", "antes", "depois"
         FROM "_ContingenciaSaida" ORDER BY "seq" LIMIT ${LOTE}`,
    );
    if (!r.rowCount) break;
    const final = r.rowCount < LOTE;
    const resposta = await nuvem.enviar<{ aplicadoAte: string; aplicadas: number; conflitos: number; recusadas: unknown[] }>(
      "/api/contingencia/subida",
      { banco, lote: r.rows, episodio, final },
      120_000,
    );
    await pool.query(`DELETE FROM "_ContingenciaSaida" WHERE "seq" <= $1::bigint`, [resposta.aplicadoAte]);
    total.subiram += resposta.aplicadas;
    total.conflitos += resposta.conflitos;
    total.recusadas += resposta.recusadas.length;
    if (final) break;
  }
  const resto = await pool.query(`SELECT COUNT(*)::int AS n FROM "_ContingenciaSaida"`);
  total.restam = resto.rows[0]?.n ?? 0;
  if (total.subiram || total.recusadas) {
    registro(`Volta: ${total.subiram} mudança(s) subiram, ${total.conflitos} conflito(s), ${total.recusadas} recusada(s), ${total.restam} na fila.`);
  }
  return total;
}
