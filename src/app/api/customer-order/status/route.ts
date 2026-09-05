import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { trackSaleForBilling } from "@/lib/billing";
import { ehPedido99Food, sincronizar99Food } from "@/lib/food99-status";
import { ehPedidoBrendi, sincronizarBrendi } from "@/lib/brendi-status";

// Status que contam como venda confirmada para fins de faturamento
// Disparado apenas em ENTREGUE para evitar contagem duplicada
const BILLING_TRIGGER_STATUSES = ["ENTREGUE"];

// Transições de status permitidas (state machine total flexível para a operação dinâmica do restaurante)
const ALL_TARGET_STATUSES = ["NOVO", "CONFIRMADO", "ACEITO", "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  // AGUARDANDO_PAGAMENTO faltava neste mapa, e a falta era fatal: sem entrada,
  // `allowedNext` virava [] e NENHUMA transição saía dele para quem não é
  // ADMIN. É o status em que todo pedido de totem NASCE.
  //
  // Na prática isso quebrava o fluxo principal do autoatendimento: o cliente
  // escolhe "pagar no balcão", leva a senha, paga — e o atendente não
  // conseguia aceitar o pedido ("Transição inválida: AGUARDANDO_PAGAMENTO →
  // ACEITO"). A cozinha nunca via o pedido. E o pedido abandonado por quem
  // desistiu também não podia ser cancelado: ficava presa na lista da loja
  // para sempre.
  //
  // Aceitar daqui é o que dispara `confirmOrderPayment` mais abaixo — que
  // carimba o pagamento, gera a senha e manda para o KDS.
  AGUARDANDO_PAGAMENTO: ALL_TARGET_STATUSES,
  CRIANDO_IA:    ALL_TARGET_STATUSES,
  NOVO:          ALL_TARGET_STATUSES,
  CONFIRMADO:    ALL_TARGET_STATUSES,
  RECEBIDO:      ALL_TARGET_STATUSES,
  PENDENTE:      ALL_TARGET_STATUSES,
  ACEITO:        ALL_TARGET_STATUSES,
  PREPARANDO:    ALL_TARGET_STATUSES,
  EM_PREPARO:    ALL_TARGET_STATUSES,
  EM_ANDAMENTO:  ALL_TARGET_STATUSES,
  PRONTO:        ALL_TARGET_STATUSES,
  SAIU_ENTREGA:  ALL_TARGET_STATUSES,
  SAIU_PARA_ENTREGA: ALL_TARGET_STATUSES,
  ENTREGUE:      ALL_TARGET_STATUSES,
  CANCELADO:     ALL_TARGET_STATUSES,
};

// GET: Public status check (no auth required)
export async function GET(req: NextRequest) {
  const orderId = req.nextUrl.searchParams.get("id");
  if (!orderId) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
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
  const { orderId, status, scheduledDatetime, cancelReason, cancellationCode } = body;

  if (!orderId || !status) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: { franchisee: true }
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

  const userStoreIds = [
    currentUser.id,
    currentUser.ownerId,
    targetFranchiseeId
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

  // Status igual ao atual não é transição: sem esta guarda, um segundo clique
  // em "Entregue" no painel (ENTREGUE → ENTREGUE, que o ADMIN passa direto)
  // disparava DE NOVO o WhatsApp "seu pedido chegou" e os efeitos da entrega.
  if (order.status === status) {
    return NextResponse.json({ success: true, semMudanca: true, order });
  }

  // State machine: só permite transições válidas (exceto ADMIN que tem controle total)
  if (role !== "ADMIN") {
    const allowedNext = ALLOWED_TRANSITIONS[order.status] ?? [];
    if (!allowedNext.includes(status)) {
      return NextResponse.json(
        { error: `Transição inválida: ${order.status} → ${status}` },
        { status: 400 }
      );
    }
  }

  const updateData: any = { status };
  // Allow updating scheduledDatetime (e.g. when anticipating a scheduled order)
  if (scheduledDatetime !== undefined) {
    updateData.scheduledDatetime = scheduledDatetime ? new Date(scheduledDatetime) : null;
  }

  // ── Auto-set KDS stage ──
  if (status === "ACEITO" || status === "PREPARANDO") {
    // Apenas atribui PRODUCTION se o pedido ainda não tiver nenhum estágio no KDS
    if (!order.kdsStage) {
      updateData.kdsStage = "PRODUCTION";
      updateData.kdsProductionAt = new Date();
    }
  }
  if (["ENTREGUE", "CANCELADO"].includes(status)) {
    // Apenas ENTREGUE e CANCELADO encerram o pedido do KDS da cozinha.
    // SAIU_ENTREGA mantém o pedido no KDS se a cozinha ainda estiver preparando!
    updateData.kdsStage = "FINISHED";
    updateData.kdsStationId = null;
  }

  // ── Sync with iFood ──
  if (order.ifoodOrderId) {
    try {
      const { getIfoodToken } = await import("@/lib/ifood-api");
      const token = await getIfoodToken();
      const ifoodId = order.ifoodOrderId;
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const baseUrl = `https://merchant-api.ifood.com.br/order/v1.0/orders/${ifoodId}`;

      if (status === "ACEITO") {
        // Confirm order on iFood
        const r = await fetch(`${baseUrl}/confirm`, { method: "POST", headers });
        console.log(`[iFood Sync] confirm ${ifoodId}: ${r.status}`);
      }

      if (status === "PRONTO") {
        // Envia readyToPickup para o iFood (acelera a alocação/chegada do motoboy parceiro do iFood e notifica cliente)
        const r = await fetch(`${baseUrl}/readyToPickup`, { method: "POST", headers });
        console.log(`[iFood Sync] readyToPickup ${ifoodId}: ${r.status}`);
      }

      if (status === "SAIU_ENTREGA") {
        // Garantir que startPreparation e readyToPickup foram enviados ao iFood
        if (order.status === "ACEITO" || order.status === "NOVO") {
          await fetch(`${baseUrl}/startPreparation`, { method: "POST", headers }).catch(() => {});
        }
        await fetch(`${baseUrl}/readyToPickup`, { method: "POST", headers }).catch(() => {});

        // Dispatch (pedidos de entrega)
        const r = await fetch(`${baseUrl}/dispatch`, { method: "POST", headers });
        console.log(`[iFood Sync] dispatch ${ifoodId}: ${r.status}`);
      }

      if (status === "ENTREGUE") {
        const isPickup = order.deliveryType !== "DELIVERY";
        if (isPickup) {
          await fetch(`${baseUrl}/readyToPickup`, { method: "POST", headers }).catch(() => {});
        } else {
          await fetch(`${baseUrl}/dispatch`, { method: "POST", headers }).catch(() => {});
        }
        // Conclude order (works for both delivery and pickup)
        const r2 = await fetch(`${baseUrl}/conclude`, { method: "POST", headers, body: JSON.stringify({}) });
        console.log(`[iFood Sync] conclude ${ifoodId}: ${r2.status}`);
      }

      if (status === "CANCELADO") {
        // Cancel on iFood
        updateData.cancelledBy = "LOJA";
        if (cancelReason) updateData.cancelReason = cancelReason;

        const codeToUse = cancellationCode || "501";

        const cancelRes = await fetch(`${baseUrl}/requestCancellation`, {
          method: "POST", headers,
          body: JSON.stringify({ reason: cancelReason || "CANCELLED_BY_RESTAURANT", cancellationCode: String(codeToUse) }),
        });

        if (!cancelRes.ok) {
          // Fallback: try deny (for NOVO orders) or direct cancel
          const fallbackUrl = order.status === "NOVO" ? `${baseUrl}/deny` : `${baseUrl}/cancel`;
          const fallbackRes = await fetch(fallbackUrl, {
            method: "POST", headers,
            body: JSON.stringify({ reason: cancelReason || "Cancelado pela loja", cancelCodeId: String(codeToUse) }),
          });
          console.log(`[iFood Sync] cancel fallback ${ifoodId}: ${fallbackRes.status}`);
        } else {
          console.log(`[iFood Sync] ✅ cancel ${ifoodId}: ${cancelRes.status}`);
        }
      }
    } catch (err: any) {
      console.error(`[iFood Sync] Erro ${order.ifoodOrderId}:`, err?.message);
      // Don't block local update even if iFood sync fails
    }
  }

  // ── Sync with 99Food ────────────────────────────────────────────────────
  // O 99Food grava o id dele em `openDeliveryOrderId`, o mesmo campo do
  // JotaJá. O bloco abaixo lia só a presença do campo, então TODO pedido do
  // 99Food era mandado para a API do JotaJá com um id que não é dele: o 99Food
  // nunca recebia o confirm (e cancela o pedido por isso), nunca recebia o
  // ready (que é o que chama o entregador deles) e nunca recebia o cancel.
  // Quem separa os dois é o canal, nunca a presença do id.
  if (ehPedido99Food(order)) {
    if (status === "CANCELADO") {
      updateData.cancelledBy = "LOJA";
      if (cancelReason) updateData.cancelReason = cancelReason;
    }
    const r = await sincronizar99Food(
      {
        openDeliveryOrderId: order.openDeliveryOrderId!,
        franchiseeId: order.franchiseeId,
        status: order.status,
        deliveryBy: order.deliveryBy,
      },
      status,
      { motivo: cancelReason, reasonId: cancellationCode ? Number(cancellationCode) : undefined }
    );
    if (r.erros.length > 0) {
      console.error(`[99Food Sync] ❌ FALHAS em ${order.openDeliveryOrderId}: ${r.erros.join(" | ")}`);
    }
  }

  // ── Sync with Brendi (Open Delivery) ────────────────────────────────────
  // A Brendi grava o id dela no MESMO `openDeliveryOrderId` do JotaJá e do
  // 99Food — quem separa os três é o canal (openDeliveryChannel/source), nunca
  // a presença do campo. `ehPedidoBrendi` decide por canal e o ramo JotaJá
  // logo abaixo exclui explicitamente os canais irmãos, senão o pedido da
  // Brendi cairia lá e o confirm iria para a API errada (o exato incidente do
  // 99Food descrito acima).
  if (ehPedidoBrendi(order)) {
    if (status === "CANCELADO") {
      updateData.cancelledBy = "LOJA";
      if (cancelReason) updateData.cancelReason = cancelReason;
    }
    const r = await sincronizarBrendi(
      {
        // O registro de resgate manual usa o sufixo `_recovered`; a API da
        // Brendi só conhece o UUID limpo (mesma normalização do brendi-action).
        openDeliveryOrderId: order.openDeliveryOrderId!.replace(/_recovered$/, ""),
        franchiseeId: order.franchiseeId,
        status: order.status,
        deliveryBy: order.deliveryBy,
      },
      status,
      { motivo: cancelReason }
    );
    if (r.erros.length > 0) {
      console.error(`[Brendi Sync] ❌ FALHAS em ${order.openDeliveryOrderId}: ${r.erros.join(" | ")}`);
    }
  }

  // ── Sync with Jotajá (Open Delivery) ──
  // Decisão por CANAL: o JotaJá é o "resto" do Open Delivery só depois de
  // excluir 99Food E Brendi — presença de openDeliveryOrderId não diz de quem
  // o pedido é.
  if (order.openDeliveryOrderId && !ehPedido99Food(order) && !ehPedidoBrendi(order)) {
    const syncErrors: string[] = [];
    try {
      const { jotajaMutate } = await import("@/lib/jotaja-api");
      const odId = order.openDeliveryOrderId;

      // Retry helper: tenta até 2x com 1s de intervalo
      const jotajaCall = async (path: string, label: string): Promise<Response> => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const r = await jotajaMutate(path, { method: "POST" }, order.franchiseeId);
            if (r.ok || r.status === 409) {
              console.log(`[Jotajá Sync] ✅ ${label} ${odId}: ${r.status}`);
              return r;
            }
            const errBody = await r.text().catch(() => "");
            console.warn(`[Jotajá Sync] ⚠️ ${label} ${odId} tentativa ${attempt}: ${r.status} — ${errBody.slice(0, 300)}`);
            if (attempt < 2) await new Promise(res => setTimeout(res, 1000));
            if (attempt === 2) syncErrors.push(`${label}: ${r.status} ${errBody.slice(0, 100)}`);
          } catch (err: any) {
            console.warn(`[Jotajá Sync] ⚠️ ${label} ${odId} tentativa ${attempt}: ${err.message}`);
            if (attempt < 2) await new Promise(res => setTimeout(res, 1000));
            if (attempt === 2) syncErrors.push(`${label}: ${err.message}`);
          }
        }
        return new Response(null, { status: 500 });
      };

      if (status === "ACEITO") {
        await jotajaCall(`/v1/orders/${odId}/confirm`, "confirm");
      }

      if (status === "PREPARANDO") {
        await jotajaCall(`/v1/orders/${odId}/startPreparation`, "startPreparation");
      }

      if (status === "SAIU_ENTREGA") {
        // Garantir startPreparation antes do dispatch (igual iFood)
        if (order.status === "ACEITO" || order.status === "NOVO") {
          await jotajaCall(`/v1/orders/${odId}/startPreparation`, "startPreparation (pre-dispatch)");
        }
        await jotajaCall(`/v1/orders/${odId}/dispatch`, "dispatch");
      }

      if (status === "ENTREGUE") {
        const isPickup = order.deliveryType !== "DELIVERY";
        if (isPickup) {
          await jotajaCall(`/v1/orders/${odId}/readyToPickup`, "readyToPickup");
        }
        await jotajaCall(`/v1/orders/${odId}/delivered`, "delivered");
      }

      if (status === "CANCELADO") {
        updateData.cancelledBy = "LOJA";
        if (cancelReason) updateData.cancelReason = cancelReason;

        const codeToUse = cancellationCode || "501";

        const cancelRes = await jotajaMutate(`/v1/orders/${odId}/requestCancellation`, {
          method: "POST",
          body: JSON.stringify({ code: String(codeToUse), mode: "MANUAL", reason: cancelReason || "CANCELLED_BY_RESTAURANT" }),
        }, order.franchiseeId);
        if (!cancelRes.ok) {
          const errBody = await cancelRes.text().catch(() => "");
          syncErrors.push(`cancel: ${cancelRes.status} ${errBody.slice(0, 100)}`);
        }
        console.log(`[Jotajá Sync] cancel ${odId}: ${cancelRes.status}`);
      }
    } catch (err: any) {
      console.error(`[Jotajá Sync] ❌ Erro ${order.openDeliveryOrderId}:`, err?.message);
      syncErrors.push(`geral: ${err.message}`);
    }
    // Registrar erro de sync para visibilidade no dashboard (Removido pois jotajaSyncError não existe no schema)
    if (syncErrors.length > 0) {
      console.error(`[Jotajá Sync] ❌ FALHAS em ${order.openDeliveryOrderId}: ${syncErrors.join(" | ")}`);
    }
  }

  // Handle non-iFood/non-Jotajá cancellations
  if (status === "CANCELADO" && !order.ifoodOrderId && !order.openDeliveryOrderId) {
    updateData.cancelledBy = "LOJA";
    if (cancelReason) updateData.cancelReason = cancelReason;
  }

  await prisma.customerOrder.update({
    where: { id: orderId },
    data: updateData
  });

  // ── Notificações via WhatsApp ──
  try {
    const { sendOrderNotification } = await import("@/lib/order-notifications");
    if (status === "SAIU_ENTREGA" || status === "SAIU_PARA_ENTREGA") {
      if (order.deliveryType === "DELIVERY") {
        sendOrderNotification(orderId, "SAIU_ENTREGA").catch(() => {});
      } else {
        sendOrderNotification(orderId, "PRONTO_RETIRADA").catch(() => {});
      }
    } else if (status === "PRONTO") {
      sendOrderNotification(orderId, "PRONTO_RETIRADA").catch(() => {});
    } else if (status === "ENTREGUE") {
      sendOrderNotification(orderId, "ENTREGUE").catch(() => {});
    } else if (status === "CANCELADO") {
      sendOrderNotification(orderId, "CANCELADO", { cancelReason }).catch(() => {});
    }
  } catch (errWp) {
    console.warn("[Status API] Erro ao disparar notificação WhatsApp:", errWp);
  }

  // Estorno Automático para Pagamentos Online no Cancelamento
  if (status === "CANCELADO" && (order as any).paymentId) {
    try {
      const { refundMpPayment } = await import("@/lib/mercadopago");
      const franchisee = await prisma.user.findUnique({
        where: { id: order.franchiseeId },
        select: { mpAccessToken: true },
      });
      const refundRes = await refundMpPayment((order as any).paymentId, franchisee?.mpAccessToken || undefined);
      if (refundRes.success) {
        console.log(`[Automatic Refund] Order ${orderId} refunded successfully via MP.`);
      } else {
        console.warn(`[Automatic Refund] Order ${orderId} refund notice:`, refundRes.error);
      }
    } catch (refundErr: any) {
      console.error(`[Automatic Refund] Erro ao estornar pedido ${orderId}:`, refundErr.message);
    }
  }

  // ── Emissão automática de NFC-e ──
  // Se a loja marcou a forma de pagamento deste pedido em "emissão automática"
  // (tela Fiscal → Configurações), a nota sai sozinha na conclusão. Fire and
  // forget: falha de emissão vira FAILED na aba Notas fiscais, nunca erro aqui.
  if (status === "ENTREGUE") {
    import("@/lib/fiscal-automatico")
      .then(({ emitirNfceAutomatica }) => emitirNfceAutomatica(orderId))
      .catch(err => console.error("[Fiscal Auto] Erro ao disparar:", err?.message));
  }

  // Atualiza faturamento do ciclo mensal se pedido foi confirmado
  if (BILLING_TRIGGER_STATUSES.includes(status)) {
    trackSaleForBilling(order.franchiseeId).catch(err =>
      console.error("[Billing] Erro ao atualizar ciclo:", err)
    );
  }

  // Baixa de estoque — disparada APENAS no ACEITO para evitar débitos múltiplos
  if (status === "ACEITO") {
    const { deductStockForOrder } = await import("@/lib/stock");
    deductStockForOrder(orderId).catch(err =>
      console.error("[Stock] Erro ao deduzir estoque:", err)
    );
  }

  // ── ACEITAR UM PEDIDO QUE ESPERAVA PAGAMENTO É CONFIRMAR QUE PAGOU ────────
  // O pedido do totem passou a nascer em AGUARDANDO_PAGAMENTO, e o cliente que
  // escolhe "pagar no caixa" depende de alguém no balcão liberar. Se o
  // atendente apenas mudasse o status por aqui, o pedido iria para a cozinha
  // com `paymentPaidAt` nulo: apareceria como não pago no fechamento do dia e
  // não geraria a senha que o cliente é chamado para retirar.
  //
  // `confirmOrderPayment` é a mesma função do webhook do gateway e do app da
  // maquininha, e é idempotente — se o pagamento já tiver sido confirmado por
  // outro caminho, ela não faz nada.
  if (order.status === "AGUARDANDO_PAGAMENTO" && status !== "CANCELADO") {
    const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
    confirmOrderPayment(orderId).catch(err =>
      console.error("[Status] Erro ao confirmar pagamento no balcão:", err)
    );
  }

  // Cancelou depois do ACEITO: o insumo já saiu do saldo, mas continua na
  // prateleira. Devolve o que a baixa consumiu — a própria função ignora
  // pedido que nunca chegou a baixar e não devolve duas vezes.
  if (status === "CANCELADO") {
    const { restoreStockForOrder } = await import("@/lib/stock");
    restoreStockForOrder(orderId).catch(err =>
      console.error("[Stock] Erro ao devolver estoque:", err)
    );
  }

  return NextResponse.json({ success: true });
} catch (err: any) {
    console.error("[PUT Status Error]:", err);
    return NextResponse.json({ error: err?.message || "Erro ao atualizar status do pedido" }, { status: 500 });
  }
}
