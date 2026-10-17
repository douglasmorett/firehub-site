/**
 * lib/cardapioweb/oauth.ts — o "Conectar com o CardápioWeb": PKCE e o `state`.
 *
 * O CardápioWeb usa OAuth 2.0 com PKCE (S256) e SEM segredo: o app de
 * integradora é cliente público. A segurança está em três coisas, todas aqui:
 *
 *   1. `code_verifier` aleatório (64 caracteres), que nunca sai do servidor —
 *      vai cifrado para o banco e só volta na troca do código.
 *   2. `state` aleatório e OPACO. A doc proíbe pôr nele o id de usuário ou de
 *      loja; por isso o cookie assinado da Keeta (lib/keeta/vinculo.ts) e o
 *      state do Meta (lib/meta-oauth-state.ts) não servem. O state é só uma
 *      senha de uso único: o banco guarda o hash dele com a loja que clicou.
 *   3. No retorno: state que o FireHub emitiu, no prazo (30 min), nunca usado,
 *      e da MESMA loja da sessão. Link aberto no painel de outra loja ia
 *      amarrar a autorização à loja errada (foi assim no 99Food).
 *
 * Tabela própria, criada no primeiro uso. O que passou de 2 dias é apagado de
 * carona na próxima conexão.
 */
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";
import { clientIdDo, urlDoPortal } from "./api";
import type { AmbienteCW } from "./id-do-pedido";

export const PRAZO_DO_STATE_MS = 30 * 60_000;

let pronta: Promise<void> | null = null;
function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = prisma
      .$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CardapioWebEstadoOAuth" (
          "stateHash"     TEXT PRIMARY KEY,
          "franchiseeId"  TEXT NOT NULL,
          "ambiente"      TEXT NOT NULL,
          "codeVerifier"  TEXT NOT NULL,
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

/** 48 bytes → 64 caracteres base64url (a doc pede 43 a 128). */
export function gerarVerificador(): string {
  return base64url(randomBytes(48));
}

/** `code_challenge` = base64url(SHA-256(verifier)), sem "=". */
export function desafioPkce(verificador: string): string {
  return base64url(createHash("sha256").update(verificador).digest());
}

export function gerarState(): string {
  return base64url(randomBytes(32));
}

/** O banco guarda o hash: quem lê a tabela não completa a autorização de ninguém. */
const hashDoState = (state: string) => createHash("sha256").update(`cardapioweb-state:${state}`).digest("hex");

/**
 * A Redirect URI cadastrada no app do CardápioWeb — tem de ser IDÊNTICA
 * (protocolo, domínio, caminho, barra final) no redirect e na troca do código.
 * `CARDAPIOWEB_REDIRECT_URI` só existe para teste em túnel (ngrok); em
 * produção sai do endereço do FireHub.
 */
export function redirectUriDoCardapioWeb(host?: string | null): string {
  const fixa = String(process.env.CARDAPIOWEB_REDIRECT_URI || "").trim();
  if (fixa) return fixa;
  return `${urlDoFireHub(host)}/api/store/integracoes/cardapioweb/retorno`;
}

/** O endereço público do FireHub (o mesmo critério de lib/keeta/vinculo.ts). */
export function urlDoFireHub(host?: string | null): string {
  return (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || (host ? `https://${host}` : "https://firehubfood.com.br")).replace(/\/+$/, "");
}

/**
 * Começa a conexão: guarda state + verifier presos à loja e devolve a URL do
 * portal (`/cw-apps`) para o navegador ir. Quem abre essa URL tem de estar
 * logado no CardápioWeb como PROPRIETÁRIO — outro perfil volta `access_denied`.
 */
export async function iniciarConexao(p: { franchiseeId: string; ambiente: AmbienteCW; quem: string; host?: string | null }): Promise<{ url: string }> {
  await garantirTabela();
  const state = gerarState();
  const verificador = gerarVerificador();
  const redirectUri = redirectUriDoCardapioWeb(p.host);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CardapioWebEstadoOAuth" ("stateHash","franchiseeId","ambiente","codeVerifier","redirectUri","criadoPor","expiraEm") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    hashDoState(state),
    p.franchiseeId,
    p.ambiente,
    cifrar(verificador),
    redirectUri,
    p.quem,
    new Date(Date.now() + PRAZO_DO_STATE_MS),
  );
  prisma.$executeRawUnsafe(`DELETE FROM "CardapioWebEstadoOAuth" WHERE "criadoEm" < now() - interval '2 days'`).catch(() => {});

  const url = new URL(urlDoPortal(p.ambiente));
  url.searchParams.set("client_id", clientIdDo(p.ambiente));
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", desafioPkce(verificador));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString() };
}

export type EstadoConsumido =
  | { ok: true; ambiente: AmbienteCW; codeVerifier: string; redirectUri: string; franchiseeId: string }
  | { ok: false; motivo: string };

/**
 * O state do retorno vale? Confere tudo ANTES de queimar: o state de outra
 * loja não é gasto (a loja certa ainda pode terminar a conexão dela). O "uso
 * único" é um UPDATE condicional — dois retornos com o mesmo state ao mesmo
 * tempo, só um passa.
 */
export async function consumirEstado(state: string | null | undefined, franchiseeIdDaSessao: string, agora = Date.now()): Promise<EstadoConsumido> {
  if (!state || state.length < 20 || state.length > 200) return { ok: false, motivo: "A volta do CardápioWeb chegou sem a conexão. Clique em Conectar de novo." };
  await garantirTabela();
  const h = hashDoState(state);
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "CardapioWebEstadoOAuth" WHERE "stateHash" = $1`, h);
  const l = linhas[0];
  if (!l) return { ok: false, motivo: "Esta conexão não foi aberta pelo FireHub. Clique em Conectar de novo." };
  if (l.usadoEm) return { ok: false, motivo: "Esta conexão já foi usada. Clique em Conectar de novo." };
  const expira = new Date(l.expiraEm).getTime();
  if (!Number.isFinite(expira) || expira < agora) return { ok: false, motivo: "A conexão expirou (30 min). Clique em Conectar de novo." };
  if (String(l.franchiseeId) !== franchiseeIdDaSessao) {
    return { ok: false, motivo: "A conexão foi aberta no painel de outra loja. Entre na loja certa e clique em Conectar de novo." };
  }
  const verificador = decifrar(l.codeVerifier);
  if (!verificador) return { ok: false, motivo: "Não consegui ler a conexão guardada. Clique em Conectar de novo." };
  const gastou = await prisma.$executeRawUnsafe(`UPDATE "CardapioWebEstadoOAuth" SET "usadoEm" = now() WHERE "stateHash" = $1 AND "usadoEm" IS NULL`, h);
  if (Number(gastou) !== 1) return { ok: false, motivo: "Esta conexão já foi usada. Clique em Conectar de novo." };
  return {
    ok: true,
    ambiente: l.ambiente === "sandbox" ? "sandbox" : "producao",
    codeVerifier: verificador,
    redirectUri: String(l.redirectUri),
    franchiseeId: String(l.franchiseeId),
  };
}
