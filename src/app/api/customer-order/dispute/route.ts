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
  // action: 'accept' | 'deny' | 'update_delivery_time' | 'deny_delivery' | 'propose_refund'
  const { orderId, action, denyReason } = body;

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

      // ── O QUE O IFOOD ACEITA COMO RESPOSTA (Plataforma de Negociação) ──
      //
      //   POST /disputes/{id}/accept   { reason, detailReason }
      //   POST /disputes/{id}/reject   { reason, detailReason }
      //   POST /disputes/{id}/alternatives/{alternativeId}
      //        { type: "REFUND", metadata: { amount: { value: "1500", currency: "BRL" } } }
      //        { type: "ADDITIONAL_TIME", metadata: { additionalTimeInMinutes: 15, additionalTimeReason: "..." } }
      //
      // Até 10/09/2026 a "nova previsão de entrega" era mandada para o
      // /accept com { additionalMinutes, reason } — que não existe naquele
      // endpoint. Foram 294 respostas, todas recusadas (400/422). Mais tempo
      // e reembolso são ALTERNATIVAS: vão pela rota de alternativas, com o id
      // que o próprio iFood mandou na disputa (`alternatives`). Os motivos
      // de tempo permitidos também vêm de lá.
      const meta: any = order.cancelDispute?.metadata || {};
      const alternativas: any[] = Array.isArray(order.cancelDispute?.alternatives)
        ? order.cancelDispute.alternatives
        : Array.isArray(meta.alternatives) ? meta.alternatives : [];
      const altTempo = alternativas.find((a) => String(a?.type || "").toUpperCase() === "ADDITIONAL_TIME");
      const altReembolso = alternativas.find((a) => String(a?.type || "").toUpperCase() === "REFUND");
      const ehParcial = order.cancelDispute?.parcial === true || String(meta.action || "").toUpperCase() === "PARTIAL_CANCELLATION";
      const ehCancelamento = String(meta.action || "").toUpperCase() === "CANCELLATION";

      if (action === "update_delivery_time") {
        const additionalMinutes = Math.max(1, Number(body.additionalMinutes) || 10);
        const motivoDoPainel = String(body.reason || "OUT_FOR_DELIVERY").toUpperCase();
        if (disputeId && altTempo) {
          // Motivo: só o que o iFood listou como permitido para ESTA disputa.
          const permitidos: string[] = ([] as string[]).concat(
            ...Object.entries(altTempo.metadata || {})
              .filter(([k, v]) => /reason/i.test(k) && Array.isArray(v))
              .map(([, v]) => (v as unknown[]).map(String)),
          );
          const preferencia: Record<string, RegExp> = {
            OUT_FOR_DELIVERY: /OUT_FOR_DELIVERY|DISPATCH/i,
            HIGH_DEMAND: /DEMAND|VOLUME/i,
            PREPARATION_DELAY: /PREPARATION|OPERATIONAL|KITCHEN/i,
            WEATHER: /WEATHER|RAIN|CLIMATE/i,
          };
          const motivo =
            permitidos.find((p) => preferencia[motivoDoPainel]?.test(p)) ||
            permitidos.find((p) => /OUT_FOR_DELIVERY/i.test(p)) ||
            permitidos[0] ||
            "ORDER_OUT_FOR_DELIVERY";
          // Minutos: se o iFood limitar a uma lista, o mais próximo do pedido.
          const minutosPermitidos: number[] = ([] as number[]).concat(
            ...Object.entries(altTempo.metadata || {})
              .filter(([k, v]) => /time|minute/i.test(k) && !/reason/i.test(k) && Array.isArray(v))
              .map(([, v]) => (v as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)),
          );
          const minutos = minutosPermitidos.length
            ? minutosPermitidos.reduce((m, n) => (Math.abs(n - additionalMinutes) < Math.abs(m - additionalMinutes) ? n : m), minutosPermitidos[0])
            : additionalMinutes;
          registrar("disputes_alternative_time", await post(`${base}/disputes/${disputeId}/alternatives/${altTempo.id}`, {
            type: "ADDITIONAL_TIME",
            metadata: { additionalTimeInMinutes: minutos, additionalTimeReason: motivo },
          }));
        } else if (disputeId) {
          // Disputa sem alternativa de tempo: o iFood não aceita "mais X min"
          // aqui. Fica registrado, e a tela avisa que não foi possível.
          ifoodResult = "sem_alternativa_de_tempo";
          ifoodOk = false;
          ifoodErro = "Esta negociação não permite propor mais tempo (o iFood não ofereceu essa opção).";
        } else {
          registrar("updateEta", await post(`${base}/orders/${order.ifoodOrderId}/updateEta`, { additionalMinutes }));
        }
      } else if (action === "deny_delivery") {
        // "Pedido não será mais entregue": se o cliente pediu cancelamento, a
        // loja está ACEITANDO o cancelamento; noutra disputa, é uma recusa.
        if (disputeId && ehCancelamento) {
          registrar("disputes_accept", await post(`${base}/disputes/${disputeId}/accept`, { reason: "OTHER_REASONS", detailReason: "O pedido não será entregue." }));
        } else if (disputeId) {
          registrar("disputes_reject_time", await post(`${base}/disputes/${disputeId}/reject`, { reason: "OTHER_REASONS", detailReason: "Não será possível entregar este pedido." }));
        }
      } else if (action === "accept") {
        const detailReason = String(body.detailReason || (ehParcial ? "Cancelamento parcial aceito pela loja." : "Cancelamento aceito pela loja.")).slice(0, 500);
        if (disputeId) {
          const r = registrar("disputes_accept", await post(`${base}/disputes/${disputeId}/accept`, { reason: "CUSTOMER_SATISFACTION", detailReason }));
          if (!r.ok && !ehParcial) {
            const base2 = ifoodResult;
            const r2 = registrar("disputes_accept", await post(`${base}/orders/${order.ifoodOrderId}/acceptCancellation`));
            ifoodResult = `${base2},fallback:${r2.status}`;
          }
        } else {
          registrar("acceptCancellation", await post(`${base}/orders/${order.ifoodOrderId}/acceptCancellation`));
        }
      } else if (action === "deny") {
        const reason = String(denyReason || "Pedido já em andamento").slice(0, 500);
        if (disputeId) {
          // `reason` é um código do iFood; o texto da loja vai em detailReason.
          const r = registrar("disputes_reject", await post(`${base}/disputes/${disputeId}/reject`, { reason: "OTHER_REASONS", detailReason: reason }));
          if (!r.ok && !ehParcial) {
            const base2 = ifoodResult;
            const r2 = registrar("disputes_reject", await post(`${base}/orders/${order.ifoodOrderId}/denyCancellation`, { reason }));
            ifoodResult = `${base2},fallback:${r2.status}`;
          }
        } else {
          registrar("denyCancellation", await post(`${base}/orders/${order.ifoodOrderId}/denyCancellation`, { reason }));
        }
      } else if (action === "propose_refund") {
        // Contraproposta de reembolso parcial: só existe quando o iFood mandou
        // a alternativa REFUND, e nunca acima do teto (maxAmount) que ele fixou.
        const valor = Math.round((Number(body.amount) || 0) * 100) / 100;
        const teto = Number(altReembolso?.maxAmount?.value ?? altReembolso?.metadata?.maxAmount?.value ?? 0) / 100;
        if (!disputeId || !altReembolso) {
          return NextResponse.json({ error: "Esta negociação não permite propor reembolso." }, { status: 400 });
        }
        if (!(valor > 0) || (teto > 0 && valor > teto + 0.001)) {
          return NextResponse.json({ error: `Informe um valor entre R$ 0,01 e R$ ${teto.toFixed(2).replace(".", ",")}.` }, { status: 400 });
        }
        registrar("disputes_alternative_refund", await post(`${base}/disputes/${disputeId}/alternatives/${altReembolso.id}`, {
          type: "REFUND",
          metadata: { amount: { value: String(Math.round(valor * 100)), currency: "BRL" } },
        }));
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
  const ehParcialLocal = dispute.parcial === true || String(dispute.metadata?.action || "").toUpperCase() === "PARTIAL_CANCELLATION";
  if (action === "accept" && ehParcialLocal) {
    // Cancelamento PARCIAL aceito: o pedido NÃO é cancelado — continua como
    // está, marcado "cancelamento parcial" com os itens e o valor devolvido.
    const valorReembolso = (Array.isArray(dispute.itens) ? dispute.itens : []).reduce((s: number, i: any) => s + (Number(i.valor) || 0), 0);
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, parcial: true, resolved: "accepted_partial", valorReembolso, resolvedAt: new Date().toISOString(), ifoodResult, ifoodOk, ifoodErro },
      } as any,
    });
  } else if (action === "accept" || (action === "deny_delivery" && String(dispute.metadata?.action || "").toUpperCase() === "CANCELLATION")) {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        status: "CANCELADO",
        cancelledBy: "CUSTOMER",
        cancelDispute: { ...dispute, pending: false, resolved: "accepted", resolvedAt: new Date().toISOString(), ifoodResult, ifoodOk, ifoodErro },
      } as any,
    });
  } else if (action === "propose_refund") {
    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        cancelDispute: { ...dispute, pending: false, parcial: true, resolved: "refund_proposed", valorReembolsoProposto: Math.round((Number(body.amount) || 0) * 100) / 100, resolvedAt: new Date().toISOString(), ifoodResult, ifoodOk, ifoodErro },
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
