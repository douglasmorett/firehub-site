/**
 * O que os avisos de "loja sem conexão" (api/cron/loja-sem-conexao) contam do
 * Modo Contingência. Pedido do Douglas (14/10/2026): "avisar o dono quando
 * ativar a contingência e quando sair é irado".
 *
 * Os avisos são os da proteção que já existia (lib/loja-sem-conexao.ts): saem
 * só com a loja sem sinal por 2 min no horário dela — a piscada de um deploy,
 * que também faz as telas pularem para o computador, não vira mensagem.
 *
 *   - na queda: a loja tem a contingência ativada? Então o computador do caixa
 *     assumiu (se estiver ligado — a nuvem não tem como saber);
 *   - na volta: o que o computador subiu desde o começo da queda (as subidas
 *     registradas em "ContingenciaEpisodio", lib/contingencia/subida-no-banco.ts).
 *
 * Falha de leitura (tabela ainda não criada, banco lento) nunca segura o
 * aviso: vira "sem contingência" / "sem subida".
 */
import { prisma } from "@/lib/prisma";

export type SubidaDaQueda = { quedas: number; pedidos: number; linhas: number; conflitos: number };

export async function contingenciaAtivada(lojaId: string): Promise<boolean> {
  try {
    const r = await prisma.$queryRawUnsafe<{ ok: number }[]>(`SELECT 1 AS ok FROM "Contingencia" WHERE "lojaId" = $1`, lojaId);
    return r.length > 0;
  } catch {
    return false;
  }
}

/** O que o computador da loja subiu desde `desde` (somado: a queda pode ter piscado mais de uma vez). */
export async function subidasDesde(lojaId: string, desde: Date): Promise<SubidaDaQueda | null> {
  try {
    // "subiuEm" é now() do banco, sem fuso, gravado em UTC.
    const r = await prisma.$queryRawUnsafe<{ quedas: unknown; pedidos: unknown; linhas: unknown; conflitos: unknown }[]>(
      `SELECT COUNT(*) AS "quedas", COALESCE(SUM("pedidos"), 0) AS "pedidos", COALESCE(SUM("linhas"), 0) AS "linhas",
              COALESCE(SUM("conflitos"), 0) AS "conflitos"
         FROM "ContingenciaEpisodio"
        WHERE "lojaId" = $1 AND "subiuEm" >= ($2::timestamptz AT TIME ZONE 'UTC')`,
      lojaId,
      desde.toISOString(),
    );
    const quedas = Number(r[0]?.quedas || 0);
    if (!quedas) return null;
    return { quedas, pedidos: Number(r[0].pedidos || 0), linhas: Number(r[0].linhas || 0), conflitos: Number(r[0].conflitos || 0) };
  } catch {
    return null;
  }
}
