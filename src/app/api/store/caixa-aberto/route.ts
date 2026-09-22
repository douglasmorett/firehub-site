import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { caixaEstaAberto } from "@/lib/caixa-aberto-servidor";

export const dynamic = "force-dynamic";

/**
 * Só isto: o caixa desta loja está aberto?
 *
 * Existe separado de /api/cash-session porque aquele GET calcula o turno
 * inteiro (esperado por forma de pagamento, movimentações, pendentes,
 * conferência de mesa) para responder. O PDV pergunta a cada carga de tela e
 * de novo antes de finalizar — pagar aquela conta toda por um booleano poria
 * o banco para trabalhar à toa no horário de pico, que é justamente quando o
 * PDV é usado.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!u) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  return NextResponse.json({ aberto: await caixaEstaAberto(u.ownerId || u.id) });
}
