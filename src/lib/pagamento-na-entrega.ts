/**
 * Este pedido tem dinheiro para o entregador receber na porta do cliente?
 *
 * ── Por que isso é uma pergunta ────────────────────────────────────────────
 *
 * "Forma de pagamento" no FireHub é texto livre que chega de seis origens
 * diferentes — site, PDV, robô do WhatsApp, iFood, 99Food, JotaJá — e cada uma
 * escreve do seu jeito: "Crédito (Pago Online)", "Dinheiro", "Cartão na
 * entrega", "PIX", "Pago via iFood". Não existe um booleano confiável no banco
 * dizendo se já está pago. Então a decisão é por leitura do texto, e é a mesma
 * leitura em três lugares: o papel, o app do entregador e o painel.
 *
 * ── O GÊMEO NO ASSISTENTE ──────────────────────────────────────────────────
 *
 * A mesma regra existe em firehub-print-assistant/server.js (busque por
 * `isOnlinePayment`), porque o Assistente é outro programa, instalado no PC da
 * loja, e não importa nada daqui. MUDOU AQUI, MUDE LÁ. Se as duas divergirem,
 * a comanda vai dizer "PAGO — NÃO COBRAR" enquanto o app pede para o
 * entregador receber, na frente do cliente.
 *
 * ── Na dúvida, cobra ───────────────────────────────────────────────────────
 *
 * Texto que não casa com nenhum dos dois lados cai em "cobrar". Errar para
 * esse lado custa um toque a mais no app; errar para o outro custa o valor do
 * pedido, e a loja só descobre no fechamento do caixa.
 */

export type CobrancaNaEntrega = {
  /** Tem o que receber na porta do cliente. */
  cobrar: boolean;
  /** "Dinheiro", "Cartão", "PIX" — sem o parêntese explicativo. */
  metodo: string;
  /** Quanto receber. */
  valor: number;
  /** A nota que o cliente vai dar ("troco para R$ 50"). */
  trocoPara?: number;
  /** Quanto de troco o entregador precisa levar no bolso. */
  levarDeTroco?: number;
};

type PedidoParaCobranca = {
  paymentMethod?: string | null;
  totalAmount?: number | null;
  changeAmount?: number | null;
  deliveryType?: string | null;
  isPrepaid?: boolean | null;
  prepaid?: boolean | null;
  kind?: string | null;
};

export function cobrancaNaEntrega(pedido: PedidoParaCobranca | null | undefined): CobrancaNaEntrega {
  const nada: CobrancaNaEntrega = { cobrar: false, metodo: "", valor: 0 };
  if (!pedido) return nada;

  // Mesa e conta da mesa se acertam no caixa, não com o entregador.
  const tipo = String(pedido.deliveryType || "").toUpperCase();
  if (tipo === "MESA" || pedido.kind === "CONTA_DA_MESA") return nada;

  const bruto = String(pedido.paymentMethod || "");
  const texto = bruto.toLowerCase();

  // Fiado é o terceiro caso, e some entre os dois se ninguém escrever: não
  // está pago, mas TAMBÉM não se recebe na porta — a loja anota e acerta
  // depois. Mandar o entregador cobrar um cliente de fiado é constrangimento
  // na porta da casa dele.
  if (/fiado|anotad|caderneta/i.test(texto)) return nada;

  const offlineExplicito =
    /dinheiro|cobrar|maquin|entrega|pendente|troco|presencial|balc/i.test(texto) ||
    pedido.isPrepaid === false ||
    pedido.prepaid === false;

  const online = !offlineExplicito && (
    /pago online|online|prepaid|ifood pago|jotaja pago|jotajá pago|app/i.test(texto) ||
    pedido.isPrepaid === true
  );

  if (online) return nada;

  // "Crédito (Pago Online)" → "Crédito". O parêntese é explicação, não o nome
  // do meio de pagamento, e no celular do entregador ele só rouba largura.
  let metodo = bruto.replace(/\s*\([^)]*\)/g, "").trim();
  if (!metodo || metodo.toUpperCase() === "OTHER") metodo = "Cartão";

  const valor = Number(pedido.totalAmount || 0);
  const trocoPara = Number(pedido.changeAmount || 0);
  const saida: CobrancaNaEntrega = { cobrar: true, metodo, valor };

  // `changeAmount` é a NOTA que o cliente vai entregar, não o troco. O troco é
  // a diferença — e é esse número que o entregador precisa ter no bolso antes
  // de sair da loja.
  if (trocoPara > 0) {
    saida.trocoPara = trocoPara;
    saida.levarDeTroco = Math.max(0, Number((trocoPara - valor).toFixed(2)));
  }

  return saida;
}

export function emReais(v?: number | null): string {
  return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
}
