/**
 * As tabelas do Disparo oficial (lib/disparo-oficial/).
 *
 * MESMA CATEGORIA das garantias de src/lib/garantir-colunas.ts: instruções
 * fixas, aditivas e idempotentes (`CREATE TABLE/INDEX IF NOT EXISTS`). Só
 * tabelas NOVAS, nenhuma coluna em tabela que já existe — se isto falhar, só o
 * Disparo oficial para; o resto do painel nem percebe. Os models entram no
 * schema.prisma no MESMO commit.
 */
import { prisma } from "@/lib/prisma";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "WhatsappOficial" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "wabaId" TEXT NOT NULL,
     "phoneNumberId" TEXT NOT NULL,
     "businessId" TEXT,
     "numero" TEXT,
     "nomeExibido" TEXT,
     "tokenCifrado" TEXT NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'CONECTADO',
     "qualidade" TEXT,
     "limite" TEXT,
     "erro" TEXT,
     "contatosSincronizadosEm" TIMESTAMP(3),
     "conectadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "WhatsappOficial_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WhatsappOficial_franchiseeId_key" ON "WhatsappOficial"("franchiseeId")`,
  `ALTER TABLE "WhatsappOficial" ADD COLUMN IF NOT EXISTS "tokenRenovadoEm" TIMESTAMP(3)`,

  `CREATE TABLE IF NOT EXISTS "DisparoRecarga" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "disparos" INTEGER NOT NULL,
     "valor" DOUBLE PRECISION NOT NULL,
     "precoPorDisparo" DOUBLE PRECISION NOT NULL,
     "tipo" TEXT NOT NULL DEFAULT 'PIX',
     "status" TEXT NOT NULL DEFAULT 'PENDENTE',
     "asaasPaymentId" TEXT,
     "pixCopiaECola" TEXT,
     "descricao" TEXT,
     "criadoPor" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "pagaEm" TIMESTAMP(3),
     CONSTRAINT "DisparoRecarga_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DisparoRecarga_asaasPaymentId_key" ON "DisparoRecarga"("asaasPaymentId")`,
  `CREATE INDEX IF NOT EXISTS "DisparoRecarga_franchiseeId_status_idx" ON "DisparoRecarga"("franchiseeId", "status")`,

  `CREATE TABLE IF NOT EXISTS "DisparoModelo" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "nome" TEXT NOT NULL,
     "titulo" TEXT NOT NULL,
     "texto" TEXT NOT NULL,
     "botaoPedir" BOOLEAN NOT NULL DEFAULT true,
     "idioma" TEXT NOT NULL DEFAULT 'pt_BR',
     "metaTemplateId" TEXT,
     "status" TEXT NOT NULL DEFAULT 'PENDENTE',
     "motivo" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "DisparoModelo_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "DisparoModelo_franchiseeId_idx" ON "DisparoModelo"("franchiseeId")`,

  `CREATE TABLE IF NOT EXISTS "DisparoCampanha" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "modeloId" TEXT NOT NULL,
     "nome" TEXT NOT NULL,
     "publico" JSONB,
     "total" INTEGER NOT NULL DEFAULT 0,
     "status" TEXT NOT NULL DEFAULT 'ENVIANDO',
     "motivo" TEXT,
     "criadoPor" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "concluidaEm" TIMESTAMP(3),
     CONSTRAINT "DisparoCampanha_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "DisparoCampanha_franchiseeId_createdAt_idx" ON "DisparoCampanha"("franchiseeId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "DisparoCampanha_status_idx" ON "DisparoCampanha"("status")`,

  `CREATE TABLE IF NOT EXISTS "DisparoEnvio" (
     "id" TEXT NOT NULL,
     "campanhaId" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "telefone" TEXT NOT NULL,
     "nome" TEXT,
     "status" TEXT NOT NULL DEFAULT 'FILA',
     "gratis" BOOLEAN NOT NULL DEFAULT false,
     "wamid" TEXT,
     "erro" TEXT,
     "tentativas" INTEGER NOT NULL DEFAULT 0,
     "enviadoEm" TIMESTAMP(3),
     "entregueEm" TIMESTAMP(3),
     "lidoEm" TIMESTAMP(3),
     "respondeuEm" TIMESTAMP(3),
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "DisparoEnvio_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DisparoEnvio_wamid_key" ON "DisparoEnvio"("wamid")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DisparoEnvio_campanhaId_telefone_key" ON "DisparoEnvio"("campanhaId", "telefone")`,
  `CREATE INDEX IF NOT EXISTS "DisparoEnvio_franchiseeId_status_idx" ON "DisparoEnvio"("franchiseeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "DisparoEnvio_status_createdAt_idx" ON "DisparoEnvio"("status", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "DisparoEnvio_franchiseeId_telefone_idx" ON "DisparoEnvio"("franchiseeId", "telefone")`,

  `CREATE TABLE IF NOT EXISTS "DisparoDescadastro" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "telefone" TEXT NOT NULL,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "DisparoDescadastro_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DisparoDescadastro_franchiseeId_telefone_key" ON "DisparoDescadastro"("franchiseeId", "telefone")`,
];

let ok = false;

/** As tabelas existem? Uma vez por processo — e só marca DEPOIS de conseguir. As rotas chamam de novo. */
export async function garantirEstruturaDoDisparoOficial(): Promise<boolean> {
  if (ok) return true;

  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a estrutura do Disparo oficial.");
    return false;
  }

  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    ok = true;
    console.log("[Boot] ✅ Tabelas do Disparo oficial garantidas.");
    return true;
  } catch (err: any) {
    console.error(`[Boot] 🛑 Estrutura do Disparo oficial falhou: ${err?.message}`);
    return false;
  }
}
