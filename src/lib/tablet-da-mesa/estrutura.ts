/**
 * As tabelas do Tablet na mesa — SQL cru, criadas no primeiro uso (como o
 * Multimarcas e o App da loja). Se faltarem, só o módulo para: cobrança zero,
 * tablet mostra "chame o garçom".
 *
 * - TabletDaMesaAssinatura: o liga/desliga (trechos, lib/modulo-pago.ts).
 * - TabletDaMesa: cada aparelho, preso a UMA mesa. `tokenHash` é o sha256 do
 *   cookie do tablet; `codigo` é o número de 6 dígitos do pareamento, que vale
 *   15 minutos e some quando o tablet entra.
 * - TabletDaMesaUso: um dia de uso de um tablet (a base da cobrança: tablet
 *   ativo no mês = com uso no mês).
 * - TabletDaMesaChamado: "chamou o garçom" / "pediu a conta", um por mesa,
 *   até alguém atender na tela de Mesas.
 */
import { prisma } from "@/lib/prisma";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "TabletDaMesaAssinatura" (
     "franchiseeId" TEXT NOT NULL,
     "ativo" BOOLEAN NOT NULL DEFAULT false,
     "testeAte" TIMESTAMP(3),
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "TabletDaMesaAssinatura_pkey" PRIMARY KEY ("franchiseeId")
   )`,
  `CREATE TABLE IF NOT EXISTS "TabletDaMesa" (
     "id" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "tableId" TEXT NOT NULL,
     "tokenHash" TEXT,
     "codigo" TEXT,
     "codigoAte" TIMESTAMP(3),
     "ultimoSinal" TIMESTAMP(3),
     "modelo" TEXT,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "TabletDaMesa_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TabletDaMesa_tokenHash_key" ON "TabletDaMesa"("tokenHash")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "TabletDaMesa_codigo_key" ON "TabletDaMesa"("codigo")`,
  `CREATE INDEX IF NOT EXISTS "TabletDaMesa_lojaId_idx" ON "TabletDaMesa"("lojaId")`,
  `CREATE TABLE IF NOT EXISTS "TabletDaMesaUso" (
     "tabletId" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "dia" TEXT NOT NULL,
     "em" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "TabletDaMesaUso_pkey" PRIMARY KEY ("tabletId", "dia")
   )`,
  `CREATE INDEX IF NOT EXISTS "TabletDaMesaUso_lojaId_em_idx" ON "TabletDaMesaUso"("lojaId", "em")`,
  `CREATE TABLE IF NOT EXISTS "TabletDaMesaChamado" (
     "tableId" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "motivo" TEXT NOT NULL,
     "em" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "TabletDaMesaChamado_pkey" PRIMARY KEY ("tableId")
   )`,
];

let pronto = false;
export async function garantirEstruturaDoTablet(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[Tablet na mesa] Estrutura falhou:", err?.message);
  }
  return pronto;
}
