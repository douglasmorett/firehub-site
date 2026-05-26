import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// Throttle iFood polling — max once every 10s for fast order detection
let lastIfoodPoll = 0;

async function pollIfoodEvents() {
  const now = Date.now();
  if (now - lastIfoodPoll < 10_000) return; // Skip if polled less than 10s ago
  lastIfoodPoll = now;

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");
    const merchantId = process.env.IFOOD_MERCHANT_UUID;
    if (!merchantId) return;

    const token = await getIfoodToken();

    // Poll events from iFood
    const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;

    const events = await res.json();
    if (!events || events.length === 0) return;

    // Find franchisee for this merchant
    let franchisee = await prisma.user.findFirst({
      where: { ifoodMerchantId: merchantId } as any,
    });
    if (!franchisee) {
      franchisee = await prisma.user.findFirst({ where: { role: "FRANCHISEE" } as any });
    }

    // Process each event
    const processedEventIds: string[] = [];
    for (const event of events) {
      try {
        const { code, orderId } = event;
        if (!orderId) continue;

        // Log de debug para identificar códigos de eventos
        console.log(`[iFood Poll] Evento recebido: code=${code}, fullCode=${event.fullCode}, orderId=${orderId}`);

        // Códigos de eventos do iFood (abreviados e completos)
        const isPlaced = code === "PLC" || event.fullCode === "PLACED";
        const isConfirmed = code === "CFM" || event.fullCode === "CONFIRMED";
        const isPreparation = code === "PRP" || event.fullCode === "IN_PREPARATION" || event.fullCode === "PREPARATION_STARTED";
        const isReadyPickup = code === "RTP" || event.fullCode === "READY_TO_PICKUP";
        const isDispatched = code === "DSP" || event.fullCode === "DISPATCHED";
        const isConcluded = code === "CON" || event.fullCode === "CONCLUDED";
        const isCancelled = code === "CAN" || event.fullCode === "CANCELLED";

        // Qualquer evento de pedido ativo — criar no FireHub se não existir
        const isActiveOrderEvent = isPlaced || isConfirmed || isPreparation || isReadyPickup || isDispatched || isConcluded;

        if (isActiveOrderEvent) {
          // Check idempotency
          const exists = await prisma.customerOrder.findFirst({
            where: { ifoodOrderId: orderId } as any,
          });

          if (!exists) {
            // Pedido não existe — criar (independente do tipo de evento)
            const orderRes = await fetch(
              `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!orderRes.ok) continue;
            const orderData = await orderRes.json();

            if (!franchisee) continue;

            // Extract items
            const items = (orderData.items ?? []).map((i: any) => ({
              price: i.unitPrice ?? i.price ?? 0,
              quantity: i.quantity ?? 1,
              menuProduct: {
                connectOrCreate: {
                  where: { id: `ifood-${i.id}` } as any,
                  create: {
                    id: `ifood-${i.id}`,
                    franchiseeId: franchisee.id,
                    name: i.name ?? "Item iFood",
                    description: "",
                    price: i.unitPrice ?? i.price ?? 0,
                    category: "iFood",
                    active: true,
                  } as any,
                } as any,
              },
            }));

            // Extract total
            const total = typeof orderData.total === "object"
              ? (orderData.total?.orderAmount ?? orderData.total?.subTotal ?? 0)
              : (orderData.totalPrice ?? orderData.total ?? 0);

            // Extract payments
            const paymentMethods = orderData.payments?.methods ?? orderData.payments ?? [];
            const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];

            // Extract delivery fee from iFood
            const deliveryFeeValue = orderData.total?.deliveryFee
              ?? orderData.delivery?.deliveryFee
              ?? orderData.deliveryFee
              ?? 0;

            // === Campos para homologação iFood ===
            const scheduledDatetime = orderData.orderTiming === "SCHEDULED" && orderData.scheduledDatetime
              ? new Date(orderData.scheduledDatetime)
              : null;

            const deliveryDeadline = !scheduledDatetime && orderData.delivery?.deliveryDateTime
              ? new Date(orderData.delivery.deliveryDateTime)
              : null;

            const customerNote = orderData.delivery?.observations ?? orderData.customer?.customerNote ?? null;

            const cashPayment = paymentList.find((p: any) =>
              p.method === "CASH" || p.name?.toLowerCase().includes("dinheir")
            );
            const changeAmount = cashPayment?.changeFor ?? cashPayment?.cash?.changeFor ?? null;
            const payMethodName = paymentList[0]?.method ?? "iFood Online";
            const customerCpfCnpj = orderData.customer?.taxPayerIdentificationNumber ?? null;

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

            // Determinar status inicial baseado no evento recebido
            let initialStatus = "NOVO";
            if (isConfirmed) initialStatus = "ACEITO";
            else if (isPreparation) initialStatus = "PREPARANDO";
            else if (isReadyPickup) initialStatus = "PREPARANDO";
            else if (isDispatched) initialStatus = "SAIU_ENTREGA";
            else if (isConcluded) initialStatus = "ENTREGUE";

            await (prisma.customerOrder as any).create({
              data: {
                franchiseeId: franchisee.id,
                ifoodOrderId: orderId,
                ifoodReference: orderData.displayId ?? undefined,
                scheduledDatetime: scheduledDatetime ?? deliveryDeadline,
                changeAmount,
                customerCpfCnpj,
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
                customerAddress: orderData.delivery?.deliveryAddress?.formattedAddress ?? "",
                deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
                paymentMethod: cashPayment ? "Dinheiro" : payMethodName,
                totalAmount: total,
                deliveryFee: deliveryFeeValue,
                status: initialStatus,
                notes: notesArr,
                createdAt: orderData.createdAt ? new Date(orderData.createdAt) : undefined,
                items: { create: items },
              },
            });
            console.log(`[iFood Poll] ✅ Pedido ${orderId} criado (evento: ${code}/${event.fullCode}, status: ${initialStatus})`);

            // Auto-confirm to iFood se ainda é PLACED
            if (isPlaced) {
              await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${orderId}/confirm`,
                { method: "POST", headers: { Authorization: `Bearer ${token}` } }
              );
            }
          } else if (!isPlaced) {
            // Pedido já existe — atualizar status
            const STATUS_EVENT_MAP: Record<string, string> = {};
            if (isConfirmed) STATUS_EVENT_MAP[code] = "ACEITO";
            if (isPreparation) STATUS_EVENT_MAP[code] = "PREPARANDO";
            if (isReadyPickup) STATUS_EVENT_MAP[code] = "PREPARANDO";
            if (isDispatched) STATUS_EVENT_MAP[code] = "SAIU_ENTREGA";
            if (isConcluded) STATUS_EVENT_MAP[code] = "ENTREGUE";

            const newStatus = STATUS_EVENT_MAP[code];
            if (newStatus) {
              await (prisma.customerOrder as any).updateMany({
                where: { ifoodOrderId: orderId } as any,
                data: { status: newStatus },
              });
            }
          }
        }

        // Handle cancellations
        if (isCancelled) {
          await (prisma.customerOrder as any).updateMany({
            where: { ifoodOrderId: orderId } as any,
            data: { status: "CANCELADO", cancelledBy: "IFOOD" },
          });
        }

        // Evento processado com sucesso
        if (event.id) processedEventIds.push(event.id);
      } catch (err) {
        console.error("[iFood Poll] Erro:", err);
        // NÃO adiciona ao processedIds — evento não foi processado, será reprocessado no próximo poll
      }
    }

    // Só reconhecer eventos que foram processados com sucesso
    if (processedEventIds.length > 0) {
      await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(processedEventIds.map((id: string) => ({ id }))),
      });
      console.log(`[iFood Poll] ✅ ${processedEventIds.length}/${events.length} eventos acknowledged`);
    }
  } catch (err) {
    console.error("[iFood Poll] Erro geral:", err);
  }
}

// GET: Fast polling endpoint - returns orders + auto-polls iFood
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true }
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Poll iFood events in background (throttled to every 10s)
  pollIfoodEvents().catch(() => {});

  const orders = await prisma.customerOrder.findMany({
    where: { franchiseeId: user.id },
    include: {
      items: { include: { menuProduct: { select: { id: true, name: true, cost: true } } } },
      motoboy: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return NextResponse.json(orders);
}
