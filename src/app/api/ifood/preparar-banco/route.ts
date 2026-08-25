/**
 * /api/ifood/preparar-banco
 *
 * Cria as colunas que o módulo Logistics precisa, sem passar pelo schema do
 * Prisma.
 *
 * O desvio é deliberado. Neste projeto, declarar um campo no schema antes de a
 * coluna existir no banco já derrubou a loja duas vezes: o Prisma Client passa
 * a pedir a coluna em todo SELECT de CustomerOrder e o erro derruba a tela
 * inteira, não só a funcionalidade nova. Como o `db push` aqui é manual, o
 * intervalo entre "subiu o código" e "alguém rodou a migração" é justamente a
 * janela perigosa.
 *
 * Por isso estas duas colunas são criadas por SQL e lidas por `$queryRaw`. Elas
 * não aparecem no schema, então nenhuma query existente muda de forma. Se um
 * dia forem promovidas a campos de verdade, basta declará-las — a coluna já vai
 * estar lá.
 *
 * `ADD COLUMN IF NOT EXISTS` torna a rota repetível sem efeito colateral.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }

  const feitos: string[] = [];
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "ifoodDropCodeRequired" BOOLEAN NOT NULL DEFAULT false`,
    );
    feitos.push("CustomerOrder.ifoodDropCodeRequired");

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "ifoodDropCodeAt" TIMESTAMP(3)`,
    );
    feitos.push("CustomerOrder.ifoodDropCodeAt");

    return NextResponse.json({
      ok: true,
      colunas: feitos,
      mensagem: "Banco preparado para o módulo Logistics.",
    });
  } catch (e: any) {
    console.error("[iFood preparar-banco]", e?.message);
    return NextResponse.json(
      { error: "Não foi possível preparar o banco.", detalhe: e?.message, feitos },
      { status: 500 },
    );
  }
}

/** GET só confere o que existe — útil antes de gravar o vídeo. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }
  try {
    const linhas = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'CustomerOrder'
        AND column_name IN ('ifoodDropCodeRequired', 'ifoodDropCodeAt')
    `;
    const presentes = linhas.map((l) => l.column_name);
    return NextResponse.json({
      pronto: presentes.length === 2,
      presentes,
      faltando: ["ifoodDropCodeRequired", "ifoodDropCodeAt"].filter((c) => !presentes.includes(c)),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
