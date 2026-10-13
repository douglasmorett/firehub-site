/**
 * O esquema do banco da cópia: o mesmo da nuvem (GET /api/contingencia/esquema),
 * sem chave estrangeira — a cópia é parcial, e o computador não pode recusar
 * pedido por causa de uma linha que ficou na nuvem.
 *
 * Mais a SAÍDA da contingência: um gatilho em cada tabela anota toda linha
 * que o FireHub local grava, apaga ou muda ("_ContingenciaSaida"), com o
 * antes e o depois. É ela que sobe quando a conexão volta. A cópia que desce
 * grava com `session_replication_role = replica` e não passa pelos gatilhos —
 * só o que a loja fez entra na saída.
 */
import crypto from "node:crypto";
import type pg from "pg";

export type EsquemaDoBanco = {
  colunas: { tabela: string; coluna: string; tipo: string; obrigatoria: boolean; padrao: string | null }[];
  restricoes: { tabela: string; nome: string; tipo: "p" | "u"; definicao: string }[];
  indices: { tabela: string; nome: string; definicao: string }[];
  sequencias: string[];
  /** As tabelas cuja gravação sobe na volta (nuvem antiga não manda: vigia todas). */
  tabelasQueSobem?: string[];
};

const q = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

export function hashDoEsquema(e: EsquemaDoBanco): string {
  return crypto.createHash("sha256").update(JSON.stringify(e)).digest("hex").slice(0, 16);
}

/** Erros de "isso já existe": a criação é idempotente, eles não contam. */
function jaExiste(e: any): boolean {
  return ["42P07", "42710", "42P16", "42701", "23505"].includes(e?.code);
}

export async function aplicarEsquema(pool: pg.Pool, esquema: EsquemaDoBanco, registro: (l: string) => void): Promise<void> {
  const porTabela = new Map<string, EsquemaDoBanco["colunas"]>();
  for (const c of esquema.colunas) {
    if (!porTabela.has(c.tabela)) porTabela.set(c.tabela, []);
    porTabela.get(c.tabela)!.push(c);
  }

  for (const s of esquema.sequencias) await pool.query(`CREATE SEQUENCE IF NOT EXISTS ${q(s)}`);

  const existentes = new Map<string, Set<string>>();
  const r = await pool.query(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  for (const linha of r.rows) {
    if (!existentes.has(linha.t)) existentes.set(linha.t, new Set());
    existentes.get(linha.t)!.add(linha.c);
  }

  for (const [tabela, colunas] of porTabela) {
    const ja = existentes.get(tabela);
    if (!ja) {
      const defs = colunas.map(
        (c) => `${q(c.coluna)} ${c.tipo}${c.padrao ? ` DEFAULT ${c.padrao}` : ""}${c.obrigatoria ? " NOT NULL" : ""}`,
      );
      await pool.query(`CREATE TABLE IF NOT EXISTS ${q(tabela)} (${defs.join(", ")})`);
      continue;
    }
    for (const c of colunas) {
      if (ja.has(c.coluna)) continue;
      // Coluna nova numa tabela com linhas: obrigatória só se tiver padrão.
      const obrigatoria = c.obrigatoria && c.padrao ? " NOT NULL" : "";
      await pool.query(`ALTER TABLE ${q(tabela)} ADD COLUMN IF NOT EXISTS ${q(c.coluna)} ${c.tipo}${c.padrao ? ` DEFAULT ${c.padrao}` : ""}${obrigatoria}`);
    }
  }

  for (const rest of esquema.restricoes) {
    try {
      await pool.query(`ALTER TABLE ${q(rest.tabela)} ADD CONSTRAINT ${q(rest.nome)} ${rest.definicao}`);
    } catch (e: any) {
      if (!jaExiste(e)) registro(`Restrição ${rest.nome}: ${e?.message}`);
    }
  }
  for (const ind of esquema.indices) {
    const sql = ind.definicao.replace(/^CREATE (UNIQUE )?INDEX /, (_m, u) => `CREATE ${u || ""}INDEX IF NOT EXISTS `);
    try {
      await pool.query(sql);
    } catch (e: any) {
      if (!jaExiste(e)) registro(`Índice ${ind.nome}: ${e?.message}`);
    }
  }

  await garantirSaida(pool, porTabela, esquema.tabelasQueSobem ? new Set(esquema.tabelasQueSobem) : null);
}

/**
 * A tabela de saída e um gatilho em cada tabela que sobe na volta. Fora delas,
 * o que o FireHub local grava (ex.: o CrmConfig que ele cria ao ligar) fica só
 * no computador — subir seria recusado e viraria aviso falso para o dono.
 */
async function garantirSaida(
  pool: pg.Pool,
  porTabela: Map<string, EsquemaDoBanco["colunas"]>,
  queSobem: Set<string> | null,
): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS "_ContingenciaSaida" (
    "seq" BIGSERIAL PRIMARY KEY,
    "tabela" TEXT NOT NULL,
    "registro" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "em" TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // A identidade deste banco: a nuvem conta "até onde subiu" por banco, e uma
  // cópia recriada recomeça a numeração da saída.
  await pool.query(`CREATE TABLE IF NOT EXISTS "_ContingenciaBanco" ("id" TEXT PRIMARY KEY)`);
  await pool.query(`INSERT INTO "_ContingenciaBanco" ("id") SELECT gen_random_uuid()::text WHERE NOT EXISTS (SELECT 1 FROM "_ContingenciaBanco")`);
  await pool.query(`CREATE OR REPLACE FUNCTION "_contingencia_saida"() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  linha jsonb;
  registro text;
BEGIN
  IF TG_OP = 'DELETE' THEN linha := to_jsonb(OLD); ELSE linha := to_jsonb(NEW); END IF;
  IF TG_NARGS = 1 THEN
    registro := linha ->> TG_ARGV[0];
  ELSE
    registro := json_build_array(linha ->> TG_ARGV[0], linha ->> TG_ARGV[1])::text;
  END IF;
  INSERT INTO "_ContingenciaSaida" ("tabela", "registro", "operacao", "antes", "depois")
  VALUES (TG_TABLE_NAME, registro, TG_OP,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;
END
$fn$`);
  for (const [tabela, colunas] of porTabela) {
    if (queSobem && !queSobem.has(tabela)) {
      await pool.query(`DROP TRIGGER IF EXISTS "contingencia_saida" ON ${q(tabela)}`);
      continue;
    }
    const nomes = new Set(colunas.map((c) => c.coluna));
    let chave: string[] | null = null;
    if (nomes.has("id")) chave = ["id"];
    else if (tabela === "DailyOrderCounter") chave = ["franchiseeId", "dateKey"];
    if (!chave) continue;
    await pool.query(
      `CREATE OR REPLACE TRIGGER "contingencia_saida" AFTER INSERT OR UPDATE OR DELETE ON ${q(tabela)}
       FOR EACH ROW EXECUTE FUNCTION "_contingencia_saida"(${chave.map((c) => `'${c}'`).join(", ")})`,
    );
  }
}

/** Quantas linhas esperam para subir. */
export async function pendentesNaSaida(pool: pg.Pool): Promise<number> {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM "_ContingenciaSaida"`);
    return r.rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function idDoBanco(pool: pg.Pool): Promise<string> {
  const r = await pool.query(`SELECT "id" FROM "_ContingenciaBanco" LIMIT 1`);
  return r.rows[0]?.id || "";
}
