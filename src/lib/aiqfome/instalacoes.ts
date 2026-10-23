/**
 * lib/aiqfome/instalacoes.ts — qual loja do aiqfome cai em qual conta do FireHub.
 *
 * Molde de lib/cardapioweb/instalacoes.ts, com uma diferença que vem do ID
 * Magalu: UM token pode liberar mais de uma loja do aiqfome (`GET /store`
 * devolve a lista). Cada loja vira uma linha aqui — chave única `storeId`,
 * nunca ligada a duas contas ao mesmo tempo —, e as linhas que nasceram da
 * MESMA autorização dividem o par de tokens pela coluna `credencial`.
 *
 * Por que dividir: o refresh_token do ID Magalu GIRA. Duas linhas com cópias
 * do mesmo par renovariam cada uma por si, e a segunda renovação, com o token
 * velho, derrubaria a outra loja (o iFood ficou semanas com token morto calado).
 * Com a credencial, renovar grava o par novo em todas as linhas dela, e a
 * trava de lib/aiqfome/api.ts é por credencial, não por loja.
 *
 * O vínculo nasce SÓ das lojas que o próprio aiqfome devolve no `GET /store`
 * com o token recém-trocado. Nada de "primeira loja ativa" (JotaJá,
 * 14/08/2026): pedido de loja sem instalação ativa não grava em conta nenhuma.
 *
 * Tokens cifrados pelo cofre (lib/cofre.ts). Tabela própria, criada no
 * primeiro uso: schema do Prisma intocado.
 */
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";

let pronta: Promise<void> | null = null;
function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AiqfomeInstalacao" (
          "id"                    BIGSERIAL PRIMARY KEY,
          "storeId"               TEXT NOT NULL UNIQUE,
          "franchiseeId"          TEXT NOT NULL,
          "nome"                  TEXT,
          "credencial"            TEXT,
          "accessToken"           TEXT,
          "refreshToken"          TEXT,
          "tokenExpiraEm"         TIMESTAMPTZ,
          "escopos"               TEXT,
          "estado"                TEXT NOT NULL DEFAULT 'ok',
          "motivoDoEstado"        TEXT,
          "ativa"                 BOOLEAN NOT NULL DEFAULT true,
          "conectadaEm"           TIMESTAMPTZ NOT NULL DEFAULT now(),
          "conectadaPor"          TEXT,
          "desligadaEm"           TIMESTAMPTZ,
          "importarDesde"         TIMESTAMPTZ NOT NULL DEFAULT now(),
          "ultimoPedidoEm"        TIMESTAMPTZ,
          "ultimoWebhookEm"       TIMESTAMPTZ,
          "ultimoSoPeloPollingEm" TIMESTAMPTZ,
          "webhooksEm"            TIMESTAMPTZ,
          "webhooksErro"          TEXT
        )`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiqfomeInstalacao_loja" ON "AiqfomeInstalacao" ("franchiseeId")`);
    })().catch((e) => {
      pronta = null;
      throw e;
    });
  }
  return pronta;
}

export type EstadoDaInstalacao = "ok" | "reconectar";

export type InstalacaoAQ = {
  id: string;
  storeId: string;
  franchiseeId: string;
  nome: string | null;
  /** As lojas da mesma autorização dividem os tokens por aqui. */
  credencial: string;
  estado: EstadoDaInstalacao;
  motivoDoEstado: string | null;
  ativa: boolean;
  conectadaEm: Date;
  /** Pedido criado antes disto não entra: nada de fila velha saindo na cozinha. */
  importarDesde: Date;
  ultimoPedidoEm: Date | null;
  ultimoWebhookEm: Date | null;
  /** O polling trouxe um pedido que o webhook não trouxe. */
  ultimoSoPeloPollingEm: Date | null;
  /** Quando os webhooks desta loja foram cadastrados no aiqfome (null = não estão). */
  webhooksEm: Date | null;
  webhooksErro: string | null;
  tokenExpiraEm: Date | null;
};

const data = (v: unknown): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
};

const ler = (l: any): InstalacaoAQ => ({
  id: String(l.id),
  storeId: String(l.storeId),
  franchiseeId: String(l.franchiseeId),
  nome: l.nome ?? null,
  credencial: String(l.credencial || `instalacao-${l.id}`),
  estado: l.estado === "reconectar" ? "reconectar" : "ok",
  motivoDoEstado: l.motivoDoEstado ?? null,
  ativa: !!l.ativa,
  conectadaEm: data(l.conectadaEm) || new Date(0),
  importarDesde: data(l.importarDesde) || data(l.conectadaEm) || new Date(0),
  ultimoPedidoEm: data(l.ultimoPedidoEm),
  ultimoWebhookEm: data(l.ultimoWebhookEm),
  ultimoSoPeloPollingEm: data(l.ultimoSoPeloPollingEm),
  webhooksEm: data(l.webhooksEm),
  webhooksErro: l.webhooksErro ?? null,
  tokenExpiraEm: data(l.tokenExpiraEm),
});

/** A instalação ATIVA desta loja do aiqfome — é a única que recebe pedido. */
export async function instalacaoAtiva(storeId: string | number | null | undefined): Promise<InstalacaoAQ | null> {
  if (storeId === null || storeId === undefined || String(storeId).trim() === "") return null;
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AiqfomeInstalacao" WHERE "storeId" = $1 AND "ativa" = true`, String(storeId).trim());
  return linhas[0] ? ler(linhas[0]) : null;
}

export async function instalacoesAtivas(): Promise<InstalacaoAQ[]> {
  try {
    await garantirTabela();
    const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AiqfomeInstalacao" WHERE "ativa" = true ORDER BY "id"`);
    return linhas.map(ler);
  } catch (e: any) {
    console.error("[aiqfome] não li as instalações:", e?.message);
    return [];
  }
}

/** As instalações ativas destas lojas do FireHub (a conta e o grupo dela). */
export async function instalacoesDasLojas(franchiseeIds: string[]): Promise<InstalacaoAQ[]> {
  const ids = Array.from(new Set(franchiseeIds.filter(Boolean)));
  if (ids.length === 0) return [];
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AiqfomeInstalacao" WHERE "franchiseeId" = ANY($1::text[]) AND "ativa" = true ORDER BY "id"`, ids);
  return linhas.map(ler);
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export type TokensGuardados = { accessToken: string | null; refreshToken: string | null; expiraEm: Date | null };

export async function lerTokens(instalacaoId: string): Promise<TokensGuardados | null> {
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "accessToken", "refreshToken", "tokenExpiraEm", "ativa" FROM "AiqfomeInstalacao" WHERE "id" = $1::bigint`,
    instalacaoId,
  );
  const l = linhas[0];
  if (!l || !l.ativa) return null;
  return { accessToken: decifrar(l.accessToken), refreshToken: decifrar(l.refreshToken), expiraEm: data(l.tokenExpiraEm) };
}

/** O par novo vai para TODAS as lojas ativas da credencial (o refresh gira). */
export async function gravarTokens(credencial: string, t: { accessToken: string; refreshToken: string | null; expiraEm: Date; escopos?: string | null }): Promise<void> {
  await garantirTabela();
  await prisma.$executeRawUnsafe(
    `UPDATE "AiqfomeInstalacao" SET "accessToken" = $2, "refreshToken" = $3, "tokenExpiraEm" = $4, "escopos" = COALESCE($5, "escopos"), "estado" = 'ok', "motivoDoEstado" = NULL WHERE "credencial" = $1 AND "ativa" = true`,
    credencial,
    cifrar(t.accessToken),
    t.refreshToken ? cifrar(t.refreshToken) : null,
    t.expiraEm,
    t.escopos ?? null,
  );
}

/** Token recusado de vez: a tela mostra "reconectar" e o polling para de bater nessas lojas. */
export async function marcarReconectar(credencial: string, motivo: string): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      `UPDATE "AiqfomeInstalacao" SET "estado" = 'reconectar', "motivoDoEstado" = $2 WHERE "credencial" = $1 AND "ativa" = true`,
      credencial,
      String(motivo).slice(0, 300),
    );
  } catch (e: any) {
    console.error(`[aiqfome] não marquei a credencial para reconectar:`, e?.message);
  }
}

// ── Ligar e desligar ────────────────────────────────────────────────────────

export type NovaAutorizacao = {
  lojas: Array<{ storeId: string; nome: string | null }>;
  franchiseeId: string;
  tokens: { accessToken: string; refreshToken: string | null; expiraEm: Date; escopos: string | null };
  quem: string;
};

export type ResultadoDaAutorizacao = {
  ligadas: InstalacaoAQ[];
  /** Lojas do aiqfome ativas em OUTRA conta: não mudam de dono (é o erro que põe o pedido no painel errado). */
  recusadas: Array<{ storeId: string; nome: string | null; motivo: string }>;
};

/**
 * Grava (ou religa) as lojas de uma autorização. (Re)ligar move o
 * `importarDesde` para agora: o pedido feito enquanto a loja estava sem
 * token já foi atendido no Geraldo, e entrar agora seria comanda velha.
 *
 * A loja ativa em outra conta é recusada e a linha dela NÃO é tocada: o ID
 * Magalu emite um par novo sem matar o antigo, então a outra conta continua
 * funcionando com o que tem.
 */
export async function gravarAutorizacao(n: NovaAutorizacao): Promise<ResultadoDaAutorizacao> {
  await garantirTabela();
  const credencial = randomBytes(12).toString("hex");
  const access = cifrar(n.tokens.accessToken);
  const refresh = n.tokens.refreshToken ? cifrar(n.tokens.refreshToken) : null;
  const saida: ResultadoDaAutorizacao = { ligadas: [], recusadas: [] };

  for (const loja of n.lojas) {
    const storeId = String(loja.storeId).trim();
    if (!storeId) continue;
    const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AiqfomeInstalacao" WHERE "storeId" = $1`, storeId);
    const existente = linhas[0] ? ler(linhas[0]) : null;
    if (existente && existente.ativa && existente.franchiseeId !== n.franchiseeId) {
      saida.recusadas.push({
        storeId,
        nome: loja.nome,
        motivo: `A loja "${loja.nome || existente.nome || storeId}" do aiqfome já está ligada a outra conta do FireHub. Desligue lá antes de ligar aqui.`,
      });
      continue;
    }
    if (existente) {
      await prisma.$executeRawUnsafe(
        `UPDATE "AiqfomeInstalacao" SET "franchiseeId" = $2, "nome" = COALESCE($3, "nome"), "credencial" = $4, "accessToken" = $5, "refreshToken" = $6, "tokenExpiraEm" = $7, "escopos" = $8, "estado" = 'ok', "motivoDoEstado" = NULL, "ativa" = true, "desligadaEm" = NULL, "conectadaEm" = now(), "conectadaPor" = $9, "importarDesde" = now() WHERE "id" = $1::bigint`,
        existente.id,
        n.franchiseeId,
        loja.nome,
        credencial,
        access,
        refresh,
        n.tokens.expiraEm,
        n.tokens.escopos,
        n.quem,
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AiqfomeInstalacao" ("storeId","franchiseeId","nome","credencial","accessToken","refreshToken","tokenExpiraEm","escopos","conectadaPor") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        storeId,
        n.franchiseeId,
        loja.nome,
        credencial,
        access,
        refresh,
        n.tokens.expiraEm,
        n.tokens.escopos,
        n.quem,
      );
    }
    const gravada = await instalacaoAtiva(storeId);
    if (gravada) saida.ligadas.push(gravada);
  }
  return saida;
}

/** Desliga esta loja do aiqfome NESTA conta (nunca a de outra) e apaga os tokens dela. */
export async function desligarInstalacao(franchiseeId: string, storeId: string): Promise<InstalacaoAQ | null> {
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "AiqfomeInstalacao" WHERE "franchiseeId" = $1 AND "storeId" = $2 AND "ativa" = true`,
    franchiseeId,
    String(storeId).trim(),
  );
  if (!linhas[0]) return null;
  const inst = ler(linhas[0]);
  await prisma.$executeRawUnsafe(
    `UPDATE "AiqfomeInstalacao" SET "ativa" = false, "desligadaEm" = now(), "accessToken" = NULL, "refreshToken" = NULL, "webhooksEm" = NULL WHERE "id" = $1::bigint`,
    inst.id,
  );
  return { ...inst, ativa: false };
}

// ── Sinais de vida (o que a tela mostra) ────────────────────────────────────

export async function registrarWebhook(storeId: string): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(`UPDATE "AiqfomeInstalacao" SET "ultimoWebhookEm" = now() WHERE "storeId" = $1 AND "ativa" = true`, String(storeId));
  } catch (e: any) {
    console.warn("[aiqfome] não registrei o webhook:", e?.message);
  }
}

export async function registrarPedido(instalacaoId: string, soPeloPolling: boolean): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      soPeloPolling
        ? `UPDATE "AiqfomeInstalacao" SET "ultimoPedidoEm" = now(), "ultimoSoPeloPollingEm" = now() WHERE "id" = $1::bigint`
        : `UPDATE "AiqfomeInstalacao" SET "ultimoPedidoEm" = now() WHERE "id" = $1::bigint`,
      instalacaoId,
    );
  } catch (e: any) {
    console.warn("[aiqfome] não registrei o pedido na instalação:", e?.message);
  }
}

/** O resultado do cadastro dos webhooks na loja (erro = a tela avisa; o polling segura). */
export async function registrarCadastroDeWebhooks(instalacaoId: string, erro: string | null): Promise<void> {
  try {
    await garantirTabela();
    await prisma.$executeRawUnsafe(
      erro
        ? `UPDATE "AiqfomeInstalacao" SET "webhooksEm" = NULL, "webhooksErro" = $2 WHERE "id" = $1::bigint`
        : `UPDATE "AiqfomeInstalacao" SET "webhooksEm" = now(), "webhooksErro" = NULL WHERE "id" = $1::bigint`,
      ...(erro ? [instalacaoId, String(erro).slice(0, 300)] : [instalacaoId]),
    );
  } catch (e: any) {
    console.warn("[aiqfome] não registrei o cadastro dos webhooks:", e?.message);
  }
}

const FOLGA_DO_WEBHOOK_MS = 10 * 60_000;

/**
 * O webhook está mudo? Só faz sentido com webhook cadastrado: o polling trouxe
 * pedido que o webhook não trouxe, e nenhum webhook chegou depois disso.
 */
export function webhookMudo(inst: Pick<InstalacaoAQ, "ativa" | "webhooksEm" | "ultimoSoPeloPollingEm" | "ultimoWebhookEm">): boolean {
  if (!inst.ativa || !inst.webhooksEm || !inst.ultimoSoPeloPollingEm) return false;
  if (!inst.ultimoWebhookEm) return true;
  return inst.ultimoWebhookEm.getTime() < inst.ultimoSoPeloPollingEm.getTime() - FOLGA_DO_WEBHOOK_MS;
}
