import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// GET - retorna paymentFees da LOJA (a linha do dono, `ownerId || id`): é a
// que o cardápio e as rotas de pedido leem. O funcionário no PDV recebia a
// linha DELE, sem as bandeiras do vale nem as formas próprias da loja
// (lib/formas-proprias.ts).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const quem = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, paymentFees: true, deliveryConfig: true },
  });
  const user = quem?.ownerId
    ? await prisma.user.findUnique({ where: { id: quem.ownerId }, select: { paymentFees: true, deliveryConfig: true } })
    : quem;

  return NextResponse.json({
    paymentFees: user?.paymentFees || {},
    deliveryConfig: user?.deliveryConfig || {},
  });
}
