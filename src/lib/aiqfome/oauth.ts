/**
 * lib/aiqfome/oauth.ts — o "Conectar com o aiqfome": a ida ao ID Magalu e o `state`.
 *
 * O aiqfome autoriza pelo ID Magalu (OAuth 2.0 com client_secret, sem PKCE).
 * O guia deles manda pôr o id da loja do ERP no `state`; aqui o state é
 * ALEATÓRIO e opaco (o molde de lib/cardapioweb/oauth.ts), e o banco guarda o
 * hash dele com a conta que clicou. No retorno: state que o FireHub emitiu,
 * no prazo (30 min), nunca usado, e da MESMA conta da sessão — link aberto
 * no painel de outra loja amarrava a autorização à loja errada (99Food).
 *
 * Os escopos vão separados por espaço (codificado como %20). A doc não diz
 * o separador do parâmetro; espaço é o do OAuth 2.0 e é o que o ID Magalu
 * devolve no `scope` do token.
 */
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { ESCOPOS, clientId, redirectUriDoAiqfome, urlDoIdMagalu } from "./api";

export const PRAZO_DO_STATE_MS = 30 * 60_000;

let pronta: Promise<void> | null = null;
function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AiqfomeEstadoOAuth" (
          "stateHash"     TEXT PRIMARY KEY,
          "franchiseeId"  TEXT NOT NULL,
          "redirectUri"   TEXT NOT NULL,
          "criadoPor"     TEXT,
          "criadoEm"      TIMESTAMPTZ NOT NULL DEFAULT now(),
          "expiraEm"      TIMESTAMPTZ NOT NULL,
          "usadoEm"       TIMESTAMPTZ
        )`)
      .then(() => undefined)
      .catch((e) => {
        pronta = null;
        throw e;
      });
  }
  return pronta;
}

const base64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hashDoState = (state: string) => createHash("sha256").update(`aiqfome-state:${state}`).digest("hex");

/** Começa a conexão: guarda o state preso à conta e devolve a URL do ID Magalu. */
export async function iniciarConexao(p: { franchiseeId: string; quem: string; host?: string | null }): Promise<{ url: string }> {
  await garantirTabela();
  const state = base64url(randomBytes(32));
  const redirectUri = redirectUriDoAiqfome(p.host);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AiqfomeEstadoOAuth" ("stateHash","franchiseeId","redirectUri","criadoPor","expiraEm") VALUES ($1,$2,$3,$4,$5)`,
    hashDoState(state),
    p.franchiseeId,
    redirectUri,
    p.quem,
    new Date(Date.now() + PRAZO_DO_STATE_MS),
  );
  prisma.$executeRawUnsafe(`DELETE FROM "AiqfomeEstadoOAuth" WHERE "criadoEm" < now() - interval '2 days'`).catch(() => {});

  const q = [
    ["client_id", clientId()],
    ["response_type", "code"],
    ["redirect_uri", redirectUri],
    ["scope", ESCOPOS.join(" ")],
    ["state", state],
    ["choose_tenants", "true"],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return { url: `${urlDoIdMagalu()}/login?${q}` };
}

export type EstadoConsumido = { ok: true; redirectUri: string; franchiseeId: string } | { ok: false; motivo: string };

/** O state do retorno vale? Confere tudo ANTES de queimar; o "uso único" é um UPDATE condicional. */
export async function consumirEstado(state: string | null | undefined, franchiseeIdDaSessao: string, agora = Date.now()): Promise<EstadoConsumido> {
  if (!state || state.length < 20 || state.length > 200) return { ok: false, motivo: "A volta do aiqfome chegou sem a conexão. Clique em Conectar de novo." };
  await garantirTabela();
  const h = hashDoState(state);
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "AiqfomeEstadoOAuth" WHERE "stateHash" = $1`, h);
  const l = linhas[0];
  if (!l) return { ok: false, motivo: "Esta conexão não foi aberta pelo FireHub. Clique em Conectar de novo." };
  if (l.usadoEm) return { ok: false, motivo: "Esta conexão já foi usada. Clique em Conectar de novo." };
  const expira = new Date(l.expiraEm).getTime();
  if (!Number.isFinite(expira) || expira < agora) return { ok: false, motivo: "A conexão expirou (30 min). Clique em Conectar de novo." };
  if (String(l.franchiseeId) !== franchiseeIdDaSessao) {
    return { ok: false, motivo: "A conexão foi aberta no painel de outra loja. Entre na loja certa e clique em Conectar de novo." };
  }
  const gastou = await prisma.$executeRawUnsafe(`UPDATE "AiqfomeEstadoOAuth" SET "usadoEm" = now() WHERE "stateHash" = $1 AND "usadoEm" IS NULL`, h);
  if (Number(gastou) !== 1) return { ok: false, motivo: "Esta conexão já foi usada. Clique em Conectar de novo." };
  return { ok: true, redirectUri: String(l.redirectUri), franchiseeId: String(l.franchiseeId) };
}
