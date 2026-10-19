import { createHash } from "node:crypto";
import { prisma } from "./prisma";
import { pegarVez, soltarVez } from "./vez";
import { idDaInstancia } from "./instancia";

/**
 * ── A DDL DO BOOT, COM TRAVA E SEM REPETIR ──────────────────────────────────
 *
 * O boot (src/instrumentation.ts) roda centenas de `ALTER TABLE … ADD COLUMN
 * IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE TRIGGER`…
 * a CADA partida — e `ADD COLUMN IF NOT EXISTS` pede a trava exclusiva da
 * tabela mesmo quando a coluna já existe. Em User, CustomerOrder e
 * MenuProduct, com o site atendendo, isso tem dois defeitos:
 *
 *  1. Um ALTER esperando a trava (atrás de uma consulta longa) faz FILA para
 *     toda consulta que chega depois dele na mesma tabela: o site para até o
 *     ALTER conseguir. Aqui cada instrução roda com `lock_timeout` curto: se a
 *     trava não vem, desiste, espera e tenta de novo — em vez de segurar o site.
 *  2. Dois boots ao mesmo tempo (deploy com dois servidores, ou o container
 *     novo reiniciando) rodam a mesma DDL juntos: `CREATE OR REPLACE FUNCTION`
 *     simultâneo dá "tuple concurrently updated", `CREATE TABLE IF NOT EXISTS`
 *     simultâneo dá chave duplicada em pg_type. Aqui cada instrução roda sob
 *     `pg_advisory_xact_lock` (uma de cada vez no cluster), e o grupo inteiro
 *     tem DONO (lib/vez.ts): o segundo boot espera o primeiro terminar e pula.
 *
 * E o principal: o grupo que já foi aplicado neste banco não roda de novo.
 * Cada grupo de instruções vira um hash (nome + texto das instruções) gravado
 * em "BootDDL" quando TODAS passam. Boot com o mesmo hash pula o grupo sem
 * pedir trava nenhuma; mudou uma vírgula numa instrução, o hash muda e o grupo
 * roda inteiro outra vez (todas são idempotentes — é a regra da casa).
 *
 * O que NÃO muda: as instruções, a ordem, e o que cada função de garantia faz
 * com o resultado (as marcas "já garanti", os logs, as conferências em
 * information_schema, os UPDATE de dados que vêm depois).
 *
 * Por que uma transação POR INSTRUÇÃO, e não uma para o grupo: numa transação
 * só, as travas de User, CustomerOrder, MenuProduct… se acumulariam até o
 * COMMIT — exatamente o deadlock com o tráfego que isto quer evitar. E a trava
 * consultiva de sessão (`pg_advisory_lock`) não serve: o Neon fala por
 * pooler (PgBouncer em modo transação), em que a sessão muda a cada comando;
 * a de transação (`_xact_`) e o `SET LOCAL` valem dentro do pooler.
 *
 * Escapes:
 *  - BOOT_DDL_SEMPRE=1 ignora o hash e roda tudo, como antes (ex.: alguém
 *    apagou uma coluna à mão).
 *  - Computador da loja (FIREHUB_LOCAL=1): o banco local é refeito pela
 *    contingência a partir da foto; lá o hash nunca pula nada.
 *  - Qualquer falha da própria coordenação (tabela BootDDL/Vez ausente, banco
 *    soluçando) cai no caminho de antes: roda as instruções, sem pular.
 */

/** Uma DDL de cada vez no cluster inteiro. */
const TRAVA = "firehub:ddl-do-boot";
/** Quanto uma instrução espera pela trava da tabela antes de desistir. */
const LOCK_TIMEOUT = "3s";
/** Esperas entre as tentativas de uma instrução que estourou a trava (4 tentativas). */
const ESPERAS_DA_TRAVA_MS = [1_000, 2_000, 4_000];
/** Quanto o segundo boot espera o primeiro terminar o grupo antes de rodar ele mesmo. */
const ESPERA_PELO_OUTRO_MS = 45_000;
/** Vale do dono do grupo: se ele morrer no meio, o grupo fica livre depois disto. */
const VEZ_DO_GRUPO_MS = 2 * 60_000;

/**
 * As duas tabelas da coordenação. Pequenas, próprias, fora do schema.prisma
 * (acesso só por SQL cru, como CashbackAjuste): sem elas, nada quebra — a DDL
 * roda como antes e a vez segue a regra de `seFalhar`.
 */
export const TABELAS_DE_COORDENACAO = [
  `CREATE TABLE IF NOT EXISTS "BootDDL" ("hash" TEXT PRIMARY KEY, "nome" TEXT NOT NULL, "em" TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS "Vez" ("chave" TEXT PRIMARY KEY, "dono" TEXT NOT NULL, "ate" TIMESTAMPTZ NOT NULL)`,
];

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ehPostgres = () => /^postgres/i.test(process.env.DATABASE_URL || "");

export function hashDoGrupo(nome: string, instrucoes: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([nome, ...instrucoes])).digest("hex");
}

/** A instrução desistiu porque a trava não veio a tempo (SQLSTATE 55P03). */
export function estourouATrava(err: any): boolean {
  const codigo = err?.meta?.code ?? err?.code;
  if (codigo === "55P03") return true;
  return /lock timeout|lock_timeout|55P03/i.test(String(err?.message || ""));
}

/** A tabela já existe / corrida no pg_type: o CREATE de outro processo venceu. */
function jaExiste(err: any): boolean {
  const codigo = err?.meta?.code ?? err?.code;
  if (codigo === "42P07" || codigo === "23505") return true;
  return /already exists|pg_type_typname_nsp_index|duplicate key/i.test(String(err?.message || ""));
}

function resumo(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 90);
}

/** Uma instrução, na sua transação: lock_timeout curto e a trava do cluster. */
export async function executarComTrava(sql: string): Promise<void> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      await prisma.$transaction([
        prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`),
        prisma.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${TRAVA}'))`),
        prisma.$executeRawUnsafe(sql),
      ]);
      return;
    } catch (err: any) {
      if (!estourouATrava(err) || tentativa >= ESPERAS_DA_TRAVA_MS.length) throw err;
      const ms = ESPERAS_DA_TRAVA_MS[tentativa];
      console.warn(`[Boot] Trava ocupada (${resumo(sql)}) — tentativa ${tentativa + 1}, de novo em ${ms} ms.`);
      await espera(ms);
    }
  }
}

let coordenacao: Promise<boolean> | null = null;

/**
 * "BootDDL" e "Vez" existem? Uma vez por processo. Sem trava nenhuma quando
 * já existem (o normal): só a consulta ao catálogo. Nunca lança.
 */
export function garantirTabelasDeCoordenacao(): Promise<boolean> {
  if (!coordenacao) {
    coordenacao = (async () => {
      if (!ehPostgres()) return false;
      try {
        const r = await prisma.$queryRawUnsafe<{ boot: boolean; vez: boolean }[]>(
          `SELECT to_regclass('"BootDDL"') IS NOT NULL AS boot, to_regclass('"Vez"') IS NOT NULL AS vez`,
        );
        if (r[0]?.boot && r[0]?.vez) return true;
        for (const sql of TABELAS_DE_COORDENACAO) {
          try {
            // A trava do cluster serializa dois boots criando ao mesmo tempo
            // (a corrida do pg_type); o `jaExiste` cobre quem criou sem ela.
            await executarComTrava(sql);
          } catch (err: any) {
            if (!jaExiste(err)) throw err;
          }
        }
        return true;
      } catch (err: any) {
        console.error(`[Boot] 🛑 Tabelas de coordenação (BootDDL/Vez) falharam: ${err?.message} — a DDL roda como antes, sem pular.`);
        coordenacao = null; // a próxima chamada tenta de novo
        return false;
      }
    })();
  }
  return coordenacao;
}

async function jaAplicado(hash: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<{ ok: number }[]>(`SELECT 1 AS ok FROM "BootDDL" WHERE "hash" = $1`, hash);
  return r.length > 0;
}

export type ResultadoDaDDL = {
  /** true = o grupo já estava aplicado neste banco e nada rodou. */
  pulou: boolean;
  /** Só com `porInstrucao`: as instruções que falharam (as outras rodaram). */
  falhas: { sql: string; erro: any }[];
};

export type OpcoesDaDDL = {
  /**
   * Erro de uma instrução não para as seguintes (o desenho de
   * garantirColunasDoSchema e garantirEstruturaDeMesa): cada falha vai para
   * cá e o laço continua. Sem isto, a primeira falha LANÇA, como o laço de
   * antes — e o catch de quem chamou faz o que sempre fez.
   */
  porInstrucao?: (sql: string, erro: any) => void;
};

/**
 * Roda o grupo de instruções — ou pula, se este banco já o aplicou. Mesma
 * ordem e mesmo efeito do `for (const sql of X) await prisma.$executeRawUnsafe(sql)`
 * que substitui. O hash só é gravado quando TODAS passaram.
 */
export async function executarDDL(
  nome: string,
  instrucoes: readonly string[],
  opcoes: OpcoesDaDDL = {},
): Promise<ResultadoDaDDL> {
  const falhas: { sql: string; erro: any }[] = [];
  const hash = hashDoGrupo(nome, instrucoes);
  const podePular = process.env.BOOT_DDL_SEMPRE !== "1" && process.env.FIREHUB_LOCAL !== "1";
  const coordena = await garantirTabelasDeCoordenacao();

  let donoDoGrupo: string | null = null;
  if (coordena) {
    try {
      if (podePular && (await jaAplicado(hash))) return { pulou: true, falhas };
      // Dono por chamada (e não a instância): duas garantias do mesmo grupo no
      // mesmo processo (o boot e uma rota que chamou por precaução) também se
      // esperam, em vez de "renovar" a vez uma da outra.
      const dono = `${idDaInstancia()}#${Math.random().toString(36).slice(2, 10)}`;
      const limite = Date.now() + ESPERA_PELO_OUTRO_MS;
      let avisou = false;
      for (;;) {
        if (await pegarVez(`ddl:${hash}`, VEZ_DO_GRUPO_MS, { dono, seFalhar: true })) {
          donoDoGrupo = dono;
          break;
        }
        if (!avisou) {
          avisou = true;
          console.log(`[Boot] DDL "${nome}": outro servidor está aplicando — espero ele terminar.`);
        }
        await espera(300);
        if (podePular && (await jaAplicado(hash))) {
          console.log(`[Boot] DDL "${nome}": aplicada pelo outro servidor — pulei.`);
          return { pulou: true, falhas };
        }
        if (Date.now() > limite) {
          // O outro está lento ou morreu segurando a vez. Rodar junto é seguro:
          // tudo é idempotente e cada instrução pega a trava do cluster.
          console.warn(`[Boot] DDL "${nome}": esperei ${ESPERA_PELO_OUTRO_MS / 1000}s pelo outro servidor — rodo eu mesmo.`);
          break;
        }
      }
    } catch (err: any) {
      console.warn(`[Boot] DDL "${nome}": coordenação falhou (${err?.message}) — rodo sem pular.`);
    }
  }

  try {
    for (const sql of instrucoes) {
      if (!opcoes.porInstrucao) {
        await executarComTrava(sql);
        continue;
      }
      try {
        await executarComTrava(sql);
      } catch (erro: any) {
        falhas.push({ sql, erro });
        opcoes.porInstrucao(sql, erro);
      }
    }
    if (coordena && falhas.length === 0) {
      await prisma
        .$executeRawUnsafe(`INSERT INTO "BootDDL" ("hash", "nome") VALUES ($1, $2) ON CONFLICT ("hash") DO NOTHING`, hash, nome)
        .catch((err: any) => console.warn(`[Boot] DDL "${nome}": aplicada, mas não consegui gravar o hash (${err?.message}) — roda de novo no próximo boot.`));
    }
  } finally {
    if (donoDoGrupo) await soltarVez(`ddl:${hash}`, donoDoGrupo);
  }
  return { pulou: false, falhas };
}

/**
 * A conferência de quem chamou (information_schema) acusou falta depois de o
 * grupo "passar": tira o hash, e a próxima tentativa — ou o próximo boot —
 * roda o grupo de novo em vez de pular para sempre. Nunca lança.
 */
export async function esquecerDDL(nome: string, instrucoes: readonly string[]): Promise<void> {
  await prisma
    .$executeRawUnsafe(`DELETE FROM "BootDDL" WHERE "hash" = $1`, hashDoGrupo(nome, instrucoes))
    .catch(() => undefined);
}
