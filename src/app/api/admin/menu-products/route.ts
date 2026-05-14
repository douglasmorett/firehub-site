import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // FRANCHISEE: busca só produtos da sua própria loja
  // ADMIN: busca todos
  const where = user.role === "ADMIN" ? {} : { franchiseeId: user.id };

  const products = await prisma.menuProduct.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, price: true, category: true,
      imageUrl: true, active: true, isCombo: true,
      activePDV: true, cost: true,
    },
  });

  return NextResponse.json(products);
}
