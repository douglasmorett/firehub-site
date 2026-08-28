-- ════════════════════════════════════════════════════════════════════════════
-- Rede de embaixadores em 2 níveis — DDL a aplicar ANTES do deploy do código.
--
-- NÃO rode `prisma db push` a partir deste repo para aplicar isto. O schema
-- local está atrás do banco de produção, e o push levaria junto:
--   DROP TABLE "AmbassadorApplication"  (inscrições do /seja-embaixador, usada
--                                        por $queryRaw, não existe no schema)
--   DROP TABLE "Food99Store"
--   DROP COLUMN "CustomerOrder"."totemIdempotencyKey" (+ índice único)
--   DROP COLUMN "CustomerOrder"."routeSequence", "Order"."emergencyFine",
--               as quatro colunas "User"."brendi*"
-- Este arquivo tem só o que a rede de embaixadores precisa. É aditivo: nada
-- aqui apaga dado nenhum.
--
-- Ordem: aplicar este SQL primeiro, deployar o código depois. O contrário
-- quebra o /admin e o /embaixador (o Prisma passa a pedir colunas que ainda
-- não existem).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "Ambassador"
  ADD COLUMN IF NOT EXISTS "level2Percent"      DOUBLE PRECISION NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "linkedUserId"       TEXT,
  ADD COLUMN IF NOT EXISTS "parentAmbassadorId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Ambassador_linkedUserId_key"
  ON "Ambassador"("linkedUserId");

CREATE INDEX IF NOT EXISTS "Ambassador_parentAmbassadorId_idx"
  ON "Ambassador"("parentAmbassadorId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ambassador_parentAmbassadorId_fkey') THEN
    ALTER TABLE "Ambassador"
      ADD CONSTRAINT "Ambassador_parentAmbassadorId_fkey"
      FOREIGN KEY ("parentAmbassadorId") REFERENCES "Ambassador"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ambassador_linkedUserId_fkey') THEN
    ALTER TABLE "Ambassador"
      ADD CONSTRAINT "Ambassador_linkedUserId_fkey"
      FOREIGN KEY ("linkedUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
