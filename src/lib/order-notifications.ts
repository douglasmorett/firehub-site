import { prisma } from "@/lib/prisma";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";

export type OrderNotificationType = "CREATED" | "SAIU_ENTREGA" | "PRONTO_RETIRADA" | "CANCELADO";

/**
 * Envia notificação automática do status do pedido para o cliente via WhatsApp (Evolution API).
 */
export async function sendOrderNotification(
  orderId: string,
  type: OrderNotificationType,
  extra?: { cancelReason?: string }
) {
  try {
    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            menuProduct: { select: { name: true } }
          }
        },
        franchisee: {
          select: {
            id: true,
            storeName: true,
            chatbotConfig: true,
          }
        }
      }
    });

    if (!order || !order.customerPhone) return;

    // Verificar se a loja desativou notificações automáticas de pedido nas configurações
    const chatbotConfig = (order.franchisee?.chatbotConfig as any) || {};
    if (chatbotConfig.sendOrderNotifications === false) {
      return;
    }

    // Sanitiza o telefone do cliente
    const phoneClean = order.customerPhone.replace(/\s*ID:\s*\d+/i, "").replace(/\D/g, "");
    if (!phoneClean || phoneClean.startsWith("0800") || phoneClean.length < 10) {
      return;
    }

    // Determinar o número sequencial do pedido no dia (ex: #34, #35 ou #2828 do iFood/JotaJá)
    let shortId = order.ifoodReference || order.openDeliveryReference;
    if (!shortId) {
      const orderDate = new Date(order.createdAt);
      const dayStart = new Date(orderDate);
      dayStart.setHours(0, 0, 0, 0);

      const seqCount = await prisma.customerOrder.count({
        where: {
          franchiseeId: order.franchiseeId,
          createdAt: { gte: dayStart, lte: orderDate }
        }
      });
      shortId = seqCount > 0 ? seqCount.toString() : order.id.slice(-4).toUpperCase();
    }
    const storeName = order.franchisee?.storeName || "Nossa Loja";

    // Formata o resumo dos itens
    const itemsSummary = order.items.map(item => {
      const name = item.menuProduct?.name || "Item";
      return `• ${item.quantity}x ${name}`;
    }).join("\n");

    let message = "";

    switch (type) {
      case "CREATED":
        message = `🎉 *Pedido Recebido com Sucesso!*

Olá, *${order.customerName}*! Recebemos o seu pedido em *${storeName}*!

📋 *Itens do Pedido:*
${itemsSummary}

💰 *Total:* R$ ${order.totalAmount.toFixed(2).replace(".", ",")}
🛵 *Modalidade:* ${order.deliveryType === "DELIVERY" ? "Entrega no Endereço" : "Retirada no Local"}

Seu pedido já está em processamento. Te avisaremos sobre cada atualização por aqui! 😊`;
        break;

      case "SAIU_ENTREGA":
        message = `🛵 *Pedido Saiu para Entrega!*

Olá, *${order.customerName}*! O seu pedido *#${shortId}* de *${storeName}* acabou de sair com nosso entregador e está a caminho!

📍 *Endereço:* ${order.customerAddress || "Endereço cadastrado"}

Fique atento para receber seu pedido. Bom apetite! 😋`;
        break;

      case "PRONTO_RETIRADA":
        message = `🛍️ *Pedido PRONTO para Retirada!*

Olá, *${order.customerName}*! Notícia boa: seu pedido *#${shortId}* em *${storeName}* já está PRONTO!

Você já pode vir ao restaurante para fazer a retirada. Estamos te esperando! 🏃‍♂️💨`;
        break;

      case "CANCELADO":
        const reason = extra?.cancelReason || order.cancelReason;
        const reasonText = reason ? `\n\n*Motivo:* ${reason}` : "";
        message = `❌ *Pedido Cancelado*

Olá, *${order.customerName}*. Informamos que o seu pedido *#${shortId}* em *${storeName}* foi cancelado.${reasonText}

Se tiver qualquer dúvida, basta nos responder por aqui.`;
        break;
    }

    if (message) {
      console.log(`[OrderNotification] Enviando notificação '${type}' para ${phoneClean} do pedido ${shortId}`);
      await sendEvolutionMessage(order.franchiseeId, phoneClean, message);
    }
  } catch (err: any) {
    console.error(`[OrderNotification] Erro ao enviar notificação '${type}' para pedido ${orderId}:`, err?.message || err);
  }
}
