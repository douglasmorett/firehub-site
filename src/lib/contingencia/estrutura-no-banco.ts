/**
 * A ESTRUTURA DA CONTINGÊNCIA NO BANCO DA NUVEM (Modo Contingência).
 * Obsidian: Projetos/FireHub - Modo Contingência.md, item 2.
 *
 *   "Contingencia"         uma linha por loja ativada: hash da chave do
 *                          computador, último contato e o relato dele.
 *   "ContingenciaMudanca"  o diário da cópia: (loja, tabela, registro) de cada
 *                          linha que mudou, só das lojas ativadas. O computador
 *                          da loja pergunta "o que mudou desde o nº X?".
 *   "ContingenciaConflito" o que a loja e a nuvem mudaram ao mesmo tempo
 *                          durante uma queda, e quem ganhou.
 *   "ContingenciaEpisodio" cada queda: quando começou, quando subiu, quanto.
 *
 * O diário é escrito por GATILHO, não pelo código: muitas tabelas da operação
 * não têm `updatedAt` (item, mesa, movimento de caixa, fila de impressão) e o
 * sistema apaga linha de verdade (sem `deletedAt`). Só o gatilho vê tudo.
 *
 * ── O gatilho não pode atrapalhar NINGUÉM ───────────────────────────────────
 * Ele roda em toda gravação de todas as lojas. Por isso:
 *   - sai na hora quando a loja não tem contingência (uma consulta pela chave
 *     primária de uma tabela minúscula);
 *   - qualquer erro dentro dele é engolido (`EXCEPTION WHEN OTHERS`): um
 *     defeito aqui NUNCA pode impedir um pedido de ser gravado;
 *   - `CONTINGENCIA_SEM_GATILHOS=1` no ambiente tira todos no próximo boot.
 * No computador da loja (`FIREHUB_LOCAL=1`) nada disto roda.
 */
import { prisma } from "@/lib/prisma";
import { executarDDL } from "@/lib/ddl-do-boot";
import { TABELAS_DA_COPIA, type TabelaDaCopia } from "./catalogo";

const TABELAS = [
  `CREATE TABLE IF NOT EXISTS "Contingencia" (
    "lojaId" TEXT PRIMARY KEY,
    "chaveHash" TEXT NOT NULL,
    "segredoDoBilhete" TEXT NOT NULL,
    "ativadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ativadaPor" TEXT,
    "ultimoContato" TIMESTAMP(3),
    "relato" JSONB,
    "ultimaSubida" BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Contingencia_chaveHash_key" ON "Contingencia"("chaveHash")`,
  // Qual banco do computador subiu por último (a cópia recriada recomeça a numeração da saída).
  `ALTER TABLE "Contingencia" ADD COLUMN IF NOT EXISTS "subidaBanco" TEXT`,
  `CREATE TABLE IF NOT EXISTS "ContingenciaMudanca" (
    "id" BIGSERIAL PRIMARY KEY,
    "lojaId" TEXT NOT NULL,
    "tabela" TEXT NOT NULL,
    "registro" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "ContingenciaMudanca_lojaId_id_idx" ON "ContingenciaMudanca"("lojaId", "id")`,
  `CREATE TABLE IF NOT EXISTS "ContingenciaConflito" (
    "id" TEXT PRIMARY KEY,
    "lojaId" TEXT NOT NULL,
    "episodioId" TEXT,
    "tabela" TEXT NOT NULL,
    "registro" TEXT NOT NULL,
    "coluna" TEXT,
    "valorDaLoja" JSONB,
    "valorDaNuvem" JSONB,
    "decisao" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "ContingenciaConflito_lojaId_em_idx" ON "ContingenciaConflito"("lojaId", "em")`,
  `CREATE TABLE IF NOT EXISTS "ContingenciaEpisodio" (
    "id" TEXT PRIMARY KEY,
    "lojaId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3),
    "fim" TIMESTAMP(3),
    "subiuEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linhas" INTEGER NOT NULL DEFAULT 0,
    "pedidos" INTEGER NOT NULL DEFAULT 0,
    "conflitos" INTEGER NOT NULL DEFAULT 0,
    "resumo" JSONB
  )`,
  `CREATE INDEX IF NOT EXISTS "ContingenciaEpisodio_lojaId_idx" ON "ContingenciaEpisodio"("lojaId", "subiuEm")`,
];

const q = (nome: string) => `"${nome.replace(/"/g, '""')}"`;
const lit = (texto: string) => `'${texto.replace(/'/g, "''")}'`;

/** Nome da função de gatilho da tabela. */
export function nomeDaFuncao(t: TabelaDaCopia): string {
  return `contingencia_anota_${t.nome}`;
}

/** A expressão que identifica o registro dentro do gatilho (`linha` = NEW ou OLD). */
function registroNoGatilho(t: TabelaDaCopia): string {
  if (t.chave.length === 1) return `linha.${q(t.chave[0])}::text`;
  return `json_build_array(${t.chave.map((c) => `linha.${q(c)}`).join(", ")})::text`;
}

/** O PL/pgSQL que acha a loja da linha e a guarda em `loja` (e `loja2`, se houver). */
function lojaNoGatilho(t: TabelaDaCopia): string {
  const l = t.loja;
  switch (l.tipo) {
    case "coluna":
      return `loja := linha.${q(l.coluna)};${l.tambem ? `\n    loja2 := linha.${q(l.tambem)};` : ""}`;
    case "usuario":
      return `loja := COALESCE(linha."ownerId", linha.id);`;
    case "pai":
      return `SELECT p.${q(l.lojaDoPai)} INTO loja FROM ${q(l.tabela)} p WHERE p.id = linha.${q(l.coluna)};`;
    case "avo":
      return `SELECT a.${q(l.lojaDoAvo)} INTO loja FROM ${q(l.tabela)} p JOIN ${q(l.tabelaDoAvo)} a ON a.id = p.${q(l.colunaDoPai)} WHERE p.id = linha.${q(l.coluna)};`;
  }
}

/** A função de gatilho da tabela — gerada, para cada uma ler a sua coluna sem `to_jsonb` a cada gravação. */
export function sqlDaFuncao(t: TabelaDaCopia): string {
  const ignorar = (t.ignorarMudancaDe || []).map(lit);
  const soMudouOIgnorado = ignorar.length
    ? `
    IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - ARRAY[${ignorar.join(", ")}]::text[]) = (to_jsonb(NEW) - ARRAY[${ignorar.join(", ")}]::text[]) THEN
      RETURN NULL;
    END IF;`
    : "";
  return `CREATE OR REPLACE FUNCTION ${q(nomeDaFuncao(t))}() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  linha record;
  loja text;
  loja2 text;
BEGIN
  -- Sem nenhuma loja ativada (o normal), sai antes do bloco protegido:
  -- custo de uma consulta numa tabela vazia.
  IF NOT EXISTS (SELECT 1 FROM "Contingencia" LIMIT 1) THEN RETURN NULL; END IF;
  BEGIN
    IF TG_OP = 'DELETE' THEN linha := OLD; ELSE linha := NEW; END IF;
    ${lojaNoGatilho(t)}
    IF loja IS NOT NULL AND EXISTS (SELECT 1 FROM "Contingencia" c WHERE c."lojaId" = loja) THEN${soMudouOIgnorado}
      INSERT INTO "ContingenciaMudanca" ("lojaId", "tabela", "registro") VALUES (loja, ${lit(t.nome)}, ${registroNoGatilho(t)});
    END IF;
    IF loja2 IS NOT NULL AND loja2 IS DISTINCT FROM loja AND EXISTS (SELECT 1 FROM "Contingencia" c WHERE c."lojaId" = loja2) THEN
      INSERT INTO "ContingenciaMudanca" ("lojaId", "tabela", "registro") VALUES (loja2, ${lit(t.nome)}, ${registroNoGatilho(t)});
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- O diário da contingência nunca pode impedir a gravação de verdade.
    RETURN NULL;
  END;
  RETURN NULL;
END
$fn$`;
}

export function sqlDoGatilho(t: TabelaDaCopia): string {
  return `CREATE OR REPLACE TRIGGER "contingencia_anota" AFTER INSERT OR UPDATE OR DELETE ON ${q(t.nome)} FOR EACH ROW EXECUTE FUNCTION ${q(nomeDaFuncao(t))}()`;
}

/** As tabelas com gatilho (as globais vão só pela foto). */
export function tabelasComGatilho(): TabelaDaCopia[] {
  return TABELAS_DA_COPIA.filter((t) => !t.soPorFoto);
}

async function existeTabela(nome: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regclass($1) IS NOT NULL AS ok`, `public.${q(nome)}`);
  return r[0]?.ok === true;
}

/**
 * No boot da nuvem (src/instrumentation.ts). Nunca lança: a contingência é um
 * recurso a mais, e o site tem que subir mesmo se ela não conseguir.
 */
export async function garantirEstruturaDaContingencia(): Promise<void> {
  if (process.env.FIREHUB_LOCAL === "1") return;
  try {
    await executarDDL("contingencia-tabelas", TABELAS);

    if (process.env.CONTINGENCIA_SEM_GATILHOS === "1") {
      // Os gatilhos vão sair: o grupo que os cria não pode mais ser pulado
      // quando a contingência voltar (lib/ddl-do-boot.ts guarda o hash).
      await prisma.$executeRawUnsafe(`DELETE FROM "BootDDL" WHERE "nome" = 'contingencia-gatilhos'`).catch(() => undefined);
      for (const t of tabelasComGatilho()) {
        if (await existeTabela(t.nome)) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "contingencia_anota" ON ${q(t.nome)}`);
      }
      console.warn("[Boot] ⚠️ Contingência: gatilhos DESLIGADOS (CONTINGENCIA_SEM_GATILHOS=1).");
      return;
    }

    let comGatilho = 0;
    const faltando: string[] = [];
    const gatilhos: string[] = [];
    for (const t of tabelasComGatilho()) {
      // Tabela criada por SQL na primeira vez que alguém usa (ex.: ClienteDaLoja)
      // pode ainda não existir: ganha o gatilho no próximo boot.
      if (!(await existeTabela(t.nome))) { faltando.push(t.nome); continue; }
      gatilhos.push(sqlDaFuncao(t), sqlDoGatilho(t));
      comGatilho++;
    }
    // Mesma ordem de antes (função, gatilho, por tabela). O hash muda quando
    // muda o texto de um gatilho OU quando uma tabela que faltava aparece.
    await executarDDL("contingencia-gatilhos", gatilhos);
    // O diário guarda 7 dias: a cópia pergunta a cada poucos segundos, e quem
    // ficou mais tempo sem perguntar refaz a foto.
    await prisma.$executeRawUnsafe(`DELETE FROM "ContingenciaMudanca" WHERE "em" < now() - interval '7 days'`);
    console.log(`[Boot] ✅ Contingência: ${comGatilho} tabelas com diário${faltando.length ? ` (ainda sem: ${faltando.join(", ")})` : ""}.`);
  } catch (e: any) {
    console.error("[Boot] ❌ Contingência: estrutura não garantida —", e?.message || e);
  }
}
