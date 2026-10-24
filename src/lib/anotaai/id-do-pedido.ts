/**
 * lib/anotaai/id-do-pedido.ts — o id do pedido do Anota AI no banco, e a loja que ele carrega.
 *
 * Mesmo raciocínio do CardápioWeb (lib/cardapioweb/id-do-pedido.ts): sem
 * coluna nova no CustomerOrder, a loja do Anota AI (a "página", `idpage`) vai
 * DENTRO do `openDeliveryOrderId`, que já é único no banco inteiro:
 *
 *   anotaai_<pageId>_<orderId>
 *
 * Com isso o "pronto" volta para lá com o `x-page-id` certo sem ler banco, e
 * uma conta com duas marcas no Anota AI (duas páginas) não mistura pedido.
 * Os dois ids do Anota AI são ObjectId do Mongo (24 hex); aceitamos letra,
 * número e hífen, nunca "_".
 *
 * Arquivo SEM import de propósito: o navegador (lib/loja-de-origem.ts) pode
 * usar o mesmo leitor que o servidor.
 */

export const PREFIXO_DO_PEDIDO_ANOTAAI = "anotaai";

const PEDACO = /^[0-9A-Za-z-]{1,40}$/;

function pedaco(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return PEDACO.test(t) ? t : null;
}

/** O `openDeliveryOrderId` do pedido. Lança com id torto: lixo no índice único é pior que não gravar. */
export function idDoPedidoAnotaAi(pageId: string, orderId: string): string {
  const pagina = pedaco(pageId);
  const pedido = pedaco(orderId);
  if (!pagina) throw new Error(`id de loja do Anota AI inválido: ${JSON.stringify(pageId)}`);
  if (!pedido) throw new Error(`id de pedido do Anota AI inválido: ${JSON.stringify(orderId)}`);
  return `${PREFIXO_DO_PEDIDO_ANOTAAI}_${pagina}_${pedido}`;
}

export type IdDoPedidoAnotaAi = { pageId: string; orderId: string };

/** O caminho de volta. `_recovered` no fim é tolerado (sufixo do resgate manual dos outros canais). */
export function lerIdDoPedidoAnotaAi(id: string | null | undefined): IdDoPedidoAnotaAi | null {
  const m = String(id ?? "").trim().match(/^anotaai_([0-9A-Za-z-]{1,40})_([0-9A-Za-z-]{1,40}?)(?:_recovered)?$/);
  return m ? { pageId: m[1], orderId: m[2] } : null;
}
