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

// Polling de eventos (alternativa ao webhook)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const franchiseeId = searchParams.get("franchiseeId");
  if (!franchiseeId) return NextResponse.json({ error: "franchiseeId obrigatório" }, { status: 400 });

  // Busca o token iFood do franqueado
  const user = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { ifoodMerchantId: true, ifoodAccessToken: true } as any,
  });

  if (!(user as any)?.ifoodAccessToken) {
    return NextResponse.json({ error: "Conta do iFood não conectada" }, { status: 400 });
  }

  // GET /events/v1.0/events:polling
  const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
    method: "GET",
    headers: { Authorization: `Bearer ${(user as any).ifoodAccessToken}` },
  });

  if (!res.ok) return NextResponse.json({ events: [], error: res.statusText });
  const data = await res.json();

  // Processa cada evento
  for (const event of data ?? []) {
    await processIfoodEvent(event, franchiseeId);
  }

  // Confirma recebimento dos eventos
  const eventIds = (data ?? []).map((e: any) => e.id);
  if (eventIds.length > 0) {
    await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(user as any).ifoodAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventIds.map((id: string) => ({ id }))),
    });
  }

  return NextResponse.json({ processed: eventIds.length });
}

// ─── Processa um evento do iFood ──────────────────────────────────────────
async function processIfoodEvent(event: any, franchiseeIdOverride?: string) {
  const { code, orderId, merchantId } = event;
  if (!orderId) return;

  // Pedido novo (PLACED) — cria no banco do FireHub
  if (code === "PLACED") {
    // Busca detalhes completos do pedido
    const franchisee = await prisma.user.findFirst({
      where: { ifoodMerchantId: merchantId } as any,
    });
    if (!franchisee) return;

    const orderData = event.fullCode === "PLACED"
      ? event.data
      : await fetchIfoodOrderDetails(orderId, (franchisee as any).ifoodAccessToken);

    if (!orderData) return;

    // Verifica se já foi criado (idempotência)
    const exists = await prisma.customerOrder.findFirst({
      where: { ifoodOrderId: orderId } as any,
    });
    if (exists) return;

    // Monta os itens do pedido
    const items = (orderData.items ?? []).map((i: any) => ({
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
            price:        i.unitPrice ?? 0,
            category:     "iFood",
            active:       true,
          } as any,
        } as any,
      },
    }));

    const total = orderData.totalPrice ?? orderData.total ?? 0;

    // === Campos para homologação iFood ===
    // Cen1: data/hora do agendamento
    const scheduledDatetime = orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime
      ? new Date(orderData.scheduledDatetime)
      : null;

    // Cen5: troco e CPF/CNPJ
    const cashPayment = (orderData.payments ?? []).find((p: any) =>
      p.name?.toLowerCase().includes("dinheir") || p.method === "CASH"
    );
    const changeAmount = cashPayment?.changeFor ?? cashPayment?.cash?.changeFor ?? null;
    const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? null;

    // Observação do cliente
    const customerNote = orderData.customer?.customerNote ?? orderData.observations ?? null;

    // Voucher/benefício
    const voucherInfo = (orderData.benefits ?? [])
      .flatMap((b: any) => b.sponsorshipValues ?? [])
      .map((v: any) => `${v.name}: -R$${v.value?.toFixed(2)}`)
      .join(", ");

    const notesArr = [
      `Pedido iFood #${(orderData.displayId ?? orderId.slice(-6)).toUpperCase()}`,
      orderData.orderTiming === "SCHEDULED" ? `📅 AGENDADO para ${scheduledDatetime ? scheduledDatetime.toLocaleString("pt-BR") : "data não informada"}` : null,
      voucherInfo ? `🎟️ Voucher: ${voucherInfo}` : null,
      customerNote ? `💬 Obs. cliente: ${customerNote}` : null,
    ].filter(Boolean).join(" | ");

    await (prisma.customerOrder as any).create({
      data: {
        franchiseeId:     franchisee.id,
        ifoodOrderId:     orderId,
        ifoodReference:   orderData.displayId ?? undefined,
        scheduledDatetime,
        changeAmount,
        customerCpfCnpj,
        source:           "IFOOD",
        customerName:     orderData.customer?.name ?? "Cliente iFood",
        customerPhone:    orderData.customer?.phone ?? "",
        customerAddress:  orderData.delivery?.deliveryAddress?.formattedAddress ?? "",
        deliveryType:     orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
        paymentMethod:    cashPayment ? "Dinheiro" : (orderData.payments?.[0]?.name ?? "iFood"),
        totalAmount:      total,
        status:           "NOVO",
        notes:            notesArr,
        items:            { create: items },
      },
    });

    // Auto-confirma o pedido para o iFood (evita cancelamento por timeout)
    await autoConfirmIfoodOrder(orderId, (franchisee as any).ifoodAccessToken);
    return;
  }

  // Atualiza status de pedido existente
  const firehubStatus = STATUS_MAP[code];
  if (firehubStatus) {
    await (prisma.customerOrder as any).updateMany({
      where: { ifoodOrderId: orderId } as any,
      data:  { status: firehubStatus },
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
