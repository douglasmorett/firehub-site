import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Cria as colunas de PREÇO POR CANAL em MenuProduct.
 *
 *   priceSalao    — balcão e mesa (o cliente está aqui dentro)
 *   priceDelivery — cardápio online, iFood, JotaJá, 99Food, WhatsApp
 *   priceTotem    — o quiosque de autoatendimento
 *
 * Todas NULÁVEIS: nulo significa "usa o preço normal do produto". Uma loja que
 * nunca preencher nada continua com um preço só para tudo, exatamente como hoje.
 *
 * Por que uma rota em vez do `prisma db push`:
 *
 * O push exige a DATABASE_URL de produção na mão de quem roda, e ela não está em
 * lugar nenhum acessível — os .env do projeto estão higienizados. A aplicação,
 * por outro lado, já está conectada ao banco: quem tem a credencial é ela. É o
 * mesmo caminho que criou MenuProduct.sortOrder (ver /api/admin/coluna-ordem).
 *
 * Por que é seguro, ao contrário da migração automática que já derrubou o
 * cardápio duas vezes (5a953ac):
 *
 *   - Roda por decisão de uma pessoa, não no start do container. Dando errado,
 *     dá errado numa aba do navegador.
 *   - O SQL é fixo no código. Nada vem da requisição.
 *   - É ADITIVO e IDEMPOTENTE. `ADD COLUMN IF NOT EXISTS` de coluna nulável não
 *     apaga, não altera e não reordena nada; rodar dez vezes é igual a uma.
 *   - Sem `criar=sim` na URL, só CONSULTA. Abrir por engano não escreve nada.
 *
 * A ORDEM IMPORTA: estas colunas precisam existir ANTES de os campos entrarem no
 * schema.prisma. Com o campo declarado e a coluna ausente, o Prisma passa a
 * pedir a coluna em toda consulta que use `include:` e o cardápio inteiro serve
 * 500 — foi assim que /loja caiu em 24/08/2026.
 *
 * Uso:
 *   GET /api/admin/colunas-preco            → diz quais já existem
 *   GET /api/admin/colunas-preco?criar=sim  → cria as que faltam e confirma
 */

const COLUNAS = ["priceSalao", "priceDelivery", "priceTotem"] as const;

async function colunasExistentes(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'MenuProduct'
      AND column_name IN ('priceSalao', 'priceDelivery', 'priceTotem')
  `;
  return Array.isArray(rows) ? rows.map((r) => r.column_name) : [];
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
  const ehDono = user.role === "ADMIN" || !user.ownerId;
  if (!ehDono) {
    return NextResponse.json(
      { error: "Só o dono da loja ou a matriz podem aplicar isto." },
      { status: 403 }
    );
  }

  try {
    const antes = await colunasExistentes();
    const faltando = COLUNAS.filter((c) => !antes.includes(c));

    if (req.nextUrl.searchParams.get("criar") !== "sim") {
      return NextResponse.json({
        jaExistem: antes,
        faltando,
        proximoPasso: faltando.length === 0
          ? "Todas as colunas já existem. Nada a fazer — dá para ligar o preço por canal."
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

    // SQL fixo, uma instrução por coluna. Nada vem da requisição.
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceSalao" DOUBLE PRECISION`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceDelivery" DOUBLE PRECISION`
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceTotem" DOUBLE PRECISION`
    );

    const depois = await colunasExistentes();
    const aindaFaltam = COLUNAS.filter((c) => !depois.includes(c));
    if (aindaFaltam.length > 0) {
      return NextResponse.json(
        {
          error: "O comando rodou mas nem todas as colunas apareceram. Não ligue o preço por canal ainda.",
          aindaFaltam,
        },
        { status: 500 }
      );
    }

    console.log(`[colunas-preco] Criadas em MenuProduct por ${session.user.email}: ${faltando.join(", ")}`);
    return NextResponse.json({
      jaExistem: depois,
      criadasAgora: faltando,
      mensagem:
        "Colunas criadas, todas vazias. Produto sem preço por canal continua " +
        "usando o preço normal, então nada mudou de preço no cardápio. " +
        "Agora dá para subir os campos no schema e a aba de preços.",
    });
  } catch (err: any) {
    console.error("[colunas-preco] Falhou:", err);
    return NextResponse.json(
      { error: err?.message || "Falha ao criar as colunas" },
      { status: 500 }
    );
  }
}
