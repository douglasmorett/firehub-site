import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { registrar99Food } from "@/lib/webhook-99food-log";
import { parseJson99Food } from "@/lib/json-ids-longos";
import { traduzirPedido99Food, type ItemTraduzido } from "@/lib/food99-pedido";

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
      // NÃO trocar por JSON.parse: os ids do 99Food têm 19 dígitos e o parse
      // nativo os arredonda em silêncio. Ver lib/json-ids-longos.ts.
      payload = parseJson99Food(bodyText);
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
      // O OrderModel do 99Food pode vir embrulhado (`event.order`) ou solto no
      // próprio evento. Reconhece-se pelo `order_id`, que é o único campo
      // presente nas duas formas.
      const pedidoBruto =
        event.order && typeof event.order === "object" ? event.order : event.order_id ? event : null;

      const traduzido = pedidoBruto ? traduzirPedido99Food(pedidoBruto) : null;

      // O id da loja no 99Food. `shop.shop_id` é o lugar dele no OrderModel;
      // os outros nomes cobrem evento de status, que não carrega o pedido.
      const merchantId =
        traduzido?.shopId || event.shop_id || event.merchantId || event.storeId || event.merchant?.id;

      // O app_shop_id é o identificador da loja DENTRO do vínculo — o mesmo que
      // aparece em listarLojasVinculadas(). Quando ele vem, a amarração é exata
      // e não sobra espaço para palpite; é o oposto do fallback lá embaixo, que
      // só existe porque o formulário antigo pedia um merchantId digitado à mão.
      const appShopId = traduzido?.appShopId || event.app_shop_id || event.appShopId;

      const orderId = traduzido?.orderId || event.order_id || event.orderId || event.id;
      const displayId =
        traduzido?.numeroNoParceiro || event.order_index || event.displayId || event.reference || orderId;
      const eventType = event.event || event.eventType || event.fullCode || event.code || event.status || "";

      if (!orderId) continue;

      // 1ª tentativa — app_shop_id gravado no vínculo (campo food99AppId).
      // É a amarração que a tela de conexão escreve quando o lojista escolhe a
      // loja dele na lista de vinculadas.
      let franchisee = appShopId
        ? await prisma.user.findFirst({ where: { food99AppId: String(appShopId) } })
        : null;

      // 2ª — o app_shop_id pode SER o nosso id, quando o 99Food aceita o valor
      // que mandamos. Custa uma consulta e cobre esse caso sem depender de o
      // vínculo ter sido gravado aqui antes.
      if (!franchisee && appShopId) {
        franchisee = await prisma.user.findUnique({ where: { id: String(appShopId) } }).catch(() => null);
      }

      // 3ª — shop_id do 99Food, para quem conectou pelo formulário antigo.
      if (!franchisee && merchantId) {
        franchisee = await prisma.user.findFirst({
          where: { food99MerchantId: String(merchantId), role: "FRANCHISEE" },
        });
      }

      // Loja achada pelo app_shop_id mas ainda sem o merchantId gravado: grava
      // agora. É a única hora em que o id da loja no 99Food aparece de graça, e
      // sem ele as chamadas de volta (confirmar, pronto, entregue) não têm a
      // quem se dirigir.
      if (franchisee && merchantId && !franchisee.food99MerchantId) {
        await prisma.user
          .update({ where: { id: franchisee.id }, data: { food99MerchantId: String(merchantId) } })
          .catch(() => {});
      }

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
      // Vale também quando o OrderModel veio junto, porque só o evento de
      // pedido novo carrega o pedido inteiro.
      const isNewOrder = EVENTOS_PEDIDO_NOVO.has(normalizarEvento(eventType)) || !!traduzido;

      // Evento de pedido novo SEM o pedido junto: registra o payload cru em vez
      // de descartar em silêncio. É o que permite ajustar o parser ao que o
      // 99Food realmente mandou, caso o formato mude.
      if (isNewOrder && !traduzido) {
        registrar99Food({
          tipo: eventType || "(pedido novo)",
          reconhecido: false,
          pedidoCriado: false,
          motivo: "pedido novo, mas sem OrderModel reconhecível (faltou order_id) — payload cru abaixo",
          payload: event,
        });
        console.warn(`[99Food Webhook] Pedido ${orderId} chegou em formato nao mapeado. Payload registrado em /api/99food/diagnostico`);
      }

      if (isNewOrder && traduzido) {
        const existing = await prisma.customerOrder.findFirst({
          where: { openDeliveryOrderId: orderId },
        });

        if (!existing) {
          const p = traduzido;

          const items = p.itens.map((i: ItemTraduzido) => ({
            price: i.precoUnitario,
            quantity: i.quantidade,
            // A observação do item entra junto dos complementos porque é ali
            // que a comanda da cozinha lê o que veio escrito para o prato.
            comboSelections:
              i.complementos.length > 0 || i.observacao
                ? JSON.stringify([
                    ...i.complementos,
                    ...(i.observacao ? [{ name: `Obs: ${i.observacao}`, quantity: 1, price: 0 }] : []),
                  ])
                : null,
            menuProduct: {
              connectOrCreate: {
                // O 99Food não manda o id do nosso cardápio, então o produto é
                // criado a partir do nome. `dummy_id` aqui casaria com um
                // produto real chamado assim; um id derivado do nome não.
                where: { id: `99food_${franchisee!.id}_${i.nome}`.slice(0, 190) },
                create: {
                  id: `99food_${franchisee!.id}_${i.nome}`.slice(0, 190),
                  name: i.nome,
                  price: i.precoUnitario,
                  description: "",
                  category: "99Food",
                  franchiseeId: franchisee!.id,
                },
              },
            },
          }));

          await (prisma.customerOrder as any).create({
            data: {
              franchiseeId: franchisee.id,
              dailyOrderNumber: await generateDailyOrderNumber(franchisee.id),
              customerName: p.cliente.nome,
              customerPhone: p.cliente.telefone,
              customerAddress: p.cliente.endereco,
              status: "NOVO",
              paymentMethod: p.pagamento.texto,
              totalAmount: p.total,
              deliveryFee: p.taxaEntrega,
              notes: p.observacoes,
              source: "99FOOD",
              openDeliveryOrderId: orderId,
              openDeliveryReference: displayId || "",
              openDeliveryChannel: "99FOOD",
              deliveryBy: p.entreguePor,
              items: { create: items },
            },
          });
          created++;
          registrar99Food({ tipo: eventType || "orderNew", reconhecido: true, pedidoCriado: true, payload: event });
          console.log(
            `[99Food Webhook] ✅ Pedido #${displayId} criado — ${p.itens.length} item(ns), R$ ${p.total.toFixed(2)}, ${p.entreguePor}`
          );
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
