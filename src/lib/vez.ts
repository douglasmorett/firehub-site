import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { idDaInstancia } from "./instancia";

/**
 * ── A VEZ: "só um servidor faz isto agora" ──────────────────────────────────
 *
 * Uma linha por assunto na tabela "Vez" (chave, dono, ate), criada no boot
 * (lib/ddl-do-boot.ts → garantirTabelasDeCoordenacao). Pegar a vez é um
 * compare-and-set num comando só: entra quem acha a linha vencida — ou é o
 * próprio dono renovando. Mesmo desenho da concessão da rodada fiscal
 * (lib/fiscal-automatico.ts → sqlPegarConcessaoDaRodada), só que valendo
 * para qualquer assunto e sem pendurar nada na tabela User.
 *
 * Por que existe, já com UM servidor: no deploy o container velho e o novo
 * ficam vivos juntos, cada um com o seu cron-runner (scripts/entrypoint.sh),
 * e todo job rodava em dobro naquela janela — Keeta acima do limite de 2
 * consultas/min, aviso repetido para o lojista. Com dois droplets, o tempo todo.
 *
 * O relógio é o do BANCO (now()): os servidores podem discordar entre si em
 * alguns segundos, o Postgres é um só.
 *
 * Banco fora do ar não tem como dizer de quem é a vez. Quem chama escolhe o
 * que acontece (`seFalhar`); o padrão é SEGUIR, que é o comportamento de antes
 * da vez existir — com um servidor só, travar o job porque a consulta da vez
 * falhou seria pior do que rodá-lo (e o job precisa do banco de qualquer jeito).
 */

/** Pega (ou renova) a vez: 1 linha devolvida = é sua até `agora + ms`. */
export function sqlPegarVez(chave: string, dono: string, ms: number, folgaMs = 0): Prisma.Sql {
  return Prisma.sql`/* fh:pegar-vez */ INSERT INTO "Vez" ("chave", "dono", "ate")
VALUES (${chave}, ${dono}, now() + (${ms}::float8 * interval '1 millisecond'))
ON CONFLICT ("chave") DO UPDATE SET "dono" = EXCLUDED."dono", "ate" = EXCLUDED."ate"
WHERE "Vez"."ate" < now() - (${folgaMs}::float8 * interval '1 millisecond') OR "Vez"."dono" = EXCLUDED."dono"
RETURNING 1 AS ok`;
}

/** Solta a vez — só se ainda for deste dono. */
export function sqlSoltarVez(chave: string, dono: string): Prisma.Sql {
  return Prisma.sql`/* fh:soltar-vez */ DELETE FROM "Vez" WHERE "chave" = ${chave} AND "dono" = ${dono}`;
}

export type OpcoesDaVez = {
  /** Quem pega. Padrão: esta instância (lib/instancia.ts). Para intervalo
   * entre avisos, passe um dono novo a cada chamada: assim nem a própria
   * instância renova antes de vencer. */
  dono?: string;
  /** Só toma de OUTRO dono se a vez dele venceu há mais que isto (a instância
   * que não é a preferida do cron dá esta folga à preferida). */
  folgaMs?: number;
  /** O que devolver se o banco não responder. Padrão: true (seguir). */
  seFalhar?: boolean;
};

/** Último log de falha por chave: banco fora não pode virar uma linha por chamada. */
const ultimoLogDeFalha = new Map<string, number>();

/**
 * A vez de `chave` por `ms` milissegundos. true = é sua (pegou ou renovou);
 * false = é de outro, ainda valendo. Nunca lança.
 */
export async function pegarVez(chave: string, ms: number, opcoes: OpcoesDaVez = {}): Promise<boolean> {
  const dono = opcoes.dono ?? idDaInstancia();
  try {
    const linhas = await prisma.$queryRaw<{ ok: number }[]>(sqlPegarVez(chave, dono, ms, opcoes.folgaMs ?? 0));
    return linhas.length > 0;
  } catch (err: any) {
    const seFalhar = opcoes.seFalhar ?? true;
    const agora = Date.now();
    if (agora - (ultimoLogDeFalha.get(chave) ?? 0) > 60_000) {
      ultimoLogDeFalha.set(chave, agora);
      console.warn(
        `[Vez] não consegui consultar a vez de "${chave}" (${String(err?.message || err).slice(0, 120)}) — ` +
          (seFalhar ? "sigo como se fosse minha." : "fico de fora."),
      );
    }
    return seFalhar;
  }
}

/** Devolve a vez antes de vencer (só se ainda for deste dono). Nunca lança. */
export async function soltarVez(chave: string, dono: string = idDaInstancia()): Promise<void> {
  try {
    await prisma.$executeRaw(sqlSoltarVez(chave, dono));
  } catch (err: any) {
    console.warn(`[Vez] não consegui soltar "${chave}": ${String(err?.message || err).slice(0, 120)}`);
  }
}

/** A vez do cron-runner que dispara os jobs (api/cron/lideranca). */
export const CHAVE_DO_LIDER_DO_CRON = "cron:lider";
