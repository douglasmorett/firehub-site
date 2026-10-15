/**
 * A VOLTA, do lado do computador: manda a saída para a nuvem em lotes, em
 * ordem, e apaga só o que a nuvem confirmou (`aplicadoAte`). Se a conexão
 * cair no meio, a próxima rodada manda de novo — a nuvem pula o que já entrou.
 */
import type pg from "pg";
import type { Nuvem } from "./nuvem";
import { idDoBanco } from "./esquema";

const LOTE = 200;

/**
 * Quantas subidas seguidas podem falhar no modo "voltando" antes de o
 * supervisor desistir de ESPERAR por elas. Sem isto, uma subida que nunca
 * passa (achado volta-1) deixava a loja em "voltando" para sempre: as telas
 * presas na cópia congelada, sem o pedido novo do iFood e do site. Desistir
 * não apaga nada — a saída fica guardada e segue subindo no modo normal.
 */
export const FALHAS_DA_SUBIDA_ATE_DESISTIR = 5;

export type PassoDaVolta =
  /** Tudo subiu: modo normal. */
  | "normal"
  /** Falhou de novo, e já são FALHAS_DA_SUBIDA_ATE_DESISTIR: modo normal com a saída guardada e o erro à vista. */
  | "normal-com-pendentes"
  /** Ainda há o que subir: continua voltando. */
  | "seguir-voltando";

/** Depois de cada tentativa de subida no modo "voltando": o que o supervisor faz. */
export function passoDaVolta(r: { subiu: boolean; falhasSeguidas: number; pendentes: number }): PassoDaVolta {
  if (r.subiu && r.pendentes === 0) return "normal";
  if (!r.subiu && r.falhasSeguidas >= FALHAS_DA_SUBIDA_ATE_DESISTIR) return "normal-com-pendentes";
  return "seguir-voltando";
}

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
    const resposta = await nuvem.enviar<{
      aplicadoAte: string;
      aplicadas: number;
      conflitos: number;
      recusadas: { tabela: string; registro?: string; motivo: string }[];
    }>(
      "/api/contingencia/subida",
      { banco, lote: r.rows, episodio, final },
      120_000,
    );
    await pool.query(`DELETE FROM "_ContingenciaSaida" WHERE "seq" <= $1::bigint`, [resposta.aplicadoAte]);
    total.subiram += resposta.aplicadas;
    total.conflitos += resposta.conflitos;
    total.recusadas += resposta.recusadas.length;
    // A linha recusada não volta mais (a nuvem já avançou o cursor): fica
    // registrada aqui e no painel do módulo, como conflito "recusada".
    for (const r of resposta.recusadas.slice(0, 5)) registro(`Volta: recusada ${r.tabela}${r.registro ? ` ${r.registro}` : ""} — ${r.motivo}`);
    if (final) break;
  }
  const resto = await pool.query(`SELECT COUNT(*)::int AS n FROM "_ContingenciaSaida"`);
  total.restam = resto.rows[0]?.n ?? 0;
  if (total.subiram || total.recusadas) {
    registro(`Volta: ${total.subiram} mudança(s) subiram, ${total.conflitos} conflito(s), ${total.recusadas} recusada(s), ${total.restam} na fila.`);
  }
  return total;
}
