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
 * ── O que a produção responde, medido em 12/09/2026 ─────────────────────────
 *
 * A referência da API promete `{success: true|false}` e o guia escreve
 * `{valid: true}`. Na Frangoso - Trindade, reenviando os códigos que o motoboy
 * tinha digitado:
 *
 *   código certo            200 com corpo VAZIO — e o pedido fica confirmado
 *   o mesmo código de novo  422 {"code":"ORDER_ALREADY_CONFIRMED"}
 *
 * Então 2xx é conferido, a menos que o corpo diga `false` com todas as letras.
 * E "já confirmado" também é conferido: é o toque repetido do motoboy ou o
 * cliente que confirmou antes — mandar redigitar ali prenderia o entregador
 * num código que está certo. O 422 de código errado ainda não foi visto; fica
 * como "errado" todo 422 que não seja o de já confirmado.
 */
export function lerRespostaCodigoIfood(r: { ok: boolean; status: number; data?: unknown }): ResultadoCodigo {
  const d = (r.data ?? {}) as { success?: unknown; valid?: unknown; code?: unknown };
  if (r.ok) return d.success === false || d.valid === false ? "errado" : "conferido";
  if (r.status === 422) return d.code === "ORDER_ALREADY_CONFIRMED" ? "conferido" : "errado";
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
