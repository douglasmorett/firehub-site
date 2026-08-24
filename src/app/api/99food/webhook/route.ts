import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { registrar99Food } from "@/lib/webhook-99food-log";

/**
 * POST /api/99food/webhook
 * Recebe pedidos e eventos de webhook do 99Food.
 *
 * ── A resposta é parte do protocolo ─────────────────────────────────────────
 * O 99Food só considera a entrega bem-sucedida se receber EXATAMENTE
 * `{"errno": 0, "errmsg": "ok"}` dentro de 6 segundos. Qualquer outra coisa —
 * inclusive um 200 com outro corpo — conta como falha, e ele reenvia o mesmo
 * evento várias vezes.
 *
 * Esta rota respondia `{"ok": true, "created": ...}`. Ou seja: mesmo que os
 * pedidos estivessem chegando, o 99Food os trataria como não entregues e
 * entraria em reenvio.
 *
 * ── Os nomes dos eventos também estavam errados ─────────────────────────────
 * O código procurava PLACED / PLC / ORDER_PLACED / CONCLUDED / DSP — que são
 * convenções do iFood e do OpenDelivery. O 99Food manda orderNew, orderCancel,
 * orderFinish, deliveryStatus, orderCancelApply, orderRefundApply e
 * orderPartialCancel. Os nomes antigos ficam aceitos junto, porque não custa
 * nada e cobre payload de teste montado no padrão antigo.
 *
 * Fonte: developer-food.99app.com/pt-BR/openapi (Integration Guide).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A única resposta que o 99Food aceita como "recebido". */
const ACK = { errno: 0, errmsg: "ok" };

/** Nome de evento normalizado, sem caixa nem separador, para comparar. */
function normalizarEvento(bruto: string): string {
  return (bruto || "").toString().toLowerCase().replace(/[^a-z]/g, "");
}

const EVENTOS_PEDIDO_NOVO = new Set([
  "ordernew",                                    // 99Food
  "placed", "plc", "orderplaced", "new",         // iFood / OpenDelivery
]);

/** Evento de mudança de status → status interno do FireHub. */
function statusDoEvento(evento: string): string | null {
  switch (normalizarEvento(evento)) {
    case "ordercancel":
    case "orderpartialcancel":
    case "cancelled":
    case "can":
      return "CANCELADO";
    case "orderfinish":
    case "concluded":
    case "con":
      return "ENTREGUE";
    case "deliverystatus":
    case "dispatched":
    case "dsp":
      return "SAIU_ENTREGA";
    case "confirmed":
    case "cfm":
      return "ACEITO";
    default:
      return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const bodyText = await req.text();
    if (!bodyText) {
      // Corpo vazio ainda recebe ACK: reenviar nao vai fazer aparecer.
      return NextResponse.json(ACK);
    }

    // Payload ilegível é o único erro que merece ACK: reenviar o mesmo texto
    // quebrado dez vezes não o conserta. Erro NOSSO, mais abaixo, é o oposto —
    // ali o reenvio é justamente o que salva o pedido.
    let payload: any;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      console.error("[99Food Webhook] Corpo não é JSON válido:", bodyText.slice(0, 300));
      registrar99Food({
        tipo: "json-invalido",
        reconhecido: false,
        pedidoCriado: false,
        motivo: "corpo recebido não é JSON válido",
        payload: bodyText.slice(0, 1000),
      });
      return NextResponse.json(ACK);
    }

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

      // Pedido novo: orderNew (99Food) ou os nomes do iFood/OpenDelivery.
      const isNewOrder = EVENTOS_PEDIDO_NOVO.has(normalizarEvento(eventType)) || !!event.order;

      // Evento de pedido novo SEM o objeto do pedido no formato esperado:
      // registra o payload cru. E assim que o formato real do 99Food aparece,
      // em vez de a gente adivinhar a estrutura e errar em silencio.
      if (isNewOrder && !event.order) {
        registrar99Food({
          tipo: eventType || "(pedido novo)",
          reconhecido: false,
          pedidoCriado: false,
          motivo: "pedido novo, mas sem campo event.order no formato esperado — payload cru abaixo",
          payload: event,
        });
        console.warn(`[99Food Webhook] Pedido ${orderId} chegou em formato nao mapeado. Payload registrado em /api/store/integracoes/99food`);
      }

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
          registrar99Food({ tipo: eventType || "orderNew", reconhecido: true, pedidoCriado: true, payload: event });
          console.log(`[99Food Webhook] ✅ Pedido #${displayId} criado!`);
        }
      } else if (orderId) {
        // Atualizações de status
        const newStatus = statusDoEvento(eventType);

        if (newStatus) {
          await (prisma.customerOrder as any).updateMany({
            where: { openDeliveryOrderId: orderId },
            data: { status: newStatus },
          });
          updated++;
        }

        registrar99Food({
          tipo: eventType || "(sem tipo)",
          reconhecido: !!newStatus,
          pedidoCriado: false,
          motivo: newStatus ? `status → ${newStatus}` : "evento não reconhecido",
          payload: event,
        });
      }
    }

    console.log(`[99Food Webhook] ${events.length} evento(s): ${created} pedido(s) criado(s), ${updated} atualizado(s)`);
    return NextResponse.json(ACK);
  } catch (err: any) {
    // Falha NOSSA (banco fora, bug no parser). Aqui NÃO se manda ACK de
    // propósito: o reenvio do 99Food é a única coisa entre um pedido e a
    // cozinha nunca saber dele. Perder o pedido em silêncio é pior do que
    // receber o mesmo evento duas vezes — a criação já é idempotente por
    // openDeliveryOrderId.
    console.error("[99Food Webhook] Erro ao processar:", err);
    registrar99Food({ tipo: "erro", reconhecido: false, pedidoCriado: false, motivo: err?.message, payload: null });
    return NextResponse.json({ errno: 1, errmsg: err?.message || "erro interno" }, { status: 500 });
  }
}
