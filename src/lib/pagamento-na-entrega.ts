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

/**
 * Já está pago por um caminho eletrônico — site, app do parceiro ou gateway.
 *
 * É a metade "online" da leitura de `cobrancaNaEntrega`, separada porque é
 * também a ÚNICA coisa que impede trocar a forma de pagamento depois: o
 * dinheiro já entrou (ou entra pelo repasse), e mexer no texto só descolaria o
 * pedido do extrato. `gatewayPaymentId` preenchido é prova por si: passou por
 * Mercado Pago, PagBank ou maquininha integrada.
 */
export function ehPagoOnline(pedido: (PedidoParaCobranca & { gatewayPaymentId?: string | null }) | null | undefined): boolean {
  if (!pedido) return false;
  if (pedido.gatewayPaymentId) return true;
  const texto = String(pedido.paymentMethod || "").toLowerCase();
  const offlineExplicito =
    /dinheiro|cobrar|maquin|entrega|pendente|troco|presencial|balc/i.test(texto) ||
    pedido.isPrepaid === false ||
    pedido.prepaid === false;
  return !offlineExplicito && (
    /pago online|online|prepaid|ifood pago|jotaja pago|jotajá pago|app/i.test(texto) ||
    pedido.isPrepaid === true
  );
}

/**
 * As formas que se recebem na porta, escritas do jeito que TODOS os
 * classificadores do FireHub leem: fechamento de caixa (api/cash-session:
 * "dinheiro", "débito", "crédito", "pix", "vale"), acerto do motoboy
 * (api/motoboy-report), NFC-e automática (lib/fiscal-automatico) e a própria
 * `cobrancaNaEntrega`. Rótulo novo aqui = conferir os quatro antes.
 */
export const FORMAS_DE_PAGAMENTO_NA_ENTREGA = ["Dinheiro", "Cartão Débito", "Cartão Crédito", "Pix", "Vale-refeição"] as const;
export type FormaNaEntrega = (typeof FORMAS_DE_PAGAMENTO_NA_ENTREGA)[number];

/**
 * "Crédito (Cobrar na Entrega)" → "Cartão Crédito". Serve para pré-selecionar
 * a forma atual na tela e para não registrar troca quando o entregador só
 * confirmou o que já estava. Texto sem forma conhecida → null.
 */
export function formaCanonica(texto: string | null | undefined): FormaNaEntrega | null {
  const t = String(texto || "").toLowerCase();
  if (!t) return null;
  if (/dinheiro|cash|money|esp[eé]cie/.test(t)) return "Dinheiro";
  if (/d[eé]b/.test(t)) return "Cartão Débito";
  if (/pix/.test(t)) return "Pix";
  if (/vale|voucher|refei|aliment|meal/.test(t)) return "Vale-refeição";
  if (/cr[eé]d|cart|card|maquin/.test(t)) return "Cartão Crédito";
  return null;
}

/**
 * A forma de pagamento deste pedido pode ser trocada?
 *
 * O cliente diz "dinheiro" ao pedir e paga no débito na porta — toda noite.
 * Vale em qualquer canal e em qualquer status que não seja cancelado,
 * inclusive depois de entregue (é quando a loja descobre). Só não vale para
 * pagamento online, e mesa se acerta na conta da mesa.
 *
 * Sem import de status-pedido de propósito: este arquivo tem um gêmeo no
 * Assistente e um teste que o carrega sozinho (scripts/teste-troca-de-pagamento.mjs).
 * Todo status cancelado começa com "CANCEL" (lib/status-pedido.ts).
 */
export function podeTrocarPagamento(
  pedido: (PedidoParaCobranca & { status?: string | null; gatewayPaymentId?: string | null; tableSessionId?: string | null }) | null | undefined,
): { pode: boolean; motivo?: string } {
  if (!pedido) return { pode: false, motivo: "Pedido não encontrado." };
  if (String(pedido.status || "").toUpperCase().startsWith("CANCEL")) {
    return { pode: false, motivo: "Este pedido foi cancelado." };
  }
  // ── MESA SEM CONTA DE MESA TROCA COMO QUALQUER OUTRO ───────────────────
  //
  // O bloqueio era por `deliveryType === "MESA"`, e isso barrava demais: no
  // balcão, "Mesa 6" é só onde o cliente sentou. O pedido sai do PDV com a
  // forma de pagamento gravada NELE, vai direto para o fechamento do caixa e
  // não existe conta de mesa nenhuma para acertar — a mensagem mandava o
  // lojista para um painel onde não há nada. Medido na NIK em 22/09/2026: os
  // 12 pedidos de mesa dos últimos dois dias, todos do PDV, todos com
  // `tableSessionId` nulo, e o lápis do painel recusando a troca em todos.
  //
  // Quem manda é a CONTA: se o pedido pertence a uma sessão de mesa aberta
  // (ou é a própria conta), o acerto é lá — trocar aqui descolaria o pedido do
  // fechamento dela. Sem sessão, é um pedido como qualquer outro.
  if (pedido.kind === "CONTA_DA_MESA" || pedido.tableSessionId) {
    return { pode: false, motivo: "Conta de mesa aberta: a forma de pagamento se acerta no painel de Mesas." };
  }
  if (ehPagoOnline(pedido)) {
    return { pode: false, motivo: "Pagamento online já confirmado — não dá para trocar." };
  }
  return { pode: true };
}

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

  if (ehPagoOnline(pedido)) return nada;

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
