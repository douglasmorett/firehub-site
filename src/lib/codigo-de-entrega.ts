/**
 * /src/lib/codigo-de-entrega.ts
 *
 * O que fazer com a resposta do iFood quando o motoboy digita, na porta do
 * cliente, o código de entrega de 4 dígitos. Sem banco e sem rede de propósito:
 * é a regra que decide se o entregador fica preso no teclado ou segue, e ela é
 * provada por scripts/teste-codigo-de-entrega.mjs.
 *
 * Três desfechos, e só um prende o entregador:
 *
 *   conferido     o iFood aceitou — e é ELE que conclui o pedido (CONCLUDED).
 *                 Ninguém chama "entregue" em cima.
 *   errado        o iFood disse que o código não confere. Volta ao teclado.
 *   indisponivel  todo o resto (403, 5xx, timeout, sem credencial). A entrega
 *                 segue com aviso e o motivo fica no pedido, em
 *                 ifoodDropCodeInfo (ver a correção de 12/09/2026 em
 *                 api/motoboys/orders).
 */

export type ResultadoCodigo = "conferido" | "errado" | "indisponivel";

/**
 * iFood, `POST /order/v1.0/orders/{id}/verifyDeliveryCode` (módulo Order).
 *
 * A referência da API responde `{success: true|false}` ("Delivery was
 * successfully confirmed or not"); o guia de implementação escreve
 * `{valid: true}`. Valem os dois. 422 é como o módulo Logistics diz "código
 * errado", e continua aceito pelo mesmo motivo.
 */
export function lerRespostaCodigoIfood(r: { ok: boolean; status: number; data?: unknown }): ResultadoCodigo {
  const d = (r.data ?? {}) as { success?: unknown; valid?: unknown };
  if (r.ok && (d.success === true || d.valid === true)) return "conferido";
  if (r.status === 422 || (r.ok && (d.success === false || d.valid === false))) return "errado";
  return "indisponivel";
}

/**
 * O FireHub já mandou "saiu para entrega" ao iFood?
 *
 * Só SAIU_ENTREGA prova isso: é a transição que dispara o dispatch (painel,
 * rota e WhatsApp do motoboy). O pedido PUXADO pelo QR da comanda chega às
 * mãos do motoboy em PRONTO ou ACEITO — para o iFood ele nunca saiu da loja, e
 * o guia do módulo Order põe o despacho antes da confirmação da entrega. Nesses
 * casos quem dá baixa despacha antes de conferir.
 */
export function jaSaiuNoParceiro(status?: string | null): boolean {
  return status === "SAIU_ENTREGA" || status === "SAIU_PARA_ENTREGA";
}
