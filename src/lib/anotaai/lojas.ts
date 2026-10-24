/**
 * lib/anotaai/lojas.ts — qual página (loja) do Anota AI cai em qual conta do FireHub.
 *
 * N para 1, como no CardápioWeb: cada marca é uma página no Anota AI, e várias
 * podem cair na MESMA conta do FireHub. A chave é o `pageId` (o `idpage` do
 * Anota AI), único: uma página nunca fica ligada a duas contas ao mesmo tempo.
 *
 * O vínculo nasce SÓ do `idpage` que o próprio Anota AI devolve ao vincular a
 * chave da loja (rota /api/store/integracoes/anotaai). Nada de "primeira loja
 * ativa" (JotaJá, 14/08/2026): pedido de página sem vínculo ativo não grava em
 * conta nenhuma.
 *
 * Não há token por loja para guardar: a credencial é a do parceiro
 * (lib/anotaai/api.ts) e a loja entra só como `x-page-id`.
 *
 * Tabela própria, criada no primeiro uso (molde de lib/cardapioweb/instalacoes.ts):
 * schema do Prisma intocado.
 */
import { prisma } from "@/lib/prisma";

let pronta: Promise<void> | null = null;
function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AnotaAiLoja" (
          "pageId"          TEXT PRIMARY KEY,
          "franchiseeId"    TEXT NOT NULL,
          "nome"            TEXT,
          "ativa"           BOOLEAN NOT NULL DEFAULT true,
          "conectadaEm"     TIMESTAMPTZ NOT NULL DEFAULT now(),
          "conectadaPor"    TEXT,
          "desligadaEm"     TIMESTAMPTZ,
          "importarDesde"   TIMESTAMPTZ NOT NULL DEFAULT now(),
          "ultimoPedidoEm"  TIMESTAMPTZ,
          "ultimoPollingEm" TIMESTAMPTZ,
          "ultimoErro"      TEXT
        )`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AnotaAiLoja_loja" ON "AnotaAiLoja" ("franchiseeId")`);
    })().catch((e) => {
      pronta = null;
      throw e;
    });
  }
  return pronta;
}

export type LojaAnotaAi = {
  pageId: string;
  franchiseeId: string;
  nome: string | null;
  ativa: boolean;
  conectadaEm: Date;
  /** Pedido criado antes disto não entra: a lista do dia traz o que já foi atendido lá. */
  importarDesde: Date;
  ultimoPedidoEm: Date | null;
  ultimoPollingEm: Date | null;
  ultimoErro: string | null;
};

const data = (v: unknown): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
};

const ler = (l: any): LojaAnotaAi => ({
  pageId: String(l.pageId),
  franchiseeId: String(l.franchiseeId),
  nome: l.nome ?? null,
  ativa: !!l.ativa,
  conectadaEm: data(l.conectadaEm) || new Date(0),
  importarDesde: data(l.importarDesde) || data(l.conectadaEm) || new Date(0),
  ultimoPedidoEm: data(l.ultimoPedidoEm),
  ultimoPollingEm: data(l.ultimoPollingEm),
  ultimoErro: l.ultimoErro ?? null,
});

export async function lojaAnotaAiAtiva(pageId: string | null | undefined): Promise<LojaAnotaAi | null> {
  if (!pageId) return null;
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AnotaAiLoja" WHERE "pageId" = $1 AND "ativa" = true`, String(pageId).trim());
  return linhas[0] ? ler(linhas[0]) : null;
}

export async function lojasAnotaAiAtivas(): Promise<LojaAnotaAi[]> {
  try {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AnotaAiLoja" WHERE "ativa" = true ORDER BY "conectadaEm"`);
    return linhas.map(ler);
  } catch (e: any) {
    console.error("[Anota AI] não li as lojas:", e?.message);
    return [];
  }
}

export async function lojasAnotaAiDaConta(franchiseeIds: string[]): Promise<LojaAnotaAi[]> {
  const ids = Array.from(new Set(franchiseeIds.filter(Boolean)));
  if (ids.length === 0) return [];
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "AnotaAiLoja" WHERE "franchiseeId" = ANY($1::text[]) AND "ativa" = true ORDER BY "conectadaEm"`,
    ids,
  );
  return linhas.map(ler);
}

/**
 * Liga (ou religa) a página nesta conta. Recusa — com motivo — a página ATIVA
 * em outra conta do FireHub: é o erro que faz o pedido de uma loja cair no
 * painel da outra. (Re)ligar move o `importarDesde` para agora: o que foi
 * pedido antes já foi atendido pelo Anota AI, e entrar agora seria comanda
 * velha saindo na cozinha.
 */
export async function ligarLojaAnotaAi(n: { pageId: string; franchiseeId: string; nome: string | null; quem: string }): Promise<{ ok: true; loja: LojaAnotaAi } | { ok: false; motivo: string }> {
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AnotaAiLoja" WHERE "pageId" = $1`, n.pageId);
  const existente = linhas[0] ? ler(linhas[0]) : null;
  if (existente && existente.ativa && existente.franchiseeId !== n.franchiseeId) {
    return { ok: false, motivo: `A loja "${n.nome || existente.nome || n.pageId}" do Anota AI já está ligada a outra conta do FireHub. Desligue lá antes de ligar aqui.` };
  }
  if (existente && existente.ativa) {
    // Mesma conta conectando de novo: nada a mudar (nem o importarDesde — o
    // pedido que entrou no meio já está aqui).
    if (n.nome) await prisma.$executeRawUnsafe(`UPDATE "AnotaAiLoja" SET "nome" = $2 WHERE "pageId" = $1`, n.pageId, n.nome);
    return { ok: true, loja: { ...existente, nome: n.nome || existente.nome } };
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AnotaAiLoja" ("pageId","franchiseeId","nome","conectadaPor") VALUES ($1,$2,$3,$4)
     ON CONFLICT ("pageId") DO UPDATE SET "franchiseeId" = EXCLUDED."franchiseeId", "nome" = COALESCE(EXCLUDED."nome", "AnotaAiLoja"."nome"),
       "ativa" = true, "conectadaEm" = now(), "conectadaPor" = EXCLUDED."conectadaPor", "desligadaEm" = NULL, "importarDesde" = now(), "ultimoErro" = NULL`,
    n.pageId,
    n.franchiseeId,
    n.nome,
    n.quem,
  );
  const loja = await lojaAnotaAiAtiva(n.pageId);
  if (!loja) throw new Error("a loja do Anota AI gravada não foi encontrada em seguida");
  return { ok: true, loja };
}

/** Desliga a página NESTA conta (nunca a de outra). */
export async function desligarLojaAnotaAi(franchiseeId: string, pageId: string): Promise<boolean> {
  await garantirTabela();
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "AnotaAiLoja" SET "ativa" = false, "desligadaEm" = now() WHERE "pageId" = $1 AND "franchiseeId" = $2 AND "ativa" = true`,
    String(pageId).trim(),
    franchiseeId,
  );
  return Number(n) > 0;
}

/** O que a tela mostra: quando o polling falou com o Anota AI por último, e o último erro. */
export async function registrarPollingAnotaAi(pageId: string, erro: string | null, pedidoNovo = false): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      `UPDATE "AnotaAiLoja" SET "ultimoPollingEm" = CASE WHEN $2::text IS NULL THEN now() ELSE "ultimoPollingEm" END, "ultimoErro" = $2${pedidoNovo ? `, "ultimoPedidoEm" = now()` : ""} WHERE "pageId" = $1`,
      pageId,
      erro ? String(erro).slice(0, 300) : null,
    );
  } catch (e: any) {
    console.warn("[Anota AI] não registrei o polling:", e?.message);
  }
}
