/**
 * /api/store/table-sessions/[id]/fiado — quem pode ficar com a conta desta
 * mesa no fiado (o "Lançar no fiado" do fechamento, components/mesas/MesasApp).
 *
 *   GET → { ligado, clientes: [{ id, nome, cargo }] }
 *
 * O lançamento em si é no fechamento (POST close com `fiado`), para a conta
 * ser calculada num lugar só. Esta rota só abastece a escolha do cliente.
 *
 * Serve o painel e o garçom pelo link (lib/garcom-auth.ts). Para o garçom vai
 * só nome e cargo — o telefone e quanto cada um deve ficam na tela Fiado, que
 * é do Financeiro. E só para o garçom que fecha conta: pôr no fiado é fechar.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { lojasDoMesmoFiado } from "@/lib/fiado-da-mesa";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (operador.tipo === "garcom" && !operador.garcom.podeFecharConta) {
    return NextResponse.json({ error: "Este garçom não fecha conta. Peça ao caixa para fechar pelo painel." }, { status: 403 });
  }
  const lojaId = operador.franchiseeId;
  const { id } = await params;
  const mesa = await prisma.tableSession.findUnique({ where: { id }, select: { table: { select: { franchiseeId: true } } } });
  if (!mesa || mesa.table.franchiseeId !== lojaId) return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });

  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { employeeAccountEnabled: true } });
  if (!loja?.employeeAccountEnabled) return NextResponse.json({ ligado: false, clientes: [] });

  const clientes = await prisma.storeEmployee.findMany({
    where: { franchiseeId: { in: await lojasDoMesmoFiado(lojaId) }, active: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
  return NextResponse.json({
    ligado: true,
    clientes: clientes.map((c) => ({ id: c.id, nome: c.name, cargo: c.role || null })),
  });
}
