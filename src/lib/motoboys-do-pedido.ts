/**
 * /src/lib/motoboys-do-pedido.ts
 *
 * Quais motoboys o seletor de um pedido (ou de um lote de pedidos) oferece.
 *
 * ── Por que existe (Annalu Pizzas, 30/10/2026) ──────────────────────────────
 *
 * Em "Todas as Lojas" o painel mostra os pedidos do grupo (Annalu + Rush +
 * PasteLê) e passou a receber os motoboys do grupo (api/motoboys?daVisao=1).
 * Só que o pedido aceita apenas motoboy da loja DELE
 * (api/customer-order/assign-motoboy): o app do motoboy lista só os pedidos
 * da loja em que ele está cadastrado. Então o seletor do pedido da PasteLê
 * mostra só os motoboys da PasteLê.
 *
 * Com motoboys de uma loja só na lista (fora do "todas", o caso de quase toda
 * loja), a lista volta inteira, sem filtro — o comportamento de sempre, até
 * para pedido antigo gravado com outro `franchiseeId`.
 *
 * Sem banco: scripts/teste-motoboys-do-pedido.ts.
 */
type ComLoja = { franchiseeId?: string | null };

export function motoboysDosPedidos<M extends ComLoja>(motoboys: M[] | null | undefined, pedidos: (ComLoja | null | undefined)[]): M[] {
  const lista = motoboys || [];
  if (new Set(lista.map((m) => m.franchiseeId)).size <= 1) return lista;
  const lojas = new Set(pedidos.map((p) => p?.franchiseeId).filter(Boolean));
  return lista.filter((m) => lojas.has(m.franchiseeId));
}
