import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Cria a tabela `Food99Store` — várias lojas do 99Food por conta — e MIGRA
 * para dentro dela o que hoje mora em colunas do `User`.
 *
 * ── Por que a tabela ────────────────────────────────────────────────────────
 *
 * O 99Food cabia em quatro colunas do usuário (`food99MerchantId`,
 * `food99AppId`, `food99SecretKey`, `food99Connected`). Isso significa UMA loja
 * por conta: conectar a segunda sobrescreveria a primeira, sem aviso. O iFood
 * nunca teve esse limite porque nasceu com tabela própria (`IfoodIntegration`).
 *
 * Também é o que destrava a cobrança: `lib/billing.ts` já calcula
 * `(lojas99 - 1) * R$50`, mas `lojas99` vinha de um booleano e nunca passava de
 * 1 — a conta dava sempre zero. Com linhas, ela passa a valer.
 *
 * ── Por que uma rota, e não `prisma db push` ────────────────────────────────
 *
 * Mesmo motivo de /api/admin/colunas-preco e /api/admin/tabela-inscricoes-
 * embaixador: o push saiu do build e a DATABASE_URL de produção não está ao
 * alcance de quem roda comando — os .env do projeto estão higienizados. Quem
 * tem a credencial é a aplicação.
 *
 * ── Por que é seguro rodar com a loja recebendo pedido ──────────────────────
 *
 *   - CREATE TABLE IF NOT EXISTS de tabela NOVA não toca em nada que exista.
 *   - A migração COPIA das colunas do User; não apaga nem altera nenhuma. Se
 *     algo der errado aqui, o caminho antigo continua inteiro e funcionando —
 *     e é justamente por isso que ele continua sendo o plano B no código.
 *   - Idempotente: `ON CONFLICT DO NOTHING`. Rodar dez vezes é igual a uma.
 *   - Sem `criar=sim`, só CONSULTA.
 *
 * Uso:
 *   GET /api/admin/tabela-lojas-99food            → diz o que existe hoje
 *   GET /api/admin/tabela-lojas-99food?criar=sim  → cria, migra e confirma
 */

async function tabelaExiste(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_name = 'Food99Store'
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

  // Quem seria migrado: contas com 99Food ligado nas colunas antigas.
  const candidatos = await prisma.user.findMany({
    where: { OR: [{ food99Connected: true }, { food99AppId: { not: null } }, { food99MerchantId: { not: null } }] },
    select: { id: true, storeName: true, name: true, food99AppId: true, food99MerchantId: true, food99Connected: true },
  });

  if (req.nextUrl.searchParams.get("criar") !== "sim") {
    return NextResponse.json({
      tabela: "Food99Store",
      existe: jaExistia,
      lojasQueSeriamMigradas: candidatos.map((c) => ({
        conta: c.storeName || c.name,
        appShopId: c.food99AppId || c.id,
        shopId: c.food99MerchantId,
        conectada: c.food99Connected,
      })),
      comoCriar: "Abra esta mesma URL com ?criar=sim no final.",
    });
  }

  if (!jaExistia) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Food99Store" (
        "id"         TEXT PRIMARY KEY,
        "userId"     TEXT NOT NULL,
        "label"      TEXT,
        "appShopId"  TEXT NOT NULL,
        "shopId"     TEXT,
        "connected"  BOOLEAN NOT NULL DEFAULT true,
        "active"     BOOLEAN NOT NULL DEFAULT true,
        "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // O appShopId é o que o webhook usa para achar a dona do pedido. Único no
    // sistema inteiro, não por conta: duas contas reivindicando o mesmo vínculo
    // é exatamente como pedido cai na cozinha errada.
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Food99Store_appShopId_key" ON "Food99Store" ("appShopId")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Food99Store_userId_idx" ON "Food99Store" ("userId")
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Food99Store_shopId_idx" ON "Food99Store" ("shopId")
    `);
  }

  // ── Migração ────────────────────────────────────────────────────────────
  // `food99AppId` quando existe; senão o próprio id da conta, que é o valor que
  // a autorização usou nas lojas conectadas antes da adoção de vínculo (é o
  // caso da Brasa Burguer: app_shop_id == lojaId).
  let migradas = 0;
  for (const c of candidatos) {
    const appShopId = c.food99AppId || c.id;
    if (!appShopId) continue;
    const r = await prisma.$executeRaw`
      INSERT INTO "Food99Store" ("id","userId","label","appShopId","shopId","connected","active","createdAt","updatedAt")
      VALUES (${`f99_${c.id}`}, ${c.id}, ${c.storeName || c.name || null}, ${appShopId}, ${c.food99MerchantId}, ${!!c.food99Connected}, true, NOW(), NOW())
      ON CONFLICT ("appShopId") DO NOTHING
    `;
    migradas += Number(r) || 0;
  }

  const total = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Food99Store"`;

  return NextResponse.json({
    ok: true,
    tabela: "Food99Store",
    jaExistia,
    migradasAgora: migradas,
    totalNaTabela: Number(total?.[0]?.n ?? 0),
    mensagem:
      "Tabela pronta. As colunas antigas do User continuam intactas e seguem valendo como plano B — " +
      "nada deixa de funcionar se esta tabela ficar vazia.",
  });
}
