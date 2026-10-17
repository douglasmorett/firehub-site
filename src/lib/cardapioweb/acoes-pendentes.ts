/**
 * lib/cardapioweb/acoes-pendentes.ts — o aviso ao CardápioWeb que falhou e precisa ser repetido.
 *
 * O iFood ensinou (Frangoso, 03/10/2026): o dispatch voltou 403 da borda
 * deles, o código só logou, e o cliente via "pronto" no app com o motoboy já
 * na rua. Aqui a falha repetível (429 do limite de 300 chamadas a cada 3 min,
 * 5xx, rede, token caído) vira linha numa tabela, e o polling do CardápioWeb
 * repete a cada ciclo por até 3 horas (`repetirAcoesPendentesCardapioWeb`, em
 * lib/cardapioweb/eventos.ts).
 *
 * A ORDEM importa: `prepared` antes do `confirm` é recusado (4003). A fila sai
 * por ordem de chegada e, no ciclo em que um passo de um pedido falha, os
 * passos seguintes DAQUELE pedido esperam o próximo ciclo.
 *
 * Tabela própria, criada no primeiro uso (o molde de lib/keeta/acoes-pendentes.ts).
 */
import { prisma } from "@/lib/prisma";

const PRAZO_MS = 3 * 60 * 60_000;
let pronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AcaoPendenteCardapioWeb" (
          "id"            BIGSERIAL PRIMARY KEY,
          "pedidoId"      TEXT NOT NULL,
          "acao"          TEXT NOT NULL,
          "corpo"         JSONB,
          "ultimoErro"    TEXT,
          "tentativas"    INT NOT NULL DEFAULT 0,
          "criadaEm"      TIMESTAMPTZ NOT NULL DEFAULT now(),
          "ordem"         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
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

/**
 * `pedidoId` é o `openDeliveryOrderId` do banco (cardapioweb_<loja>_<id>) — ele
 * diz a instalação. A mesma ação de novo volta para o FIM da fila (`ordem`) e
 * ganha prazo novo: um `dispatch` re-enfileirado não pode passar na frente do
 * `confirm` que falhou depois dele.
 */
export async function registrarAcaoPendente(pedidoId: string, acao: string, corpo: unknown, erro: string): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AcaoPendenteCardapioWeb" ("pedidoId","acao","corpo","ultimoErro")
       VALUES ($1,$2,$3::jsonb,$4)
       ON CONFLICT ("pedidoId","acao") DO UPDATE SET "ultimoErro" = EXCLUDED."ultimoErro", "corpo" = EXCLUDED."corpo", "resolvidaEm" = NULL, "tentativas" = 0, "criadaEm" = now(), "ordem" = clock_timestamp()`,
      pedidoId,
      acao,
      JSON.stringify(corpo ?? null),
      String(erro).slice(0, 500),
    );
  } catch (e: any) {
    console.error(`[CardápioWeb] não registrei a ação pendente ${acao} de ${pedidoId}:`, e?.message);
  }
}

export type AcaoPendenteCW = { id: string; pedidoId: string; acao: string; corpo: unknown; tentativas: number };

export async function acoesPendentes(): Promise<AcaoPendenteCW[]> {
  try {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id","pedidoId","acao","corpo","tentativas" FROM "AcaoPendenteCardapioWeb"
       WHERE "resolvidaEm" IS NULL AND "criadaEm" > now() - ($1 || ' milliseconds')::interval
       ORDER BY "ordem", "id" LIMIT 50`,
      String(PRAZO_MS),
    );
    return linhas.map((l) => ({ id: String(l.id), pedidoId: l.pedidoId, acao: l.acao, corpo: l.corpo, tentativas: Number(l.tentativas) }));
  } catch {
    return [];
  }
}

/** Este pedido tem aviso esperando na fila? (A escada nova entra DEPOIS dele, nunca por cima.) */
export async function temAcaoPendente(pedidoId: string): Promise<boolean> {
  try {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id" FROM "AcaoPendenteCardapioWeb" WHERE "pedidoId" = $1 AND "resolvidaEm" IS NULL AND "criadaEm" > now() - ($2 || ' milliseconds')::interval LIMIT 1`,
      pedidoId,
      String(PRAZO_MS),
    );
    return linhas.length > 0;
  } catch {
    return false;
  }
}

export async function marcarTentativa(id: string, resolvida: boolean, erro?: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "AcaoPendenteCardapioWeb" SET "tentativas" = "tentativas" + 1, "ultimoErro" = COALESCE($2, "ultimoErro"),
       "resolvidaEm" = CASE WHEN $3 THEN now() ELSE NULL END WHERE "id" = $1::bigint`,
      id,
      erro ? String(erro).slice(0, 500) : null,
      resolvida,
    );
  } catch (e: any) {
    console.error(`[CardápioWeb] não atualizei a ação pendente ${id}:`, e?.message);
  }
}
