/**
 * POST /api/customer-order/jotaja-action
 * Ações Open Delivery que o lojista executa manualmente no dashboard:
 *  - accept_cancellation: aceitar cancelamento solicitado pelo cliente
 *  - deny_cancellation:   negar cancelamento solicitado pelo cliente
 *  - deny:                recusar pedido novo (antes de confirmar)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lojasDaVisao, cookieDaVisao } from "@/lib/loja-ativa";
import { prisma } from "@/lib/prisma";

type Action = "accept_cancellation" | "deny_cancellation" | "deny";

const ACTION_ENDPOINT: Record<Action, string> = {
  accept_cancellation: "acceptCancellation",
  deny_cancellation: "denyCancellation",
  deny: "deny",
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { orderId, action, reason } = await req.json() as {
    orderId: string;
    action: Action;
    reason?: string;
  };

  if (!orderId || !action || !ACTION_ENDPOINT[action]) {
    return NextResponse.json({ error: "orderId e action são obrigatórios" }, { status: 400 });
  }

  // Verifica que o pedido pertence ao franqueado logado
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;
  // "Todas as Lojas" (cookie "all", lib/loja-ativa.ts): o pedido pode ser de
  // qualquer loja do grupo (Annalu + PasteLê, 30/10/2026: "agora todos é pra
  // mexer em tudo"), e a credencial do parceiro passa a ser a da loja DO
  // PEDIDO. Fora do "todas" é a loja da sessão, como sempre foi.
  const { lojaIds } = await lojasDaVisao(user, await cookieDaVisao()).catch(() => ({
    lojaIds: [targetFranchiseeId],
  }));

  const order = await prisma.customerOrder.findFirst({
    where: { openDeliveryOrderId: orderId, franchiseeId: { in: lojaIds } } as any,
    select: { id: true, openDeliveryOrderId: true, cancelDispute: true, franchiseeId: true } as any,
  });
  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }
  const lojaDoPedido: string = (order as any).franchiseeId;

  try {
    const { jotajaMutate } = await import("@/lib/jotaja-api");

    // Monta payload conforme a ação
    let body: Record<string, any> | undefined;
    if (action === "deny_cancellation") {
      body = { reason: reason || "O restaurante não pode aceitar o cancelamento neste momento." };
    } else if (action === "deny") {
      body = {
        reason: reason || "Restaurante não pode aceitar o pedido no momento.",
        cancellationCode: "501",
      };
    } else if (action === "accept_cancellation") {
      body = { reason: reason || "Cancelamento aceito pelo restaurante." };
    }

    // Chama API Open Delivery — com a credencial DESTA loja (antes ia sem loja
    // e caía na credencial de reserva do servidor)
    const apiEndpoint = ACTION_ENDPOINT[action];
    const res = await jotajaMutate(`/v1/orders/${orderId}/${apiEndpoint}`, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }, lojaDoPedido);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[JotaJá Action] ${action} falhou: ${res.status} — ${errText}`);
      return NextResponse.json({
        error: `Falha ao executar ação no JotaJá (${res.status}): ${errText.slice(0, 200)}`,
      }, { status: 502 });
    }

    // Atualiza estado local no banco
    const dbUpdate: any = {};

    if (action === "accept_cancellation") {
      dbUpdate.status = "CANCELADO";
      dbUpdate.cancelledBy = "LOJA";
      dbUpdate.cancelReason = reason || "Cancelamento aceito pelo restaurante.";
      dbUpdate.cancelDispute = { pending: false };
    } else if (action === "deny_cancellation") {
      // Limpa o dispute — pedido continua ativo
      dbUpdate.cancelDispute = { pending: false };
    } else if (action === "deny") {
      dbUpdate.status = "CANCELADO";
      dbUpdate.cancelledBy = "LOJA";
      dbUpdate.cancelReason = reason || "Pedido recusado pelo restaurante.";
    }

    if (Object.keys(dbUpdate).length > 0) {
      await (prisma.customerOrder as any).update({
        where: { id: (order as any).id },
        data: dbUpdate,
      });
      // Cancelado no JotaJá com NFC-e de pé: não trava (o JotaJá já cancelou lá), avisa na tela fiscal.
      if (dbUpdate.status === "CANCELADO") import("@/lib/fiscal-automatico").then((m) => m.alertarCancelamentoComNota({ id: (order as any).id }, "JotaJá")).catch(() => {});
    }

    console.log(`[JotaJá Action] ✅ ${action} — orderId=${orderId}`);
    return NextResponse.json({ ok: true, action, orderId });

  } catch (err: any) {
    console.error(`[JotaJá Action] Erro:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
