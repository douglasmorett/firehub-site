/**
 * A FILA DO ASSISTENTE TEM ALGO? — uma consulta só, antes das duas de verdade.
 *
 * O Assistente de impressão de cada loja consulta GET /api/store/print-queue a
 * cada 3 s (~12 chamadas/s no pico de 18/10/2026), e quase todas voltam
 * vazias. Mesmo vazia, a fila fazia duas consultas (pedidos e impressões
 * avulsas), e cada consulta custa CPU no processo do Node (motor do Prisma)
 * mesmo com o banco respondendo rápido.
 *
 * Aqui as duas perguntas vão juntas, num recorte MAIOR que o das consultas
 * da rota (só loja, carimbo de impresso, acréscimo, status e a janela de
 * tempo — sem os detalhes de modo do KDS, atraso ou DANFE). Então:
 *   • "não" garante que a consulta de verdade viria vazia — pode pular;
 *   • "sim" (ou qualquer erro: devolve null) = o caminho de sempre.
 * Pedido novo nunca fica de fora: ele nasce sem `printedAt`, com createdAt de
 * agora, e cai neste recorte (scripts/teste-fila-tem-algo.ts).
 *
 * As datas vão em UTC explícito: a coluna é `timestamp` sem fuso e o
 * parâmetro não pode depender do fuso da sessão do banco.
 */
import { Prisma } from "@prisma/client";
import { nadaMudouDesde, PRAZO_MS } from "@/lib/novidade-da-loja";

export type NovidadeDaFila = { pedidos: boolean; avulsas: boolean };

export type PerguntaDaFila = {
  franchiseeId: string;
  /** O mais antigo dos inícios que a consulta de pedidos usa (janela ou atraso). */
  desde: Date;
  /** O início da janela das impressões avulsas (PrintRequest). */
  desdeDaAvulsa: Date;
  /** Os status que a fila nunca imprime (o `notIn` da consulta da rota). */
  statusQueNaoEntram: string[];
  /** A loja imprime no FIM do KDS: a janela vale também pela hora da finalização. */
  tambemPeloFimDoKds: boolean;
};

function utc(d: Date): Prisma.Sql {
  return Prisma.sql`(CAST(${d.toISOString()} AS timestamptz) AT TIME ZONE 'UTC')`;
}

export function sqlDaFila(p: PerguntaDaFila): Prisma.Sql {
  const desde = utc(p.desde);
  const janela = p.tambemPeloFimDoKds
    ? Prisma.sql`("createdAt" > ${desde} OR "kdsFinishedAt" > ${desde})`
    : Prisma.sql`"createdAt" > ${desde}`;
  return Prisma.sql`SELECT
    EXISTS (
      SELECT 1 FROM "CustomerOrder"
      WHERE "franchiseeId" = ${p.franchiseeId}
        AND "parentOrderId" IS NULL
        AND "printedAt" IS NULL
        AND NOT ("status" = ANY(${p.statusQueNaoEntram}::text[]))
        AND ${janela}
    ) AS "pedidos",
    EXISTS (
      SELECT 1 FROM "PrintRequest"
      WHERE "franchiseeId" = ${p.franchiseeId}
        AND "createdAt" > ${utc(p.desdeDaAvulsa)}
        AND "printedAt" IS NULL
    ) AS "avulsas"`;
}

export async function filaTemAlgo(
  db: { $queryRaw: <T = unknown>(sql: Prisma.Sql) => Promise<T> },
  p: PerguntaDaFila,
): Promise<NovidadeDaFila | null> {
  try {
    const linhas = await db.$queryRaw<{ pedidos: unknown; avulsas: unknown }[]>(sqlDaFila(p));
    const l = Array.isArray(linhas) ? linhas[0] : null;
    if (!l || typeof l.pedidos !== "boolean" || typeof l.avulsas !== "boolean") return null;
    return { pedidos: l.pedidos, avulsas: l.avulsas };
  } catch (err) {
    console.error("[PrintQueue] pré-consulta da fila falhou; seguindo pelo caminho de sempre:", (err as any)?.code || (err as any)?.message || err);
    return null;
  }
}

// ── "NADA" SEM IR AO BANCO (lib/novidade-da-loja.ts) ──────────────────────
//
// Mesmo a pré-consulta acima, a cada 3 s por Assistente, era a chamada mais
// frequente do servidor (232 de 607 por minuto no almoço de 23/10/2026). A
// fila vazia fica guardada até a loja ter qualquer gravação de pedido, item ou
// impressão — ou por 15 s, o que vier antes. Só o "nada" é guardado: "sim"
// sempre vai ao banco.
//
// A janela anda para a frente a cada consulta. O "nada" de uma janela vale
// para outra que começa no mesmo ponto ou DEPOIS (contém menos); a que começa
// antes (o Assistente voltando de um atraso) vai ao banco.
const NADA: NovidadeDaFila = { pedidos: false, avulsas: false };
const nadaGuardado = new Map<string, { lidaEm: number; desde: number; desdeDaAvulsa: number }>();

export async function filaTemAlgoGuardado(
  db: { $queryRaw: <T = unknown>(sql: Prisma.Sql) => Promise<T> },
  p: PerguntaDaFila,
): Promise<NovidadeDaFila | null> {
  const chave = `${p.franchiseeId}|${p.tambemPeloFimDoKds ? 1 : 0}|${p.statusQueNaoEntram.join(",")}`;
  const g = nadaGuardado.get(chave);
  if (
    g &&
    Date.now() - g.lidaEm < PRAZO_MS &&
    p.desde.getTime() >= g.desde &&
    p.desdeDaAvulsa.getTime() >= g.desdeDaAvulsa &&
    nadaMudouDesde([p.franchiseeId], g.lidaEm)
  ) {
    return { ...NADA };
  }
  const lidaEm = Date.now();
  const r = await filaTemAlgo(db, p);
  if (r && !r.pedidos && !r.avulsas) {
    if (nadaGuardado.size > 5_000) nadaGuardado.clear();
    nadaGuardado.set(chave, { lidaEm, desde: p.desde.getTime(), desdeDaAvulsa: p.desdeDaAvulsa.getTime() });
  } else {
    nadaGuardado.delete(chave);
  }
  return r;
}
