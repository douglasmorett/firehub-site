import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Cria as colunas da REDE DE EMBAIXADORES (2 níveis) em Ambassador.
 *
 *   parentAmbassadorId — quem trouxe este embaixador para o programa
 *   level2Percent      — % que ele recebe das lojas dos embaixadores que trouxe
 *   linkedUserId       — a loja dele, quando o embaixador também é lojista
 *
 * Mesmo padrão de /api/admin/colunas-preco e /api/admin/coluna-ordem: SQL fixo
 * no código, aditivo, idempotente, disparado por uma pessoa e não pelo start do
 * container. Sem `criar=sim` na URL, só consulta.
 *
 * NÃO use `prisma db push` para isto. O schema do repo está atrás do banco de
 * produção e o push levaria junto a tabela `AmbassadorApplication` (as
 * inscrições do /seja-embaixador, que só existem no banco e são lidas por
 * $queryRaw), a `Food99Store` e a coluna `CustomerOrder.totemIdempotencyKey`.
 * Ver scripts/2026-08-28-rede-embaixadores.sql.
 *
 * A ORDEM IMPORTA: com os campos já no schema.prisma e as colunas ausentes, o
 * Prisma passa a pedi-las em toda consulta de embaixador — o /admin e o
 * /embaixador servem 500 até isto rodar.
 *
 * Uso:
 *   GET /api/admin/colunas-rede-embaixador            → diz o que falta
 *   GET /api/admin/colunas-rede-embaixador?criar=sim  → cria e confirma
 */

const COLUNAS = ["parentAmbassadorId", "level2Percent", "linkedUserId"] as const;

async function colunasExistentes(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'Ambassador'
      AND column_name IN ('parentAmbassadorId', 'level2Percent', 'linkedUserId')
  `;
  return Array.isArray(rows) ? rows.map((r) => r.column_name) : [];
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login no painel primeiro." }, { status: 401 });
  }
  if ((session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Só a matriz pode aplicar isto." }, { status: 403 });
  }

  try {
    const antes = await colunasExistentes();
    const faltando = COLUNAS.filter((c) => !antes.includes(c));

    if (req.nextUrl.searchParams.get("criar") !== "sim") {
      return NextResponse.json({
        jaExistem: antes,
        faltando,
        proximoPasso: faltando.length === 0
          ? "Tudo aplicado. A rede de 2 níveis pode ser usada."
          : "Abra esta mesma URL com ?criar=sim no final para criar as colunas.",
      });
    }

    if (faltando.length === 0) {
      return NextResponse.json({
        jaExistem: antes,
        criadasAgora: [],
        mensagem: "As colunas já existiam. Nada foi alterado.",
      });
    }

    // SQL fixo. Nada vem da requisição.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Ambassador" ADD COLUMN IF NOT EXISTS "parentAmbassadorId" TEXT`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Ambassador" ADD COLUMN IF NOT EXISTS "level2Percent" DOUBLE PRECISION NOT NULL DEFAULT 3`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Ambassador" ADD COLUMN IF NOT EXISTS "linkedUserId" TEXT`
    );
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Ambassador_linkedUserId_key" ON "Ambassador"("linkedUserId")`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "Ambassador_parentAmbassadorId_idx" ON "Ambassador"("parentAmbassadorId")`
    );

    // As chaves estrangeiras não têm "IF NOT EXISTS" — daí o teste pelo nome.
    await prisma.$executeRawUnsafe(`
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
    `);

    const depois = await colunasExistentes();
    const aindaFaltam = COLUNAS.filter((c) => !depois.includes(c));
    if (aindaFaltam.length > 0) {
      return NextResponse.json(
        { error: "O comando rodou mas nem todas as colunas apareceram.", aindaFaltam },
        { status: 500 }
      );
    }

    console.log(`[colunas-rede-embaixador] Criadas por ${session.user.email}: ${faltando.join(", ")}`);
    return NextResponse.json({
      jaExistem: depois,
      criadasAgora: faltando,
      mensagem:
        "Colunas criadas, todas vazias. Nenhum embaixador tem indicador ainda, " +
        "então nenhum split mudou. Agora dá para promover lojistas a embaixador.",
    });
  } catch (err: any) {
    console.error("[colunas-rede-embaixador] Falhou:", err);
    return NextResponse.json({ error: err?.message || "Falha ao criar as colunas" }, { status: 500 });
  }
}
