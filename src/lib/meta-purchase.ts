import { prisma } from "@/lib/prisma";
import { enviarCompraParaMeta } from "@/lib/meta-capi";

/**
 * Dispara o Purchase da API de Conversões para um pedido.
 *
 * ── QUANDO O EVENTO DEVE NASCER (e por que quase errei) ─────────────────────
 *
 * O instinto é "só depois que o pagamento confirmar". Está errado NESTE
 * negócio, e o mapeamento do código provou:
 *
 * `PAGAMENTO_ONLINE_ATIVO` está DESLIGADO (src/lib/pagamento-online.ts) — as
 * rotas de cartão e PIX devolvem 503. Então, hoje, todo pedido do cardápio é
 * "pagar na entrega": nasce ACEITO ou NOVO e `paymentPaidAt` fica NULO PARA
 * SEMPRE, porque nenhum caminho posterior o confirma. Ancorar o Purchase em
 * `confirmOrderPayment` mandaria ZERO evento para o tráfego real das lojas —
 * o gestor de tráfego abriria o Gerenciador de Eventos e não veria nada.
 *
 * A regra certa é pela NATUREZA do pedido:
 *
 *   · pagar na entrega  → o pedido É a venda. Dispara na criação.
 *   · pagamento online  → o pedido só vira venda quando o dinheiro entra.
 *                          Dispara na confirmação, nunca na criação. Se
 *                          disparasse na criação, quem desistisse na tela do
 *                          cartão viraria conversão — inflando o número e
 *                          ensinando o algoritmo a buscar mais gente que
 *                          abandona.
 *
 * ── O QUE NÃO PODE VIRAR EVENTO ─────────────────────────────────────────────
 *
 * Pedido de iFood, 99Food, Jotajá e Brendi nunca tocou o cardápio da loja: não
 * houve clique em anúncio, não há cookie, não há nada para atribuir. Mandar
 * isso polui o sinal e faz o Meta otimizar para um público que ele não
 * alcançou. Mesma coisa para PDV e mesa — venda de balcão não é conversão de
 * site.
 *
 * ── DUPLICAR É PIOR QUE NÃO MANDAR ──────────────────────────────────────────
 *
 * O `event_id` é determinístico por pedido (`purchase:<orderId>`), tanto aqui
 * quanto no navegador. O Meta usa isso para entender que os dois são o MESMO
 * evento e contar uma venda só. É também o que protege contra webhook que
 * reenvia: mandar de novo é inofensivo.
 */

/** Origens que NÃO são conversão do cardápio da loja. */
const ORIGENS_FORA = new Set([
  "IFOOD", "99FOOD", "FOOD99", "JOTAJA", "JOTAJÁ", "BRENDI",
  "PRESENCIAL", "PDV", "MESA", "TOTEM",
]);

export async function dispararCompraNoMeta(orderId: string): Promise<void> {
  try {
    const pedido = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true, totalAmount: true, status: true, source: true,
        customerName: true, customerPhone: true,
        ifoodOrderId: true, openDeliveryOrderId: true,
        franchisee: {
          select: {
            slug: true, city: true,
            metaPixelId: true, facebookPixelId: true, metaCapiToken: true,
          },
        },
        items: { select: { menuProductId: true, quantity: true, price: true } },
      },
    });
    if (!pedido) return;

    // Nunca conversão de site.
    const origem = String(pedido.source || "").toUpperCase();
    if (ORIGENS_FORA.has(origem) || pedido.ifoodOrderId || pedido.openDeliveryOrderId) return;

    // Pedido que ainda não é venda. O de pagamento online chega aqui de novo
    // pela confirmação, com o status já mudado.
    if (pedido.status === "AGUARDANDO_PAGAMENTO" || pedido.status === "CRIANDO_IA") return;
    if (pedido.status === "CANCELADO") return;

    const loja = pedido.franchisee;
    // Dois campos concorrentes no schema. O do módulo Meta Ads tem precedência;
    // `facebookPixelId` é o antigo e ainda vale para quem só preencheu ele.
    const pixelId = loja?.metaPixelId || loja?.facebookPixelId || null;
    const token = loja?.metaCapiToken || null;

    // Loja sem pixel ou sem token não é erro: é loja que não faz tráfego pago.
    // Sair calado aqui evita encher o log de toda venda de toda loja.
    if (!pixelId || !token) return;

    const r = await enviarCompraParaMeta({
      pixelId,
      token,
      orderId: pedido.id,
      valor: pedido.totalAmount || 0,
      moeda: "BRL",
      urlDaLoja: loja?.slug ? `https://firehubfood.com.br/loja/${loja.slug}` : null,
      telefone: pedido.customerPhone,
      nome: pedido.customerName,
      cidade: loja?.city || null,
      itens: (pedido.items || [])
        .filter((i) => i.menuProductId)
        .map((i) => ({ id: i.menuProductId as string, quantidade: i.quantity, preco: i.price })),
    });

    if (r.ok) {
      console.log(`[Meta CAPI] Purchase enviado — pedido ${pedido.id}, evento ${r.eventId}`);
    } else {
      // Log e segue: a venda já aconteceu, e o Meta não pode derrubar nada.
      console.error(`[Meta CAPI] Purchase falhou — pedido ${pedido.id}: ${r.erro}`);
    }
  } catch (e: any) {
    console.error(`[Meta CAPI] Erro inesperado no pedido ${orderId}:`, e?.message);
  }
}
