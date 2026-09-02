import { prisma } from "@/lib/prisma";
import { enviarCompraParaGa4 } from "@/lib/ga4-mp";

/**
 * Dispara o `purchase` do GA4 (Measurement Protocol) para um pedido.
 *
 * Gêmeo de `src/lib/meta-purchase.ts`, e pelas MESMAS razões — as regras de
 * quando o evento nasce são de negócio, não da plataforma:
 *
 *   · pagar na entrega  → o pedido É a venda. Dispara na criação.
 *   · pagamento online  → só vira venda quando o dinheiro entra. Dispara na
 *                          confirmação; quem desiste na tela do cartão não
 *                          pode virar conversão.
 *
 * Pedido de iFood, 99Food, Jotajá, Brendi, PDV, mesa e totem nunca tocou o
 * cardápio: não há sessão do GA4 para atribuir. Mandar isso não "enriquece" o
 * relatório — cria compras órfãs de origem, que aparecem como "Direct" e
 * estragam a leitura de qual canal traz venda.
 *
 * ── A DIFERENÇA IMPORTANTE PARA O META ──────────────────────────────────────
 *
 * A CAPI casa a pessoa por telefone em SHA-256 e funciona mesmo sem cookie
 * nenhum. O GA4 não: quem identifica o visitante é o `client_id`. Pedido sem
 * `gaClientId` gravado (cliente com cookie bloqueado, pedido criado pelo robô
 * do WhatsApp, cardápio aberto antes desta versão) sai calado daqui — mandar
 * com um id inventado registraria a compra como um visitante novo sem origem,
 * que é pior do que não registrar: infla usuários e some com a atribuição.
 */

/** Origens que NÃO são conversão do cardápio da loja. */
const ORIGENS_FORA = new Set([
  "IFOOD", "99FOOD", "FOOD99", "JOTAJA", "JOTAJÁ", "BRENDI",
  "PRESENCIAL", "PDV", "MESA", "TOTEM",
]);

export async function dispararCompraNoGoogle(orderId: string): Promise<void> {
  try {
    const pedido = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true, totalAmount: true, deliveryFee: true, status: true, source: true,
        ifoodOrderId: true, openDeliveryOrderId: true,
        gaClientId: true, gaSessionId: true,
        franchisee: {
          select: { slug: true, gaMeasurementId: true, gaApiSecret: true },
        },
        items: {
          select: { menuProductId: true, productName: true, quantity: true, price: true },
        },
      },
    });
    if (!pedido) return;

    const origem = String(pedido.source || "").toUpperCase();
    if (ORIGENS_FORA.has(origem) || pedido.ifoodOrderId || pedido.openDeliveryOrderId) return;

    if (pedido.status === "AGUARDANDO_PAGAMENTO" || pedido.status === "CRIANDO_IA") return;
    if (pedido.status === "CANCELADO") return;

    const loja = pedido.franchisee;
    const measurementId = loja?.gaMeasurementId || null;
    const apiSecret = loja?.gaApiSecret || null;

    // Loja sem GA4 configurado não é erro — é loja que não mede nada por lá.
    // Sair calado evita encher o log a cada venda de cada loja.
    if (!measurementId || !apiSecret) return;

    // Sem cookie do GA4 não há a quem atribuir. Silencioso pelo mesmo motivo.
    if (!pedido.gaClientId) return;

    const r = await enviarCompraParaGa4({
      measurementId,
      apiSecret,
      orderId: pedido.id,
      valor: pedido.totalAmount || 0,
      moeda: "BRL",
      frete: pedido.deliveryFee ?? null,
      clientId: pedido.gaClientId,
      sessionId: pedido.gaSessionId,
      itens: (pedido.items || [])
        .filter((i) => i.menuProductId || i.productName)
        .map((i) => ({
          id: (i.menuProductId || i.productName) as string,
          nome: i.productName,
          quantidade: i.quantity,
          preco: i.price,
        })),
    });

    if (r.ok) {
      console.log(`[GA4 MP] purchase enviado — pedido ${pedido.id}, transação ${r.transactionId}`);
    } else {
      // Log e segue: a venda já aconteceu, e o Google não pode derrubar nada.
      console.error(`[GA4 MP] purchase falhou — pedido ${pedido.id}: ${r.erro}`);
    }
  } catch (e: any) {
    console.error(`[GA4 MP] Erro inesperado no pedido ${orderId}:`, e?.message);
  }
}
