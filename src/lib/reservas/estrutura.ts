/**
 * As tabelas das Reservas de mesa: a assinatura + configuração da loja
 * ("ReservasAssinatura") e as reservas ("ReservaDeMesa").
 *
 * Mesma categoria de src/lib/garantir-colunas.ts: `CREATE TABLE IF NOT EXISTS`,
 * idempotente, no primeiro uso. Tabelas próprias, sem coluna nova em tabela que
 * já existe: se faltarem, só as reservas param — o robô de vendas segue inteiro
 * (sem a tabela, reservasDaLoja diz "desligado" e ele atende como antes).
 * Sem model no Prisma: tudo por SQL, como a Balança.
 */
import { executarDDL } from "@/lib/ddl-do-boot";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "ReservasAssinatura" (
     "franchiseeId" TEXT NOT NULL,
     "ativo" BOOLEAN NOT NULL DEFAULT false,
     "testeAte" TIMESTAMP(3),
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "config" JSONB NOT NULL DEFAULT '{}',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ReservasAssinatura_pkey" PRIMARY KEY ("franchiseeId")
   )`,
  // data "AAAA-MM-DD" e hora "HH:MM" no relógio da loja (lib/reservas/regras.ts).
  `CREATE TABLE IF NOT EXISTS "ReservaDeMesa" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "nome" TEXT NOT NULL,
     "telefone" TEXT,
     "data" TEXT NOT NULL,
     "hora" TEXT NOT NULL,
     "pessoas" INTEGER NOT NULL,
     "observacao" TEXT,
     "origem" TEXT NOT NULL DEFAULT 'PAINEL',
     "status" TEXT NOT NULL DEFAULT 'CONFIRMADA',
     "mesaId" TEXT,
     "criadaPor" TEXT,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "chegouEm" TIMESTAMP(3),
     "canceladaEm" TIMESTAMP(3),
     CONSTRAINT "ReservaDeMesa_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "ReservaDeMesa_franchiseeId_data_idx" ON "ReservaDeMesa"("franchiseeId", "data")`,
];

let pronto = false;

export async function garantirEstruturaDasReservas(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await executarDDL("reservas", INSTRUCOES);
    pronto = true;
  } catch (err: any) {
    console.error(`[Reservas] Estrutura das tabelas falhou: ${err?.message}`);
  }
  return pronto;
}
