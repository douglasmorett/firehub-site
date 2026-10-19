/**
 * /src/lib/ajustes-do-acerto.ts
 *
 * Grava e lê os ajustes à mão do acerto do motoboy: a diária de um dia e as
 * pendências (a conta está em lib/ajustes-do-acerto-regras.ts).
 *
 * ── As tabelas ficam fora do schema.prisma ──────────────────────────────────
 * Como LancheDaEquipe e CashbackAjuste: SQL cru, `CREATE TABLE IF NOT EXISTS`
 * no boot (src/instrumentation.ts) e de novo no primeiro uso. O schema não
 * conhece as tabelas, então não existe o 500 de "campo no schema, coluna
 * ausente" que derrubou /loja em 24/08/2026 — se o CREATE falhar, o acerto sai
 * sem os ajustes (como era antes) e só gravar um ajuste dá erro.
 *
 *   MotoboyDiariaDoDia  — uma linha por motoboy + dia ajustado. Apagar a linha
 *                         é "voltar ao padrão" (a diária do cadastro).
 *   MotoboyPendencia    — uma linha por pendência. Excluir marca `excluidoEm`
 *                         (dinheiro descontado de alguém não some sem rastro).
 *
 * A hora é gravada com `horaEmUtc` (lib/cashback-no-banco.ts): Date solto no
 * SQL cru vira a hora do fuso da sessão do banco.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { executarDDL } from "@/lib/ddl-do-boot";
import { horaEmUtc } from "@/lib/cashback-no-banco";
import type { AjusteDaDiaria, PendenciaDoAcerto } from "@/lib/ajustes-do-acerto-regras";

let tabelasOk = false;

/** As duas tabelas existem? Uma vez por processo — e só marca DEPOIS de conseguir. Nunca lança. */
export async function garantirTabelasDoAcerto(): Promise<boolean> {
  if (tabelasOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await executarDDL("ajustes-do-acerto", [
      `CREATE TABLE IF NOT EXISTS "MotoboyDiariaDoDia" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "motoboyId" TEXT NOT NULL,
      "dia" TEXT NOT NULL,
      "valor" DOUBLE PRECISION NOT NULL,
      "padrao" DOUBLE PRECISION,
      "criadoPor" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "MotoboyDiariaDoDia_pkey" PRIMARY KEY ("id")
    )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "MotoboyDiariaDoDia_motoboyId_dia_key" ON "MotoboyDiariaDoDia"("motoboyId", "dia")`,
      `CREATE INDEX IF NOT EXISTS "MotoboyDiariaDoDia_lojaId_dia_idx" ON "MotoboyDiariaDoDia"("lojaId", "dia")`,
      `CREATE TABLE IF NOT EXISTS "MotoboyPendencia" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "motoboyId" TEXT NOT NULL,
      "dia" TEXT NOT NULL,
      "valor" DOUBLE PRECISION NOT NULL,
      "motivo" TEXT NOT NULL,
      "criadoPor" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "excluidoEm" TIMESTAMP(3),
      "excluidoPor" TEXT,
      CONSTRAINT "MotoboyPendencia_pkey" PRIMARY KEY ("id")
    )`,
      `CREATE INDEX IF NOT EXISTS "MotoboyPendencia_lojaId_motoboyId_dia_idx" ON "MotoboyPendencia"("lojaId", "motoboyId", "dia")`,
    ]);
    tabelasOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Acerto] 🛑 Tabelas MotoboyDiariaDoDia/MotoboyPendencia falharam: ${err?.message}`);
    return false;
  }
}

const novoId = (prefixo: string) => `${prefixo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export type AjustesDoPeriodo = {
  /** motoboyId → dia → ajuste. */
  diarias: Map<string, Map<string, AjusteDaDiaria>>;
  /** motoboyId → pendências do período (as não excluídas). */
  pendencias: Map<string, PendenciaDoAcerto[]>;
};

/**
 * Os ajustes dos motoboys entre os dias `de` e `ate` (dias do expediente,
 * inclusive). Sem a tabela, volta vazio: o acerto sai como era antes.
 */
export async function ajustesDoPeriodo(opts: { lojaId: string; motoboyIds: string[]; de: string; ate: string }): Promise<AjustesDoPeriodo> {
  const vazio: AjustesDoPeriodo = { diarias: new Map(), pendencias: new Map() };
  if (!opts.motoboyIds.length || !(await garantirTabelasDoAcerto())) return vazio;
  const ids = Prisma.join(opts.motoboyIds);
  const [diarias, pendencias] = await Promise.all([
    prisma.$queryRaw<{ motoboyId: string; dia: string; valor: number; criadoPor: string | null; updatedAt: Date }[]>(Prisma.sql`
      SELECT "motoboyId", "dia", "valor", "criadoPor", "updatedAt" FROM "MotoboyDiariaDoDia"
      WHERE "lojaId" = ${opts.lojaId} AND "motoboyId" IN (${ids}) AND "dia" >= ${opts.de} AND "dia" <= ${opts.ate}`),
    prisma.$queryRaw<{ id: string; motoboyId: string; dia: string; valor: number; motivo: string; criadoPor: string | null; createdAt: Date }[]>(Prisma.sql`
      SELECT "id", "motoboyId", "dia", "valor", "motivo", "criadoPor", "createdAt" FROM "MotoboyPendencia"
      WHERE "lojaId" = ${opts.lojaId} AND "motoboyId" IN (${ids}) AND "dia" >= ${opts.de} AND "dia" <= ${opts.ate}
        AND "excluidoEm" IS NULL
      ORDER BY "dia" ASC, "createdAt" ASC`),
  ]);
  for (const d of diarias) {
    const m = vazio.diarias.get(d.motoboyId) || new Map<string, AjusteDaDiaria>();
    m.set(d.dia, { valor: Number(d.valor) || 0, criadoPor: d.criadoPor, em: new Date(d.updatedAt).toISOString() });
    vazio.diarias.set(d.motoboyId, m);
  }
  for (const p of pendencias) {
    const lista = vazio.pendencias.get(p.motoboyId) || [];
    lista.push({
      id: p.id, motoboyId: p.motoboyId, dia: p.dia, valor: Number(p.valor) || 0, motivo: p.motivo,
      criadoPor: p.criadoPor, em: new Date(p.createdAt).toISOString(),
    });
    vazio.pendencias.set(p.motoboyId, lista);
  }
  return vazio;
}

/** Muda a diária de um dia (grava ou regrava). `padrao` é a do cadastro, guardada para conferência. */
export async function salvarDiariaDoDia(o: { lojaId: string; motoboyId: string; dia: string; valor: number; padrao: number | null; quem: string }) {
  if (!(await garantirTabelasDoAcerto())) throw new Error("tabela MotoboyDiariaDoDia indisponível");
  const agora = horaEmUtc(new Date());
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "MotoboyDiariaDoDia" ("id", "lojaId", "motoboyId", "dia", "valor", "padrao", "criadoPor", "createdAt", "updatedAt")
    VALUES (${novoId("mdd")}, ${o.lojaId}, ${o.motoboyId}, ${o.dia}, ${o.valor}, ${o.padrao}, ${o.quem.slice(0, 120)}, ${agora}, ${agora})
    ON CONFLICT ("motoboyId", "dia") DO UPDATE SET
      "valor" = EXCLUDED."valor", "padrao" = EXCLUDED."padrao", "criadoPor" = EXCLUDED."criadoPor", "updatedAt" = EXCLUDED."updatedAt"`);
}

/** Volta o dia para a diária do cadastro. */
export async function voltarDiariaAoPadrao(o: { lojaId: string; motoboyId: string; dia: string }) {
  if (!(await garantirTabelasDoAcerto())) throw new Error("tabela MotoboyDiariaDoDia indisponível");
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "MotoboyDiariaDoDia" WHERE "lojaId" = ${o.lojaId} AND "motoboyId" = ${o.motoboyId} AND "dia" = ${o.dia}`);
}

export async function lancarPendencia(o: { lojaId: string; motoboyId: string; dia: string; valor: number; motivo: string; quem: string }): Promise<string> {
  if (!(await garantirTabelasDoAcerto())) throw new Error("tabela MotoboyPendencia indisponível");
  const id = novoId("mpd");
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "MotoboyPendencia" ("id", "lojaId", "motoboyId", "dia", "valor", "motivo", "criadoPor", "createdAt")
    VALUES (${id}, ${o.lojaId}, ${o.motoboyId}, ${o.dia}, ${o.valor}, ${o.motivo}, ${o.quem.slice(0, 120)}, ${horaEmUtc(new Date())})`);
  return id;
}

/** Tira a pendência do acerto (fica no banco, marcada como excluída). Devolve se achou. */
export async function excluirPendencia(o: { lojaId: string; id: string; quem: string }): Promise<boolean> {
  if (!(await garantirTabelasDoAcerto())) throw new Error("tabela MotoboyPendencia indisponível");
  const n = await prisma.$executeRaw(Prisma.sql`
    UPDATE "MotoboyPendencia" SET "excluidoEm" = ${horaEmUtc(new Date())}, "excluidoPor" = ${o.quem.slice(0, 120)}
    WHERE "id" = ${o.id} AND "lojaId" = ${o.lojaId} AND "excluidoEm" IS NULL`);
  return Number(n) > 0;
}
