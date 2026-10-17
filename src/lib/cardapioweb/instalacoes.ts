/**
 * lib/cardapioweb/instalacoes.ts — qual loja do CardápioWeb cai em qual conta do FireHub.
 *
 * ── N para 1 ────────────────────────────────────────────────────────────────
 *
 * No CardápioWeb cada marca é uma loja (company) e cada loja autoriza o app
 * separadamente, com tokens próprios. Várias delas podem cair na MESMA conta
 * do FireHub — a `KeetaLoja` (uma loja de lá por conta) não serve. Aqui a
 * chave é (ambiente, companyId), única: uma loja do CardápioWeb nunca fica
 * ligada a duas contas ao mesmo tempo.
 *
 * O vínculo nasce SÓ do `company.id` que o próprio CardápioWeb devolve no
 * `identity/context` com o token recém-trocado (lib/cardapioweb/oauth.ts e a
 * rota de retorno). Nada de "primeira loja ativa" (JotaJá, 14/08/2026), nada
 * de herdar o vínculo antigo ao reconectar (iFood, Pastel da Paulista caindo
 * no merchant da Hakim): pedido de loja sem instalação ativa não grava em
 * conta nenhuma.
 *
 * ── Tokens cifrados ──────────────────────────────────────────────────────────
 *
 * access_token e refresh_token vão pelo cofre (lib/cofre.ts, AES-256-GCM):
 * quem lê o banco não sai com o poder de mexer nos pedidos de todas as lojas.
 * Token que não abre (chave trocada) é o mesmo que não ter — a loja reconecta.
 *
 * Tabelas próprias, criadas no primeiro uso (o molde de lib/keeta/lojas.ts):
 * schema do Prisma intocado, nenhuma loja fora do CardápioWeb toca nelas.
 */
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";
import type { AmbienteCW } from "./id-do-pedido";

let pronta: Promise<void> | null = null;
function garantirTabelas(): Promise<void> {
  if (!pronta) {
    pronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CardapioWebInstalacao" (
          "id"                    BIGSERIAL PRIMARY KEY,
          "ambiente"              TEXT NOT NULL,
          "companyId"             TEXT NOT NULL,
          "franchiseeId"          TEXT NOT NULL,
          "nome"                  TEXT,
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
          "cwUserId"              TEXT,
          "cwUserEmail"           TEXT,
          "importarDesde"         TIMESTAMPTZ NOT NULL DEFAULT now(),
          "cursorDoPolling"       TIMESTAMPTZ,
          "ultimoPedidoEm"        TIMESTAMPTZ,
          "ultimoWebhookEm"       TIMESTAMPTZ,
          "ultimoSoPeloPollingEm" TIMESTAMPTZ,
          UNIQUE ("ambiente", "companyId")
        )`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CardapioWebInstalacao_loja" ON "CardapioWebInstalacao" ("franchiseeId")`);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CardapioWebConta" (
          "franchiseeId"        TEXT PRIMARY KEY,
          "receberMarketplaces" BOOLEAN NOT NULL DEFAULT false,
          "atualizadaEm"        TIMESTAMPTZ NOT NULL DEFAULT now(),
          "atualizadaPor"       TEXT
        )`);
    })().catch((e) => {
      pronta = null;
      throw e;
    });
  }
  return pronta;
}

export type EstadoDaInstalacao = "ok" | "reconectar";

export type InstalacaoCW = {
  id: string;
  ambiente: AmbienteCW;
  companyId: string;
  franchiseeId: string;
  nome: string | null;
  estado: EstadoDaInstalacao;
  motivoDoEstado: string | null;
  ativa: boolean;
  conectadaEm: Date;
  /** Pedido criado antes disto não entra: a 1ª conexão traz até 8 h de histórico. */
  importarDesde: Date;
  cursorDoPolling: Date | null;
  ultimoPedidoEm: Date | null;
  ultimoWebhookEm: Date | null;
  /** O polling trouxe um pedido que o webhook não trouxe (é como se percebe o webhook pausado). */
  ultimoSoPeloPollingEm: Date | null;
  tokenExpiraEm: Date | null;
};

const data = (v: unknown): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
};

const ler = (l: any): InstalacaoCW => ({
  id: String(l.id),
  ambiente: l.ambiente === "sandbox" ? "sandbox" : "producao",
  companyId: String(l.companyId),
  franchiseeId: String(l.franchiseeId),
  nome: l.nome ?? null,
  estado: l.estado === "reconectar" ? "reconectar" : "ok",
  motivoDoEstado: l.motivoDoEstado ?? null,
  ativa: !!l.ativa,
  conectadaEm: data(l.conectadaEm) || new Date(0),
  importarDesde: data(l.importarDesde) || data(l.conectadaEm) || new Date(0),
  cursorDoPolling: data(l.cursorDoPolling),
  ultimoPedidoEm: data(l.ultimoPedidoEm),
  ultimoWebhookEm: data(l.ultimoWebhookEm),
  ultimoSoPeloPollingEm: data(l.ultimoSoPeloPollingEm),
  tokenExpiraEm: data(l.tokenExpiraEm),
});

/** A instalação ATIVA desta loja do CardápioWeb — é a única que recebe pedido. */
export async function instalacaoAtiva(ambiente: AmbienteCW, companyId: string | number | null | undefined): Promise<InstalacaoCW | null> {
  if (companyId === null || companyId === undefined || String(companyId).trim() === "") return null;
  await garantirTabelas();
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CardapioWebInstalacao" WHERE "ambiente" = $1 AND "companyId" = $2 AND "ativa" = true`,
    ambiente,
    String(companyId).trim(),
  );
  return linhas[0] ? ler(linhas[0]) : null;
}

export async function instalacoesAtivas(): Promise<InstalacaoCW[]> {
  try {
    await garantirTabelas();
    const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "CardapioWebInstalacao" WHERE "ativa" = true ORDER BY "id"`);
    return linhas.map(ler);
  } catch (e: any) {
    console.error("[CardápioWeb] não li as instalações:", e?.message);
    return [];
  }
}

/** As instalações ativas destas lojas do FireHub (a conta e o grupo dela). */
export async function instalacoesDasLojas(franchiseeIds: string[]): Promise<InstalacaoCW[]> {
  const ids = Array.from(new Set(franchiseeIds.filter(Boolean)));
  if (ids.length === 0) return [];
  await garantirTabelas();
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CardapioWebInstalacao" WHERE "franchiseeId" = ANY($1::text[]) AND "ativa" = true ORDER BY "id"`,
    ids,
  );
  return linhas.map(ler);
}

// ── Tokens ──────────────────────────────────────────────────────────────────

export type TokensGuardados = { accessToken: string | null; refreshToken: string | null; expiraEm: Date | null };

export async function lerTokens(instalacaoId: string): Promise<TokensGuardados | null> {
  await garantirTabelas();
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "accessToken", "refreshToken", "tokenExpiraEm", "ativa" FROM "CardapioWebInstalacao" WHERE "id" = $1::bigint`,
    instalacaoId,
  );
  const l = linhas[0];
  if (!l || !l.ativa) return null;
  return { accessToken: decifrar(l.accessToken), refreshToken: decifrar(l.refreshToken), expiraEm: data(l.tokenExpiraEm) };
}

export async function gravarTokens(
  instalacaoId: string,
  t: { accessToken: string; refreshToken: string | null; expiraEm: Date; escopos?: string | null },
): Promise<void> {
  await garantirTabelas();
  await prisma.$executeRawUnsafe(
    `UPDATE "CardapioWebInstalacao" SET "accessToken" = $2, "refreshToken" = $3, "tokenExpiraEm" = $4, "escopos" = COALESCE($5, "escopos"), "estado" = 'ok', "motivoDoEstado" = NULL WHERE "id" = $1::bigint`,
    instalacaoId,
    cifrar(t.accessToken),
    t.refreshToken ? cifrar(t.refreshToken) : null,
    t.expiraEm,
    t.escopos ?? null,
  );
}

/** Token recusado de vez: a tela mostra "reconectar" e o polling para de bater nesta loja. */
export async function marcarReconectar(instalacaoId: string, motivo: string): Promise<void> {
  try {
    await garantirTabelas();
    await prisma.$executeRawUnsafe(
      `UPDATE "CardapioWebInstalacao" SET "estado" = 'reconectar', "motivoDoEstado" = $2 WHERE "id" = $1::bigint`,
      instalacaoId,
      String(motivo).slice(0, 300),
    );
  } catch (e: any) {
    console.error(`[CardápioWeb] não marquei a instalação ${instalacaoId} para reconectar:`, e?.message);
  }
}

// ── Ligar e desligar ────────────────────────────────────────────────────────

export type NovaInstalacao = {
  ambiente: AmbienteCW;
  companyId: string;
  franchiseeId: string;
  nome: string | null;
  tokens: { accessToken: string; refreshToken: string | null; expiraEm: Date; escopos: string | null };
  quem: string;
  cwUserId?: string | null;
  cwUserEmail?: string | null;
};

/**
 * Grava (ou religa) a instalação. Recusa — com motivo — a loja do CardápioWeb
 * que está ATIVA em outra conta do FireHub: é o erro que faz o pedido de uma
 * loja cair no painel da outra.
 *
 * Mesmo recusando, os tokens novos vão para a instalação que já existe: o
 * CardápioWeb troca os tokens da instalação a cada autorização, então os que a
 * outra conta guarda acabaram de morrer. Guardar os novos lá é o que impede
 * que uma tentativa errada derrube a integração de quem está certo.
 *
 * (Re)ligar move o `importarDesde` para agora: o pedido feito enquanto a
 * loja estava sem token já foi atendido pelo CardápioWeb, e entrar agora seria
 * comanda velha saindo na cozinha. O cursor do polling só recomeça quando a
 * loja estava DESLIGADA (ou vem de outra conta); na reconexão de quem estava
 * ligado ele fica onde estava, para o cancelamento feito lá no meio do
 * apagão ainda chegar aos pedidos que já estão aqui.
 */
export async function gravarInstalacao(n: NovaInstalacao): Promise<{ ok: true; instalacao: InstalacaoCW; nova: boolean } | { ok: false; motivo: string }> {
  await garantirTabelas();
  const companyId = String(n.companyId).trim();
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CardapioWebInstalacao" WHERE "ambiente" = $1 AND "companyId" = $2`,
    n.ambiente,
    companyId,
  );
  const existente = linhas[0] ? ler(linhas[0]) : null;
  const access = cifrar(n.tokens.accessToken);
  const refresh = n.tokens.refreshToken ? cifrar(n.tokens.refreshToken) : null;

  if (existente && existente.ativa && existente.franchiseeId !== n.franchiseeId) {
    await gravarTokens(existente.id, n.tokens).catch(() => {});
    return {
      ok: false,
      motivo: `A loja "${n.nome || existente.nome || companyId}" do CardápioWeb já está ligada a outra conta do FireHub. Desligue lá antes de ligar aqui.`,
    };
  }

  if (existente) {
    const reconexaoDaMesmaLoja = existente.ativa && existente.franchiseeId === n.franchiseeId;
    await prisma.$executeRawUnsafe(
      `UPDATE "CardapioWebInstalacao" SET "franchiseeId" = $2, "nome" = COALESCE($3, "nome"), "accessToken" = $4, "refreshToken" = $5, "tokenExpiraEm" = $6, "escopos" = $7, "estado" = 'ok', "motivoDoEstado" = NULL, "ativa" = true, "desligadaEm" = NULL, "conectadaEm" = now(), "conectadaPor" = $8, "cwUserId" = $9, "cwUserEmail" = $10, "importarDesde" = now()${reconexaoDaMesmaLoja ? "" : `, "cursorDoPolling" = now()`} WHERE "id" = $1::bigint`,
      existente.id,
      n.franchiseeId,
      n.nome,
      access,
      refresh,
      n.tokens.expiraEm,
      n.tokens.escopos,
      n.quem,
      n.cwUserId ?? null,
      n.cwUserEmail ?? null,
    );
    const depois = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "CardapioWebInstalacao" WHERE "id" = $1::bigint`, existente.id);
    return { ok: true, instalacao: ler(depois[0] ?? { ...linhas[0], ativa: true, franchiseeId: n.franchiseeId }), nova: false };
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "CardapioWebInstalacao" ("ambiente","companyId","franchiseeId","nome","accessToken","refreshToken","tokenExpiraEm","escopos","conectadaPor","cwUserId","cwUserEmail","cursorDoPolling") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
    n.ambiente,
    companyId,
    n.franchiseeId,
    n.nome,
    access,
    refresh,
    n.tokens.expiraEm,
    n.tokens.escopos,
    n.quem,
    n.cwUserId ?? null,
    n.cwUserEmail ?? null,
  );
  const nova = await instalacaoAtiva(n.ambiente, companyId);
  if (!nova) throw new Error("a instalação gravada não foi encontrada em seguida");
  return { ok: true, instalacao: nova, nova: true };
}

/**
 * Desliga as instalações desta loja do CardápioWeb NESTA conta (nunca a de
 * outra conta) e apaga os tokens. Devolve o que estava gravado, para quem
 * chamou revogar lá.
 */
export async function desligarInstalacao(
  franchiseeId: string,
  companyId: string,
  ambiente?: AmbienteCW | null,
): Promise<Array<{ instalacao: InstalacaoCW; tokens: TokensGuardados | null }>> {
  await garantirTabelas();
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CardapioWebInstalacao" WHERE "franchiseeId" = $1 AND "companyId" = $2 AND "ativa" = true`,
    franchiseeId,
    String(companyId).trim(),
  );
  const saida: Array<{ instalacao: InstalacaoCW; tokens: TokensGuardados | null }> = [];
  for (const l of linhas) {
    const inst = ler(l);
    if (ambiente && inst.ambiente !== ambiente) continue;
    const tokens = await lerTokens(inst.id).catch(() => null);
    await prisma.$executeRawUnsafe(
      `UPDATE "CardapioWebInstalacao" SET "ativa" = false, "desligadaEm" = now(), "accessToken" = NULL, "refreshToken" = NULL WHERE "id" = $1::bigint`,
      inst.id,
    );
    saida.push({ instalacao: { ...inst, ativa: false }, tokens });
  }
  return saida;
}

// ── Sinais de vida (o que a tela mostra) ────────────────────────────────────

/** O webhook falou desta loja: a prova de que não está pausado. */
export async function registrarWebhook(ambiente: AmbienteCW, companyId: string): Promise<void> {
  try {
    await garantirTabelas();
    await prisma.$executeRawUnsafe(
      `UPDATE "CardapioWebInstalacao" SET "ultimoWebhookEm" = now() WHERE "ambiente" = $1 AND "companyId" = $2 AND "ativa" = true`,
      ambiente,
      String(companyId),
    );
  } catch (e: any) {
    console.warn("[CardápioWeb] não registrei o webhook:", e?.message);
  }
}

/** Entrou um pedido; `soPeloPolling` = o webhook não tinha trazido. */
export async function registrarPedido(instalacaoId: string, soPeloPolling: boolean): Promise<void> {
  try {
    await garantirTabelas();
    await prisma.$executeRawUnsafe(
      soPeloPolling
        ? `UPDATE "CardapioWebInstalacao" SET "ultimoPedidoEm" = now(), "ultimoSoPeloPollingEm" = now() WHERE "id" = $1::bigint`
        : `UPDATE "CardapioWebInstalacao" SET "ultimoPedidoEm" = now() WHERE "id" = $1::bigint`,
      instalacaoId,
    );
  } catch (e: any) {
    console.warn("[CardápioWeb] não registrei o pedido na instalação:", e?.message);
  }
}

export async function gravarCursor(instalacaoId: string, cursor: Date): Promise<void> {
  await garantirTabelas();
  await prisma.$executeRawUnsafe(`UPDATE "CardapioWebInstalacao" SET "cursorDoPolling" = $2 WHERE "id" = $1::bigint`, instalacaoId, cursor);
}

/** Folga entre o polling achar o pedido e o webhook chegar: o webhook às vezes perde a corrida por segundos. */
const FOLGA_DO_WEBHOOK_MS = 10 * 60_000;

/**
 * O webhook está mudo? O CardápioWeb PAUSA o webhook depois de 15 falhas e só
 * religa por e-mail — e ninguém avisa. A pista é o polling trazendo pedido
 * que o webhook não trouxe, sem webhook nenhum depois disso. O polling segura
 * a operação (30 s); a tela avisa para alguém pedir a reativação.
 */
export function webhookMudo(inst: Pick<InstalacaoCW, "ativa" | "ultimoSoPeloPollingEm" | "ultimoWebhookEm">): boolean {
  if (!inst.ativa || !inst.ultimoSoPeloPollingEm) return false;
  if (!inst.ultimoWebhookEm) return true;
  return inst.ultimoWebhookEm.getTime() < inst.ultimoSoPeloPollingEm.getTime() - FOLGA_DO_WEBHOOK_MS;
}

// ── A opção da conta ────────────────────────────────────────────────────────

/**
 * "Receber marketplaces pelo CardápioWeb" — desligada por padrão. O
 * CardápioWeb repassa iFood/99/Keeta/aiqfome no mesmo webhook; com o iFood e o
 * 99 ligados direto no FireHub, aceitar os dois caminhos é pedido em dobro na
 * cozinha. Só liga quem NÃO tem a integração direta.
 */
export async function recebeMarketplaces(franchiseeId: string): Promise<boolean> {
  try {
    await garantirTabelas();
    const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT "receberMarketplaces" FROM "CardapioWebConta" WHERE "franchiseeId" = $1`, franchiseeId);
    return !!linhas[0]?.receberMarketplaces;
  } catch {
    return false;
  }
}

export async function definirRecebeMarketplaces(franchiseeId: string, ligado: boolean, quem: string): Promise<void> {
  await garantirTabelas();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CardapioWebConta" ("franchiseeId","receberMarketplaces","atualizadaPor") VALUES ($1,$2,$3) ON CONFLICT ("franchiseeId") DO UPDATE SET "receberMarketplaces" = EXCLUDED."receberMarketplaces", "atualizadaEm" = now(), "atualizadaPor" = EXCLUDED."atualizadaPor"`,
    franchiseeId,
    ligado,
    quem,
  );
}
