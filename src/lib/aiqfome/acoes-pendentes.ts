/**
 * lib/aiqfome/acoes-pendentes.ts — o aviso ao aiqfome que falhou e precisa ser repetido.
 *
 * O molde de lib/cardapioweb/acoes-pendentes.ts. O iFood ensinou (Frangoso,
 * 03/10/2026): o dispatch voltou 403 da borda deles, o código só logou, e o
 * cliente via "pronto" no app com o motoboy já na rua. Aqui a falha repetível
 * (429, 5xx, rede, token caído) vira linha numa tabela, e o polling do
 * aiqfome repete a cada ciclo por até 3 horas (`repetirAcoesPendentesAiqfome`,
 * em lib/aiqfome/eventos.ts).
 *
 * A ORDEM importa: "pronto" antes do "lido" não faz sentido lá. A fila sai por
 * ordem de chegada e, no ciclo em que um passo de um pedido falha, os passos
 * seguintes DAQUELE pedido esperam o próximo ciclo.
 */
import { prisma } from "@/lib/prisma";

const PRAZO_MS = 3 * 60 * 60_000;
let pronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AcaoPendenteAiqfome" (
          "id"            BIGSERIAL PRIMARY KEY,
          "pedidoId"      TEXT NOT NULL,
          "acao"          TEXT NOT NULL,
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

/** `pedidoId` é o `openDeliveryOrderId` do banco (aiqfome_<loja>_<id>): ele diz a instalação. */
export async function registrarAcaoPendente(pedidoId: string, acao: string, erro: string): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AcaoPendenteAiqfome" ("pedidoId","acao","ultimoErro")
       VALUES ($1,$2,$3)
       ON CONFLICT ("pedidoId","acao") DO UPDATE SET "ultimoErro" = EXCLUDED."ultimoErro", "resolvidaEm" = NULL, "tentativas" = 0, "criadaEm" = now(), "ordem" = clock_timestamp()`,
      pedidoId,
      acao,
      String(erro).slice(0, 500),
    );
  } catch (e: any) {
    console.error(`[aiqfome] não registrei a ação pendente ${acao} de ${pedidoId}:`, e?.message);
  }
}

export type AcaoPendenteAQ = { id: string; pedidoId: string; acao: string; tentativas: number };

export async function acoesPendentes(): Promise<AcaoPendenteAQ[]> {
  try {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id","pedidoId","acao","tentativas" FROM "AcaoPendenteAiqfome"
       WHERE "resolvidaEm" IS NULL AND "criadaEm" > now() - ($1 || ' milliseconds')::interval
       ORDER BY "ordem", "id" LIMIT 50`,
      String(PRAZO_MS),
    );
    return linhas.map((l) => ({ id: String(l.id), pedidoId: l.pedidoId, acao: l.acao, tentativas: Number(l.tentativas) }));
  } catch {
    return [];
  }
}

export async function temAcaoPendente(pedidoId: string): Promise<boolean> {
  try {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id" FROM "AcaoPendenteAiqfome" WHERE "pedidoId" = $1 AND "resolvidaEm" IS NULL AND "criadaEm" > now() - ($2 || ' milliseconds')::interval LIMIT 1`,
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
      `UPDATE "AcaoPendenteAiqfome" SET "tentativas" = "tentativas" + 1, "ultimoErro" = COALESCE($2, "ultimoErro"),
       "resolvidaEm" = CASE WHEN $3 THEN now() ELSE NULL END WHERE "id" = $1::bigint`,
      id,
      erro ? String(erro).slice(0, 500) : null,
      resolvida,
    );
  } catch (e: any) {
    console.error(`[aiqfome] não atualizei a ação pendente ${id}:`, e?.message);
  }
}
