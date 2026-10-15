/**
 * A CÓPIA: a foto inicial e o espelho contínuo da nuvem para o banco do
 * computador da loja (lib/contingencia/catalogo.ts diz o que entra).
 *
 * Grava com `session_replication_role = replica`: o gatilho da SAÍDA não
 * dispara (o que desce da nuvem não sobe de volta) e nada de chave
 * estrangeira atrapalha a ordem das tabelas.
 *
 * Coluna que não desce (senha, chave de fora) e é obrigatória no banco
 * ganha um valor de enfeite — senha vazia não abre nada; quem entra no
 * computador da loja é o bilhete.
 */
import type pg from "pg";
import { TABELAS_DA_COPIA } from "../../src/lib/contingencia/catalogo";
import type { Nuvem } from "./nuvem";

const q = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

type ColunaLocal = { nome: string; tipo: string; obrigatoria: boolean; temPadrao: boolean };
const colunasEmCache = new Map<string, ColunaLocal[]>();

async function colunasLocais(c: pg.PoolClient | pg.Pool, tabela: string): Promise<ColunaLocal[]> {
  const ja = colunasEmCache.get(tabela);
  if (ja) return ja;
  const r = await c.query(
    `SELECT column_name AS nome, data_type AS tipo, is_nullable = 'NO' AS obrigatoria, column_default IS NOT NULL AS "temPadrao"
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [tabela],
  );
  colunasEmCache.set(tabela, r.rows);
  return r.rows;
}

export function esquecerColunas(): void {
  colunasEmCache.clear();
}

function enfeite(tipo: string): unknown {
  if (/json/.test(tipo)) return {};
  if (/int|numeric|double|real|decimal/.test(tipo)) return 0;
  if (tipo === "boolean") return false;
  if (/timestamp|date/.test(tipo)) return new Date().toISOString();
  if (tipo === "ARRAY") return [];
  return "";
}

/** Grava (insere ou atualiza) as linhas de uma tabela, na transação dada. */
export async function gravarLinhas(c: pg.PoolClient, tabela: string, chave: string[], linhas: Record<string, unknown>[]): Promise<number> {
  if (!linhas.length) return 0;
  const colunas = await colunasLocais(c, tabela);
  if (!colunas.length) return 0;
  const obrigatorias = colunas.filter((x) => x.obrigatoria && !x.temPadrao);
  // A mesma linha duas vezes no lote faria o ON CONFLICT reclamar: vale a última.
  const porChave = new Map<string, Record<string, unknown>>();
  for (const linha of linhas) {
    const l = { ...linha };
    for (const o of obrigatorias) if (l[o.nome] === undefined || l[o.nome] === null) l[o.nome] = enfeite(o.tipo);
    porChave.set(JSON.stringify(chave.map((k) => l[k])), l);
  }
  const resto = colunas.map((x) => x.nome).filter((n) => !chave.includes(n));
  const atualizar = resto.length
    ? `DO UPDATE SET (${resto.map(q).join(", ")}) = ROW(${resto.map((n) => `EXCLUDED.${q(n)}`).join(", ")})`
    : "DO NOTHING";
  await c.query(
    `INSERT INTO ${q(tabela)} SELECT * FROM jsonb_populate_recordset(NULL::${q(tabela)}, $1::jsonb)
     ON CONFLICT (${chave.map(q).join(", ")}) ${atualizar}`,
    [JSON.stringify([...porChave.values()])],
  );
  return porChave.size;
}

export async function apagarRegistros(c: pg.PoolClient, tabela: string, chave: string[], registros: string[]): Promise<void> {
  if (!registros.length || !(await colunasLocais(c, tabela)).length) return;
  if (chave.length === 1) {
    await c.query(`DELETE FROM ${q(tabela)} WHERE ${q(chave[0])}::text = ANY($1::text[])`, [registros]);
    return;
  }
  await c.query(
    `DELETE FROM ${q(tabela)} WHERE jsonb_build_array(${chave.map(q).join(", ")}) = ANY($1::jsonb[])`,
    [registros],
  );
}

async function emTransacaoDeCopia<T>(pool: pg.Pool, fazer: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    const r = await fazer(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * A foto inteira da loja. Só com a saída vazia: apaga a cópia anterior
 * dessas tabelas e grava a de agora. Devolve o cursor do diário.
 */
export async function fazerFoto(
  pool: pg.Pool,
  nuvem: Nuvem,
  registro: (l: string) => void,
  apenas?: (nome: string) => boolean,
): Promise<string> {
  const inicio = await nuvem.json<{ cursor: string; tabelas: { nome: string; chave: string[] }[] }>("/api/contingencia/foto");
  let total = 0;
  const feitas: string[] = [];
  for (const t of inicio.tabelas) {
    if (apenas && !apenas(t.nome)) continue;
    feitas.push(t.nome);
    const linhas: Record<string, unknown>[] = [];
    let depoisDe: string | null = null;
    do {
      const pagina: { linhas: Record<string, unknown>[]; proximo: string | null } = await nuvem.json(
        `/api/contingencia/foto?tabela=${encodeURIComponent(t.nome)}${depoisDe ? `&depoisDe=${encodeURIComponent(depoisDe)}` : ""}`,
      );
      linhas.push(...pagina.linhas);
      depoisDe = pagina.proximo;
    } while (depoisDe);
    await emTransacaoDeCopia(pool, async (c) => {
      if (!apenas && (await colunasLocais(c, t.nome)).length) await c.query(`DELETE FROM ${q(t.nome)}`);
      for (let i = 0; i < linhas.length; i += 500) await gravarLinhas(c, t.nome, t.chave, linhas.slice(i, i + 500));
    });
    total += linhas.length;
  }
  // Com `apenas` é a atualização de hora em hora (só os cadastros de clientes,
  // sem apagar nada): dizer "Foto da loja" com o total de tabelas da cópia
  // fazia parecer que a cópia inteira tinha só essas linhas (achado foto-1).
  registro(
    apenas
      ? `Foto de hora em hora dos clientes (${feitas.join(", ") || "nenhuma tabela"}): ${total} cadastro(s) — não é a cópia inteira, que segue pelo espelho.`
      : `Foto da loja: ${total} linhas em ${feitas.length} tabelas.`,
  );
  return inicio.cursor;
}

type RespostaDoEspelho = {
  ate?: string;
  linhas?: Record<string, Record<string, unknown>[]>;
  apagados?: Record<string, string[]>;
  mais?: boolean;
  refazerFoto?: boolean;
};

/** Traz tudo o que mudou desde `cursor`. Devolve o novo cursor, ou `null` se precisa de foto. */
export async function puxarEspelho(pool: pg.Pool, nuvem: Nuvem, cursor: string): Promise<{ cursor: string; linhas: number } | null> {
  let atual = cursor;
  let linhas = 0;
  for (let voltas = 0; voltas < 20; voltas++) {
    const r = await nuvem.json<RespostaDoEspelho>(`/api/contingencia/espelho?desde=${encodeURIComponent(atual)}`, { prazoMs: 20_000 });
    if (r.refazerFoto) return null;
    await emTransacaoDeCopia(pool, async (c) => {
      for (const t of TABELAS_DA_COPIA) {
        const novas = r.linhas?.[t.nome];
        if (novas?.length) linhas += await gravarLinhas(c, t.nome, t.chave, novas);
      }
      for (const t of TABELAS_DA_COPIA) {
        const fora = r.apagados?.[t.nome];
        if (fora?.length) await apagarRegistros(c, t.nome, t.chave, fora);
      }
    });
    atual = r.ate || atual;
    if (!r.mais) break;
  }
  return { cursor: atual, linhas };
}
