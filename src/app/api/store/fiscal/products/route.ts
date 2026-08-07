import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;

    const products = await prisma.menuProduct.findMany({
      where: { franchiseeId, active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, products });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;
    const body = await req.json();
    const { productId, ncm, cest, cfop, origem, csosn, pis, cofins } = body;

    if (!productId) return NextResponse.json({ error: "Product ID obrigatório" }, { status: 400 });

    const updated = await prisma.menuProduct.updateMany({
      where: { id: productId, franchiseeId },
      data: {
        ncm: ncm || "2106.90.90",
        cest: cest || null,
        cfop: cfop || "5102",
        origem: origem || "0",
        csosn: csosn || "102",
        pis: pis || "49",
        cofins: cofins || "49",
      },
    });

    return NextResponse.json({ success: true, count: updated.count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
