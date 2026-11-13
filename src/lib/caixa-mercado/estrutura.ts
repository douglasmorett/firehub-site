/**
 * As tabelas do Caixa de mercado — SQL cru, criadas no primeiro uso (o padrão
 * do Tablet na mesa e da Balança). Se faltarem, só o módulo para: cobrança
 * zero, a tela do caixa avisa. Plano e contratos no vault:
 * Projetos/FireHub - Caixa de mercado.md.
 *
 * Horas em TIMESTAMP sem fuso, em UTC, como o Prisma grava: quem escreve usa
 * `(… AT TIME ZONE 'UTC')` ou `NOW() AT TIME ZONE 'UTC'`.
 *
 * - CaixaMercadoAssinatura: o liga/desliga (trechos, lib/modulo-pago.ts) e a
 *   `config` da loja (etiqueta da balança, margem padrão, NFC-e).
 * - CaixaMercadoTerminal: cada computador de caixa pareado. `tokenHash` é o
 *   sha256 do cookie do computador (como o tablet da mesa).
 * - CaixaMercadoUso: um dia de uso de um computador — a base da cobrança
 *   (R$ 97 por computador com uso no mês, fora do teste).
 * - CaixaMercadoProduto: o que o mercado precisa a mais no produto do
 *   cardápio: unidade (UN/KG) e de onde veio o NCM (ncmSugerido = IA, conferir).
 * - CaixaMercadoCodigo: EAN(s) e PLU da balança etiquetadora → produto.
 * - CaixaMercadoRegraNcm: a tributação por NCM que o contador devolveu.
 * - CaixaMercadoTurno / CaixaMercadoMovimento: o turno do operador num
 *   computador (fundo, sangria, suprimento, fechamento por forma).
 * - CaixaMercadoVenda: a venda do caixa (o pedido é o CustomerOrder): turno,
 *   pagamentos em centavos, troco, Pix (txid e quem confirmou), parte TEF e os
 *   itens cancelados com a senha do gerente.
 */
import { prisma } from "@/lib/prisma";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoAssinatura" (
     "franchiseeId" TEXT NOT NULL,
     "ativo" BOOLEAN NOT NULL DEFAULT false,
     "testeAte" TIMESTAMP(3),
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "config" JSONB NOT NULL DEFAULT '{}',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CaixaMercadoAssinatura_pkey" PRIMARY KEY ("franchiseeId")
   )`,
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoTerminal" (
     "id" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "numero" INTEGER NOT NULL,
     "nome" TEXT NOT NULL,
     "tokenHash" TEXT NOT NULL,
     "criadoPor" TEXT,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "ultimoSinal" TIMESTAMP(3),
     "desativadoEm" TIMESTAMP(3),
     CONSTRAINT "CaixaMercadoTerminal_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CaixaMercadoTerminal_tokenHash_key" ON "CaixaMercadoTerminal"("tokenHash")`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoTerminal_lojaId_idx" ON "CaixaMercadoTerminal"("lojaId")`,
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoUso" (
     "terminalId" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "dia" TEXT NOT NULL,
     "em" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "CaixaMercadoUso_pkey" PRIMARY KEY ("terminalId", "dia")
   )`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoUso_lojaId_em_idx" ON "CaixaMercadoUso"("lojaId", "em")`,
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoProduto" (
     "menuProductId" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "unidade" TEXT NOT NULL DEFAULT 'UN',
     "ncmOrigem" TEXT,
     "ncmSugerido" BOOLEAN NOT NULL DEFAULT false,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CaixaMercadoProduto_pkey" PRIMARY KEY ("menuProductId")
   )`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoProduto_lojaId_idx" ON "CaixaMercadoProduto"("lojaId")`,
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoCodigo" (
     "lojaId" TEXT NOT NULL,
     "tipo" TEXT NOT NULL,
     "codigo" TEXT NOT NULL,
     "menuProductId" TEXT NOT NULL,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CaixaMercadoCodigo_pkey" PRIMARY KEY ("lojaId", "tipo", "codigo")
   )`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoCodigo_menuProductId_idx" ON "CaixaMercadoCodigo"("menuProductId")`,
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoRegraNcm" (
     "lojaId" TEXT NOT NULL,
     "ncm" TEXT NOT NULL,
     "cfop" TEXT,
     "csosn" TEXT,
     "pis" TEXT,
     "cofins" TEXT,
     "cest" TEXT,
     "origem" TEXT,
     "obs" TEXT,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "CaixaMercadoRegraNcm_pkey" PRIMARY KEY ("lojaId", "ncm")
   )`,
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoTurno" (
     "id" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "terminalId" TEXT NOT NULL,
     "operador" TEXT NOT NULL,
     "operadorId" TEXT,
     "abertoEm" TIMESTAMP(3) NOT NULL,
     "fundoCentavos" INTEGER NOT NULL DEFAULT 0,
     "fechadoEm" TIMESTAMP(3),
     "fechadoPor" TEXT,
     "esperado" JSONB,
     "contado" JSONB,
     "diferencaCentavos" INTEGER,
     "obs" TEXT,
     "cashSessionId" TEXT,
     CONSTRAINT "CaixaMercadoTurno_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoTurno_terminal_idx" ON "CaixaMercadoTurno"("terminalId", "fechadoEm")`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoTurno_lojaId_idx" ON "CaixaMercadoTurno"("lojaId", "abertoEm")`,
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoMovimento" (
     "id" TEXT NOT NULL,
     "turnoId" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "tipo" TEXT NOT NULL,
     "valorCentavos" INTEGER NOT NULL,
     "descricao" TEXT,
     "criadoPor" TEXT,
     "em" TIMESTAMP(3) NOT NULL,
     "cashMovementId" TEXT,
     CONSTRAINT "CaixaMercadoMovimento_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoMovimento_turno_idx" ON "CaixaMercadoMovimento"("turnoId")`,
  `CREATE TABLE IF NOT EXISTS "CaixaMercadoVenda" (
     "orderId" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "turnoId" TEXT NOT NULL,
     "terminalId" TEXT NOT NULL,
     "operador" TEXT,
     "operadorId" TEXT,
     "situacao" TEXT NOT NULL,
     "totalCentavos" INTEGER NOT NULL,
     "pagamentos" JSONB NOT NULL DEFAULT '[]',
     "trocoCentavos" INTEGER NOT NULL DEFAULT 0,
     "tefCentavos" INTEGER NOT NULL DEFAULT 0,
     "pixTxid" TEXT,
     "pixConfirmadoPor" TEXT,
     "itensCancelados" JSONB NOT NULL DEFAULT '[]',
     "criadoEm" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "CaixaMercadoVenda_pkey" PRIMARY KEY ("orderId")
   )`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoVenda_turno_idx" ON "CaixaMercadoVenda"("turnoId")`,
  `CREATE INDEX IF NOT EXISTS "CaixaMercadoVenda_lojaId_idx" ON "CaixaMercadoVenda"("lojaId", "criadoEm")`,
];

let pronto = false;
export async function garantirEstruturaDoCaixa(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[Caixa de mercado] Estrutura falhou:", err?.message);
  }
  return pronto;
}

/** Para as rotas: garante ou devolve a frase de "ainda não dá". */
export const MENSAGEM_SEM_ESTRUTURA = "O Caixa de mercado ainda não está disponível. Tente de novo em alguns minutos.";
