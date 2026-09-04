/**
 * POST /api/store/table-sessions/[id]/transferir
 *
 * Muda a mesa de uma conta aberta. Corpo: { toTableId }.
 *
 * O grupo trocou de mesa, juntou duas, ou o garçom abriu na mesa errada: a
 * sessão (pedidos, pessoas, pagamentos) continua a mesma, só o `tableId`
 * muda. Antes o botão dizia "em breve" e a saída era fechar a mesa errada
 * sem pagar e relançar tudo na certa — com o pedido saindo de novo na cozinha.
 *
 * Regras: origem e destino são da MESMA loja; a origem está aberta; o
 * destino está ativo e sem conta aberta. O nome "Mesa N" gravado nos pedidos
 * (customerName/customerAddress) é atualizado para o KDS e a impressão não
 * continuarem apontando para a mesa velha.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = operador.franchiseeId;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const toTableId = typeof body?.toTableId === "string" ? body.toTableId : "";
  if (!toTableId) return NextResponse.json({ error: "Informe a mesa de destino" }, { status: 400 });

  const sessao = await prisma.tableSession.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      customerName: true,
      table: { select: { id: true, number: true, franchiseeId: true } },
    },
  });
  if (!sessao || sessao.table.franchiseeId !== lojaId) {
    return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
  }
  if (sessao.status !== "OPEN") {
    return NextResponse.json({ error: "Esta conta já foi fechada" }, { status: 400 });
  }
  if (sessao.table.id === toTableId) {
    return NextResponse.json({ error: "A conta já está nesta mesa" }, { status: 400 });
  }

  const destino = await prisma.table.findUnique({
    where: { id: toTableId },
    select: {
      id: true,
      number: true,
      isActive: true,
      franchiseeId: true,
      sessions: { where: { status: "OPEN" }, select: { id: true } },
    },
  });
  if (!destino || destino.franchiseeId !== lojaId) {
    return NextResponse.json({ error: "Mesa de destino não encontrada" }, { status: 404 });
  }
  if (!destino.isActive) {
    return NextResponse.json({ error: "A mesa de destino está desativada" }, { status: 400 });
  }
  if (destino.sessions.length > 0) {
    return NextResponse.json({ error: `A mesa ${destino.number} já está ocupada` }, { status: 400 });
  }

  const nomeAntigo = `Mesa ${sessao.table.number}`;
  const nomeNovo = `Mesa ${destino.number}`;

  await prisma.$transaction(async (tx) => {
    await tx.tableSession.update({ where: { id }, data: { tableId: destino.id } });
    // Pedido lançado sem nome de cliente nasce como "Mesa N": acompanha a mudança.
    await tx.customerOrder.updateMany({
      where: { tableSessionId: id, customerName: nomeAntigo },
      data: { customerName: nomeNovo },
    });
    await tx.customerOrder.updateMany({
      where: { tableSessionId: id, customerAddress: nomeAntigo },
      data: { customerAddress: nomeNovo },
    });
  });

  return NextResponse.json({ ok: true, de: sessao.table.number, para: destino.number, tableId: destino.id });
}
