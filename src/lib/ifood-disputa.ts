/**
 * /src/lib/ifood-disputa.ts
 *
 * A negociação do iFood (HANDSHAKE_DISPUTE e o desfecho HANDSHAKE_SETTLEMENT)
 * num lugar só. Três leitores consomem a mesma fila de eventos e disputam quem
 * chega primeiro: o cron (lib/ifood-eventos.ts, a cada minuto) e o poll do
 * painel (api/customer-order/poll, a cada 5 s com a tela aberta).
 *
 * ── Por que saiu de dentro deles ────────────────────────────────────────────
 *
 * Eram duas cópias, e só a do cron aprendeu (10/09/2026) que a disputa pode
 * ser de PARTE do pedido. A do painel gravava todo cancelamento parcial como
 * cancelamento do pedido inteiro — sem `parcial`, sem os itens —, e como a
 * loja trabalha com a tela aberta, era ela que chegava primeiro. O modal
 * oferecia "Aceitar cancelamento" e o pedido ia inteiro para Cancelado
 * enquanto no iFood só a parte contestada saía (Frangoso, 04/10/2026). O
 * desfecho (HSS) o painel nem gravava: confirmava o evento e o jogava fora.
 *
 * Também não reabre o que a loja já respondeu: se o outro leitor processa o
 * mesmo evento depois da resposta, a disputa não volta a "pendente".
 */
import { prisma } from "@/lib/prisma";
import { ehDisputaParcial, itensDaDisputa, valorDaDisputaParcial } from "@/lib/cancelamento-parcial";
import { aplicarCancelamentoParcial } from "@/lib/cancelamento-parcial-no-banco";

/** O evento é uma negociação aberta (cancelamento, parcial, prazo, reembolso)? */
export function ehEventoDeDisputa(event: any): boolean {
  const code = event?.code;
  const full = event?.fullCode;
  return code === "HSD" || code === "CRR" || code === "DDC" || full === "HANDSHAKE_DISPUTE" || full === "CANCELLATION_REQUESTED" || full === "DUE_DATE_CHANGE_REQUESTED";
}

/** O evento é o desfecho da negociação (aceita, recusada, alternativa, prazo esgotado)? */
export function ehEventoDeDesfecho(event: any): boolean {
  return event?.code === "HSS" || event?.fullCode === "HANDSHAKE_SETTLEMENT";
}

/**
 * Monta o que fica em `cancelDispute` a partir do evento — a regra que era só
 * do cron. Cancelamento parcial: o pedido continua, o cliente contesta alguns
 * itens (metadata.items) e a loja pode aceitar, recusar ou propor reembolso até
 * o teto de `alternatives`. Regra do dono (10/09/2026): tem que ficar escrito
 * "cancelamento parcial" e quais itens.
 */
export async function montarDisputa(event: any, orderId: string) {
  const code = event?.code;
  const meta = event?.metadata || {};
  const actionType = String(meta.action || meta.handshakeType || meta.type || event?.fullCode || "").toUpperCase();
  const rawReason = meta.message || meta.cancelCodeDescription || meta.subCodeDescription || meta.reason || meta.description || "";

  const itensContestados: { index: number; quantidade: number; valor: number; motivo: string; nome: string }[] = [];
  let disputeType = "CANCELLATION";
  if (actionType === "PARTIAL_CANCELLATION" || String(meta.handshakeType || "").toUpperCase().includes("PARTIALLY")) {
    disputeType = "PARTIAL_CANCELLATION";
  } else if (actionType.includes("DUE_DATE") || actionType.includes("PREDICTION") || code === "DDC") {
    disputeType = "DUE_DATE_CHANGE";
  } else if (actionType.includes("RESEND") || actionType.includes("REPLACEMENT") || actionType.includes("REENVIO") || /reenvio|reenviar|repor|substituir/i.test(rawReason)) {
    disputeType = "RESEND_ITEMS";
  } else if (actionType.includes("REFUND") || /reembolso|reembolsar/i.test(rawReason)) {
    disputeType = "REFUND_ITEMS";
  }

  // Os itens contestados (parcial e reembolso), com o nome do pedido gravado:
  // o iFood manda a POSIÇÃO do item (1, 2…), não o nome.
  const listaDoIfood: any[] = Array.isArray(meta.metadata?.items) ? meta.metadata.items : [];
  if ((disputeType === "PARTIAL_CANCELLATION" || disputeType === "REFUND_ITEMS") && listaDoIfood.length > 0) {
    const doPedido = await prisma.customerOrder.findFirst({
      where: { ifoodOrderId: orderId },
      select: { items: { select: { productName: true, quantity: true, menuProduct: { select: { name: true } } }, orderBy: { id: "asc" } } },
    });
    const nomes = (doPedido?.items || []).map((i) => i.productName || i.menuProduct?.name || "");
    for (const it of listaDoIfood) {
      const index = Number(it.index) || 0;
      itensContestados.push({
        index,
        quantidade: Number(it.quantity) || 1,
        // O iFood manda centavos em string ("6798" = R$ 67,98).
        valor: Number(it.amount?.value ?? 0) / 100,
        motivo: String(it.reason || "").trim(),
        nome: nomes[index - 1] || it.name || `Item ${index}`,
      });
    }
  }

  const finalReason = rawReason || itensContestados.find((i) => i.motivo)?.motivo || (
    disputeType === "DUE_DATE_CHANGE" ? "O pedido está atrasado. Quero uma nova previsão de entrega." :
    disputeType === "RESEND_ITEMS" ? "Cliente prefere o reenvio de itens pra resolver o problema." :
    disputeType === "REFUND_ITEMS" ? "Cliente solicitou reembolso de item." :
    disputeType === "PARTIAL_CANCELLATION" ? "Cliente pediu o cancelamento de parte do pedido pelo iFood." :
    "Cliente solicitou cancelamento do pedido pelo iFood."
  );

  return {
    pending: true,
    disputeId: meta.disputeId || "",
    type: disputeType,
    reason: finalReason,
    // Reembolso de item também é de PARTE do pedido (ehDisputaParcial), mas o
    // modal tem texto próprio para ele: `parcial` fica só no cancelamento.
    parcial: disputeType === "PARTIAL_CANCELLATION",
    itens: itensContestados,
    // O que o iFood aceita como resposta além de aceitar/recusar
    // (REFUND com teto, ADDITIONAL_TIME com motivos permitidos).
    alternatives: Array.isArray(meta.alternatives) ? JSON.parse(JSON.stringify(meta.alternatives)) : [],
    evidencias: Array.isArray(meta.metadata?.evidences) ? meta.metadata.evidences.length : 0,
    customerName: meta.customerName || "",
    handshakeType: meta.handshakeType || actionType,
    expiresAt: meta.expiresAt || meta.expirationDate || meta.timeoutDate || "",
    requestedAt: meta.createdAt || new Date().toISOString(),
    // O payload cru da disputa, aparado. Existe porque respondemos 294
    // disputas de nova previsão de entrega até 09/09/2026 e o iFood recusou
    // TODAS — sem guardar o que ele mandou não dá para saber que forma de
    // resposta ele espera.
    metadata: JSON.parse(JSON.stringify(meta ?? {})),
  };
}

/**
 * Grava a disputa no pedido. A mesma disputa já respondida (o outro leitor
 * chegando atrasado com o mesmo evento) não volta a "pendente".
 */
export async function gravarDisputa(orderId: string, disputa: Awaited<ReturnType<typeof montarDisputa>>): Promise<number> {
  const pedidos = await prisma.customerOrder.findMany({
    where: { ifoodOrderId: orderId },
    select: { id: true, cancelDispute: true },
  });
  let gravados = 0;
  for (const p of pedidos) {
    const atual = (p.cancelDispute || {}) as Record<string, any>;
    const mesma = disputa.disputeId && atual.disputeId === disputa.disputeId;
    if (mesma && atual.pending === false) continue;
    await prisma.customerOrder.update({ where: { id: p.id }, data: { cancelDispute: disputa as any } });
    gravados++;
  }
  return gravados;
}

/**
 * O desfecho da negociação. Sem isto a disputa ficava "pendente" para sempre
 * quando a resposta saía pelo app do iFood ou quando o prazo vencia.
 *
 * Desfecho ACEITO de uma disputa de parte do pedido (a loja aceitou no portal
 * do iFood, o cliente aceitou a proposta de reembolso, ou o aceite feito no
 * painel) é o que corta o pedido aqui: o total cai, os itens ficam riscados e
 * a loja recebe o aviso. O mesmo corte não é aplicado duas vezes.
 */
export async function gravarDesfecho(orderId: string, meta: any): Promise<{ achou: boolean; status: string; corte: boolean }> {
  const atual = await prisma.customerOrder.findFirst({
    where: { ifoodOrderId: orderId },
    select: { id: true, cancelDispute: true },
  });
  const statusDesfecho = String(meta?.status || meta?.settlementStatus || "").toUpperCase();
  if (!atual) return { achou: false, status: statusDesfecho, corte: false };

  const d: any = atual.cancelDispute || {};
  const aceitou = statusDesfecho.includes("ACCEPT") || statusDesfecho.includes("ALTERNATIVE");
  const parcial = ehDisputaParcial(d);
  await prisma.customerOrder.update({
    where: { id: atual.id },
    data: {
      cancelDispute: {
        ...d,
        pending: false,
        settlement: {
          status: statusDesfecho,
          reason: meta?.reason ?? null,
          detailReason: meta?.detailReason ?? null,
          at: meta?.createdAt || new Date().toISOString(),
          raw: JSON.parse(JSON.stringify(meta ?? {})),
        },
        ...(parcial && aceitou ? { parcialConfirmado: true } : {}),
      } as any,
    },
  });

  let corte = false;
  if (parcial && aceitou) {
    const viaProposta = statusDesfecho.includes("ALTERNATIVE");
    const r = await aplicarCancelamentoParcial(atual.id, {
      id: String(d.disputeId || meta?.disputeId || `ifood:${orderId}`),
      canal: "iFood",
      itens: itensDaDisputa(d),
      valor: valorDaDisputaParcial(d, { usarProposta: viaProposta }),
      motivo: d.reason || null,
    });
    corte = r.aplicado;
  }
  return { achou: true, status: statusDesfecho, corte };
}
