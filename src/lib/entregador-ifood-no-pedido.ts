/**
 * "Chamar entregador iFood" no card do pedido do canal próprio (site, robô,
 * balcão, WhatsApp) — o módulo SHIPPING, homologado no app distribuído em
 * 12/11/2026 (chamado #36173941).
 *
 * O caminho é o mesmo da aba Shipping da homologação (lib/ifood-shipping.ts):
 * cotação pela coordenada do cliente → a loja vê o custo → confirma → o pedido
 * é registrado no iFood (salesChannel=POS) e ligado ao pedido da loja em
 * "IfoodShippingPedido", para o polling não importá-lo de novo
 * (lib/ifood-sob-demanda.ts).
 *
 * Este arquivo é puro (sem banco) para a tela e a rota usarem a mesma régua.
 */
import type { EntradaPedido, Endereco, PagamentoPedido } from "./ifood-shipping";
import { cobrancaNaEntrega } from "./pagamento-na-entrega";

/** Canais que já trazem entregador próprio (o app do parceiro entrega ou não). */
const MARKETPLACES = new Set(["IFOOD", "99FOOD", "KEETA", "JOTAJA", "BRENDI", "AIQFOME", "ANOTAAI", "CARDAPIOWEB"]);
const STATUS_QUE_PODEM = new Set(["NOVO", "ACEITO", "PREPARANDO", "PRONTO"]);

type PedidoParaEntregador = {
  status?: string | null;
  deliveryType?: string | null;
  source?: string | null;
  ifoodOrderId?: string | null;
  openDeliveryChannel?: string | null;
  motoboyId?: string | null;
  ifoodDriverStatus?: string | null;
  deliveryBy?: string | null;
};

/**
 * Por que o botão NÃO aparece — ou null quando aparece. Uma regra só para o
 * card e para a rota.
 */
export function motivoParaNaoChamar(o: PedidoParaEntregador | null | undefined): string | null {
  if (!o) return "Pedido não encontrado.";
  if (String(o.deliveryType || "").toUpperCase() !== "DELIVERY") return "Só pedido de entrega.";
  const canal = String(o.openDeliveryChannel || o.source || "").toUpperCase();
  if (o.ifoodOrderId || MARKETPLACES.has(canal)) return "Pedido de aplicativo: a entrega é tratada pelo próprio app.";
  if (!STATUS_QUE_PODEM.has(String(o.status || "").toUpperCase())) return "O pedido já saiu, foi entregue ou cancelado.";
  if (o.motoboyId) return "Já tem motoboy da loja neste pedido.";
  if (o.ifoodDriverStatus || o.deliveryBy) return "O entregador já foi chamado.";
  return null;
}

/** Telefone do pedido → DDD + número, sem o 55. */
export function telefoneParaIfood(texto: unknown): { ddd: string; numero: string } | null {
  let d = String(texto ?? "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return { ddd: d.slice(0, 2), numero: d.slice(2) };
}

/** Bandeira para cartão na porta: a primeira que a cotação aceita para aquele método. */
function bandeiraAceita(cotacao: any, metodo: "CREDIT" | "DEBIT"): string {
  const m = (cotacao?.paymentMethods ?? []).find((p: any) => String(p?.method).toUpperCase() === metodo && p?.brand);
  return String(m?.brand || "VISA");
}

/**
 * Como o entregador do iFood recebe. Na porta: dinheiro (com o troco) ou
 * cartão. Pago antes (site, Pix): ⚠️ "ONLINE" ainda NÃO foi confirmado na loja
 * de teste — a homologação só gravou CASH/CREDIT/DEBIT. Perguntar ao iFood
 * antes de publicar (vault: Homologação iFood).
 */
export function pagamentoParaIfood(pedido: any, cotacao: any): PagamentoPedido {
  const c = cobrancaNaEntrega(pedido);
  if (!c.cobrar) return { metodo: "ONLINE", bandeira: bandeiraAceita(cotacao, "CREDIT") };
  const m = c.metodo.toLowerCase();
  if (m.includes("dinheiro")) return { metodo: "CASH", trocoPara: c.trocoPara ?? null };
  const tipo = m.includes("déb") || m.includes("deb") ? "DEBIT" : "CREDIT";
  return { metodo: tipo, bandeira: bandeiraAceita(cotacao, tipo) };
}

/**
 * O pedido da loja no formato que o iFood registra. Os itens vão como UMA
 * linha com o valor do pedido sem a taxa: o iFood confere total = itens + taxa,
 * e o entregador cobra exatamente o que o cliente deve — desconto, cupom e
 * acréscimo já estão no total do FireHub.
 */
export function entradaDoPedido(
  pedido: { totalAmount: number; deliveryFee?: number | null; customerName?: string | null; customerPhone?: string | null; dailyOrderNumber?: number | null; id: string },
  endereco: Endereco,
  pagamento: PagamentoPedido,
  quoteId: string,
): EntradaPedido {
  const tel = telefoneParaIfood(pedido.customerPhone);
  const taxa = Math.max(0, Number(pedido.deliveryFee) || 0);
  const itens = Math.max(0, Math.round((Number(pedido.totalAmount) - taxa) * 100) / 100);
  const numero = pedido.dailyOrderNumber ? `#${pedido.dailyOrderNumber}` : `#${pedido.id.slice(-6).toUpperCase()}`;
  return {
    cliente: { nome: pedido.customerName || "Cliente", ddd: tel?.ddd ?? "", numero: tel?.numero ?? "" },
    endereco,
    itens: [{ nome: `Pedido ${numero}`, quantidade: 1, precoUnitario: itens }],
    pagamento,
    quoteId,
    taxaEntrega: taxa,
    preparoMin: 0,
  };
}
