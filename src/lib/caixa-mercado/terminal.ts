/**
 * O COMPUTADOR DO CAIXA — pareado como o tablet da mesa: o dono, logado NO
 * computador que vai ser caixa, clica "Registrar este computador". O servidor
 * cria o terminal ("Caixa 1", "Caixa 2"…) e devolve um cookie próprio
 * (`firehub_caixa_mercado`, httpOnly, 2 anos); no banco fica só o sha256.
 *
 * É por computador que o módulo cobra (R$ 97 por computador em uso no mês):
 * cada venda e cada turno aberto marcam o dia de uso (CaixaMercadoUso).
 *
 * O TEF do computador é uma "licença" `caixa:<terminalId>` no motor do totem
 * (lib/tef-do-totem.ts): o mesmo Assistente, o mesmo simulador.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCaixa, MENSAGEM_SEM_ESTRUTURA } from "./estrutura";

export const COOKIE_DO_CAIXA = "firehub_caixa_mercado";
export const VALIDADE_DO_COOKIE_S = 2 * 365 * 24 * 60 * 60;
const hash = (token: string) => crypto.createHash("sha256").update(`firehub-caixa:${token}`).digest("hex");

export type TerminalDoCaixa = { id: string; lojaId: string; numero: number; nome: string; ultimoSinal: string | null; criadoEm: string; ativo: boolean };

const publico = (l: any): TerminalDoCaixa => ({
  id: l.id, lojaId: l.lojaId, numero: Number(l.numero), nome: l.nome,
  ultimoSinal: l.ultimoSinal ? new Date(l.ultimoSinal).toISOString() : null,
  criadoEm: new Date(l.criadoEm).toISOString(),
  ativo: !l.desativadoEm,
});

/** A licença do TEF deste computador (a chave em TefDoTotem). */
export const licencaTefDoTerminal = (terminalId: string) => `caixa:${terminalId}`;

export async function terminaisDaLoja(lojaId: string): Promise<TerminalDoCaixa[]> {
  if (!(await garantirEstruturaDoCaixa())) return [];
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CaixaMercadoTerminal" WHERE "lojaId" = $1 AND "desativadoEm" IS NULL ORDER BY "numero" ASC`,
    lojaId,
  );
  return linhas.map(publico);
}

/** O terminal do cookie, se é desta loja e está ativo. */
export async function terminalDoCookie(token: string | null | undefined, lojaId: string): Promise<TerminalDoCaixa | null> {
  if (!token || token.length < 20) return null;
  if (!(await garantirEstruturaDoCaixa())) return null;
  const [l] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CaixaMercadoTerminal" WHERE "tokenHash" = $1 AND "lojaId" = $2 AND "desativadoEm" IS NULL`,
    hash(token), lojaId,
  );
  if (!l) return null;
  await prisma.$executeRawUnsafe(`UPDATE "CaixaMercadoTerminal" SET "ultimoSinal" = (NOW() AT TIME ZONE 'UTC') WHERE "id" = $1`, l.id).catch(() => {});
  return publico(l);
}

export async function registrarTerminal(lojaId: string, nome: string | null, por: string | null): Promise<{ terminal: TerminalDoCaixa; token: string }> {
  if (!(await garantirEstruturaDoCaixa())) throw new Error(MENSAGEM_SEM_ESTRUTURA);
  const token = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const [{ proximo }] = await prisma.$queryRawUnsafe<{ proximo: number }[]>(
    `SELECT COALESCE(MAX("numero"), 0) + 1 AS "proximo" FROM "CaixaMercadoTerminal" WHERE "lojaId" = $1`,
    lojaId,
  );
  const numero = Number(proximo);
  const rotulo = (nome || "").trim().slice(0, 40) || `Caixa ${numero}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CaixaMercadoTerminal" ("id", "lojaId", "numero", "nome", "tokenHash", "criadoPor", "criadoEm", "ultimoSinal")
     VALUES ($1, $2, $3, $4, $5, $6, (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))`,
    id, lojaId, numero, rotulo, hash(token), por,
  );
  const [l] = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "CaixaMercadoTerminal" WHERE "id" = $1`, id);
  return { terminal: publico(l), token };
}

export async function desativarTerminal(lojaId: string, terminalId: string): Promise<boolean> {
  if (!(await garantirEstruturaDoCaixa())) return false;
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "CaixaMercadoTerminal" SET "desativadoEm" = (NOW() AT TIME ZONE 'UTC') WHERE "id" = $1 AND "lojaId" = $2 AND "desativadoEm" IS NULL`,
    terminalId, lojaId,
  );
  return Number(n) > 0;
}

/** Marca o dia de uso do computador (a base da cobrança). Nunca lança. */
export async function marcarUso(terminal: { id: string; lojaId: string }, agora: Date = new Date()): Promise<void> {
  try {
    const dia = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CaixaMercadoUso" ("terminalId", "lojaId", "dia", "em") VALUES ($1, $2, $3, ($4::timestamptz AT TIME ZONE 'UTC'))
       ON CONFLICT ("terminalId", "dia") DO NOTHING`,
      terminal.id, terminal.lojaId, dia, agora.toISOString(),
    );
  } catch (err: any) {
    console.error("[Caixa de mercado] uso do computador não gravou:", err?.message);
  }
}
