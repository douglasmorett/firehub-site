/**
 * As tabelas do Meu Assessor (prisma/schema.prisma: AssessorAssinatura e
 * AssessorRegistro).
 *
 * Mesma categoria de src/lib/garantir-colunas.ts: `CREATE TABLE IF NOT EXISTS`,
 * idempotente. Tabelas próprias, sem coluna nova em tabela que já existe: se
 * faltarem, só o assessor para — o robô de vendas e o estoque seguem inteiros.
 */
import { prisma } from "@/lib/prisma";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "AssessorAssinatura" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "ativo" BOOLEAN NOT NULL DEFAULT false,
     "testeAte" TIMESTAMP(3),
     "periodos" JSONB NOT NULL DEFAULT '[]',
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "AssessorAssinatura_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AssessorAssinatura_franchiseeId_key" ON "AssessorAssinatura"("franchiseeId")`,
  `CREATE TABLE IF NOT EXISTS "AssessorRegistro" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "tipo" TEXT NOT NULL,
     "resumo" TEXT NOT NULL,
     "refs" JSONB,
     "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
     "telefone" TEXT,
     "desfeitoEm" TIMESTAMP(3),
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "AssessorRegistro_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "AssessorRegistro_franchiseeId_criadoEm_idx" ON "AssessorRegistro"("franchiseeId", "criadoEm")`,
];

let pronto = false;

export async function garantirEstruturaDoAssessor(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) {
    pronto = true;
    return true;
  }
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
    console.log("[Boot] ✅ Tabelas do Meu Assessor garantidas.");
  } catch (err: any) {
    console.error(`[Boot] 🛑 Estrutura do Meu Assessor falhou: ${err?.message}`);
  }
  return pronto;
}
