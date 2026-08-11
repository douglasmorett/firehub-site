import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { trackSaleForBilling } from "@/lib/billing";

// Status que contam como venda confirmada para fins de faturamento
// Disparado apenas em ENTREGUE para evitar contagem duplicada
const BILLING_TRIGGER_STATUSES = ["ENTREGUE"];

// Transições de status permitidas (state machine flexível para a operação do restaurante)
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NOVO:          ["ACEITO", "PREPARANDO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"],
  CONFIRMADO:    ["ACEITO", "PREPARANDO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"],
  ACEITO:        ["PREPARANDO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"],
  PREPARANDO:    ["ACEITO", "PRONTO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"],
  PRONTO:        ["ACEITO", "PREPARANDO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"],
  SAIU_ENTREGA:  ["ACEITO", "PREPARANDO", "ENTREGUE", "CANCELADO"],
  SAIU_PARA_ENTREGA: ["ACEITO", "PREPARANDO", "ENTREGUE", "CANCELADO"],
  ENTREGUE:      ["SAIU_ENTREGA", "PREPARANDO", "ACEITO", "CANCELADO"],
  CANCELADO:     ["NOVO", "ACEITO", "PREPARANDO"],
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
          menuProduct: { select: { name: true } }
        }
      }
    }
  });

  if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PUT(req: Request) {
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

  if (role !== "ADMIN" && role !== "FRANQUEADO" && role !== "LOJA" && !isStoreMember) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
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
    // Voltando para preparo/produção: reseta kdsStage para PRODUCTION para reaparecer em ambos os KDS
    if (order.kdsStage === "FINISHED" || !order.kdsStage) {
      updateData.kdsStage = "PRODUCTION";
      updateData.kdsProductionAt = new Date();
    }
  }
  if (["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "ENTREGUE", "CANCELADO"].includes(status)) {
    // Saiu para entrega/cancelou/entregou: marca como FINISHED para sair de ambos os KDS
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

      if (status === "PREPARANDO") {
        // Start preparation
        const r = await fetch(`${baseUrl}/startPreparation`, { method: "POST", headers });
        console.log(`[iFood Sync] startPreparation ${ifoodId}: ${r.status}`);
      }

      if (status === "SAIU_ENTREGA") {
        // Guarantee startPreparation occurred if jumping directly from ACEITO/NOVO
        if (order.status === "ACEITO" || order.status === "NOVO") {
          await fetch(`${baseUrl}/startPreparation`, { method: "POST", headers }).catch(() => {});
        }
        // Dispatch (delivery orders)
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
        updateData.motoboyId = null;
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

  // ── Sync with Jotajá (Open Delivery) ──
  if (order.openDeliveryOrderId) {
    const syncErrors: string[] = [];
    try {
      const { jotajaMutate } = await import("@/lib/jotaja-api");
      const odId = order.openDeliveryOrderId;

      // Retry helper: tenta até 2x com 1s de intervalo
      const jotajaCall = async (path: string, label: string): Promise<Response> => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const r = await jotajaMutate(path, { method: "POST" });
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
        updateData.motoboyId = null;
        updateData.cancelledBy = "LOJA";
        if (cancelReason) updateData.cancelReason = cancelReason;

        const codeToUse = cancellationCode || "501";

        const cancelRes = await jotajaMutate(`/v1/orders/${odId}/requestCancellation`, {
          method: "POST",
          body: JSON.stringify({ code: String(codeToUse), mode: "MANUAL", reason: cancelReason || "CANCELLED_BY_RESTAURANT" }),
        });
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
    // Registrar erro de sync para visibilidade no dashboard
    if (syncErrors.length > 0) {
      updateData.jotajaSyncError = syncErrors.join(" | ");
      console.error(`[Jotajá Sync] ❌ FALHAS em ${order.openDeliveryOrderId}: ${syncErrors.join(" | ")}`);
    } else {
      updateData.jotajaSyncError = null; // Limpa erros anteriores
    }
  }

  // Handle non-iFood/non-Jotajá cancellations
  if (status === "CANCELADO" && !order.ifoodOrderId && !order.openDeliveryOrderId) {
    updateData.motoboyId = null;
    updateData.cancelledBy = "LOJA";
    if (cancelReason) updateData.cancelReason = cancelReason;
  }

  await prisma.customerOrder.update({
    where: { id: orderId },
    data: updateData
  });

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

  return NextResponse.json({ success: true });
}
