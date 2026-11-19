import { NextRequest, NextResponse } from "next/server";
import { exigirSenhaDoGerente } from "@/lib/senha-do-gerente";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { motivoDoCorpo, MENSAGEM_SEM_MOTIVO_DO_SERVIDOR } from "@/lib/motivo-do-cancelamento";
import { lojasDaVisao, cookieDaVisao } from "@/lib/loja-ativa";
// A mudança de status em si (avisos aos parceiros, WhatsApp, estorno…) mora
// em lib/mudar-status-do-pedido.ts: o Bill passa pelo mesmo caminho.
import { CAMPOS_DO_PEDIDO, mudarStatusDoPedido } from "@/lib/mudar-status-do-pedido";

// GET: Public status check (no auth required)
export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("id");
  if (!orderId) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      // O número do dia é o que o cliente fala para a loja ("pedido 34"); o
      // final do id ninguém acha no painel.
      dailyOrderNumber: true,
      status: true,
      totalAmount: true,
      deliveryType: true,
      paymentMethod: true,
      createdAt: true,
      updatedAt: true,
      items: {
        select: {
          quantity: true,
          price: true,
          productName: true,
          menuProduct: { select: { name: true } }
        }
      }
    }
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

  const role = (session.user as any)?.role;
  const body = await req.json();
  const { orderId, status, scheduledDatetime, cancellationCode } = body;

  if (!orderId || !status) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  // ── CANCELAR PEDE O MOTIVO (lib/motivo-do-cancelamento.ts) ────────────────
  //
  // Esta rota é sempre a PESSOA na loja (sessão do painel): o quadro de
  // pedidos, o arrastar para Cancelado, a ação em lote, o "Não aceitar" do
  // rascunho do robô. iFood/99Food cancelando, o cliente no site e o sistema
  // entram por outras rotas e seguem com o motivo deles. Sem motivo escrito,
  // 400 — antes do pedido ser lido, nada muda nem avisa parceiro.
  const cancelReason: string | undefined = status === "CANCELADO" ? motivoDoCorpo(body) : undefined;
  if (status === "CANCELADO" && !cancelReason) {
    return NextResponse.json({ error: MENSAGEM_SEM_MOTIVO_DO_SERVIDOR, precisaDeMotivo: true }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: CAMPOS_DO_PEDIDO,
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, name: true, role: true }
  });
  if (!currentUser) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const targetFranchiseeId = currentUser.ownerId || currentUser.id;

  // ── "TODAS AS LOJAS" MEXE NO GRUPO INTEIRO ────────────────────────────────
  //
  // Em "Todas as Lojas" (cookie "all", lib/loja-ativa.ts) a sessão fica na
  // principal e o quadro mostra os pedidos do grupo. Aceitar, marcar saiu,
  // entregue ou cancelar o pedido da filial voltava 403 "Sem permissão": a
  // Annalu só mexia no pedido da PasteLê trocando para a página da PasteLê
  // (Douglas, 30/10/2026: "agora todos é pra mexer em tudo"). Fora do "todas",
  // e sempre para funcionário, `lojaIds` é só a loja da sessão.
  const { lojaIds } = await lojasDaVisao(currentUser, await cookieDaVisao()).catch(() => ({
    lojaIds: [targetFranchiseeId],
  }));

  const userStoreIds = [
    currentUser.id,
    currentUser.ownerId,
    targetFranchiseeId,
    ...lojaIds,
  ].filter(Boolean) as string[];

  const isStoreMember = userStoreIds.includes(order.franchiseeId) ||
                        (order.franchisee?.ownerId && userStoreIds.includes(order.franchisee.ownerId));

  // ── SER LOJISTA NÃO É SER DONO DESTE PEDIDO ───────────────────────────────
  //
  // A condição anterior era `role !== "ADMIN" && role !== "FRANQUEADO" &&
  // role !== "LOJA" && !isStoreMember`: como TODO lojista tem role FRANQUEADO
  // ou LOJA, a expressão virava falsa antes de olhar `isStoreMember` — e a
  // verificação de dono nunca rodava. Na prática, qualquer conta de loja
  // mandava um orderId de OUTRA loja e mudava o status: cancelava o pedido do
  // concorrente, marcava como entregue, disparava WhatsApp para o cliente
  // dele. Dono só é dispensado quando é ADMIN de verdade.
  if (role !== "ADMIN" && !isStoreMember) {
    console.warn(
      `[Status] 🚫 Tentativa cross-tenant: usuário ${currentUser.id} (role ${role}) ` +
      `tentou alterar o pedido ${orderId} da loja ${order.franchiseeId}.`
    );
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  return await mudarStatusDoPedido({
    order, status, role, currentUser, cancelReason, cancellationCode, scheduledDatetime,
    quemFinaliza: session.user?.name || session.user?.email || "?",
    conferirSenhaDoGerente: () => exigirSenhaDoGerente(req, order.franchiseeId, "cancelarPedido"),
  });
} catch (err: any) {
    console.error("[PUT Status Error]:", err);
    return NextResponse.json({ error: err?.message || "Erro ao atualizar status do pedido" }, { status: 500 });
  }
}
