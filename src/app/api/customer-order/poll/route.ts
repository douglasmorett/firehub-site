import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// GET: Fast polling endpoint - returns only orders for the franchisee
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true }
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id },
    include: { items: { include: { menuProduct: { select: { id: true, name: true, cost: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return NextResponse.json(orders);
}
