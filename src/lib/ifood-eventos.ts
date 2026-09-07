/**
 * /src/lib/ifood-eventos.ts
 *
 * Processamento de eventos do iFood — extraido de /api/cron/ifood-poll para
 * poder rodar DUAS vezes: uma para o app centralizado (um token, varias lojas)
 * e uma por loja do app DISTRIBUIDO (token da propria loja).
 *
 * O corpo do laco e o MESMO que ja rodava em producao para a Hakim: foi movido,
 * nao reescrito, justamente para nao regredir o que funciona.
 *
 * ISOLAMENTO: no modo distribuido passa-se merchantEsperado. Todo evento com
 * merchantId diferente e DESCARTADO antes de tocar o banco. E a segunda tranca —
 * a primeira e o header x-polling-merchants, que faz o iFood entregar apenas os
 * eventos daquela loja.
 */
import { prisma } from "./prisma";
import { generateDailyOrderNumber, generateDailyOrderNumberTx } from "./order-number";
import { ehEventoDeCodigo, marcarExigeCodigo } from "./ifood-logistics";
import { montarItensDoPedidoIfood } from "./ifood-itens";

export type ResultadoEventos = {
  created: number;
  updated: number;
  acknowledged: number;
  descartados: number;
};

/**
 * Puxa a fila de eventos do iFood com UM token.
 *
 * `merchants` vazio (o que o cron faz) significa SEM o header
 * `x-polling-merchants`: o iFood entrega tudo o que aquele token enxerga. É
 * assim que uma loja iFood recém-autorizada aparece — filtrando, ela nunca
 * apareceria, porque não dá para pedir o que não se sabe que existe. Quem
 * chama sem filtro precisa peneirar depois, no `merchantEsperado`.
 *
 * Com lista, o header é tudo ou nada: basta UMA loja não estar autorizada
 * para aquele token e o iFood responde 403 na chamada inteira, levando junto
 * as que funcionavam. Por isso, no 403, repete-se loja a loja — as autorizadas
 * entregam seus pedidos e as recusadas voltam nomeadas.
 */
export async function puxarEventosIfood(opts: {
  token: string;
  merchants: string[];
  log?: string[];
}): Promise<{ eventos: any[]; naoAutorizados: string[]; erro?: string }> {
  const url = "https://merchant-api.ifood.com.br/events/v1.0/events:polling?excludeHeartbeat=true";

  const pedir = async (lista: string[]) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.token}` };
    if (lista.length > 0) headers["x-polling-merchants"] = lista.join(",");
    const res = await fetch(url, { method: "GET", headers });
    const texto = await res.text().catch(() => "");
    return { res, texto };
  };

  const lerEventos = (texto: string): any[] => {
    if (!texto) return [];
    try {
      const lidos = JSON.parse(texto);
      return Array.isArray(lidos) ? lidos : [];
    } catch {
      return [];
    }
  };

  const primeira = await pedir(opts.merchants);
  if (primeira.res.ok) {
    return { eventos: lerEventos(primeira.texto), naoAutorizados: [] };
  }

  if (primeira.res.status !== 403 || opts.merchants.length < 2) {
    return {
      eventos: [],
      naoAutorizados: primeira.res.status === 403 ? [...opts.merchants] : [],
      erro: `${primeira.res.status} ${primeira.texto.slice(0, 120)}`,
    };
  }

  opts.log?.push(`  [!] 403 no polling com ${opts.merchants.length} lojas — repetindo uma a uma`);
  const eventos: any[] = [];
  const naoAutorizados: string[] = [];
  for (const merchant of opts.merchants) {
    const uma = await pedir([merchant]);
    if (uma.res.ok) eventos.push(...lerEventos(uma.texto));
    else naoAutorizados.push(merchant);
  }
  if (naoAutorizados.length > 0) {
    opts.log?.push(`  [!] loja(s) sem autorização para este token: ${naoAutorizados.join(", ")}`);
  }
  return { eventos, naoAutorizados };
}

/**
 * O nome da loja iFood de onde veio o pedido — e, de quebra, conserta o rótulo
 * da integração.
 *
 * Duas coisas que só o detalhe do pedido resolve:
 *
 * 1. `orderData.merchant.name` é o nome como a loja aparece no app do iFood
 *    ("Ragnar Pizza"). É a ÚNICA fonte: este aplicativo tem só `order` e
 *    `events` por loja, então pedir o detalhe do merchant volta 403 e a
 *    listagem volta `200 []`.
 *
 * 2. A integração costuma nascer com o nome do cadastro do FireHub, porque na
 *    hora de cadastrar não há pedido de onde tirar o nome real. Três lojas
 *    escritas "PIETRO CUNHA ROCHA 01797511238" na tela não distinguem nada.
 *
 * Fica aqui, e não no cron, porque quem importa pedido durante o movimento é o
 * polling do painel aberto (a cada 5s) — o cron de 60s quase nunca ganha a
 * corrida. Deixar a correção só lá significava, na prática, nunca corrigir.
 */
export async function nomeDaLojaDoPedidoIfood(opts: {
  franchiseeId: string;
  merchantId?: string | null;
  orderData: any;
}): Promise<string | null> {
  const nome = String(opts.orderData?.merchant?.name || "").trim();
  if (!nome) return null;

  if (opts.merchantId) {
    try {
      const integ = await prisma.ifoodIntegration.findFirst({
        where: { userId: opts.franchiseeId, merchantId: opts.merchantId },
        select: { id: true, label: true },
      });
      if (integ && (integ.label || "").trim() !== nome) {
        const atual = (integ.label || "").trim();
        const generico =
          !atual || /^loja principal$/i.test(atual) || /^loja ifood/i.test(atual);
        // Só troca o que não identifica a loja: o nome do cadastro repetido em
        // todas, um placeholder, ou vazio. Nome já bom fica como está.
        const loja = await prisma.user.findUnique({
          where: { id: opts.franchiseeId },
          select: { storeName: true, name: true },
        });
        const doCadastro =
          atual === (loja?.storeName || "").trim() || atual === (loja?.name || "").trim();
        if (generico || doCadastro) {
          await prisma.ifoodIntegration.update({ where: { id: integ.id }, data: { label: nome } });
          console.log(`[iFood] Rótulo de ${opts.merchantId} corrigido para "${nome}".`);
        }
      }
    } catch {
      // Nunca pode derrubar a importação de um pedido.
    }
  }

  return nome;
}

export async function processarEventosIfood(opts: {
  events: any[];
  token: string;
  log: string[];
  /** Uma loja, ou TODAS as lojas daquela chamada de polling. */
  merchantEsperado?: string | string[] | null;
}): Promise<ResultadoEventos> {
  const { token, log } = opts;

  let descartados = 0;
  let events = opts.events || [];
  const esperados = opts.merchantEsperado
    ? new Set((Array.isArray(opts.merchantEsperado) ? opts.merchantEsperado : [opts.merchantEsperado]).filter(Boolean))
    : null;
  if (esperados && esperados.size > 0) {
    const antes = events.length;
    events = events.filter((e) => e && esperados.has(e.merchantId));
    descartados = antes - events.length;
    if (descartados > 0) {
      log.push("  [x] " + descartados + " evento(s) de outro merchant descartado(s)");
    }
  }

  const processedEventIds: { id: string; orderId: string; eventType: string }[] = [];
  let created = 0;
  let updated = 0;

    for (const event of events) {
      try {
        const { code, orderId, merchantId } = event;
        if (!orderId) continue;

        const isPlaced = code === "PLC" || event.fullCode === "PLACED";
        const isConfirmed = code === "CFM" || event.fullCode === "CONFIRMED";
        const isPreparation = code === "PRP" || event.fullCode === "IN_PREPARATION" || event.fullCode === "PREPARATION_STARTED";
        const isReadyPickup = code === "RTP" || event.fullCode === "READY_TO_PICKUP";
        const isDispatched = code === "DSP" || event.fullCode === "DISPATCHED";
        const isConcluded = code === "CON" || event.fullCode === "CONCLUDED";
        const isCancelled = code === "CAN" || event.fullCode === "CANCELLED";
        const isDispute = code === "HSD" || code === "CRR" || code === "DDC" || event.fullCode === "HANDSHAKE_DISPUTE" || event.fullCode === "CANCELLATION_REQUESTED" || event.fullCode === "DUE_DATE_CHANGE_REQUESTED";

        log.push(`  📋 Evento: code=${code}, fullCode=${event.fullCode}, orderId=${orderId}`);

        // O iFood avisando que ESTE pedido vai exigir código de entrega na porta
        // do cliente. Sem guardar isso, a tela do entregador não tem como saber
        // que precisa pedir o código — e "não processa o evento
        // DELIVERY_DROP_CODE_REQUESTED" está na lista oficial das reprovações
        // mais comuns da homologação de Logistics.
        //
        // Note que o código curto é DDCR, não DDC: este último é a mudança de
        // previsão de entrega, tratada logo abaixo como disputa.
        if (ehEventoDeCodigo(event)) {
          const marca = await marcarExigeCodigo(prisma, orderId);

          // Confirmar o evento sem ter gravado nada era perdê-lo para sempre: o
          // iFood não reenvia o que já foi reconhecido, e o pedido nunca ficaria
          // elegível para o código de entrega. Acontece de verdade, porque o
          // aviso do código pode chegar antes de o pedido ser gravado aqui.
          //
          // Então o evento fica na fila para a próxima rodada — mas só por um
          // tempo: um evento órfão de pedido que nunca vai existir não pode
          // rodar na fila para sempre.
          const nascido = event.createdAt ? new Date(event.createdAt).getTime() : 0;
          const velhoDemais = nascido > 0 && Date.now() - nascido > 30 * 60 * 1000;

          if (marca === "sem-pedido" && !velhoDemais) {
            log.push(`  🔐 Pedido ${orderId} exige código, mas ainda não chegou ao banco — evento fica na fila`);
            continue;
          }

          log.push(
            marca === "gravado"
              ? `  🔐 Pedido ${orderId} exige código de entrega`
              : `  🔐 Evento de código do pedido ${orderId} confirmado sem gravar (${marca})`,
          );
          processedEventIds.push({ id: event.id, orderId, eventType: "DELIVERY_DROP_CODE_REQUESTED" });
          continue;
        }

        // Handle cancellation or due date change REQUEST (negotiation)
        if (isDispute) {
          const meta = event.metadata || {};
          const actionType = (meta.action || meta.handshakeType || meta.type || event.fullCode || "").toUpperCase();
          const rawReason = meta.message || meta.cancelCodeDescription || meta.subCodeDescription || meta.reason || meta.description || "";
          
          let disputeType = "CANCELLATION";
          if (actionType.includes("DUE_DATE") || actionType.includes("PREDICTION") || code === "DDC") {
            disputeType = "DUE_DATE_CHANGE";
          } else if (actionType.includes("RESEND") || actionType.includes("REPLACEMENT") || actionType.includes("REENVIO") || /reenvio|reenviar|repor|substituir/i.test(rawReason)) {
            disputeType = "RESEND_ITEMS";
          } else if (actionType.includes("REFUND") || /reembolso|reembolsar/i.test(rawReason)) {
            disputeType = "REFUND_ITEMS";
          }

          const finalReason = rawReason || (
            disputeType === "DUE_DATE_CHANGE" ? "O pedido está atrasado. Quero uma nova previsão de entrega." :
            disputeType === "RESEND_ITEMS" ? "Cliente prefere o reenvio de itens pra resolver o problema." :
            disputeType === "REFUND_ITEMS" ? "Cliente solicitou reembolso de item." :
            "Cliente solicitou cancelamento do pedido pelo iFood."
          );

          const disputeData = {
            pending: true,
            disputeId: meta.disputeId || "",
            type: disputeType,
            reason: finalReason,
            customerName: meta.customerName || "",
            handshakeType: meta.handshakeType || actionType,
            expiresAt: meta.expiresAt || "",
            requestedAt: meta.createdAt || new Date().toISOString(),
          };
          await (prisma.customerOrder as any).updateMany({
            where: { ifoodOrderId: orderId } as any,
            data: { cancelDispute: disputeData },
          });
          log.push(`  ⚠️ Negociação (${disputeData.type}): ${orderId} — disputeId=${meta.disputeId}, motivo="${meta.message}"`);
          if (event.id) {
            processedEventIds.push({
              id: event.id,
              orderId: event.orderId || "",
              eventType: event.fullCode || event.code || "",
            });
          }
          continue;
        }

        if (isCancelled) {
          const existingOrder: any = await prisma.customerOrder.findFirst({
            where: { ifoodOrderId: orderId } as any,
            select: { id: true, cancelledBy: true } as any,
          });

          if (existingOrder) {
            // Pedido já existe — apenas atualizar status para CANCELADO
            const cancelData: any = { status: "CANCELADO" };
            if (!existingOrder.cancelledBy || existingOrder.cancelledBy !== "LOJA") {
              cancelData.cancelledBy = "IFOOD";
            }
            await (prisma.customerOrder as any).updateMany({
              where: { ifoodOrderId: orderId } as any,
              data: cancelData,
            });
            log.push(`  🚫 Cancelado (existente): ${orderId}`);
          } else {
            // Pedido NÃO existe no nosso DB — importar como CANCELADO
            // Isso acontece quando o sistema estava fora do ar e o iFood cancelou por timeout
            try {
              const cancelOrderRes = await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (cancelOrderRes.ok) {
                const cancelOrderData = await cancelOrderRes.json();
                let cancelFranchisee = merchantId
                  ? (await prisma.user.findFirst({ where: { ifoodMerchantId: merchantId, role: "FRANCHISEE" } as any })
                    || await prisma.ifoodIntegration.findFirst({ where: { merchantId, active: true } })
                        .then(async (int: any) => int ? prisma.user.findUnique({ where: { id: int.userId } }) : null))
                  : null;

                if (cancelFranchisee) {
                  const cancelItems = await montarItensDoPedidoIfood(cancelOrderData.items ?? [], {
                    franchiseeId: cancelFranchisee.id,
                  });

                  const cancelTotal = typeof cancelOrderData.total === "object"
                    ? (cancelOrderData.total?.orderAmount ?? cancelOrderData.total?.subTotal ?? 0)
                    : (cancelOrderData.totalPrice ?? cancelOrderData.total ?? 0);

                  const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
                  const cancelParsedPay = parseOrderPaymentInfo(cancelOrderData, "IFOOD");

                  const cancelMeta = event.metadata || {};
                  const cancelReason = cancelMeta.cancelCodeDescription
                    || cancelMeta.message
                    || cancelMeta.reason
                    || "Pedido cancelado automaticamente pelo iFood (não confirmado a tempo)";

                  // Mesma sequência da loja: sem número, a tela cai no displayId
                  // do iFood e o pedido cancelado aparece com numeração alheia.
                  const numeroCancelado = await generateDailyOrderNumber(cancelFranchisee.id);

                  await (prisma.customerOrder as any).create({
                    data: {
                      franchiseeId: cancelFranchisee.id,
                      dailyOrderNumber: numeroCancelado,
                      ifoodOrderId: orderId,
                      ifoodReference: cancelOrderData.displayId ?? undefined,
                      source: "IFOOD",
                      customerName: cancelOrderData.customer?.name ?? "Cliente iFood",
                      customerPhone: (() => {
                        const phone = cancelOrderData.customer?.phone;
                        const number = phone?.number ?? (typeof phone === 'string' ? phone : '');
                        const localizer = phone?.localizer;
                        return localizer ? `${number} ID: ${localizer}` : number;
                      })(),
                      customerAddress: (() => {
                        const addr = cancelOrderData.delivery?.deliveryAddress;
                        if (!addr) return "";
                        const parts: string[] = [];
                        if (addr.formattedAddress) parts.push(addr.formattedAddress);
                        else if (addr.streetName) parts.push(`${addr.streetName}${addr.streetNumber ? `, ${addr.streetNumber}` : ""}`);
                        if (addr.neighborhood) parts.push(addr.neighborhood);
                        if (addr.city) parts.push(addr.city);
                        return parts.join(" - ");
                      })(),
                      deliveryType: cancelOrderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
                      paymentMethod: cancelParsedPay.paymentMethod,
                      totalAmount: cancelTotal,
                      deliveryFee: cancelOrderData.total?.deliveryFee ?? cancelOrderData.delivery?.deliveryFee ?? 0,
                      status: "CANCELADO",
                      cancelledBy: "IFOOD",
                      cancelReason,
                      kdsStage: "PRODUCTION",
                      kdsProductionAt: new Date(),
                      notes: `Pedido iFood #${(cancelOrderData.displayId ?? orderId.slice(-6)).toUpperCase()} | ❌ Cancelado: ${cancelReason}`,
                      createdAt: cancelOrderData.createdAt ? new Date(cancelOrderData.createdAt) : undefined,
                      items: { create: cancelItems },
                    },
                  });
                  created++;
                  log.push(`  🚫📦 Cancelado + IMPORTADO: ${orderId} (R$ ${cancelTotal})`);
                } else {
                  log.push(`  ⚠️ Cancelado mas sem franqueado: ${orderId}`);
                }
              } else {
                log.push(`  ⚠️ Cancelado mas detalhes indisponíveis: ${orderId} (${cancelOrderRes.status})`);
              }
            } catch (cancelErr: any) {
              log.push(`  ⚠️ Erro ao importar cancelado ${orderId}: ${cancelErr.message}`);
            }
          }

          if (event.id) {
            processedEventIds.push({
              id: event.id,
              orderId: event.orderId || "",
              eventType: event.fullCode || event.code || "",
            });
          }
          continue;
        }

        // Check if order exists
        const exists = await prisma.customerOrder.findFirst({
          where: { ifoodOrderId: orderId } as any,
        });

        if (!exists) {
          // Fetch order details
          const orderRes = await fetch(
            `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          if (!orderRes.ok) {
            log.push(`  ⚠️ Detalhes do pedido ${orderId} falhou: ${orderRes.status}`);
            continue;
          }

          const orderData = await orderRes.json();

          const eventMerchantId = merchantId || orderData.merchant?.id;
          let eventFranchisee = eventMerchantId
            ? (await prisma.user.findFirst({ where: { ifoodMerchantId: eventMerchantId, role: "FRANCHISEE" } as any })
              || await prisma.ifoodIntegration.findFirst({ where: { merchantId: eventMerchantId, active: true } })
                  .then(async (int: any) => int ? prisma.user.findUnique({ where: { id: int.userId } }) : null))
            : null;

          if (!eventFranchisee) {
            log.push(`  ❌ Nenhum franqueado encontrado para merchantId: ${eventMerchantId} no pedido ${orderId}`);
            continue;
          }

          // Extract items
          const items = await montarItensDoPedidoIfood(orderData.items ?? [], {
            franchiseeId: eventFranchisee.id,
          });

          const total = typeof orderData.total === "object"
            ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
            : (orderData.totalPrice ?? orderData.total ?? 0);

          const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
          const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

          const deliveryFeeValue = orderData.total?.deliveryFee
            ?? orderData.delivery?.deliveryFee
            ?? orderData.deliveryFee
            ?? 0;

          const isExplicitlyScheduled = orderData.orderTiming === "SCHEDULED" || Boolean(orderData.schedule);
          const rawScheduled = isExplicitlyScheduled
            ? (orderData.schedule?.scheduledDatetimeEnd
              ?? orderData.schedule?.scheduledDatetimeStart
              ?? orderData.scheduledDatetime
              ?? orderData.preparationStartDateTime)
            : null;

          const scheduledDatetime = rawScheduled ? new Date(rawScheduled) : null;

          if (isExplicitlyScheduled) {
            log.push(`  📅 Scheduling: orderTiming=${orderData.orderTiming}, scheduledDatetime=${orderData.scheduledDatetime}, schedule=${JSON.stringify(orderData.schedule)}, resolved=${scheduledDatetime?.toISOString()}`);
          }

          const rawDeadline = orderData.delivery?.deliveryDateTime
            ?? orderData.delivery?.estimatedDeliveryWindow?.end
            ?? orderData.delivery?.estimatedDeliveryWindow?.start
            ?? orderData.takeout?.takeoutDateTime
            ?? orderData.takeout?.estimatedTakeoutWindow?.end;

          const deliveryDeadline = scheduledDatetime ?? (rawDeadline ? new Date(rawDeadline) : null);

          const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

          const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
          const parsedPay = parseOrderPaymentInfo(orderData, "IFOOD");
          const payMethodName = parsedPay.paymentMethod;
          const changeAmount = parsedPay.changeAmount;
          const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? null;

          // Descontos
          const benefits = orderData.benefits ?? [];
          let discountIfood = 0, discountMerchant = 0, discountTotal = 0;
          const discountDetails: any[] = [];

          for (const benefit of benefits) {
            const value = benefit.value ?? 0;
            discountTotal += value;
            const sponsorships = Array.isArray(benefit.sponsorshipValues)
              ? benefit.sponsorshipValues
              : benefit.sponsorshipValues ? [benefit.sponsorshipValues] : [];
            let bIfood = 0, bMerchant = 0;
            for (const sp of sponsorships) {
              const spName = (sp.name ?? sp.sponsorship ?? "").toUpperCase();
              const spValue = sp.value ?? 0;
              if (spName === "IFOOD" || spName === "PARTNER" || spName === "EXTERNAL") bIfood += spValue;
              else if (spName === "MERCHANT") bMerchant += spValue;
              else bIfood += spValue;
            }
            if (sponsorships.length === 0 && value > 0) {
              if ((benefit.sponsorship ?? "").toUpperCase() === "MERCHANT") bMerchant += value;
              else bIfood += value;
            }
            discountIfood += bIfood;
            discountMerchant += bMerchant;
            discountDetails.push({ target: benefit.target ?? "CART", value, ifood: bIfood, merchant: bMerchant, description: benefit.campaign?.name ?? benefit.description ?? null });
          }

          const notesArr = [
            `Pedido iFood #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
            scheduledDatetime ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : null,
            discountTotal > 0 ? `🏷️ Desconto R$${discountTotal.toFixed(2)} (iFood: R$${discountIfood.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : null,
            customerNote ? `💬 ${customerNote}` : null,
          ].filter(Boolean).join(" | ");

          const deliveredByRaw = (
            orderData.deliveredBy || orderData.deliveryBy ||
            orderData.delivery?.deliveredBy || orderData.delivery?.deliveryBy ||
            orderData.merchant?.deliveredBy || orderData.logistics?.deliveredBy ||
            ""
          ).toString().toUpperCase();

          const deliveryBy = (deliveredByRaw.includes("IFOOD") || deliveredByRaw.includes("LOGISTICS") || deliveredByRaw.includes("PARTNER")) ? "IFOOD" : "MERCHANT";

          const ifoodPickupCode = (
            orderData.delivery?.pickupCode ||
            orderData.pickupCode ||
            orderData.driver?.pickupCode ||
            orderData.logistics?.pickupCode ||
            event?.pickupCode ||
            event?.data?.pickupCode ||
            null
          )?.toString().trim() || null;

          let initialStatus = "NOVO";
          if (isConfirmed) initialStatus = "ACEITO";
          else if (isPreparation) initialStatus = "PREPARANDO";
          else if (isReadyPickup) initialStatus = "PREPARANDO";
          else if (isDispatched) initialStatus = "SAIU_ENTREGA";
          else if (isConcluded) initialStatus = "ENTREGUE";

          // Numeração sequencial DA LOJA (1, 2, 3…), DENTRO da transação.
          //
          // Sem número, o pedido caía no ifoodReference e a Pastel da Paulista
          // recebeu os 15 primeiros como #3902, #5097, #1772 — o displayId do
          // iFood, não a fila da loja.
          //
          // Mas pegar o número FORA da transação criou outro problema, visto em
          // produção no mesmo dia: a Hakim ficou com a sequência 93, 94, 96, 98.
          // O mesmo pedido do iFood chega por dois caminhos (este cron e o
          // webhook); os dois pegavam número e tentavam gravar, um perdia na
          // trava de ifoodOrderId único e o número dele ficava queimado. Buraco
          // na sequência, que o lojista lê como "sumiu um pedido".
          //
          // De qual loja iFood veio — a conta pode ter várias no mesmo painel.
          const nomeDaLoja = await nomeDaLojaDoPedidoIfood({
            franchiseeId: eventFranchisee.id,
            merchantId: eventMerchantId,
            orderData,
          });

          // Agora número e pedido nascem na MESMA transação: se a gravação falhar
          // — inclusive por duplicidade — o contador volta atrás junto.
          await prisma.$transaction(async (tx) => {
            const numeroDoDia = await generateDailyOrderNumberTx(tx, eventFranchisee.id);

            await (tx.customerOrder as any).create({
            data: {
              franchiseeId: eventFranchisee.id,
              dailyOrderNumber: numeroDoDia,
              ifoodOrderId: orderId,
              ifoodStoreName: nomeDaLoja ?? undefined,
              ifoodStoreMerchant: eventMerchantId ?? undefined,
              ifoodReference: orderData.displayId ?? undefined,
              ifoodPickupCode: ifoodPickupCode ?? undefined,
              scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
              changeAmount,
              customerCpfCnpj,
              deliveryBy,
              discountTotal: discountTotal > 0 ? discountTotal : null,
              discountIfood: discountIfood > 0 ? discountIfood : null,
              discountMerchant: discountMerchant > 0 ? discountMerchant : null,
              discountDetails: discountDetails.length > 0 ? discountDetails : undefined,
              source: "IFOOD",
              customerName: orderData.customer?.name ?? "Cliente iFood",
              customerPhone: (() => {
                const phone = orderData.customer?.phone;
                const number = phone?.number ?? (typeof phone === 'string' ? phone : '');
                const localizer = phone?.localizer;
                return localizer ? `${number} ID: ${localizer}` : number;
              })(),
              customerAddress: (() => {
                const addr = orderData.delivery?.deliveryAddress;
                if (!addr) return "";
                const formatted = addr.formattedAddress || "";
                const neighborhood = addr.neighborhood || "";
                const city = addr.city || "";
                const complement = addr.complement || addr.streetNameComplement || "";
                const reference = addr.reference || addr.streetNameReference || orderData.delivery?.observations || orderData.customer?.customerNote || "";
                const parts: string[] = [];
                if (formatted) {
                  parts.push(formatted);
                } else if (addr.streetName) {
                  parts.push(`${addr.streetName}${addr.streetNumber ? `, ${addr.streetNumber}` : ""}`);
                }
                if (complement && !parts.some(p => p.toLowerCase().includes(complement.toLowerCase()))) {
                  parts.push(`Comp: ${complement}`);
                }
                if (reference && !parts.some(p => p.toLowerCase().includes(reference.toLowerCase()))) {
                  parts.push(`Ref: ${reference}`);
                }
                if (neighborhood && (!parts[0] || !parts[0].toLowerCase().includes(neighborhood.toLowerCase()))) {
                  parts.push(neighborhood);
                }
                if (city) parts.push(city);
                return parts.join(" - ");
              })(),
              deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
              paymentMethod: payMethodName,
              totalAmount: total,
              deliveryFee: deliveryFeeValue,
              status: initialStatus,
              kdsStage: "PRODUCTION",
              kdsProductionAt: new Date(),
              notes: notesArr,
              createdAt: orderData.createdAt ? new Date(orderData.createdAt) : undefined,
              items: { create: items },
            },
            });
          }, { timeout: 20000 });

          log.push(`  ✅ Pedido CRIADO: ${orderId} (status: ${initialStatus})`);
          created++;

          // ── BAIXA DE ESTOQUE DO PEDIDO DE MARKETPLACE ─────────────────────
          //
          // Não existia. `deductStockForOrder` aparecia ZERO vezes neste
          // arquivo e em todos os outros caminhos de plataforma (99Food,
          // Jotajá, Brendi, chatbot, API de parceiro) — ou seja, o iFood não
          // tirava UM GRAMA do estoque, e para a maioria das lojas de delivery
          // ele é a maior parte do faturamento.
          //
          // E não bastava esperar o gatilho de sempre: o único era a TRANSIÇÃO
          // para ACEITO (api/customer-order/status), e o pedido importado JÁ
          // NASCE em ACEITO quando vem confirmado — nunca transita para o
          // status em que já está. Por isso a chamada é aqui, na criação.
          //
          // A resolução da ficha técnica do produto-espelho está em
          // src/lib/stock.ts (procura o produto do cardápio com o mesmo nome).
          // É idempotente por `sourceRef` único, então uma reimportação do
          // mesmo pedido não baixa de novo.
          //
          // Fora da transação e sem await, como todos os outros chamadores: a
          // baixa não pode segurar nem derrubar a importação do pedido — comida
          // que não entra é pior que saldo que atrasa um segundo.
          try {
            const pedidoCriado = await prisma.customerOrder.findFirst({
              where: { ifoodOrderId: orderId, franchiseeId: eventFranchisee.id },
              select: { id: true },
              orderBy: { createdAt: "desc" },
            });
            if (pedidoCriado) {
              const { deductStockForOrder } = await import("@/lib/stock");
              deductStockForOrder(pedidoCriado.id).catch((e) =>
                console.error(`[iFood] Baixa de estoque falhou para ${orderId}:`, e?.message)
              );
            }
          } catch (e: any) {
            console.error(`[iFood] Não consegui disparar a baixa de ${orderId}:`, e?.message);
          }

          // Auto-confirm
          //
          // ⚠️ Só para pedido RECENTE. Quando uma loja conecta pela primeira
          // vez, a fila do iFood vem com horas de histórico de uma vez (a
          // Pastel da Paulista tinha 56 eventos / 15 pedidos represados, o mais
          // antigo de 3h antes). Confirmar em massa pedidos velhos é uma ação
          // externa e irreversível sobre a operação de outra pessoa — vários já
          // haviam sido despachados ou concluídos por outro app. Importa-se o
          // histórico, mas não se mexe nele.
          const idadeMs = event?.createdAt ? Date.now() - new Date(event.createdAt).getTime() : 0;
          const recente = idadeMs < 30 * 60 * 1000;
          if (isPlaced && recente) {
            await fetch(
              `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`,
              { method: "POST", headers: { Authorization: `Bearer ${token}` } }
            );
            log.push(`  ✅ Auto-confirmado: ${orderId}`);
          } else if (isPlaced) {
            log.push(`  ⏭️ Não auto-confirmado (evento de ${Math.round(idadeMs / 60000)} min atrás): ${orderId}`);
          }
        } else {
          // Update existing order status
          let newStatus: string | null = null;
          if (isConcluded) newStatus = "ENTREGUE";
          else if (isDispatched) newStatus = "SAIU_ENTREGA";
          else if (isPreparation || isReadyPickup) newStatus = "PREPARANDO";
          else if (isConfirmed) newStatus = "ACEITO";

          if (newStatus) {
            const updateData: any = { status: newStatus };
            // ⚠️ `ifoodDriverStatus = CONCLUDED` SÓ em pedido que teve entregador
            // do iFood de verdade.
            //
            // Antes era carimbado em todo pedido concluído, inclusive nos
            // entregues pelo motoboy da loja. O painel decide "entrega parceira"
            // por esse campo, então o pedido saía certo com o nome do entregador
            // e, ao virar Finalizado, trocava para "Motoboy iFood": a tela
            // mandava "não enviar motoboy da loja" num pedido que era da loja, e
            // o entregador que fez a corrida sumia do registro que fecha o
            // pagamento dele. 4.130 pedidos na base quando foi medido.
            if (isConcluded && (exists as any)?.ifoodDriverName) {
              updateData.ifoodDriverStatus = "CONCLUDED";
            }

            // === Sincronizar prazo de entrega do iFood ===
            try {
              const detailRes = await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (detailRes.ok) {
                const detailData = await detailRes.json();
                const updatedDeadline = detailData.delivery?.deliveryDateTime
                  ?? detailData.delivery?.estimatedDeliveryWindow?.end
                  ?? detailData.delivery?.estimatedDeliveryWindow?.start
                  ?? detailData.takeout?.takeoutDateTime
                  ?? detailData.takeout?.estimatedTakeoutWindow?.end;
                if (updatedDeadline) {
                  updateData.scheduledDatetime = new Date(updatedDeadline);
                  log.push(`  ⏱️ Prazo atualizado: ${orderId} → ${updatedDeadline}`);
                }
                const dByRaw = (
                  detailData.deliveredBy || detailData.deliveryBy ||
                  detailData.delivery?.deliveredBy || detailData.delivery?.deliveryBy ||
                  detailData.merchant?.deliveredBy || detailData.logistics?.deliveredBy ||
                  ""
                ).toString().toUpperCase();
                if (dByRaw.includes("IFOOD") || dByRaw.includes("LOGISTICS") || dByRaw.includes("PARTNER")) {
                  updateData.deliveryBy = "IFOOD";
                }
                const pCode = (
                  detailData.delivery?.pickupCode ||
                  detailData.pickupCode ||
                  detailData.driver?.pickupCode ||
                  detailData.logistics?.pickupCode
                )?.toString().trim();
                if (pCode) {
                  updateData.ifoodPickupCode = pCode;
                }
              }
            } catch (deadlineErr: any) {
              log.push(`  ⚠️ Falha ao sincronizar prazo de ${orderId}: ${deadlineErr?.message}`);
            }

            await (prisma.customerOrder as any).updateMany({
              where: { ifoodOrderId: orderId } as any,
              data: updateData,
            });
            log.push(`  🔄 Status atualizado: ${orderId} → ${newStatus}`);
            updated++;
          }
        }

        if (event.id) {
          processedEventIds.push({
            id: event.id,
            orderId: event.orderId || "",
            eventType: event.fullCode || event.code || "",
          });
        }
      } catch (err: any) {
        log.push(`  ❌ Erro: ${err.message}`);
      }
    }

    // Acknowledge processed events
    if (processedEventIds.length > 0) {
      await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(processedEventIds),
      });
      log.push(`✅ ${processedEventIds.length} eventos acknowledged`);
    }

  return { created, updated, acknowledged: processedEventIds.length, descartados };
}
