/**
 * lib/keeta/acoes-pendentes.ts — chamada à Keeta que falhou e precisa ser repetida.
 *
 * O iFood ensinou (Frangoso, 03/10/2026): o dispatch voltou 403 da borda deles,
 * o código só logou, e o cliente via "pronto" no app com o motoboy já na rua.
 * Aqui a falha repetível vira linha numa tabela, e o polling da Keeta repete a
 * cada ciclo por até 3 horas (`repetirAcoesPendentesKeeta`).
 *
 * Tabela própria, criada no primeiro uso — nenhuma loja fora da Keeta toca nela.
 */
import { prisma } from "@/lib/prisma";

const PRAZO_MS = 3 * 60 * 60_000;
let pronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AcaoPendenteKeeta" (
          "id"            BIGSERIAL PRIMARY KEY,
          "pedidoId"      TEXT NOT NULL,
          "acao"          TEXT NOT NULL,
          "corpo"         JSONB,
          "ultimoErro"    TEXT,
          "tentativas"    INT NOT NULL DEFAULT 0,
          "criadaEm"      TIMESTAMPTZ NOT NULL DEFAULT now(),
          "resolvidaEm"   TIMESTAMPTZ,
          UNIQUE ("pedidoId", "acao")
        )`)
      .then(() => undefined)
      .catch((e) => {
        pronta = null;
        throw e;
      });
  }
  return pronta;
}

/** `pedidoId` é o `openDeliveryOrderId` do banco (keeta_<id>). */
export async function registrarAcaoPendente(pedidoId: string, acao: string, corpo: unknown, erro: string): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AcaoPendenteKeeta" ("pedidoId","acao","corpo","ultimoErro")
       VALUES ($1,$2,$3::jsonb,$4)
       ON CONFLICT ("pedidoId","acao") DO UPDATE SET "ultimoErro" = EXCLUDED."ultimoErro", "resolvidaEm" = NULL`,
      pedidoId,
      acao,
      JSON.stringify(corpo ?? null),
      String(erro).slice(0, 500),
    );
  } catch (e: any) {
    console.error(`[Keeta] não registrei a ação pendente ${acao} de ${pedidoId}:`, e?.message);
  }
}

export type AcaoPendente = { id: string; pedidoId: string; acao: string; corpo: unknown; tentativas: number };

export async function acoesPendentes(): Promise<AcaoPendente[]> {
  try {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id","pedidoId","acao","corpo","tentativas" FROM "AcaoPendenteKeeta"
       WHERE "resolvidaEm" IS NULL AND "criadaEm" > now() - ($1 || ' milliseconds')::interval
       ORDER BY "id" LIMIT 50`,
      String(PRAZO_MS),
    );
    return linhas.map((l) => ({ id: String(l.id), pedidoId: l.pedidoId, acao: l.acao, corpo: l.corpo, tentativas: Number(l.tentativas) }));
  } catch {
    return [];
  }
}

export async function marcarTentativa(id: string, resolvida: boolean, erro?: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "AcaoPendenteKeeta" SET "tentativas" = "tentativas" + 1, "ultimoErro" = COALESCE($2, "ultimoErro"),
       "resolvidaEm" = CASE WHEN $3 THEN now() ELSE NULL END WHERE "id" = $1::bigint`,
      id,
      erro ? String(erro).slice(0, 500) : null,
      resolvida,
    );
  } catch (e: any) {
    console.error(`[Keeta] não atualizei a ação pendente ${id}:`, e?.message);
  }
}
