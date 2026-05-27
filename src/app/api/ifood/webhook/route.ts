/**
 * POST /api/ifood/webhook
 * Recebe eventos de pedidos do iFood via Webhook.
 *
 * ⚠️  REQUER APROVAÇÃO DO IFOOD COMO INTEGRADOR
 *     https://developer.ifood.com.br
 *
 * Módulos necessários:
 *  - Order: receber e confirmar pedidos
 *  - Events: polling ou webhook de eventos
 *  - Merchant: status e operações da loja
 *
 * Este endpoint está preparado e aguarda apenas as credenciais
 * (CLIENT_ID e CLIENT_SECRET) após aprovação do iFood.
 *
 * ─── FLUXO DO PEDIDO IFOOD ────────────────────────────────────────────────
 * 1. iFood envia evento → PLACED (novo pedido)
 * 2. FireHub confirma   → POST /orders/{orderId}/confirm (em até 8 min)
 * 3. Cozinha prepara    → POST /orders/{orderId}/startPreparation
 * 4. Pedido pronto      → POST /orders/{orderId}/readyToPickup
 * 5. Entregue           → POST /orders/{orderId}/dispatch (se delivery próprio)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

// Valida assinatura HMAC do iFood (segurança)
function validateIfoodSignature(body: string, signature: string | null): boolean {
  if (!process.env.IFOOD_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto
    .createHmac("sha256", process.env.IFOOD_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  return `sha256=${expected}` === signature;
}

// Mapeia status do iFood para status do FireHub
const STATUS_MAP: Record<string, string> = {
  PLACED:             "NOVO",
  CONFIRMED:          "ACEITO",
  IN_PREPARATION:     "PREPARANDO",
  READY_TO_PICKUP:    "PREPARANDO",
  DISPATCHED:         "SAIU_ENTREGA",
  CONCLUDED:          "ENTREGUE",
  CANCELLED:          "CANCELADO",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-ifood-signature");

  // Em produção, validar assinatura
  if (process.env.NODE_ENV === "production" && process.env.IFOOD_WEBHOOK_SECRET) {
    if (!validateIfoodSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
    }
  }

  let events: any[];
  try {
    const body = JSON.parse(rawBody);
    events = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  for (const event of events) {
    try {
      await processIfoodEvent(event);
    } catch (err) {
      console.error("[iFood Webhook] Erro ao processar evento:", event?.id, err);
    }
  }

  // O iFood exige resposta 200 em até 8 segundos
  return NextResponse.json({ received: true });
}

// Polling de eventos (alternativa ao webhook) — usa token centralizado
export async function GET(req: NextRequest) {
  const { getIfoodToken } = await import("@/lib/ifood-api");
  const merchantId = process.env.IFOOD_MERCHANT_UUID;
  if (!merchantId) return NextResponse.json({ error: "IFOOD_MERCHANT_UUID não configurado" }, { status: 500 });

  // Obtém token via client_credentials (centralizado)
  let token: string;
  try {
    token = await getIfoodToken();
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // GET /events/v1.0/events:polling
  const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json({ events: [], error: `${res.status} ${errText}` });
  }
  // iFood events:polling can return 204 No Content or empty body
  const dataText = await res.text();
  const data = dataText ? JSON.parse(dataText) : [];

  // Encontra o franqueado vinculado a esse merchantId
  const franchisee = await prisma.user.findFirst({
    where: { ifoodMerchantId: merchantId } as any,
  });
  // Fallback: pega o primeiro usuário franqueado se nenhum tem o merchantId
  const fallbackUser = franchisee ?? await prisma.user.findFirst({
    where: { role: "FRANCHISEE" } as any,
  });

  // Processa cada evento
  for (const event of data ?? []) {
    try {
      await processIfoodEvent(event, fallbackUser?.id);
    } catch (err) {
      console.error("[iFood Polling] Erro ao processar evento:", event?.id, err);
    }
  }

  // Confirma recebimento dos eventos (acknowledgment)
  const eventIds = (data ?? []).map((e: any) => e.id);
  if (eventIds.length > 0) {
    await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventIds.map((id: string) => ({ id }))),
    });
  }

  return NextResponse.json({ processed: eventIds.length, events: data ?? [] });
}

// ─── Processa um evento do iFood ──────────────────────────────────────────
async function processIfoodEvent(event: any, franchiseeIdOverride?: string) {
  const { code, orderId, merchantId } = event;
  if (!orderId) return;

  // Pedido novo (PLACED) — cria no banco do FireHub
  if (code === "PLACED") {
    const { getIfoodToken } = await import("@/lib/ifood-api");
    const token = await getIfoodToken();

    // Busca franqueado - usa IFOOD_MERCHANT_UUID do env para consistência
    const envMerchantId = process.env.IFOOD_MERCHANT_UUID;
    let franchisee = await prisma.user.findFirst({
      where: { ifoodMerchantId: envMerchantId ?? merchantId } as any,
    });
    // Fallback: usa o franchiseeId do override ou pega o primeiro franqueado
    if (!franchisee && franchiseeIdOverride) {
      franchisee = await prisma.user.findUnique({ where: { id: franchiseeIdOverride } });
    }
    if (!franchisee) {
      franchisee = await prisma.user.findFirst({ where: { role: "FRANCHISEE" } as any });
    }
    if (!franchisee) {
      console.error(`[iFood Webhook] ❌ Nenhum franqueado encontrado para pedido ${orderId}`);
      return;
    }
    console.log(`[iFood Webhook] Usando franchisee: ${franchisee.id} para pedido ${orderId}`);

    // Busca detalhes do pedido na API usando token centralizado
    const orderData = event.data ?? await fetchIfoodOrderDetails(orderId, token);
    if (!orderData) return;

    // Verifica se já foi criado (idempotência)
    const exists = await prisma.customerOrder.findFirst({
      where: { ifoodOrderId: orderId } as any,
    });
    if (exists) return;

    // Monta os itens do pedido (simplificado para evitar erros com customizations)
    const rawItems = orderData.items ?? [];
    const items = rawItems.map((i: any) => ({
      price:    i.unitPrice ?? i.price ?? 0,
      quantity: i.quantity ?? 1,
      menuProduct: {
        connectOrCreate: {
          where: { id: `ifood-${i.id}` } as any,
          create: {
            id:           `ifood-${i.id}`,
            franchiseeId: franchisee.id,
            name:         i.name ?? i.description ?? "Item iFood",
            description:  "",
            price:        i.unitPrice ?? i.price ?? 0,
            category:     "iFood",
            active:       true,
          } as any,
        } as any,
      },
    }));

    // Total — iFood retorna em total.orderAmount ou total.subTotal
    const total = typeof orderData.total === "object"
      ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
      : (orderData.totalPrice ?? orderData.total ?? 0);

    // Pagamentos — iFood retorna em payments.methods[]
    const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
    const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

    // === Campos para homologação iFood ===
    const scheduledDatetime = orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime
      ? new Date(orderData.scheduledDatetime)
      : null;

    const cashPayment = paymentList.find((p: any) =>
      p.method === "CASH" || p.name?.toLowerCase().includes("dinheir")
    );
    const changeAmount = cashPayment?.changeFor ?? cashPayment?.cash?.changeFor ?? null;
    const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? null;
    const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

    // === DISCRIMINAÇÃO DE DESCONTOS (benefits) ===
    const benefits = orderData.benefits ?? [];
    let discountIfood = 0;
    let discountMerchant = 0;
    let discountTotal = 0;
    const discountDetails: any[] = [];

    for (const benefit of benefits) {
      const value = benefit.value ?? 0;
      discountTotal += value;

      const sponsorships = Array.isArray(benefit.sponsorshipValues)
        ? benefit.sponsorshipValues
        : benefit.sponsorshipValues ? [benefit.sponsorshipValues] : [];

      let benefitIfood = 0;
      let benefitMerchant = 0;

      for (const sp of sponsorships) {
        const spName = (sp.name ?? sp.sponsorship ?? "").toUpperCase();
        const spValue = sp.value ?? 0;
        if (spName === "IFOOD" || spName === "PARTNER" || spName === "EXTERNAL") {
          benefitIfood += spValue;
        } else if (spName === "MERCHANT") {
          benefitMerchant += spValue;
        } else {
          benefitIfood += spValue;
        }
      }

      if (sponsorships.length === 0 && value > 0) {
        const sponsor = (benefit.sponsorship ?? "").toUpperCase();
        if (sponsor === "MERCHANT") {
          benefitMerchant += value;
        } else {
          benefitIfood += value;
        }
      }

      discountIfood += benefitIfood;
      discountMerchant += benefitMerchant;

      discountDetails.push({
        target: benefit.target ?? "CART",
        value,
        ifood: benefitIfood,
        merchant: benefitMerchant,
        description: benefit.campaign?.name ?? benefit.description ?? null,
      });
    }

    const notesArr = [
      `Pedido iFood #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
      scheduledDatetime ? `📅 AGENDADO para ${scheduledDatetime.toLocaleString("pt-BR")}` : null,
      discountTotal > 0 ? `🏷️ Desconto R$${discountTotal.toFixed(2)} (iFood: R$${discountIfood.toFixed(2)} | Loja: R$${discountMerchant.toFixed(2)})` : null,
      customerNote ? `💬 ${customerNote}` : null,
    ].filter(Boolean).join(" | ");

    const payMethodName = paymentList[0]?.method ?? paymentList[0]?.name ?? "iFood Online";

    try {
      await (prisma.customerOrder as any).create({
        data: {
          franchiseeId:     franchisee.id,
          ifoodOrderId:     orderId,
          ifoodReference:   orderData.displayId ?? undefined,
          scheduledDatetime,
          changeAmount,
          customerCpfCnpj,
          discountTotal: discountTotal > 0 ? discountTotal : null,
          discountIfood: discountIfood > 0 ? discountIfood : null,
          discountMerchant: discountMerchant > 0 ? discountMerchant : null,
          discountDetails: discountDetails.length > 0 ? discountDetails : undefined,
          source:           "IFOOD",
          customerName:     orderData.customer?.name ?? "Cliente iFood",
          customerPhone:    (() => {
            const phone = orderData.customer?.phone;
            const number = phone?.number ?? (typeof phone === 'string' ? phone : '');
            const localizer = phone?.localizer;
            return localizer ? `${number} ID: ${localizer}` : number;
          })(),
          customerAddress:  orderData.delivery?.deliveryAddress?.formattedAddress ?? "",
          deliveryType:     orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
          paymentMethod:    cashPayment ? "Dinheiro" : payMethodName,
          totalAmount:      total,
          status:           "NOVO",
          notes:            notesArr,
          items:            { create: items },
        },
      });
      console.log(`[iFood] ✅ Pedido ${orderId} criado no FireHub`);
    } catch (createErr: any) {
      console.error(`[iFood] ❌ Erro ao criar pedido ${orderId}:`, createErr.message);
      throw createErr;
    }

    // Auto-confirma o pedido para o iFood (evita cancelamento por timeout)
    await autoConfirmIfoodOrder(orderId, token);
    return;
  }

  // Atualiza status de pedido existente
  const firehubStatus = STATUS_MAP[code];
  if (firehubStatus) {
    const updateData: any = { status: firehubStatus };

    // Cenário 4: registra quem cancelou
    if (code === "CANCELLED") {
      updateData.cancelledBy = "IFOOD";
    }

    await (prisma.customerOrder as any).updateMany({
      where: { ifoodOrderId: orderId } as any,
      data:  updateData,
    });
  }
}

async function fetchIfoodOrderDetails(orderId: string, token: string) {
  const res = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function autoConfirmIfoodOrder(orderId: string, token: string) {
  await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
