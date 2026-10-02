/**
 * GET /api/cash-session/por-tipo?sessionId=…
 *
 * As vendas de um caixa JÁ FECHADO separadas por tipo (Delivery, Retirada,
 * Balcão, Mesas, Totem), para o Histórico de caixas. Pedido da Delícia de Casa
 * (02/10/2026): "no fechamento do caixa e no extrato de fechamento também".
 *
 * Apurado na hora, na janela do caixa (abertura → fechamento), pela mesma
 * função do papel e da 2ª via (lib/esperado-do-turno.ts) — o retrato do turno
 * não é gravado em lugar nenhum. Só na hora do clique: o histórico lista 60
 * caixas, e apurar todos ao abrir a página seria 60 varreduras de pedidos.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  if (!u) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const lojaId = u.ownerId || u.id;

  const sessionId = new URL(req.url).searchParams.get("sessionId") || "";
  if (!sessionId) return NextResponse.json({ error: "Informe o caixa." }, { status: 400 });

  // A sessão TEM que ser desta loja: o id vem do navegador.
  const caixa = await prisma.cashSession.findFirst({ where: { id: sessionId, franchiseeId: lojaId } });
  if (!caixa) return NextResponse.json({ error: "Caixa não encontrado." }, { status: 404 });

  const d = await calcularEsperadoDoTurno(lojaId, caixa, { ate: caixa.closedAt || new Date() });
  return NextResponse.json({
    vendas: d.detalhe.vendas,
    porTipo: d.detalhe.porTipo,
    trocoDasMesas: { valor: d.detalhe.mesas.troco || 0, qtd: d.detalhe.mesas.trocoQtd || 0 },
  });
}
