import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Cria a coluna `routeSequence` em CustomerOrder — a ORDEM da parada na rota.
 *
 * A loja monta a rota no mapa numerando as paradas (1º, 2º, 3º…), mas essa
 * sequência não era gravada em lugar nenhum: o app do motoboy ordenava por
 * data de criação DESC, e o entregador via as paradas na ordem inversa de
 * entrada dos pedidos — a rota otimizada morria dentro do painel.
 *
 * Mesmo caminho de /api/admin/colunas-preco, e pelos mesmos motivos (o db push
 * saiu do build; a credencial do banco é da aplicação). Coluna NULÁVEL e
 * ADITIVA: pedido sem sequência continua exatamente como hoje.
 *
 * ⚠️ Esta coluna NÃO entra no schema.prisma de propósito: quem grava e lê é
 * SQL cru em pontos isolados. Declarar no schema exigiria commitar junto o
 * trabalho em andamento de outra frente, e coluna+schema fora de sincronia já
 * derrubou o cardápio duas vezes (ver colunas-preco).
 *
 * Uso:
 *   GET /api/admin/coluna-sequencia-rota            → diz se já existe
 *   GET /api/admin/coluna-sequencia-rota?criar=sim  → cria e confirma
 */

async function colunaExiste(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'CustomerOrder' AND column_name = 'routeSequence'
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

  const jaExistia = await colunaExiste();

  if (req.nextUrl.searchParams.get("criar") !== "sim") {
    return NextResponse.json({
      coluna: "CustomerOrder.routeSequence",
      existe: jaExistia,
      comoCriar: jaExistia ? "Nada a fazer." : "Abra esta mesma URL com ?criar=sim no final.",
    });
  }

  if (!jaExistia) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "routeSequence" INTEGER`
    );
  }

  return NextResponse.json({
    ok: true,
    coluna: "CustomerOrder.routeSequence",
    jaExistia,
    existeAgora: await colunaExiste(),
  });
}
