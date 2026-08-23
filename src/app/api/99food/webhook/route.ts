import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";

/**
 * POST /api/99food/webhook
 * Recebe pedidos e eventos de webhook do 99Food / OpenDelivery.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const bodyText = await req.text();
    if (!bodyText) {
      return NextResponse.json({ error: "Body vazio" }, { status: 400 });
    }

    const payload = JSON.parse(bodyText);
    const events = Array.isArray(payload) ? payload : [payload];

    console.log(`[99Food Webhook] Recebidos ${events.length} evento(s)`);

    let created = 0;
    let updated = 0;

    for (const event of events) {
      const merchantId = event.merchantId || event.storeId || event.merchant?.id;
      const orderId = event.orderId || event.id || event.order?.id;
      const displayId = event.displayId || event.orderReference || event.reference || orderId;
      const eventType = event.eventType || event.fullCode || event.code || event.status || "";

      if (!orderId) continue;

      // Buscar franqueado dono deste merchantId no 99Food
      let franchisee = merchantId
        ? await prisma.user.findFirst({
            where: { food99MerchantId: merchantId, role: "FRANCHISEE" },
          })
        : null;

      // Fallback: SO quando existe exatamente 1 franqueado com 99Food ativo.
      // Antes pegava o mais antigo com findFirst, entao um merchantId
      // desconhecido despejava o pedido na cozinha de outra loja. Com duas ou
      // mais lojas conectadas nao ha como adivinhar o dono — recusa.
      if (!franchisee) {
        const conectados = await prisma.user.findMany({
          where: { food99Connected: true, role: "FRANCHISEE" },
          select: { id: true },
          take: 2,
        });
        if (conectados.length === 1) {
          franchisee = await prisma.user.findUnique({ where: { id: conectados[0].id } });
        } else if (conectados.length > 1) {
          console.warn(
            `[99Food Webhook] merchantId "${merchantId}" nao mapeado e ha ${conectados.length}+ lojas conectadas — pedido ${orderId} recusado para nao cair na loja errada`
          );
          continue;
        }
      }

      if (!franchisee) {
        console.warn(`[99Food Webhook] Nenhum franqueado encontrado para o pedido: ${orderId}`);
        continue;
      }

      // Se for pedido criado/colocado (PLACED / NEW / ORDER_PLACED)
      const isNewOrder =
        eventType === "PLACED" ||
        eventType === "PLC" ||
        eventType === "ORDER_PLACED" ||
        eventType === "NEW" ||
        !!event.order;

      if (isNewOrder && event.order) {
        const oData = event.order;
        const existing = await prisma.customerOrder.findFirst({
          where: { openDeliveryOrderId: orderId },
        });

        if (!existing) {
          const customer = oData.customer || {};
          const delivery = oData.delivery || {};
          const address = delivery.deliveryAddress || customer.address || {};
          const payments = oData.payments?.methods || oData.payments || [];
          const pmLabel = payments[0]?.method || payments[0]?.type || "99Food";

          const payMethod = pmLabel.toUpperCase().includes("PIX")
            ? "Pix (99Food Pago Online)"
            : pmLabel.toUpperCase().includes("CREDIT") || pmLabel.toUpperCase().includes("CRÉDITO")
            ? "Cartão (99Food Pago Online)"
            : pmLabel.toUpperCase().includes("DEBIT") || pmLabel.toUpperCase().includes("DÉBITO")
            ? "Débito (99Food Pago Online)"
            : `${pmLabel} (99Food Pago Online)`;

          const totalAmount = oData.totalPrice ?? oData.total?.orderAmount ?? oData.totalAmount ?? 0;
          const deliveryFee = oData.deliveryFee?.value ?? oData.deliveryFee ?? 0;

          const items = (oData.items ?? []).map((i: any) => {
            const subs = i.options || i.subItems || i.garnishItems || [];
            const unitPrice = (i.totalPrice || i.price || 0) / (i.quantity || 1);
            return {
              price: unitPrice,
              quantity: i.quantity ?? 1,
              comboSelections: subs.length > 0
                ? JSON.stringify(subs.map((s: any) => ({ name: s.name || "", quantity: s.quantity || 1, price: s.price || 0 })))
                : null,
              menuProduct: {
                connectOrCreate: {
                  where: { id: i.id || "dummy_id" },
                  create: {
                    name: i.name || "Item 99Food",
                    price: unitPrice,
                    description: "",
                    category: "99Food",
                    franchiseeId: franchisee!.id,
                  },
                },
              },
            };
          });

          const formattedAddress = [
            address.streetName,
            address.streetNumber,
            address.neighborhood || address.district,
            address.city,
          ].filter(Boolean).join(", ") || address.formattedAddress || "";

          const dByRaw = (
            delivery.deliveredBy || delivery.deliveryBy ||
            oData.deliveredBy || oData.deliveryBy ||
            oData.logistics?.deliveryBy || oData.logistics?.deliveredBy ||
            ""
          ).toString().toUpperCase();

          const deliveryBy = (
            dByRaw.includes("99") ||
            dByRaw.includes("LOGISTICS") ||
            dByRaw.includes("PARTNER")
          ) ? "99FOOD" : "MERCHANT";

          const pickupCode = (
            delivery.pickupCode ||
            oData.pickupCode ||
            oData.driver?.pickupCode ||
            oData.logistics?.pickupCode ||
            null
          )?.toString().trim() || null;

          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchisee.id,
              dailyOrderNumber: await generateDailyOrderNumber(franchisee.id),
              customerName: customer.name || "Cliente 99Food",
              customerPhone: customer.phone?.number || customer.phone || "",
              customerAddress: formattedAddress,
              status: "NOVO",
              paymentMethod: payMethod,
              totalAmount,
              deliveryFee: typeof deliveryFee === "number" ? deliveryFee : 0,
              notes: oData.extraInfo || oData.notes || "",
              source: "99FOOD",
              openDeliveryOrderId: orderId,
              openDeliveryReference: displayId || "",
              openDeliveryChannel: "99FOOD",
              deliveryBy,
              ifoodPickupCode: pickupCode ?? undefined,
              items: { create: items },
            },
          });
          created++;
          console.log(`[99Food Webhook] ✅ Pedido #${displayId} criado!`);
        }
      } else if (orderId) {
        // Atualizações de status
        let newStatus: string | null = null;
        if (eventType === "CONFIRMED" || eventType === "CFM") newStatus = "ACEITO";
        if (eventType === "DISPATCHED" || eventType === "DSP") newStatus = "SAIU_ENTREGA";
        if (eventType === "CONCLUDED" || eventType === "CON") newStatus = "ENTREGUE";
        if (eventType === "CANCELLED" || eventType === "CAN") newStatus = "CANCELADO";

        if (newStatus) {
          await (prisma.customerOrder as any).updateMany({
            where: { openDeliveryOrderId: orderId },
            data: { status: newStatus },
          });
          updated++;
        }
      }
    }

    return NextResponse.json({ ok: true, created, updated, received: events.length });
  } catch (err: any) {
    console.error("[99Food Webhook] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
  }
}
