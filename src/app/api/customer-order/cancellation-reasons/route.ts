import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojasDaVisao, cookieDaVisao } from "@/lib/loja-ativa";
// Os motivos (do iFood, ou a lista padrão) moram em lib/motivos-do-cancelamento-do-pedido.ts:
// o Bill oferece os mesmos.
import { motivosDoCancelamento } from "@/lib/motivos-do-cancelamento-do-pedido";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId");

  if (!orderId) {
    return NextResponse.json({ error: "orderId é obrigatório" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: { franchisee: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, role: true }
  });
  if (!currentUser) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const targetFranchiseeId = currentUser.ownerId || currentUser.id;
  const role = (session.user as any)?.role;

  // "Todas as Lojas" (cookie "all", lib/loja-ativa.ts): o quadro mostra o grupo,
  // e ver os motivos de cancelamento do pedido da filial voltava 403 (Annalu + PasteLê,
  // 30/10/2026: "agora todos é pra mexer em tudo"). Fora dele, só a loja da sessão.
  const { lojaIds } = await lojasDaVisao(currentUser, await cookieDaVisao()).catch(() => ({
    lojaIds: [targetFranchiseeId],
  }));
  if (role !== "ADMIN" && !lojaIds.includes(order.franchiseeId)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  return NextResponse.json(await motivosDoCancelamento(order));
}
