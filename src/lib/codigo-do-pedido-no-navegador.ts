/**
 * /src/lib/codigo-do-pedido-no-navegador.ts
 *
 * O código do pedido (lib/codigo-do-pedido) do lado do cliente — é o que deixa
 * avaliar. Chega na resposta da criação do pedido ou no `?c=` dos links do
 * WhatsApp, e fica guardado neste navegador, por pedido: quem volta pelo
 * "Meus pedidos" ou pelo app da loja (a página aberta no mesmo armazenamento)
 * ainda tem o código.
 */
const CHAVE = "fh_codigos_dos_pedidos";

function guardados(): Record<string, unknown> {
  try {
    const o = JSON.parse(localStorage.getItem(CHAVE) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch { return {}; }
}

export function guardarCodigoDoPedido(orderId: string, codigo: string) {
  if (!orderId || !codigo) return;
  try {
    const todos = guardados();
    delete todos[orderId];
    todos[orderId] = codigo;
    // Os 30 mais recentes bastam.
    localStorage.setItem(CHAVE, JSON.stringify(Object.fromEntries(Object.entries(todos).slice(-30))));
  } catch { /* storage bloqueado: segue sem */ }
}

/** O código guardado deste pedido, ou "". */
export function codigoGuardado(orderId: string): string {
  const c = guardados()[orderId];
  return typeof c === "string" ? c : "";
}

/** Na página do pedido: o `?c=` do link aberto (e guarda), senão o guardado. */
export function codigoDoPedidoNoNavegador(orderId: string): string {
  try {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) { guardarCodigoDoPedido(orderId, c); return c; }
  } catch { /* URL estranha: segue sem */ }
  return codigoGuardado(orderId);
}
