import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { qtdPedidosDosClientes } from "@/lib/qtd-pedidos-do-cliente";

export const dynamic = "force-dynamic";

/**
 * "Qtd Pedidos" para a comanda impressa pelo NAVEGADOR (lib/print.ts). A fila
 * da nuvem já manda o número dentro do pedido; o painel não tem esse dado nos
 * pedidos que lista, e contar no poll custaria uma consulta por pedido a cada
 * poucos segundos. Aqui é uma por comanda, na hora de imprimir.
 *
 * Acesso: a loja do usuário e as do grupo dele — a mesma régua dos relatórios
 * (lib/relatorios/servidor.ts). O ADMIN vê qualquer pedido.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const usuario = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, ownerId: true, accountGroupId: true },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { id } = await params;
  const pedido = await prisma.customerOrder.findUnique({
    where: { id },
    select: {
      id: true, franchiseeId: true, customerPhone: true, createdAt: true, source: true,
      ifoodOrderId: true, openDeliveryOrderId: true, openDeliveryChannel: true, tableSessionId: true, parentOrderId: true,
    },
  });
  if (!pedido) return NextResponse.json({ qtd: null });

  if (usuario.role !== "ADMIN") {
    const donoId = usuario.ownerId || usuario.id;
    const masterId = usuario.accountGroupId || donoId;
    const daConta = await prisma.user.findFirst({
      where: { id: pedido.franchiseeId, OR: [{ id: donoId }, { id: masterId }, { accountGroupId: masterId }] },
      select: { id: true },
    });
    if (!daConta) return NextResponse.json({ error: "Pedido de outra loja" }, { status: 403 });
  }

  const qtd = (await qtdPedidosDosClientes([pedido])).get(pedido.id) ?? null;
  return NextResponse.json({ qtd });
}
