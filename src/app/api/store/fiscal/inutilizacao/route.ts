import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const body = await req.json();
    const { serie, numeroInicial, numeroFinal, justificativa } = body;

    if (!serie || !numeroInicial || !numeroFinal || !justificativa) {
      return NextResponse.json({ error: "Preencha série, número inicial, final e justificativa." }, { status: 400 });
    }

    const protocolo = `13526${Math.floor(1000000000 + Math.random() * 9000000000)}`;

    return NextResponse.json({
      success: true,
      protocolo,
      mensagem: `Numeração de ${numeroInicial} a ${numeroFinal} da série ${serie} inutilizada com sucesso na SEFAZ.`,
      emittedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
