import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { registrarVendaPresencial } from "@/lib/venda-presencial";

/**
 * POST /api/store/orders/presencial — a venda do PDV do painel (balcão, mesa
 * e delivery lançados no /store/venda-presencial).
 *
 * Esta rota só diz QUEM vende e de qual loja: a regra inteira da venda — as
 * travas, a medida da entrega, o estoque, a gravação, a impressão e o aviso
 * ao cliente — mora em lib/venda-presencial.ts, a mesma que o pedido de
 * balcão do garçom (api/garcom/balcao) usa.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await req.json();

  const dbUser = await prisma.user.findUnique({ where: { email: session.user.email! }, select: { id: true, ownerId: true } });
  if (!dbUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const r = await registrarVendaPresencial({
    franchiseeId: dbUser.ownerId || dbUser.id,
    origemDaImpressao: dbUser.ownerId ? "FIREHUB" : "HAKIM RIO DAS OSTRAS",
    passaPeloBloqueio: (session.user as any)?.role === "ADMIN",
    data,
  });
  return NextResponse.json(r.corpo, { status: r.status });
}
