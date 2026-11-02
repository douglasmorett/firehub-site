/**
 * As tabelas da base de endereços do IBGE (lib/enderecos-ibge-servidor.ts).
 * Num arquivo só delas para o boot e o importador (scripts/importar-ibge.ts)
 * criarem as MESMAS tabelas sem o importador carregar o Prisma. Aditivas e
 * idempotentes: nenhuma tabela existente é tocada.
 */
export const DDL_DO_IBGE = [
  `CREATE TABLE IF NOT EXISTS "IbgeMunicipio" (
     "codigo" INTEGER NOT NULL,
     "nome" TEXT NOT NULL,
     "chaveDoNome" TEXT NOT NULL,
     "uf" TEXT NOT NULL,
     "fonte" TEXT NOT NULL,
     "enderecos" INTEGER NOT NULL,
     "trechos" INTEGER NOT NULL,
     "bairrosDaMalha" INTEGER NOT NULL DEFAULT 0,
     "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "IbgeMunicipio_pkey" PRIMARY KEY ("codigo")
   )`,
  `CREATE INDEX IF NOT EXISTS "IbgeMunicipio_chaveDoNome_idx" ON "IbgeMunicipio"("chaveDoNome")`,
  `CREATE TABLE IF NOT EXISTS "IbgeRua" (
     "id" BIGSERIAL NOT NULL,
     "municipio" INTEGER NOT NULL,
     "tipo" TEXT NOT NULL,
     "nome" TEXT NOT NULL,
     "chave" TEXT NOT NULL,
     "chaveSemTitulo" TEXT,
     "bairro" TEXT NOT NULL,
     "ceps" TEXT[] NOT NULL,
     "numeros" INTEGER[] NOT NULL,
     "lats" REAL[] NOT NULL,
     "lngs" REAL[] NOT NULL,
     CONSTRAINT "IbgeRua_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "IbgeRua_municipio_idx" ON "IbgeRua"("municipio")`,
  `CREATE TABLE IF NOT EXISTS "IbgeBairro" (
     "municipio" INTEGER NOT NULL,
     "nome" TEXT NOT NULL,
     "fonte" TEXT NOT NULL,
     "lat" REAL NOT NULL,
     "lng" REAL NOT NULL,
     "enderecos" INTEGER NOT NULL DEFAULT 0,
     "bbox" REAL[],
     "aneis" JSONB,
     CONSTRAINT "IbgeBairro_pkey" PRIMARY KEY ("municipio", "nome", "fonte")
   )`,
];
