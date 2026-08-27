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

    // O breakdown era gravado como veio — QUALQUER JSON entrava. Confere o
    // formato ([{name, price, ncm?...}]) e o NCM de cada item antes de gravar.
    let breakdown: any = null;
    if (body.fiscalBreakdown != null) {
      if (!Array.isArray(body.fiscalBreakdown) || body.fiscalBreakdown.length > 50) {
        return NextResponse.json(
          { error: "fiscalBreakdown precisa ser uma lista de até 50 itens." },
          { status: 400 }
        );
      }
      const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
      for (const item of body.fiscalBreakdown) {
        if (!item || typeof item !== "object" || typeof item.name !== "string" || !item.name.trim()) {
          return NextResponse.json({ error: "Cada item do combo precisa de um nome." }, { status: 400 });
        }
        const preco = Number(item.price);
        if (!Number.isFinite(preco) || preco < 0) {
          return NextResponse.json({ error: `Preço inválido no item "${item.name}".` }, { status: 400 });
        }
        if (item.ncm && soDigitos(item.ncm).length !== 8) {
          return NextResponse.json({ error: `NCM do item "${item.name}" precisa ter 8 dígitos.` }, { status: 400 });
        }
      }
      breakdown = body.fiscalBreakdown;
    }

    const updated = await prisma.menuProduct.update({
      where: { id: comboId },
      data: { fiscalBreakdown: breakdown },
    });

    return NextResponse.json({ success: true, combo: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
