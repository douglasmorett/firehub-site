/**
 * PATCH /api/store/table-sessions/[id]
 *
 * Corrige o NOME DO CLIENTE e a OBSERVAÇÃO de uma conta aberta.
 * Corpo: { customerName?, notes? } — o que não vier fica como está.
 *
 * Os dois eram escritos só ao ocupar a mesa. Com a mesa já aberta, o único
 * "nome" que o ✏️ deixava mudar era o Nome/Label da MESA FÍSICA — e a loja
 * escrevia ali o nome do cliente. Na transferência a conta ia para a mesa
 * nova e o nome ficava na velha, à vista do próximo cliente (Ragnar,
 * 03/10/2026). O nome do cliente mora na conta: é ele que viaja junto.
 *
 * Pedido lançado sem nome nasceu com o nome da conta (ou "Mesa N", ver
 * add-order): esses acompanham a troca, para o KDS e a impressão não
 * mostrarem o nome antigo. Pedido com nome próprio fica como está.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = operador.franchiseeId;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const sessao = await prisma.tableSession.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      customerName: true,
      table: { select: { number: true, franchiseeId: true } },
    },
  });
  if (!sessao || sessao.table.franchiseeId !== lojaId) {
    return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
  }
  if (sessao.status !== "OPEN") {
    return NextResponse.json({ error: "Esta conta já foi fechada" }, { status: 400 });
  }

  const data: { customerName?: string | null; notes?: string | null } = {};
  if (body?.customerName !== undefined) {
    data.customerName = String(body.customerName ?? "").trim().slice(0, 80) || null;
  }
  // Mesmo teto da abertura (POST /api/store/table-sessions).
  if (body?.notes !== undefined) {
    data.notes = String(body.notes ?? "").trim().slice(0, 200) || null;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nada para alterar" }, { status: 400 });
  }

  const nomeDaMesa = `Mesa ${sessao.table.number}`;
  const nomeAntigo = sessao.customerName?.trim() || null;

  await prisma.$transaction(async (tx) => {
    await tx.tableSession.update({ where: { id }, data });
    if (data.customerName !== undefined && data.customerName !== nomeAntigo) {
      await tx.customerOrder.updateMany({
        where: {
          tableSessionId: id,
          customerName: { in: nomeAntigo ? [nomeAntigo, nomeDaMesa] : [nomeDaMesa] },
        },
        data: { customerName: data.customerName || nomeDaMesa },
      });
    }
  });

  return NextResponse.json({ ok: true, ...data });
}
