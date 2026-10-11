/**
 * As tabelas e colunas do CMV real: contagem de estoque, preparos (massa,
 * recheio), custo gravado em cada movimento, compra ligada à conta a pagar e a
 * folha da loja (CMO).
 *
 * MESMA CATEGORIA das garantias de src/lib/garantir-colunas.ts: instruções
 * fixas, aditivas e idempotentes (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF
 * NOT EXISTS` de coluna NULÁVEL, constraint dentro de `DO $$ ... EXCEPTION`).
 * Rodar mil vezes é igual a rodar uma. Os models e campos entram no
 * schema.prisma no MESMO commit.
 *
 * As colunas novas em StockItem, StockTransaction, StockInvoice e Payable são o
 * risco de verdade: o Prisma monta o SELECT com todas as escalares do schema, e
 * uma coluna faltando faz o estoque inteiro e as contas a pagar servirem 500.
 * Por isso três tentativas e a conferência coluna por coluna no fim, como a
 * garantia dos lotes.
 */
import { prisma } from "@/lib/prisma";

const INSTRUCOES = [
  // ── Insumo: preparo, rendimento, local, contagem do dia, fora do CMV ──────
  `ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "tipo" TEXT`,
  `ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "rendimento" DOUBLE PRECISION`,
  `ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "local" TEXT`,
  `ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "contagemDiaria" BOOLEAN`,
  `ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "entraNoCmv" BOOLEAN`,

  // ── Movimento: o custo daquela hora e a compra de onde veio ───────────────
  `ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "unitCost" DOUBLE PRECISION`,
  `ALTER TABLE "StockTransaction" ADD COLUMN IF NOT EXISTS "stockInvoiceId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "StockTransaction_stockInvoiceId_idx" ON "StockTransaction"("stockInvoiceId")`,

  // ── Compra: o dia em que entrou, a origem, o valor no estoque, o estorno ──
  `ALTER TABLE "StockInvoice" ADD COLUMN IF NOT EXISTS "dia" TEXT`,
  `ALTER TABLE "StockInvoice" ADD COLUMN IF NOT EXISTS "origem" TEXT`,
  `ALTER TABLE "StockInvoice" ADD COLUMN IF NOT EXISTS "valorNoEstoque" DOUBLE PRECISION`,
  `ALTER TABLE "StockInvoice" ADD COLUMN IF NOT EXISTS "criadoPor" TEXT`,
  `ALTER TABLE "StockInvoice" ADD COLUMN IF NOT EXISTS "canceladaEm" TIMESTAMP(3)`,

  // ── Conta a pagar nascida da compra ──────────────────────────────────────
  `ALTER TABLE "Payable" ADD COLUMN IF NOT EXISTS "stockInvoiceId" TEXT`,

  // ── Receita do preparo ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "ComponenteDoPreparo" (
     "id" TEXT NOT NULL,
     "preparoId" TEXT NOT NULL,
     "insumoId" TEXT NOT NULL,
     "quantidade" DOUBLE PRECISION NOT NULL,
     CONSTRAINT "ComponenteDoPreparo_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ComponenteDoPreparo_preparoId_insumoId_key" ON "ComponenteDoPreparo"("preparoId", "insumoId")`,
  `CREATE INDEX IF NOT EXISTS "ComponenteDoPreparo_insumoId_idx" ON "ComponenteDoPreparo"("insumoId")`,
  `DO $$ BEGIN
     ALTER TABLE "ComponenteDoPreparo" ADD CONSTRAINT "ComponenteDoPreparo_preparoId_fkey"
       FOREIGN KEY ("preparoId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     ALTER TABLE "ComponenteDoPreparo" ADD CONSTRAINT "ComponenteDoPreparo_insumoId_fkey"
       FOREIGN KEY ("insumoId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ── Contagem ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "ContagemDeEstoque" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "dia" TEXT NOT NULL,
     "tipo" TEXT NOT NULL DEFAULT 'COMPLETA',
     "status" TEXT NOT NULL DEFAULT 'ABERTA',
     "valorTotal" DOUBLE PRECISION,
     "observacao" TEXT,
     "criadoPor" TEXT,
     "fechadaPor" TEXT,
     "fechadaEm" TIMESTAMP(3),
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ContagemDeEstoque_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ContagemDeEstoque_franchiseeId_dia_key" ON "ContagemDeEstoque"("franchiseeId", "dia")`,
  `CREATE INDEX IF NOT EXISTS "ContagemDeEstoque_franchiseeId_status_idx" ON "ContagemDeEstoque"("franchiseeId", "status")`,
  `CREATE TABLE IF NOT EXISTS "ContagemItem" (
     "id" TEXT NOT NULL,
     "contagemId" TEXT NOT NULL,
     "stockItemId" TEXT NOT NULL,
     "contado" DOUBLE PRECISION,
     "quantidade" DOUBLE PRECISION,
     "origem" TEXT,
     "nome" TEXT NOT NULL,
     "unidade" TEXT NOT NULL,
     "custoUnitario" DOUBLE PRECISION,
     "valor" DOUBLE PRECISION,
     "saldoSistema" DOUBLE PRECISION,
     "atualizadoPor" TEXT,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ContagemItem_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ContagemItem_contagemId_stockItemId_key" ON "ContagemItem"("contagemId", "stockItemId")`,
  `CREATE INDEX IF NOT EXISTS "ContagemItem_stockItemId_idx" ON "ContagemItem"("stockItemId")`,
  `DO $$ BEGIN
     ALTER TABLE "ContagemItem" ADD CONSTRAINT "ContagemItem_contagemId_fkey"
       FOREIGN KEY ("contagemId") REFERENCES "ContagemDeEstoque"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
     ALTER TABLE "ContagemItem" ADD CONSTRAINT "ContagemItem_stockItemId_fkey"
       FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ── Folha (CMO) ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "PessoaDaFolha" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "nome" TEXT NOT NULL,
     "funcao" TEXT,
     "salario" DOUBLE PRECISION NOT NULL,
     "encargosPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
     "beneficios" DOUBLE PRECISION NOT NULL DEFAULT 0,
     "desde" TEXT NOT NULL,
     "ate" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "PessoaDaFolha_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "PessoaDaFolha_franchiseeId_idx" ON "PessoaDaFolha"("franchiseeId")`,
];

/** As colunas em tabelas que JÁ existem: sem elas o estoque e as contas a pagar quebram. */
const COLUNAS_ESPERADAS = [
  "StockItem.tipo", "StockItem.rendimento", "StockItem.local", "StockItem.contagemDiaria", "StockItem.entraNoCmv",
  "StockTransaction.unitCost", "StockTransaction.stockInvoiceId",
  "StockInvoice.dia", "StockInvoice.origem", "StockInvoice.valorNoEstoque", "StockInvoice.criadoPor", "StockInvoice.canceladaEm",
  "Payable.stockInvoiceId",
];
const TABELAS_ESPERADAS = ["ComponenteDoPreparo", "ContagemDeEstoque", "ContagemItem", "PessoaDaFolha"];

let ok = false;

export async function garantirEstruturaDoCmv(): Promise<boolean> {
  if (ok) return true;

  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a estrutura do CMV.");
    ok = true;
    return true;
  }

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);

      const cols = await prisma.$queryRaw<{ tabela: string; coluna: string }[]>`
        SELECT table_name AS tabela, column_name AS coluna FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name IN ('StockItem', 'StockTransaction', 'StockInvoice', 'Payable')
      `;
      const tabs = await prisma.$queryRaw<{ t: string }[]>`
        SELECT table_name AS t FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN ('ComponenteDoPreparo', 'ContagemDeEstoque', 'ContagemItem', 'PessoaDaFolha')
      `;
      const tem = new Set(cols.map((c) => `${c.tabela}.${c.coluna}`));
      const temTab = new Set(tabs.map((t) => t.t));
      const faltando = [
        ...COLUNAS_ESPERADAS.filter((c) => !tem.has(c)),
        ...TABELAS_ESPERADAS.filter((t) => !temTab.has(t)).map((t) => `tabela ${t}`),
      ];

      if (faltando.length > 0) {
        console.error(`[Boot] 🛑 Estrutura do CMV incompleta: falta ${faltando.join(", ")}.`);
        if (tentativa < 3) { await new Promise((r) => setTimeout(r, 2000 * tentativa)); continue; }
        return false;
      }

      ok = true;
      console.log("[Boot] ✅ Estrutura do CMV (contagem, preparos, custo por movimento, folha) garantida.");
      return true;
    } catch (err: any) {
      console.error(`[Boot] 🛑 Estrutura do CMV falhou (tentativa ${tentativa}/3): ${err?.message}`);
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
  }
  return false;
}
