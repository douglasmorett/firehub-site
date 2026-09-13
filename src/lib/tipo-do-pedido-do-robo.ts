/**
 * /src/lib/tipo-do-pedido-do-robo.ts
 *
 * Entrega ou retirada, no pedido que o robô do WhatsApp anota. Sem banco e sem
 * rede de propósito: é provado por scripts/teste-tipo-do-pedido-do-robo.mjs.
 *
 * O JSON do PEDIDO_IA não traz o tipo — traz `address` e `deliveryFee`. O sinal
 * é o que a IA anotou: texto de balcão ("retirada", "vou buscar") é retirada;
 * sem endereço nenhum e sem frete também. Todo o resto é entrega.
 *
 * ── O endereço que vale é o do PEDIDO, não o da mensagem ────────────────────
 *
 * O robô grava um rascunho logo no primeiro PEDIDO_IA, antes de o cliente dar o
 * endereço, e o atualiza a cada mensagem. A regra olhava só o `address` da
 * mensagem da vez — e a atualização do rascunho nem regravava o tipo. O pedido
 * nascia RETIRADA e ficava assim com endereço, frete e nota "Entrega: 1.9 km":
 * seis na Hakim Centro entre 06 e 12/09/2026, o #50 com a cliente esperando em
 * casa. Então o endereço é o desta mensagem ou, se ela não trouxe, o que o
 * rascunho já guardou.
 */

export type TipoDoPedido = "DELIVERY" | "RETIRADA";

const FALA_DE_BALCAO = /retirad|balc[ãa]o|buscar|takeout|pickup/;

export function tipoDoPedidoDoRobo(e: {
  /** `address` do PEDIDO_IA desta mensagem. */
  enderecoDoPayload?: unknown;
  /** `customerAddress` do rascunho que esta mensagem atualiza, se houver. */
  enderecoDoRascunho?: unknown;
  /** `deliveryType`/`orderType`, se a IA escreveu um. */
  tipoInformado?: unknown;
  /** Frete já validado (número, >= 0). */
  frete: number;
}): { tipo: TipoDoPedido; endereco: string } {
  const endereco = String(e.enderecoDoPayload || e.enderecoDoRascunho || "").trim();
  const texto = `${endereco} ${e.tipoInformado || ""}`.toLowerCase();
  const retirada = FALA_DE_BALCAO.test(texto) || (!endereco && e.frete === 0);
  return { tipo: retirada ? "RETIRADA" : "DELIVERY", endereco };
}
