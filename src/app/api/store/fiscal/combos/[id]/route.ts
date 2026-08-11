import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;
    const resolvedParams = await params;
    const comboId = resolvedParams.id;
    const body = await req.json();

    const combo = await prisma.menuProduct.findFirst({
      where: { id: comboId, franchiseeId },
    });
    if (!combo) return NextResponse.json({ error: "Combo não encontrado" }, { status: 404 });

    const updated = await prisma.menuProduct.update({
      where: { id: comboId },
      data: { fiscalBreakdown: body.fiscalBreakdown || null },
    });

    return NextResponse.json({ success: true, combo: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
