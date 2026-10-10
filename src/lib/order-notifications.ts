import { prisma } from "@/lib/prisma";
import { STATUS_CANCELADOS } from "./status-pedido";
import { sendEvolutionMessage } from "@/lib/whatsapp-evolution";
import { inicioDoExpedienteDaLoja } from "./fuso";
import { telefoneDeVerdade, paraEnvioWhatsApp } from "./telefone";
import { ehRetirada } from "./status-para-o-cliente";
import { linkDeAvaliacaoNoGoogle } from "./avaliacao-no-google";
import { comandaDoRobo } from "./comanda-do-robo";
import { previsaoDaEntrega } from "./previsao-da-entrega";
import { formaCanonica } from "./pagamento-na-entrega";

/**
 * A forma de pagamento como o cliente lê: o site grava "CARTAO_CREDITO",
 * "DINHEIRO", "VOUCHER_<bandeira>"; a comanda diz "Cartão Crédito".
 */
export function formaDePagamentoParaOCliente(pedido: { paymentMethod?: string | null; gatewayProvider?: string | null; gatewayPaymentId?: string | null }): string {
  const cru = String(pedido.paymentMethod || "").trim();
  if (!cru) return "";
  const forma = formaCanonica(cru.replace(/_/g, " ")) || cru;
  if (pedido.gatewayProvider || pedido.gatewayPaymentId) return `${forma} (pago online)`;
  // "PIX_ENTREGA": o Pix é na porta — só "Pix" pareceria já pago.
  return forma === "Pix" && /entrega|cobrar/i.test(cru) ? "Pix na entrega" : forma;
}

/**
 * `EM_PREPARO` é novo. A promessa feita ao cliente no "Pedido Recebido" é
 * "te avisaremos sobre cada atualização por aqui", e entre o recebido e o
 * saiu-para-entrega havia um silêncio de meia hora — justamente a janela em
 * que o cliente liga para a loja perguntando se o pedido caiu.
 */
export type OrderNotificationType = "CREATED" | "EM_PREPARO" | "SAIU_ENTREGA" | "PRONTO_RETIRADA" | "CANCELADO" | "ENTREGUE";

/**
 * O "pedido recebido" de qualquer canal: a comanda inteira, com os valores
 * gravados (ver o comentário no case "CREATED" de sendOrderNotification).
 * Exportada para o teste montar a mensagem sem mandar nada.
 */
export function comandaDoPedidoRecebido(order: any, numero: string | number | null): string {
  const previsao = previsaoDaEntrega(order);
  const cashbackUsado = Number(order.cashbackUsed) || 0;
  return comandaDoRobo({
    numero,
    status: order.status,
    cliente: order.customerName,
    itens: (order.items || []).map((item: any) => ({
      quantity: item.quantity,
      productName: item.productName || item.menuProduct?.name || "Item",
      price: Number(item.price) || 0,
      comboSelections: (item.comboSelections as any) ?? null,
      notes: item.notes,
    })),
    formaDePagamento: formaDePagamentoParaOCliente(order),
    trocoPara: order.changeAmount,
    entrega: String(order.deliveryType || "").toUpperCase() === "DELIVERY",
    taxaDeEntrega: Number(order.deliveryFee) || 0,
    endereco: order.customerAddress,
    previsao: previsao ? new Date(previsao.em) : null,
    fuso: order.franchisee?.storeTimezone,
    // O cashback já está somado no discountTotal (lib/cashback.ts).
    desconto: Math.max(0, (Number(order.discountTotal) || 0) - cashbackUsado),
    cashbackUsado,
    cashbackGerado: Number(order.cashbackEarned) || 0,
    total: Number(order.totalAmount) || 0,
  });
}

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
        // O nome do entregador no "saiu para entrega" (a roteirização já o
        // dizia; agora vale para todo caminho que despacha).
        motoboy: { select: { name: true } },
        franchisee: {
          select: {
            id: true,
            storeName: true,
            // Sem o slug o link da avaliação saía "/loja/loja/avaliar/<id>".
            slug: true,
            chatbotConfig: true,
            storeTimezone: true,
            accountGroupId: true,
          }
        }
      }
    });

    if (!order || !order.customerPhone) return;

    // ── QUEM MANDA O AVISO: A LOJA DO PEDIDO OU A PRINCIPAL DO GRUPO ────────
    // A filial que recebe um pedido aceito pela principal (Pizzaria 17 →
    // Aeroporto, 09/10/2026) não tem WhatsApp conectado: mandar por ela dava
    // 503 no gateway e o cliente ficava sem "em preparo" e "saiu para
    // entrega". Sem conexão própria, o aviso sai pela principal do grupo —
    // que é o número em que o cliente fez o pedido.
    let lojaQueEnvia = order.franchiseeId;
    const configDaLoja = (order.franchisee?.chatbotConfig as any) || {};
    if (configDaLoja.connected !== true && order.franchisee?.accountGroupId) {
      const principal = await prisma.user
        .findUnique({ where: { id: order.franchisee.accountGroupId }, select: { id: true, chatbotConfig: true } })
        .catch(() => null);
      if ((principal?.chatbotConfig as any)?.connected === true) lojaQueEnvia = principal!.id;
    }

    // Pedido que o cliente vem BUSCAR nunca "saiu para entrega". A rota de
    // status já escolhe PRONTO_RETIRADA para quem não é DELIVERY, mas qualquer
    // outro chamador que mande SAIU_ENTREGA num pedido de retirada (o status no
    // banco é o mesmo para os dois) diria ao cliente que um entregador está a
    // caminho. A correção mora aqui para valer para todos eles
    // (lib/status-para-o-cliente.ts).
    if (type === "SAIU_ENTREGA" && ehRetirada(order.deliveryType)) type = "PRONTO_RETIRADA";

    // Verificar se a loja desativou notificações automáticas de pedido nas configurações
    const chatbotConfig = (order.franchisee?.chatbotConfig as any) || {};
    if (chatbotConfig.sendOrderNotifications === false) {
      return;
    }

    // ── SÓ NÚMERO DE CLIENTE DE VERDADE ───────────────────────────────
    //
    // A verificação era feita aqui à mão e deixava passar o carimbo
    // "00000000000" que a venda de balcão e a mesa gravam quando o cliente
    // não dá o telefone: 11 dígitos, não começa com 0800, passava. Agora é
    // lib/telefone.ts, a mesma regra da campanha de recuperação.
    if (!telefoneDeVerdade(order.customerPhone)) return;
    const phoneClean = paraEnvioWhatsApp(order.customerPhone).replace(/\D/g, "");
    if (!phoneClean) return;

    // Determinar o número sequencial/referência idêntico ao exibido no painel da loja
    //
    // O corte é o EXPEDIENTE da loja. Com `setHours(0,0,0,0)` o corte caía no
    // fuso do container (UTC = 21:00 de Brasília): depois das nove a contagem
    // recomeçava do 1, e o número que ia para o cliente no WhatsApp deixava de
    // bater com o do painel — que é justamente o que esta função promete.
    const dayStart = inicioDoExpedienteDaLoja(null, new Date(order.createdAt));

    const refNum = order.openDeliveryReference || order.ifoodReference;

    const allTodayOrders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: order.franchiseeId,
        createdAt: { gte: dayStart },
        status: { notIn: [...STATUS_CANCELADOS] }
      },
      select: { id: true },
      orderBy: { createdAt: "asc" }
    });

    const orderIndex = allTodayOrders.findIndex(o => o.id === order.id);
    const dailySeqNumber = orderIndex >= 0 ? (orderIndex + 1).toString() : "";

    const shortId = refNum || (order as any).dailyOrderNumber || dailySeqNumber || order.id.slice(-4).toUpperCase();
    const storeName = order.franchisee?.storeName || "Nossa Loja";

    let message = "";

    switch (type) {
      case "CREATED": {
        // ── O "PEDIDO RECEBIDO" É A COMANDA INTEIRA ──────────────────────
        //
        // China pow (Flávio, 09/10/2026): o pedido do robô chegava ao cliente
        // com a comanda completa (lib/comanda-do-robo.ts) — itens com preço,
        // pagamento, taxa, endereço, previsão e total —, e é esse texto que
        // ele repassa no grupo dos entregadores. O pedido do SITE chegava com
        // o resumo curto ("Itens do Pedido / Total / Modalidade"), sem preço,
        // sem endereço e sem pagamento. Agora todo canal (site, balcão, o
        // rascunho do robô aceito pela loja) recebe a mesma comanda, montada
        // com os valores GRAVADOS — o que o cliente lê é o que vai ser cobrado.
        message = comandaDoPedidoRecebido(order as any, shortId);
        break;
      }

      case "EM_PREPARO":
        message = `👨‍🍳 *Seu pedido entrou na cozinha!*

Olá, *${order.customerName}*! O seu pedido *#${shortId}* em *${storeName}* já está sendo preparado.

${order.deliveryType === "DELIVERY" ? "Assim que sair para entrega, a gente te avisa por aqui. 🛵" : "Te avisamos aqui assim que estiver pronto para retirada. 🛍️"}`;
        break;

      case "SAIU_ENTREGA":
        message = `🛵 *Pedido Saiu para Entrega!*

Olá, *${order.customerName}*! O seu pedido *#${shortId}* de *${storeName}* acabou de sair com nosso entregador e está a caminho!

📍 *Endereço:* ${order.customerAddress || "Endereço cadastrado"}${(order as any).motoboy?.name ? `
🛵 *Entregador:* ${(order as any).motoboy.name}` : ""}

Muito obrigado pela preferência! Fique atento para receber o entregador. 

Bom apetite e uma ótima refeição! 😋✨`;
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

      case "ENTREGUE":
        const rawSlug = (order.franchisee as any)?.slug;
        const storeSlug = rawSlug && rawSlug !== "minha-loja" ? rawSlug : "loja";
        const baseUrl = process.env.NEXTAUTH_URL || "https://firehubfood.com.br";
        const reviewUrl = `${baseUrl.replace(/\/$/, "")}/loja/${storeSlug}/avaliar/${order.id}`;
        // Em pedido de RETIRADA ninguém entregou nada: o cliente veio buscar.
        // "Foi entregue 🛵" num pedido de balcão faz o cliente achar que houve
        // entrega — e, quando ele ainda não passou na loja, que alguém pegou o
        // pedido dele.
        const ehRetirada = order.deliveryType !== "DELIVERY";
        // Avaliação no Google, quando a loja cadastrou o link na tela do robô
        // (lib/avaliacao-no-google.ts). Vai depois da do site, no mesmo
        // agradecimento: uma mensagem só, que é o que o antispam do WhatsApp
        // tolera melhor que duas seguidas.
        const linkDoGoogle = linkDeAvaliacaoNoGoogle(chatbotConfig.googleReviewUrl);
        const pedidoDoGoogle = linkDoGoogle
          ? `\n\nE se puder deixar sua avaliação no Google também, ajuda demais a gente! 🙏\n⭐ ${linkDoGoogle}`
          : "";
        message = `${ehRetirada ? "🥳 *Pedido Retirado!*" : "🥳 *Pedido Entregue com Sucesso!*"}

Olá, *${order.customerName}*! O seu pedido *#${shortId}* de *${storeName}* ${ehRetirada ? "foi retirado! 🛍️" : "foi entregue! 🛵"}

Sua opinião é muito importante para nós! Poderia avaliar ${ehRetirada ? "a refeição" : "a refeição e a entrega"} em 5 segundos?
👉 ${reviewUrl}${pedidoDoGoogle}

Muito obrigado e bom apetite! ⭐😋`;
        break;
    }

    if (message) {
      console.log(`[OrderNotification] Enviando notificação '${type}' para ${phoneClean} do pedido ${shortId}`);
      let enviou = await sendEvolutionMessage(lojaQueEnvia, phoneClean, message);
      // Uma segunda tentativa: o gateway devolve "Timed Out" de vez em quando
      // (visto no log de 04/10) e o aviso do pedido não tinha outra chance.
      if (!enviou) {
        await new Promise((r) => setTimeout(r, 5000));
        enviou = await sendEvolutionMessage(lojaQueEnvia, phoneClean, message);
      }
      // O gateway recusa (503) quando a instância da loja não está aberta, e
      // este retorno era jogado fora: o painel dizia "conectado" e o cliente
      // ficava sem aviso, sem rastro no log do site.
      if (!enviou) {
        console.error(`[OrderNotification] ⛔ '${type}' do pedido ${shortId} NÃO saiu: o gateway recusou o envio da loja ${order.franchiseeId} (instância firehub_${order.franchiseeId.slice(-10)} fora do ar?). Reconecte o WhatsApp da loja.`);
      }
    }
  } catch (err: any) {
    console.error(`[OrderNotification] Erro ao enviar notificação '${type}' para pedido ${orderId}:`, err?.message || err);
  }
}
