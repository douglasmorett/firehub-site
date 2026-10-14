/**
 * QUAIS FORMAS DE PAGAMENTO NA ENTREGA O CARDÁPIO OFERECE.
 *
 * A loja liga e desliga cada forma em Minha Loja → Formas de Pagamento
 * (`paymentFees.<FORMA>.active`), mas o cardápio só lia o Voucher — e mesmo
 * desligado ele entrava pelo `else` como "🎟️ Voucher". Dinheiro, Débito e
 * Crédito nem eram lidos (Showrrascão e outra loja reclamaram, 02/10/2026).
 *
 * Loja que nunca salvou a tela (sem `paymentFees`, ou a forma sem `active`)
 * continua com tudo: só `active: false` explícito tira a forma.
 *
 * O pagamento PELO SITE (Pix/cartão no Asaas) não passa por aqui: ele é ligado
 * em Integrações → Asaas (`pixOnlineAtivo`/`cartaoOnlineAtivo`).
 */

/** A chave de `paymentFees` que manda nesta forma do cardápio. */
export function chaveDaForma(paymentMethod: unknown): "PIX" | "DINHEIRO" | "DEBITO" | "CREDITO" | "VOUCHER" | null {
  const pm = String(paymentMethod || "").toUpperCase().trim();
  if (pm === "PIX_ENTREGA") return "PIX";
  if (pm === "DINHEIRO") return "DINHEIRO";
  if (pm === "DEBITO") return "DEBITO";
  if (pm === "CREDITO") return "CREDITO";
  if (pm === "VOUCHER" || pm.startsWith("VOUCHER_")) return "VOUCHER";
  return null;
}

export function formaLigada(paymentFees: unknown, chave: string): boolean {
  return (paymentFees as any)?.[chave]?.active !== false;
}

/** As bandeiras de vale ligadas (nomes). Vazio = "Voucher" genérico. */
export function bandeirasDeValeLigadas(paymentFees: unknown): string[] {
  const brands = (paymentFees as any)?.VOUCHER?.brands;
  if (!Array.isArray(brands)) return [];
  return brands.filter((b: any) => b && b.active !== false && String(b.name || "").trim()).map((b: any) => String(b.name).trim());
}

/**
 * Esta forma, escolhida no cardápio, está desligada pela loja? Devolve o nome
 * para a frase de recusa, ou null quando pode. Forma que não é desta tela
 * (Pix/cartão pelo site, texto de outro canal) → null.
 */
export function formaDesligada(paymentFees: unknown, paymentMethod: unknown): string | null {
  const chave = chaveDaForma(paymentMethod);
  if (!chave) return null;
  const nome = { PIX: "Pix na entrega", DINHEIRO: "dinheiro", DEBITO: "débito", CREDITO: "crédito", VOUCHER: "vale/voucher" }[chave];
  if (!formaLigada(paymentFees, chave)) return nome;
  if (chave === "VOUCHER") {
    const pm = String(paymentMethod || "").trim();
    const bandeira = pm.toUpperCase().startsWith("VOUCHER_") ? pm.slice("VOUCHER_".length) : "";
    const ligadas = bandeirasDeValeLigadas(paymentFees);
    if (bandeira && Array.isArray((paymentFees as any)?.VOUCHER?.brands) && !ligadas.includes(bandeira)) return bandeira;
  }
  return null;
}

// ── "NA ENTREGA, SÓ PAGAMENTO ONLINE" (paymentFees.entregaSoOnline) ─────────
//
// Pedido da Holy Top (açaí, 14/10/2026): na entrega o motoboy não quer levar
// maquininha nem troco, então o pedido para ENTREGA só fecha pago pelo site.
// Na retirada (e na mesa/balcão) o cliente paga na loja, de qualquer forma.
// Mora em `paymentFees` como a chave `descontoOnline`: não é forma, e ninguém
// percorre as chaves de paymentFees.

/** Mesma lista fechada do servidor do pedido: o que não é retirada é entrega. */
const TIPOS_DE_RETIRADA = ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO", "MESA"];

export function ehPedidoDeEntrega(deliveryType: unknown): boolean {
  return !TIPOS_DE_RETIRADA.includes(String(deliveryType || "").trim().toUpperCase());
}

/** Pago na hora, pelo site (Asaas; o "PIX" cru é o do site, o da porta é PIX_ENTREGA). */
export function ehFormaPeloSite(paymentMethod: unknown): boolean {
  const pm = String(paymentMethod || "").toUpperCase().trim();
  return pm === "PIX" || pm === "PIX_ONLINE" || pm === "CREDITO_ONLINE" || pm === "CARTAO_ONLINE";
}

/** A loja marcou "Na entrega, só pagamento online"? */
export function entregaSoOnlineMarcada(paymentFees: unknown): boolean {
  return (paymentFees as any)?.entregaSoOnline === true;
}

export const TEXTO_ENTREGA_SO_ONLINE = "Para entrega, esta loja aceita só pagamento online";

/**
 * Este pedido deve ser recusado pela regra "na entrega, só online"? Só quando a
 * loja marcou a opção, o pedido é de entrega, a forma não é paga pelo site E a
 * loja recebe pelo site agora. Sem Pix/cartão pelo site ligado a opção não vale:
 * barrar seria fechar a entrega inteira (Asaas desconectado depois de marcar).
 */
export function formaRecusadaNaEntrega(
  paymentFees: unknown,
  paymentMethod: unknown,
  deliveryType: unknown,
  recebePeloSite: boolean,
): boolean {
  if (!recebePeloSite || !entregaSoOnlineMarcada(paymentFees)) return false;
  if (!ehPedidoDeEntrega(deliveryType)) return false;
  return !ehFormaPeloSite(paymentMethod);
}
