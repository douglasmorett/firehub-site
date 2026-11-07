/**
 * As tabelas da Cotação automática (prisma/schema.prisma: CotacaoAssinatura,
 * Fornecedor, ProdutoDeCompra, CotacaoRodada, CotacaoEnvio, CotacaoResposta,
 * CotacaoPreco e PedidoDeCompra).
 *
 * Mesma categoria de src/lib/garantir-colunas.ts: `CREATE TABLE IF NOT EXISTS`,
 * idempotente. Tabelas próprias, sem coluna nova em tabela que já existe: se
 * faltarem, só a cotação para — o robô de vendas e o estoque seguem inteiros.
 * Roda no boot (src/instrumentation.ts) e no primeiro uso das rotas.
 */
import { executarDDL } from "@/lib/ddl-do-boot";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "CotacaoAssinatura" (
     "franchiseeId" TEXT NOT NULL,
     "ativo" BOOLEAN NOT NULL DEFAULT false,
     "testeAte" TIMESTAMP(3),
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "agenda" JSONB NOT NULL DEFAULT '[]',
     "horasParaResumo" INTEGER NOT NULL DEFAULT 4,
     "compradorTelefone" TEXT,
     "compradorNome" TEXT,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CotacaoAssinatura_pkey" PRIMARY KEY ("franchiseeId")
   )`,
  `CREATE TABLE IF NOT EXISTS "Fornecedor" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "nome" TEXT NOT NULL,
     "telefone" TEXT,
     "telefoneCanonico" TEXT,
     "contato" TEXT,
     "categorias" JSONB NOT NULL DEFAULT '[]',
     "pedidoMinimo" DOUBLE PRECISION,
     "diasDeEntrega" JSONB NOT NULL DEFAULT '[]',
     "prazoEntregaDias" INTEGER,
     "horarioLimite" TEXT,
     "pagamento" TEXT,
     "observacoes" TEXT,
     "ativo" BOOLEAN NOT NULL DEFAULT true,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "Fornecedor_franchiseeId_idx" ON "Fornecedor"("franchiseeId")`,
  `CREATE INDEX IF NOT EXISTS "Fornecedor_franchiseeId_telefoneCanonico_idx" ON "Fornecedor"("franchiseeId", "telefoneCanonico")`,
  `CREATE TABLE IF NOT EXISTS "ProdutoDeCompra" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "nome" TEXT NOT NULL,
     "categoria" TEXT,
     "unidade" TEXT NOT NULL DEFAULT 'un',
     "quantidadePadrao" DOUBLE PRECISION,
     "stockItemId" TEXT,
     "fatorDoInsumo" DOUBLE PRECISION,
     "apelidos" JSONB NOT NULL DEFAULT '[]',
     "ativo" BOOLEAN NOT NULL DEFAULT true,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ProdutoDeCompra_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "ProdutoDeCompra_franchiseeId_idx" ON "ProdutoDeCompra"("franchiseeId")`,
  `CREATE TABLE IF NOT EXISTS "CotacaoRodada" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "origem" TEXT NOT NULL DEFAULT 'MANUAL',
     "chave" TEXT,
     "resumoApos" TIMESTAMP(3),
     "resumoEnviadoEm" TIMESTAMP(3),
     "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CotacaoRodada_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CotacaoRodada_franchiseeId_chave_key" ON "CotacaoRodada"("franchiseeId", "chave")`,
  `CREATE INDEX IF NOT EXISTS "CotacaoRodada_franchiseeId_criadaEm_idx" ON "CotacaoRodada"("franchiseeId", "criadaEm")`,
  `CREATE TABLE IF NOT EXISTS "CotacaoEnvio" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "rodadaId" TEXT,
     "fornecedorId" TEXT,
     "pedidoId" TEXT,
     "tipo" TEXT NOT NULL,
     "telefone" TEXT NOT NULL,
     "texto" TEXT NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'FILA',
     "enviarApos" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "enviadoEm" TIMESTAMP(3),
     "erro" TEXT,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CotacaoEnvio_pkey" PRIMARY KEY ("id")
   )`,
  // "Nunca repetir para o mesmo fornecedor na mesma rodada": a trava é o banco.
  `CREATE UNIQUE INDEX IF NOT EXISTS "CotacaoEnvio_rodadaId_fornecedorId_tipo_key" ON "CotacaoEnvio"("rodadaId", "fornecedorId", "tipo")`,
  `CREATE INDEX IF NOT EXISTS "CotacaoEnvio_status_enviarApos_idx" ON "CotacaoEnvio"("status", "enviarApos")`,
  `CREATE INDEX IF NOT EXISTS "CotacaoEnvio_franchiseeId_criadoEm_idx" ON "CotacaoEnvio"("franchiseeId", "criadoEm")`,
  `CREATE TABLE IF NOT EXISTS "CotacaoResposta" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "fornecedorId" TEXT NOT NULL,
     "rodadaId" TEXT,
     "tipo" TEXT NOT NULL,
     "texto" TEXT,
     "status" TEXT NOT NULL DEFAULT 'LENDO',
     "linhas" INTEGER NOT NULL DEFAULT 0,
     "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CotacaoResposta_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "CotacaoResposta_franchiseeId_criadaEm_idx" ON "CotacaoResposta"("franchiseeId", "criadaEm")`,
  `CREATE INDEX IF NOT EXISTS "CotacaoResposta_fornecedorId_rodadaId_idx" ON "CotacaoResposta"("fornecedorId", "rodadaId")`,
  `CREATE TABLE IF NOT EXISTS "CotacaoPreco" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "fornecedorId" TEXT NOT NULL,
     "produtoId" TEXT,
     "respostaId" TEXT,
     "rodadaId" TEXT,
     "nomeLido" TEXT NOT NULL,
     "unidadeLida" TEXT,
     "preco" DOUBLE PRECISION NOT NULL,
     "validade" TEXT,
     "confianca" DOUBLE PRECISION NOT NULL DEFAULT 0,
     "status" TEXT NOT NULL DEFAULT 'SUGERIDO',
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CotacaoPreco_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "CotacaoPreco_franchiseeId_criadoEm_idx" ON "CotacaoPreco"("franchiseeId", "criadoEm")`,
  `CREATE INDEX IF NOT EXISTS "CotacaoPreco_franchiseeId_produtoId_fornecedorId_idx" ON "CotacaoPreco"("franchiseeId", "produtoId", "fornecedorId")`,
  `CREATE TABLE IF NOT EXISTS "PedidoDeCompra" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "fornecedorId" TEXT NOT NULL,
     "rodadaId" TEXT,
     "itens" JSONB NOT NULL DEFAULT '[]',
     "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
     "texto" TEXT NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'FILA',
     "enviadoEm" TIMESTAMP(3),
     "recebidoEm" TIMESTAMP(3),
     "stockInvoiceId" TEXT,
     "criadoPor" TEXT,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "PedidoDeCompra_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "PedidoDeCompra_franchiseeId_criadoEm_idx" ON "PedidoDeCompra"("franchiseeId", "criadoEm")`,
];

let pronto = false;

export async function garantirEstruturaDaCotacao(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) {
    pronto = true;
    return true;
  }
  try {
    await executarDDL("cotacao", INSTRUCOES);
    pronto = true;
    console.log("[Boot] ✅ Tabelas da Cotação automática garantidas.");
  } catch (err: any) {
    console.error(`[Boot] 🛑 Estrutura da Cotação falhou: ${err?.message}`);
  }
  return pronto;
}
