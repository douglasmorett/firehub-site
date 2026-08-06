import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;

    const integrations = await prisma.ifoodIntegration.findMany({
      where: { userId: franchiseeId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        label: true,
        merchantId: true,
        connected: true,
        active: true,
        widgetId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ integrations });
  } catch (error) {
    console.error("Erro ao listar integrações iFood:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
