import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { caixaEstaAberto } from "@/lib/caixa-aberto-servidor";

export const dynamic = "force-dynamic";

/**
 * Só isto: o caixa desta loja está aberto?
 *
 * Existe separado de /api/cash-session porque aquele GET calcula o turno
 * inteiro (esperado por forma de pagamento, movimentações, pendentes,
 * conferência de mesa) para responder. O PDV e o app de Mesas perguntam a cada
 * carga de tela e de novo a cada 30s — pagar aquela conta toda por um booleano
 * poria o banco para trabalhar à toa no horário de pico, que é justamente
 * quando as duas telas são usadas.
 *
 * Responde ao painel E ao garçom logado pelo link. O garçom não tem sessão do
 * NextAuth, e sem este caminho ele receberia 401 e a faixa "caixa fechado"
 * nunca apareceria no aparelho dele — justamente quem mais precisa saber, já
 * que é ele que vai até a mesa.
 */
export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (session?.user?.email) {
    const u = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (u) return NextResponse.json({ aberto: await caixaEstaAberto(u.ownerId || u.id) });
  }

  const operador = await resolverOperadorDaMesa().catch(() => null);
  if (operador) return NextResponse.json({ aberto: await caixaEstaAberto(operador.franchiseeId) });

  return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
}
