import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Cria a coluna MenuProduct.sortOrder — a que falta para a loja poder ordenar
 * os produtos dentro da categoria.
 *
 * Por que uma rota em vez do `prisma db push`:
 *
 * O push exige a DATABASE_URL de produção na mão de quem roda, e ela não está
 * em lugar nenhum do repositório (todos os .env do projeto estão higienizados).
 * A aplicação, por outro lado, já está conectada ao banco. Então quem tem a
 * credencial é ela — e basta alguém com sessão de dono abrir esta rota.
 *
 * Por que é seguro, ao contrário da migração automática que já derrubou o
 * cardápio duas vezes (5a953ac):
 *
 *   - Roda por decisão de uma pessoa, não no start do container. Se der errado,
 *     dá errado numa aba do navegador, não num container que morre em loop.
 *   - O SQL é fixo no código. Não há nada vindo da requisição — sem interpolação,
 *     sem nome de tabela dinâmico.
 *   - É ADITIVO e IDEMPOTENTE. `ADD COLUMN IF NOT EXISTS` com default 0 não
 *     apaga, não altera e não reordena nada; rodar dez vezes tem o mesmo efeito
 *     de rodar uma. Nada a ver com o `--accept-data-loss` do db push.
 *   - Sem `criar=sim` na URL, só CONSULTA. Abrir a rota por engano (ou um
 *     prefetch do navegador) não escreve no banco.
 *
 * Uso:
 *   GET /api/admin/coluna-ordem            → diz se a coluna existe
 *   GET /api/admin/coluna-ordem?criar=sim  → cria, e confirma o resultado
 */

async function colunaExiste(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ achou: number }[]>`
    SELECT 1 AS achou
    FROM information_schema.columns
    WHERE table_name = 'MenuProduct' AND column_name = 'sortOrder'
    LIMIT 1
  `;
  return Array.isArray(rows) && rows.length > 0;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login no painel primeiro." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  // Alterar o schema do banco é coisa de dono da loja ou da matriz — não de
  // funcionário com acesso ao painel.
  // DDL em produção é ato de ADMIN, e só. A condição antiga (`|| !user.ownerId`)
  // liberava para QUALQUER dono de loja — todo franqueado tem ownerId nulo —,
  // então qualquer cliente logado criava/alterava coluna no banco de todos.
  const ehDono = user.role === "ADMIN";
  if (!ehDono) {
    return NextResponse.json(
      { error: "Só o dono da loja ou a matriz podem aplicar isto." },
      { status: 403 }
    );
  }

  try {
    const antes = await colunaExiste();

    if (req.nextUrl.searchParams.get("criar") !== "sim") {
      return NextResponse.json({
        colunaExiste: antes,
        proximoPasso: antes
          ? "A coluna já existe. Nada a fazer — avise que dá para ligar a ordenação."
          : "Abra esta mesma URL com ?criar=sim no final para criar a coluna.",
      });
    }

    if (antes) {
      return NextResponse.json({
        colunaExiste: true,
        criadaAgora: false,
        mensagem: "A coluna já existia. Nada foi alterado.",
      });
    }

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0`
    );

    const depois = await colunaExiste();
    if (!depois) {
      return NextResponse.json(
        { error: "O comando rodou mas a coluna não apareceu. Não ligue a ordenação ainda." },
        { status: 500 }
      );
    }

    console.log(`[coluna-ordem] MenuProduct.sortOrder criada por ${session.user.email}`);
    return NextResponse.json({
      colunaExiste: true,
      criadaAgora: true,
      mensagem:
        "Coluna criada. Todos os produtos ficaram com sortOrder 0, e o desempate " +
        "continua sendo o nome — o cardápio não mudou de ordem. Agora dá para " +
        "devolver o campo ao schema e ligar a ordenação.",
    });
  } catch (err: any) {
    console.error("[coluna-ordem] Falhou:", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao aplicar a coluna" },
      { status: 500 }
    );
  }
}
