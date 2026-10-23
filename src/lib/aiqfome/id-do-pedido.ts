/**
 * lib/aiqfome/id-do-pedido.ts — o id do pedido do aiqfome no banco, e a loja que ele carrega.
 *
 * O molde é lib/cardapioweb/id-do-pedido.ts: sem coluna nova no CustomerOrder
 * (o `prisma generate` na worktree estraga o cliente das outras sessões), a
 * loja do aiqfome vai DENTRO do `openDeliveryOrderId`, que já é único no
 * banco inteiro:
 *
 *   aiqfome_<storeId>_<orderId>
 *
 * Um token do aiqfome pode liberar mais de uma loja, e várias lojas do
 * aiqfome podem cair na MESMA conta do FireHub. Com a loja no id, quem lê o
 * pedido (status de volta, fila de ações, impressora por loja de origem) sabe
 * com o token de QUAL instalação falar, sem banco. E o "senão é JotaJá" das
 * rotas de status nunca vê esse id: o canal decide antes (lib/aiqfome/status.ts).
 *
 * O aiqfome não tem mais sandbox separado (as lojas de teste ficam na
 * produção, em Tupiratins-TO) — então não há prefixo de ambiente.
 *
 * Arquivo SEM import de propósito: o navegador (lib/loja-de-origem.ts →
 * print.ts) usa o mesmo leitor que o servidor.
 */

export const PREFIXO_DO_PEDIDO_AQ = "aiqfome";

/** Ids do aiqfome são inteiros; comparados como texto, sem "_" (é o separador). */
const PEDACO = /^[0-9A-Za-z-]{1,40}$/;

function pedaco(v: unknown): string | null {
  const t = String(v ?? "").trim();
  return PEDACO.test(t) ? t : null;
}

/** O `openDeliveryOrderId` do pedido. Lança com id torto: gravar lixo no índice único é pior que não gravar. */
export function idDoPedidoAQ(storeId: string | number, orderId: string | number): string {
  const loja = pedaco(storeId);
  if (!loja) throw new Error(`id de loja do aiqfome inválido: ${JSON.stringify(storeId)}`);
  const pedido = pedaco(orderId);
  if (!pedido) throw new Error(`id de pedido do aiqfome inválido: ${JSON.stringify(orderId)}`);
  return `${PREFIXO_DO_PEDIDO_AQ}_${loja}_${pedido}`;
}

export type IdDoPedidoAQ = { storeId: string; orderId: string };

/** O caminho de volta. `_recovered` no fim é tolerado (o sufixo do resgate manual dos outros canais). */
export function lerIdDoPedidoAQ(id: string | null | undefined): IdDoPedidoAQ | null {
  const m = String(id ?? "").trim().match(/^aiqfome_([0-9A-Za-z-]{1,40})_([0-9A-Za-z-]{1,40}?)(?:_recovered)?$/);
  if (!m) return null;
  return { storeId: m[1], orderId: m[2] };
}

/** A chave de loja de origem (lib/loja-de-origem.ts): "aiqfome:53852". */
export function chaveDeOrigemAQ(storeId: string | number): string {
  return `aiqfome:${String(storeId).trim().toLowerCase()}`;
}
