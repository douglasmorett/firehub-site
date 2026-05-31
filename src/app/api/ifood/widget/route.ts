/**
 * /api/ifood/widget/route.ts
 * PUT  { ifoodWidgetId } → salva o widget ID do iFood para a loja do usuário
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const { ifoodWidgetId } = await req.json();

    await prisma.user.update({
      where: { email: session.user.email },
      data: { ifoodWidgetId: ifoodWidgetId || null },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[ifood/widget] PUT error:", err);
    return NextResponse.json({ error: err.message || "Erro ao salvar widget ID" }, { status: 500 });
  }
}
