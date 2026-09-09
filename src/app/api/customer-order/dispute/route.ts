import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json();
  const { orderId, action, denyReason } = body; // action: 'accept' | 'deny'

  if (!orderId || !action) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const order: any = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: { franchisee: true },
  });

  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true }
  });
  if (!currentUser) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const targetFranchiseeId = currentUser.ownerId || currentUser.id;
  const role = (session.user as any)?.role;

  if (role !== "ADMIN" && order.franchiseeId !== targetFranchiseeId) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  // Sync with iFood using Disputes API
  //
  // `ifoodOk` existe porque esta rota devolvia 200 e a tela cantava "✅ enviada
  // ao iFood com sucesso" mesmo quando o iFood recusava. Em 09/09/2026 o banco
  // tinha 294 respostas de nova previsão de entrega gravadas — 145 com HTTP
  // 400, 143 com 422, 6 com 403 — e NENHUMA aceita. O lojista achava que tinha
  // respondido; o cliente ficava sem previsão e recorria ao iFood. Agora o
  // motivo do iFood é guardado junto e a tela mostra o que de fato aconteceu.
  let ifoodResult = "no_ifood";
  let ifoodOk: boolean | null = null;
  let ifoodErro = "";
  const registrar = (rotulo: string, r: { ok: boolean; status: number; texto: string }) => {
    ifoodResult = `${rotulo}:${r.status}`;
    ifoodOk = r.ok;
    if (!r.ok) ifoodErro = (r.texto || "").slice(0, 300);
    return r;
  };
  if (order.ifoodOrderId) {
    try {
      // Com a credencial do DONO do pedido: o token central só alcança a
      // Hakim, e nas outras lojas a disputa era respondida com um 403 que
      // ninguém via — o cliente ficava sem resposta no iFood.
      const { chamarPeloPedido } = await import("@/lib/ifood-pedido");
      const disputeId = order.cancelDispute?.disputeId;
      const base = "/order/v1.0";
      const post = (path: string, corpo: unknown = {}) =>
        chamarPeloPedido(order, path, { method: "POST", body: JSON.stringify(corpo) }, "iFood Dispute");

      if (action === "update_delivery_time") {
        const { additionalMinutes = 10, reason = "OUT_FOR_DELIVERY" } = body;
        if (disputeId) {
          registrar("disputes_accept_time", await post(`${base}/disputes/${disputeId}/accept`, { additionalMinutes, reason }));
        } else {
          registrar("updateEta", await post(`${base}/orders/${order.ifoodOrderId}/updateEta`, { additionalMinutes }));
        }
      } else if (action === "deny_delivery") {
        if (disputeId) {
          registrar("disputes_reject_time", await post(`${base}/disputes/${disputeId}/reject`, { reason: "CANNOT_DELIVER" }));
        }
      } else if (action === "accept") {
        // Try Disputes API first (correct endpoint)
        if (disputeId) {
          const r = registrar("disputes_accept", await post(`${base}/disputes/${disputeId}/accept`, { reason: "CUSTOMER_SATISFACTION" }));
          if (!r.ok) {
            const base2 = ifoodResult;
            const r2 = registrar("disputes_accept", await post(`${base}/orders/${order.ifoodOrderId}/acceptCancellation`));
            ifoodResult = `${base2},fallback:${r2.status}`;
          }
        } else {
          registrar("acceptCancellation", await post(`${base}/orders/${order.ifoodOrderId}/acceptCancellation`));
        }
      } else if (action === "deny") {
        const reason = denyReason || "Pedido já em andamento";
        if (disputeId) {
          const r = registrar("disputes_reject", await post(`${base}/disputes/${disputeId}/reject`, { reason }));
          if (!r.ok) {
            const base2 = ifoodResult;
            const r2 = registrar("disputes_reject", await post(`${base}/orders/${order.ifoodOrderId}/denyCancellation`, { reason }));
            ifoodResult = `${base2},fallback:${r2.status}`;
          }
        } else {
          registrar("denyCancellation", await post(`${base}/orders/${order.ifoodOrderId}/denyCancellation`, { reason }));
        }
      }
    } catch (err: any) {
      console.error(`[iFood Dispute] Erro:`, err?.message);
      ifoodResult = `error:${err?.message}`;
      ifoodOk = false;
      ifoodErro = String(err?.message || "").slice(0, 300);
    }
  }

  // Update local database
  const dispute = order.cancelDispute || {};
  if (action === "accept") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        status: "CANCELADO",
        cancelledBy: "CUSTOMER",
        cancelDispute: { ...dispute, pending: false, resolved: "accepted", resolvedAt: new Date().toISOString(), ifoodResult, ifoodOk, ifoodErro },
      } as any,
    });
  } else if (action === "update_delivery_time") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, resolved: "accepted_time_update", resolvedAt: new Date().toISOString(), ifoodResult, ifoodOk, ifoodErro },
      } as any,
    });
  } else if (action === "deny_delivery") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, resolved: "denied_delivery", resolvedAt: new Date().toISOString(), ifoodResult, ifoodOk, ifoodErro },
      } as any,
    });
  } else {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, resolved: "denied", resolvedAt: new Date().toISOString(), denyReason, ifoodResult, ifoodOk, ifoodErro },
      } as any,
    });
  }

  // ifoodOk === false quer dizer: gravamos aqui, mas o iFood recusou. A tela
  // precisa desse campo para não cantar vitória — ver o comentário lá em cima.
  return NextResponse.json({ success: true, action, ifoodResult, ifoodOk, ifoodErro });
}
