/**
 * GET /api/store/table-sessions/[id]/conta
 *
 * A conta da mesa, já dividida por pessoa. É o que o garçom abre na hora de
 * fechar: quanto é o total, quanto cada um consumiu, e quanto falta receber.
 *
 * A conta em si é calculada em src/lib/conta-da-mesa.ts — a mesma função que
 * monta o cupom impresso (rota imprimir-conta), para o papel e a tela nunca
 * dizerem totais diferentes.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { calcularContaDaMesa, sanearTaxa } from "@/lib/conta-da-mesa";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = operador.franchiseeId;

  const { id } = await params;

  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    include: {
      table: { select: { number: true, label: true } },
      orders: {
        select: {
          status: true,
          totalAmount: true,
          dailyOrderNumber: true,
          items: {
            select: {
              id: true, quantity: true, price: true, productName: true,
              tableGuestId: true,
              menuProduct: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!mesa || mesa.franchiseeId !== lojaId) {
    return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
  }

  const pessoas = await prisma.tableGuest.findMany({
    where: { tableSessionId: id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  // A tela de fechamento manda a taxa e a gorjeta que o garçom escolheu na
  // hora. Sem isso, o rateio usaria os valores salvos na sessão e a soma das
  // partes não bateria com o total que o fechamento vai exigir — a mesa
  // mostraria uma conta e recusaria fechar por outra.
  //
  // O fallback da taxa é 0, não `mesa.serviceFee`: o fechamento grava ali o
  // VALOR em reais da taxa, não o percentual. Ler aquele campo como "%"
  // transformaria uma taxa de R$ 24 em 24% e inflaria a conta inteira.
  const taxaPct = sanearTaxa(req.nextUrl.searchParams.get("taxa"), 0);
  const gorjetaParam = req.nextUrl.searchParams.get("gorjeta");
  const gorjeta =
    gorjetaParam !== null && gorjetaParam !== "" ? Math.max(0, Number(gorjetaParam) || 0) : null;

  return NextResponse.json(calcularContaDaMesa(mesa, pessoas, taxaPct, gorjeta));
}
