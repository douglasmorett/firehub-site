/**
 * Os tablets presos às mesas: pareamento, o cookie do tablet, o sinal de vida
 * (que também é o uso cobrado) e o "chamou o garçom / pediu a conta".
 *
 * PAREAMENTO: o dono escolhe a mesa no painel e recebe um número de 6 dígitos
 * (vale 15 min). No tablet, firehubfood.com.br/tablet (ou o app FireHub, modo
 * "Tablet da mesa") pede o número. Acertou: o tablet ganha um cookie próprio
 * (`firehub_tablet`, httpOnly, 1 ano) e o servidor guarda só o sha256 dele.
 * Ninguém digita senha da loja no tablet que fica na mão do cliente.
 *
 * O tablet não carrega mesa no endereço: a mesa é a da linha do banco. Trocar
 * de mesa ou desligar o tablet é no painel, e vale no próximo sinal.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoTablet } from "./estrutura";

export const COOKIE_DO_TABLET = "firehub_tablet";
const VALIDADE_DO_CODIGO_MS = 15 * 60 * 1000;
/** Sem sinal há mais que isto: o painel mostra o tablet como desligado. */
export const TABLET_ONLINE_MS = 2 * 60 * 1000;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export type TabletDaLoja = {
  id: string;
  tableId: string;
  mesaNumero: number | null;
  mesaRotulo: string | null;
  pareado: boolean;
  codigo: string | null;
  codigoAte: string | null;
  ultimoSinal: string | null;
  online: boolean;
  modelo: string | null;
};

/** Os tablets da loja, com a mesa de cada um. */
export async function tabletsDaLoja(lojaId: string): Promise<TabletDaLoja[]> {
  if (!(await garantirEstruturaDoTablet())) return [];
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT t."id", t."tableId", t."tokenHash", t."codigo", t."codigoAte", t."ultimoSinal", t."modelo", m."number" AS "mesaNumero", m."label" AS "mesaRotulo"
       FROM "TabletDaMesa" t LEFT JOIN "Table" m ON m."id" = t."tableId"
      WHERE t."lojaId" = $1
      ORDER BY m."number" ASC NULLS LAST, t."criadoEm" ASC`,
    lojaId,
  );
  const agora = Date.now();
  return linhas
    // Código vencido de tablet que nunca entrou: a linha não serve para nada.
    .filter((l) => l.tokenHash || (l.codigoAte && new Date(l.codigoAte).getTime() > agora))
    .map((l) => ({
      id: l.id,
      tableId: l.tableId,
      mesaNumero: l.mesaNumero ?? null,
      mesaRotulo: l.mesaRotulo ?? null,
      pareado: Boolean(l.tokenHash),
      codigo: l.tokenHash ? null : l.codigo,
      codigoAte: l.tokenHash ? null : l.codigoAte ? new Date(l.codigoAte).toISOString() : null,
      ultimoSinal: l.ultimoSinal ? new Date(l.ultimoSinal).toISOString() : null,
      online: Boolean(l.ultimoSinal && agora - new Date(l.ultimoSinal).getTime() < TABLET_ONLINE_MS),
      modelo: l.modelo ?? null,
    }));
}

/**
 * Um número de 6 dígitos para parear um tablet novo nesta mesa. A mesa tem
 * que ser da loja. Devolve o código e até quando vale.
 */
export async function novoCodigoDePareamento(lojaId: string, tableId: string): Promise<{ codigo: string; ate: Date } | null> {
  if (!(await garantirEstruturaDoTablet())) return null;
  const mesa = await prisma.table.findFirst({ where: { id: tableId, franchiseeId: lojaId }, select: { id: true } });
  if (!mesa) return null;
  // Códigos vencidos de tablet que nunca entrou saem, para não ocupar número.
  await prisma.$executeRawUnsafe(`DELETE FROM "TabletDaMesa" WHERE "tokenHash" IS NULL AND "codigoAte" < NOW()`);
  const ate = new Date(Date.now() + VALIDADE_DO_CODIGO_MS);
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "TabletDaMesa" ("id", "lojaId", "tableId", "codigo", "codigoAte", "criadoEm") VALUES ($1, $2, $3, $4, $5, NOW())`,
        crypto.randomUUID(), lojaId, tableId, codigo, ate,
      );
      return { codigo, ate };
    } catch {
      // Número repetido (índice único): tenta outro.
    }
  }
  return null;
}

/**
 * O tablet digitou o código: devolve o token do cookie (só desta vez — o banco
 * guarda o hash) e a loja, ou null.
 */
export async function parearTablet(codigo: string, modelo: string | null): Promise<{ token: string; lojaId: string; tabletId: string } | null> {
  if (!/^\d{6}$/.test(codigo) || !(await garantirEstruturaDoTablet())) return null;
  const linhas = await prisma.$queryRawUnsafe<{ id: string; lojaId: string }[]>(
    `SELECT "id", "lojaId" FROM "TabletDaMesa" WHERE "codigo" = $1 AND "tokenHash" IS NULL AND "codigoAte" > NOW()`,
    codigo,
  );
  const t = linhas[0];
  if (!t) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const gravadas = await prisma.$executeRawUnsafe(
    `UPDATE "TabletDaMesa" SET "tokenHash" = $2, "codigo" = NULL, "codigoAte" = NULL, "modelo" = $3 WHERE "id" = $1 AND "tokenHash" IS NULL`,
    t.id, hash(token), modelo ? modelo.slice(0, 120) : null,
  );
  if (gravadas !== 1) return null;
  return { token, lojaId: t.lojaId, tabletId: t.id };
}

export type TabletAutenticado = {
  tabletId: string;
  lojaId: string;
  mesa: { id: string; numero: number; rotulo: string | null; ativa: boolean };
};

/** O tablet do cookie, com a mesa dele. null = cookie que não vale (tablet apagado). */
export async function tabletDoCookie(token: string | null | undefined): Promise<TabletAutenticado | null> {
  if (!token || token.length < 20 || !(await garantirEstruturaDoTablet())) return null;
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT t."id", t."lojaId", m."id" AS "mesaId", m."number", m."label", m."isActive", m."franchiseeId"
       FROM "TabletDaMesa" t JOIN "Table" m ON m."id" = t."tableId"
      WHERE t."tokenHash" = $1`,
    hash(token),
  );
  const l = linhas[0];
  if (!l || l.franchiseeId !== l.lojaId) return null;
  return { tabletId: l.id, lojaId: l.lojaId, mesa: { id: l.mesaId, numero: l.number, rotulo: l.label ?? null, ativa: Boolean(l.isActive) } };
}

/** Dia (AAAA-MM-DD) no fuso de Brasília: um uso por tablet por dia. */
function diaDeHoje(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

const usoJaMarcado = new Map<string, string>();

/**
 * Sinal de vida do tablet: atualiza o "visto agora" e marca o uso do dia (a
 * base da cobrança). O uso do dia é gravado uma vez por servidor; o banco
 * desempata (chave tablet + dia).
 */
export async function sinalDoTablet(t: TabletAutenticado, agora: Date = new Date()): Promise<void> {
  await prisma.$executeRawUnsafe(`UPDATE "TabletDaMesa" SET "ultimoSinal" = $2 WHERE "id" = $1`, t.tabletId, agora);
  const dia = diaDeHoje(agora);
  if (usoJaMarcado.get(t.tabletId) === dia) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TabletDaMesaUso" ("tabletId", "lojaId", "dia", "em") VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    t.tabletId, t.lojaId, dia, agora,
  );
  usoJaMarcado.set(t.tabletId, dia);
}

export async function trocarMesaDoTablet(lojaId: string, tabletId: string, tableId: string): Promise<boolean> {
  if (!(await garantirEstruturaDoTablet())) return false;
  const mesa = await prisma.table.findFirst({ where: { id: tableId, franchiseeId: lojaId }, select: { id: true } });
  if (!mesa) return false;
  const n = await prisma.$executeRawUnsafe(`UPDATE "TabletDaMesa" SET "tableId" = $3 WHERE "id" = $2 AND "lojaId" = $1`, lojaId, tabletId, tableId);
  return n === 1;
}

/** Tira o tablet: o cookie dele para de valer na hora. O uso já gravado continua (é a cobrança). */
export async function apagarTablet(lojaId: string, tabletId: string): Promise<boolean> {
  if (!(await garantirEstruturaDoTablet())) return false;
  const n = await prisma.$executeRawUnsafe(`DELETE FROM "TabletDaMesa" WHERE "id" = $2 AND "lojaId" = $1`, lojaId, tabletId);
  return n === 1;
}

// ── CHAMADOS ────────────────────────────────────────────────────────────────

export type MotivoDoChamado = "GARCOM" | "CONTA";
export type ChamadoDaMesa = { tableId: string; motivo: MotivoDoChamado; em: string };

/** Grava (ou troca) o chamado da mesa. "Pediu a conta" vence "chamou o garçom". */
export async function chamarNaMesa(t: TabletAutenticado, motivo: MotivoDoChamado): Promise<void> {
  if (!(await garantirEstruturaDoTablet())) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TabletDaMesaChamado" ("tableId", "lojaId", "motivo", "em") VALUES ($1, $2, $3, NOW())
     ON CONFLICT ("tableId") DO UPDATE SET
       "motivo" = CASE WHEN "TabletDaMesaChamado"."motivo" = 'CONTA' THEN 'CONTA' ELSE EXCLUDED."motivo" END,
       "em" = EXCLUDED."em"`,
    t.mesa.id, t.lojaId, motivo,
  );
}

/** Os chamados abertos da loja (para a tela de Mesas). Nunca lança. */
export async function chamadosDaLoja(lojaId: string): Promise<ChamadoDaMesa[]> {
  try {
    if (!(await garantirEstruturaDoTablet())) return [];
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "tableId", "motivo", "em" FROM "TabletDaMesaChamado" WHERE "lojaId" = $1`,
      lojaId,
    );
    return linhas.map((l) => ({ tableId: l.tableId, motivo: l.motivo === "CONTA" ? "CONTA" : "GARCOM", em: new Date(l.em).toISOString() }));
  } catch {
    return [];
  }
}

/** Alguém atendeu: o chamado da mesa sai. */
export async function atenderChamado(lojaId: string, tableId: string): Promise<void> {
  if (!(await garantirEstruturaDoTablet())) return;
  await prisma.$executeRawUnsafe(`DELETE FROM "TabletDaMesaChamado" WHERE "lojaId" = $1 AND "tableId" = $2`, lojaId, tableId);
}

/** O chamado desta mesa, para o tablet mostrar "o garçom já foi avisado". */
export async function chamadoDaMesa(tableId: string): Promise<ChamadoDaMesa | null> {
  const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT "tableId", "motivo", "em" FROM "TabletDaMesaChamado" WHERE "tableId" = $1`, tableId);
  const l = linhas[0];
  return l ? { tableId: l.tableId, motivo: l.motivo === "CONTA" ? "CONTA" : "GARCOM", em: new Date(l.em).toISOString() } : null;
}
