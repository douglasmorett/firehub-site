/**
 * As linhas de pagamento do WhatsApp que o motoboy recebe quando a loja
 * atribui o pedido a ele (api/customer-order/assign-motoboy).
 *
 * Pedido do Douglas (27/09/2026): a mensagem dizia o troco a levar, mas não
 * QUANTO cobrar do cliente — o motoboy saía sem saber o valor do pedido. E a
 * mensagem tinha uma leitura de pagamento própria, diferente da do app do
 * motoboy: texto que ela não reconhecia virava "✅ Pago Online", enquanto o app
 * manda cobrar; e o troco era calculado de outro jeito. Duas telas dizendo
 * coisas diferentes para o mesmo entregador sobre o mesmo pedido.
 *
 * Agora a decisão é a do app: `cobrancaNaEntrega` (lib/pagamento-na-entrega.ts)
 * — mesmo valor, mesma forma, mesmo troco. Na dúvida, cobra.
 */
import { cobrancaNaEntrega, ehPagoOnline, formaCanonica, emReais } from "./pagamento-na-entrega";

type PedidoDoMotoboy = {
  paymentMethod?: string | null;
  totalAmount?: number | null;
  changeAmount?: number | null;
  deliveryType?: string | null;
  notes?: string | null;
  gatewayPaymentId?: string | null;
  isPrepaid?: boolean | null;
  kind?: string | null;
};

/**
 * Pedido antigo ou de integração que veio SEM forma de pagamento: a
 * observação do cliente é o que resta ("troco para 50", "levar maquininha").
 * Com forma gravada, a observação não fala — "já paguei no pix, não precisa
 * de troco" não pode virar dinheiro.
 */
function comOQueAObservacaoDiz(pedido: PedidoDoMotoboy): PedidoDoMotoboy {
  const notas = String(pedido.notes || "").toUpperCase();
  const total = Number(pedido.totalAmount || 0);
  let paymentMethod = pedido.paymentMethod;
  let changeAmount = pedido.changeAmount;

  if (!String(paymentMethod || "").trim()) {
    if (/DINHEIRO|TROCO/.test(notas)) paymentMethod = "Dinheiro";
    else if (/MAQUININHA|LEVAR MAQUINA/.test(notas)) paymentMethod = "Cartão";
  }

  // "Troco para 50" na observação: é a NOTA que o cliente vai dar. Só vale se
  // for maior que o pedido — "troco 5" não é nota nenhuma.
  if (!(Number(changeAmount) > 0) && /DINHEIRO/i.test(String(paymentMethod || ""))) {
    const m = notas.match(/TROCO\s*(?:PARA|PRA|P\/)?\s*R?\$?\s*(\d+(?:[.,]\d{1,2})?)/);
    const nota = m ? parseFloat(m[1].replace(",", ".")) : 0;
    if (nota > total) changeAmount = nota;
  }

  return { ...pedido, paymentMethod, changeAmount };
}

/** As linhas de pagamento da mensagem, prontas (já com o \n de cada uma). */
export function linhasDePagamentoParaOMotoboy(pedidoBruto: PedidoDoMotoboy): string {
  const pedido = comOQueAObservacaoDiz(pedidoBruto);
  const cobranca = cobrancaNaEntrega(pedido);

  if (!cobranca.cobrar) {
    if (ehPagoOnline(pedido)) return `✅ *Pagamento:* Pago online — *NÃO cobrar nada*\n`;
    if (/fiado|anotad|caderneta/i.test(String(pedido.paymentMethod || ""))) {
      return `📒 *Pagamento:* Fiado — *NÃO cobrar*, a loja acerta depois\n`;
    }
    return `✅ *Pagamento:* *NÃO cobrar nada*\n`;
  }

  const forma = formaCanonica(cobranca.metodo);
  let linhas = `💰 *Cobrar do cliente:* ${emReais(cobranca.valor)}\n`;

  if (forma === "Dinheiro") {
    linhas += `💵 *Pagamento:* Dinheiro\n`;
    if (cobranca.trocoPara && cobranca.trocoPara < cobranca.valor) {
      // Nota menor que o pedido não existe: o canal gravou o próprio TROCO
      // nesse campo. Era como esta mensagem lia antes, e continua lendo.
      linhas += `🪙 *Troco:* levar *${emReais(cobranca.trocoPara)}*\n`;
    } else if (cobranca.trocoPara) {
      linhas += cobranca.levarDeTroco && cobranca.levarDeTroco > 0
        ? `🪙 *Troco:* cliente paga com ${emReais(cobranca.trocoPara)} — levar *${emReais(cobranca.levarDeTroco)}* de troco\n`
        : `🪙 *Troco:* cliente paga com ${emReais(cobranca.trocoPara)} — não precisa de troco\n`;
    } else {
      linhas += `🪙 *Troco:* cliente não pediu troco\n`;
    }
  } else if (forma === "Pix") {
    linhas += `📲 *Pagamento:* Pix na entrega\n`;
  } else {
    // Cartão, vale-refeição ou forma que ninguém reconhece: na dúvida, a
    // maquininha vai junto.
    linhas += `💳 *Pagamento:* ${cobranca.metodo} — levar a maquininha\n`;
  }

  return linhas;
}
