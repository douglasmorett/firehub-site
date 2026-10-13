/**
 * O lado da NUVEM da cópia (Modo Contingência): quem é a loja pela chave, as
 * linhas de cada tabela com as colunas que podem descer, a foto inicial, o
 * diário de mudanças e o esquema do banco para o computador montar o dele.
 * Obsidian: Projetos/FireHub - Modo Contingência.md, item 2.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { colunasQueNaoDescem, sobeNaVolta, TABELAS_DA_COPIA, type TabelaDaCopia } from "./catalogo";
import { hashDaChave } from "./chave";

const q = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

export type LojaDaChave = { lojaId: string; segredoDoBilhete: string };

/**
 * Quem já se identificou há pouco: a primeira instalação baixa milhares de
 * arquivos do pacote, e cada pedido iria ao banco. 1 minuto — desativar a
 * contingência leva no máximo isso para valer em todos os pedidos.
 */
const chavesEmCache = new Map<string, { loja: LojaDaChave | null; em: number }>();

/** A loja dona da chave (`Authorization: Bearer <chave>`), ou `null`. */
export async function lojaDaChave(req: NextRequest): Promise<LojaDaChave | null> {
  const cabecalho = req.headers.get("authorization") || "";
  const chave = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
  if (chave.length < 20) return null;
  const hash = hashDaChave(chave);
  const visto = chavesEmCache.get(hash);
  if (visto && Date.now() - visto.em < 60_000) return visto.loja;
  const r = await prisma.$queryRawUnsafe<LojaDaChave[]>(
    `SELECT "lojaId", "segredoDoBilhete" FROM "Contingencia" WHERE "chaveHash" = $1`,
    hash,
  );
  const loja = r[0] || null;
  if (chavesEmCache.size > 500) chavesEmCache.clear();
  chavesEmCache.set(hash, { loja, em: Date.now() });
  return loja;
}

const colunasEmCache = new Map<string, { colunas: string[]; em: number }>();

/** As colunas da tabela na nuvem (cache de 5 min: o esquema muda só no deploy). */
export async function colunasDaTabela(tabela: string): Promise<string[]> {
  const c = colunasEmCache.get(tabela);
  if (c && Date.now() - c.em < 5 * 60_000) return c.colunas;
  const r = await prisma.$queryRawUnsafe<{ coluna: string }[]>(
    `SELECT column_name AS coluna FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    tabela,
  );
  const colunas = r.map((x) => x.coluna);
  colunasEmCache.set(tabela, { colunas, em: Date.now() });
  return colunas;
}

async function existe(tabela: string): Promise<boolean> {
  return (await colunasDaTabela(tabela)).length > 0;
}

/** `to_jsonb(t)` sem as colunas que não descem. */
async function linhaQueDesce(t: TabelaDaCopia): Promise<string> {
  const fora = colunasQueNaoDescem(t, await colunasDaTabela(t.nome));
  if (!fora.length) return `to_jsonb(t)`;
  return `to_jsonb(t) - ARRAY[${fora.map((c) => `'${c.replace(/'/g, "''")}'`).join(", ")}]::text[]`;
}

/** Filtro padrão da loja quando a tabela não tem recorte de foto próprio. */
function filtroDaLoja(t: TabelaDaCopia): string {
  if (t.foto) return `(${t.foto})`;
  const l = t.loja;
  if (l.tipo === "coluna") return l.tambem ? `(t.${q(l.coluna)} = $1 OR t.${q(l.tambem)} = $1)` : `t.${q(l.coluna)} = $1`;
  if (l.tipo === "usuario") return `(t.id = $1 OR t."ownerId" = $1)`;
  throw new Error(`Tabela ${t.nome} precisa de recorte de foto.`);
}

/**
 * Uma página da foto inicial de uma tabela. Tabela de chave simples pagina
 * pelo `id` (`depoisDe`); a de chave composta é pequena e vem inteira.
 */
export async function paginaDaFoto(
  t: TabelaDaCopia,
  lojaId: string,
  depoisDe: string | null,
  limite: number,
): Promise<{ linhas: Record<string, unknown>[]; proximo: string | null }> {
  if (!(await existe(t.nome))) return { linhas: [], proximo: null };
  const selecao = await linhaQueDesce(t);
  const simples = t.chave.length === 1;
  const ordem = simples ? `ORDER BY t.${q(t.chave[0])}` : "";
  const pagina = simples && depoisDe ? `AND t.${q(t.chave[0])} > $2` : "";
  const parametros: unknown[] = [lojaId];
  if (simples && depoisDe) parametros.push(depoisDe);
  const r = await prisma.$queryRawUnsafe<{ linha: Record<string, unknown> }[]>(
    `SELECT ${selecao} AS linha FROM ${q(t.nome)} t WHERE ${filtroDaLoja(t)} ${pagina} ${ordem} ${simples ? `LIMIT ${Math.max(1, Math.min(limite, 2000))}` : ""}`,
    ...parametros,
  );
  const linhas = r.map((x) => x.linha);
  const proximo = simples && linhas.length >= limite ? String(linhas[linhas.length - 1][t.chave[0]]) : null;
  return { linhas, proximo };
}

/** As linhas atuais destes registros (o que não voltar foi apagado). */
export async function linhasDosRegistros(t: TabelaDaCopia, registros: string[]): Promise<Record<string, unknown>[]> {
  if (!registros.length || !(await existe(t.nome))) return [];
  const selecao = await linhaQueDesce(t);
  if (t.chave.length === 1) {
    const r = await prisma.$queryRawUnsafe<{ linha: Record<string, unknown> }[]>(
      `SELECT ${selecao} AS linha FROM ${q(t.nome)} t WHERE t.${q(t.chave[0])}::text = ANY($1::text[])`,
      registros,
    );
    return r.map((x) => x.linha);
  }
  // Chave composta: o registro é o `json_build_array(...)::text` que o
  // gatilho gravou — a mesma expressão aqui dá o mesmo texto.
  const colunas = t.chave.map((c) => `t.${q(c)}`).join(", ");
  const r = await prisma.$queryRawUnsafe<{ linha: Record<string, unknown> }[]>(
    `SELECT ${selecao} AS linha FROM ${q(t.nome)} t
      WHERE json_build_array(${colunas})::text = ANY($1::text[])`,
    registros,
  );
  return r.map((x) => x.linha);
}

/** O número da última anotação do diário (para a foto saber de onde a cópia continua). */
export async function ultimaMudanca(lojaId: string): Promise<string> {
  const r = await prisma.$queryRawUnsafe<{ id: string | null }[]>(
    `SELECT MAX("id")::text AS id FROM "ContingenciaMudanca" WHERE "lojaId" = $1`,
    lojaId,
  );
  return r[0]?.id || "0";
}

/** As anotações do diário depois de `desde`, em ordem. */
export async function mudancasDesde(
  lojaId: string,
  desde: string,
  limite: number,
): Promise<{ id: string; tabela: string; registro: string }[]> {
  return prisma.$queryRawUnsafe(
    `SELECT "id"::text AS id, "tabela", "registro" FROM "ContingenciaMudanca"
      WHERE "lojaId" = $1 AND "id" > $2::bigint ORDER BY "id" LIMIT ${Math.max(1, Math.min(limite, 5000))}`,
    lojaId,
    desde || "0",
  );
}

/** A menor anotação ainda guardada (para saber se a cópia ficou tempo demais sem perguntar). */
export async function primeiraMudancaGuardada(lojaId: string): Promise<string | null> {
  const r = await prisma.$queryRawUnsafe<{ id: string | null }[]>(
    `SELECT MIN("id")::text AS id FROM "ContingenciaMudanca" WHERE "lojaId" = $1`,
    lojaId,
  );
  return r[0]?.id || null;
}

export type EsquemaDoBanco = {
  colunas: { tabela: string; coluna: string; tipo: string; obrigatoria: boolean; padrao: string | null }[];
  restricoes: { tabela: string; nome: string; tipo: "p" | "u"; definicao: string }[];
  indices: { tabela: string; nome: string; definicao: string }[];
  sequencias: string[];
  /** Só nestas o computador anota o que a loja grava (o resto a volta recusaria). */
  tabelasQueSobem: string[];
};

/**
 * O esquema do banco da nuvem, para o computador da loja montar o dele igual
 * (tabelas, colunas, chaves, índices). Sem chave estrangeira: a cópia é
 * parcial e o computador não pode recusar pedido por causa de uma linha que
 * ficou na nuvem. Sem as tabelas da própria contingência.
 */
export async function esquemaDoBanco(): Promise<EsquemaDoBanco> {
  const colunas = await prisma.$queryRawUnsafe<EsquemaDoBanco["colunas"]>(`
    SELECT c.relname AS tabela, a.attname AS coluna, format_type(a.atttypid, a.atttypmod) AS tipo,
           a.attnotnull AS obrigatoria, pg_get_expr(d.adbin, d.adrelid) AS padrao
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
       AND c.relname NOT LIKE 'Contingencia%' AND c.relname <> '_prisma_migrations'
     ORDER BY c.relname, a.attnum`);
  const restricoes = await prisma.$queryRawUnsafe<EsquemaDoBanco["restricoes"]>(`
    SELECT c.relname AS tabela, con.conname AS nome, con.contype::text AS tipo, pg_get_constraintdef(con.oid) AS definicao
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND con.contype IN ('p', 'u') AND c.relname NOT LIKE 'Contingencia%'`);
  const indices = await prisma.$queryRawUnsafe<EsquemaDoBanco["indices"]>(`
    SELECT i.tablename AS tabela, i.indexname AS nome, i.indexdef AS definicao
      FROM pg_indexes i
     WHERE i.schemaname = 'public' AND i.tablename NOT LIKE 'Contingencia%'
       AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conname = i.indexname)`);
  const seq = await prisma.$queryRawUnsafe<{ nome: string }[]>(
    `SELECT sequencename AS nome FROM pg_sequences WHERE schemaname = 'public' AND sequencename NOT LIKE 'Contingencia%'`,
  );
  return {
    colunas,
    restricoes,
    indices,
    sequencias: seq.map((s) => s.nome),
    tabelasQueSobem: TABELAS_DA_COPIA.filter(sobeNaVolta).map((t) => t.nome),
  };
}
