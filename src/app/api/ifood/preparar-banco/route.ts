/**
 * /api/ifood/preparar-banco
 *
 * Cria as colunas do código de entrega quando elas ainda não existem.
 *
 * As colunas TAMBÉM estão declaradas no schema do Prisma, e é assim que tem que ser:
 * o build deste projeto roda `prisma db push --accept-data-loss` antes do `next build`,
 * e esse comando REMOVE do banco qualquer coluna que não esteja no schema. Deixá-las de
 * fora — como estavam antes — fazia o próprio deploy apagá-las silenciosamente. Foi o que
 * aconteceu: criadas à mão, sumiram no deploy seguinte.
 *
 * Então por que esta rota continua existindo? Porque o `db push` só roda no build. Se
 * alguém subir o container sem rebuild, ou restaurar um backup antigo, esta rota conserta
 * em um clique e sem terminal. `ADD COLUMN IF NOT EXISTS` torna a chamada repetível.
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
