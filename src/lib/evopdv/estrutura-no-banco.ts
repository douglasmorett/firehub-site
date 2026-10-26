/**
 * As tabelas do EvoPDV emitindo NFC-e pelo emissor do FireHub (lib/evopdv):
 * a venda de fora (`VendaExterna`) e a ligação da conta (`IntegracaoEvopdv`).
 *
 * MESMA CATEGORIA das garantias de src/lib/garantir-colunas.ts: instruções
 * fixas, aditivas e idempotentes (`CREATE TABLE/INDEX IF NOT EXISTS`). Rodar
 * mil vezes é igual a rodar uma. Os models entram no schema.prisma no MESMO
 * commit. Tabelas novas e nenhuma coluna em tabela existente.
 *
 * ── Por que no boot, antes do primeiro request ──────────────────────────────
 *
 * A numeração da NFC-e (lib/nfce/numeracao → fonteDaLoja) lê pedidos E vendas
 * de fora da loja, para as duas não repetirem número na mesma série. Sem a
 * tabela, essa leitura falharia — e com ela a emissão de TODA loja do emissor
 * próprio. Por isso três tentativas, a conferência em information_schema e o
 * log CRÍTICO, como a garantia do CMV.
 */
import { prisma } from "@/lib/prisma";
import { executarDDL, esquecerDDL } from "@/lib/ddl-do-boot";

export const INSTRUCOES_DO_EVOPDV = [
  `CREATE TABLE IF NOT EXISTS "VendaExterna" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "origem" TEXT NOT NULL DEFAULT 'evopdv',
     "vendaId" TEXT NOT NULL,
     "venda" JSONB NOT NULL,
     "hashDaVenda" TEXT NOT NULL,
     "totalCentavos" INTEGER NOT NULL,
     "vendaEm" TIMESTAMP(3) NOT NULL,
     "fiscalStatus" TEXT,
     "fiscalInfo" JSONB,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "VendaExterna_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "VendaExterna_franchiseeId_origem_vendaId_key" ON "VendaExterna"("franchiseeId", "origem", "vendaId")`,
  `CREATE INDEX IF NOT EXISTS "VendaExterna_franchiseeId_createdAt_idx" ON "VendaExterna"("franchiseeId", "createdAt")`,
  `CREATE TABLE IF NOT EXISTS "IntegracaoEvopdv" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "cnpj" TEXT NOT NULL,
     "chaveHash" TEXT NOT NULL,
     "email" TEXT,
     "assinatura" JSONB,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "IntegracaoEvopdv_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IntegracaoEvopdv_franchiseeId_key" ON "IntegracaoEvopdv"("franchiseeId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IntegracaoEvopdv_cnpj_key" ON "IntegracaoEvopdv"("cnpj")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IntegracaoEvopdv_chaveHash_key" ON "IntegracaoEvopdv"("chaveHash")`,
];

const TABELAS_ESPERADAS = ["VendaExterna", "IntegracaoEvopdv"];

let ok = false;

export async function garantirEstruturaDoEvopdv(): Promise<boolean> {
  if (ok) return true;

  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a estrutura do EvoPDV.");
    ok = true;
    return true;
  }

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      await executarDDL("evopdv", INSTRUCOES_DO_EVOPDV);
      const tabs = await prisma.$queryRaw<{ t: string }[]>`
        SELECT table_name AS t FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name IN ('VendaExterna', 'IntegracaoEvopdv')
      `;
      const tem = new Set(tabs.map((t) => t.t));
      const faltando = TABELAS_ESPERADAS.filter((t) => !tem.has(t));
      if (faltando.length > 0) {
        console.error(`[Boot] 🛑 Estrutura do EvoPDV incompleta: falta ${faltando.join(", ")}.`);
        await esquecerDDL("evopdv", INSTRUCOES_DO_EVOPDV);
        if (tentativa < 3) { await new Promise((r) => setTimeout(r, 2000 * tentativa)); continue; }
        return false;
      }
      ok = true;
      console.log("[Boot] ✅ Tabelas do EvoPDV (VendaExterna, IntegracaoEvopdv) garantidas.");
      return true;
    } catch (err: any) {
      console.error(`[Boot] 🛑 Estrutura do EvoPDV (tentativa ${tentativa}/3): ${err?.message}`);
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
  }
  // Sem a tabela a numeração da NFC-e do emissor próprio falha (ver o cabeçalho).
  console.error("[Boot] 🛑🛑 CRÍTICO: sem a tabela VendaExterna a emissão de NFC-e do emissor próprio para. Confira o banco.");
  return false;
}
