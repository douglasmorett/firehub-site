import { createHmac, timingSafeEqual } from "crypto";

/**
 * /src/lib/codigo-do-pedido.ts
 *
 * O código do pedido: prova de que quem chama é o navegador que CRIOU o pedido.
 *
 * O id do pedido não é segredo (a busca por telefone, links e o acompanhamento
 * mostram), então não serve sozinho para cancelar. O código é o id assinado
 * com o NEXTAUTH_SECRET — sem coluna nova no banco: o servidor recalcula e
 * confere. Só a resposta do POST /api/customer-order o entrega.
 */

function chave(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET ausente: não dá para assinar o código do pedido.");
  return s;
}

/** ~22 caracteres base64url (128 bits do HMAC). */
export function codigoDoPedido(orderId: string): string {
  return createHmac("sha256", chave()).update(`pedido:${orderId}`).digest("base64url").slice(0, 22);
}

export function confereCodigoDoPedido(orderId: string, codigo: unknown): boolean {
  if (typeof codigo !== "string" || !codigo) return false;
  const certo = Buffer.from(codigoDoPedido(orderId));
  const veio = Buffer.from(codigo);
  return veio.length === certo.length && timingSafeEqual(veio, certo);
}

// Data da publicação do código do pedido. Pedido criado antes dela veio de uma
// página ou de um link antigo, sem código: continua valendo só com o id.
export const CORTE_DO_CODIGO = new Date("2026-10-25T03:00:00Z");

/** Veio código: tem que conferir. Não veio: só pedido criado antes do corte. */
export function autorizaPeloCodigo(orderId: string, codigo: unknown, criadoEm: Date): boolean {
  return codigo ? confereCodigoDoPedido(orderId, codigo) : criadoEm < CORTE_DO_CODIGO;
}

/** O link que vai para o cliente (acompanhamento, avaliação) levando o código em `?c=`. */
export function linkComCodigo(url: string, orderId: string): string {
  try {
    return `${url}${url.includes("?") ? "&" : "?"}c=${codigoDoPedido(orderId)}`;
  } catch (e: any) {
    // Sem o segredo não há código: o link sai sem ele (a avaliação do pedido novo recusa).
    console.warn(`[codigo-do-pedido] link do pedido ${orderId} sem código: ${e?.message || e}`);
    return url;
  }
}
