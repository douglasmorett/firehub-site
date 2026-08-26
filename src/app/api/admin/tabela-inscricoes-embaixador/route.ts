import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Cria a tabela `AmbassadorApplication` — as inscrições de quem quer ser
 * embaixador do FireHub.
 *
 * Mesmo caminho de /api/admin/colunas-preco e /api/admin/coluna-ordem, e pelo
 * mesmo motivo: o `prisma db push` saiu do build, e a DATABASE_URL de produção
 * não está acessível a quem roda comando aqui — os .env do projeto estão
 * higienizados. Quem tem a credencial é a aplicação, que já está conectada.
 *
 * Por que é seguro:
 *
 *   - Roda por decisão de uma pessoa, não no start do container.
 *   - O SQL é fixo no código. Nada vem da requisição.
 *   - `CREATE TABLE IF NOT EXISTS` de tabela NOVA não toca em nada que exista.
 *     Rodar dez vezes é igual a rodar uma.
 *   - Sem `criar=sim` na URL, só CONSULTA. Abrir por engano não escreve nada.
 *
 * Diferente do caso das colunas de preço, aqui a ordem é menos perigosa: uma
 * TABELA que falta só quebra as consultas dela mesma. Uma COLUNA que falta
 * numa tabela existente derruba todo `include:` daquele modelo — foi assim que
 * /loja caiu em 24/08/2026. Ainda assim, rode isto ANTES de abrir a aba
 * "Inscrições" no admin, senão ela responde erro.
 *
 * Uso:
 *   GET /api/admin/tabela-inscricoes-embaixador            → diz se já existe
 *   GET /api/admin/tabela-inscricoes-embaixador?criar=sim  → cria e confirma
 */

async function tabelaExiste(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name = 'AmbassadorApplication'
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login no painel primeiro." }, { status: 401 });
  }
  if ((session.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Só o admin do FireHub roda isto." }, { status: 403 });
  }

  const jaExistia = await tabelaExiste();

  if (req.nextUrl.searchParams.get("criar") !== "sim") {
    return NextResponse.json({
      tabela: "AmbassadorApplication",
      existe: jaExistia,
      comoCriar: jaExistia
        ? "Nada a fazer — a tabela já existe."
        : "Abra esta mesma URL com ?criar=sim no final.",
    });
  }

  if (!jaExistia) {
    // `status` é texto e não enum de propósito: enum no Postgres precisa de
    // ALTER TYPE para ganhar valor novo, e essa é a parte que mais muda aqui.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AmbassadorApplication" (
        "id"         TEXT PRIMARY KEY,
        "fullName"   TEXT NOT NULL,
        "instagram"  TEXT NOT NULL,
        "followers"  INTEGER NOT NULL DEFAULT 0,
        "whatsapp"   TEXT,
        "email"      TEXT,
        "message"    TEXT,
        "status"     TEXT NOT NULL DEFAULT 'NOVO',
        "notes"      TEXT,
        "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AmbassadorApplication_status_createdAt_idx"
        ON "AmbassadorApplication" ("status", "createdAt")
    `);
  }

  return NextResponse.json({
    ok: true,
    tabela: "AmbassadorApplication",
    jaExistia,
    existeAgora: await tabelaExiste(),
    mensagem: jaExistia
      ? "A tabela já existia. Nada foi alterado."
      : "Tabela criada. A aba 'Inscrições' do admin já pode ser aberta.",
  });
}
