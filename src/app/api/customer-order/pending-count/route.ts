import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// GET - retorna contagem de pedidos em SAIU_ENTREGA para o lojista
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ count: 0 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true },
  });
  if (!user) return NextResponse.json({ count: 0 });

  const targetId = user.ownerId || user.id;

  const count = await prisma.customerOrder.count({
    where: {
      franchiseeId: targetId,
      status: "SAIU_ENTREGA",
      // Mesa não é "pedido na rua": o fechamento do caixa não a finaliza (quem fecha é a
      // conta da mesa), então contá-la aqui avisava de algo que não ia acontecer.
      tableSessionId: null,
    },
  });

  return NextResponse.json({ count });
}
