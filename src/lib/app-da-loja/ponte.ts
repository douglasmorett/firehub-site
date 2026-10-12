/**
 * A página da loja rodando DENTRO do app próprio (apps/loja, WebView) conta
 * ao app o que aconteceu — hoje, só "pedido feito", para o app ligar o
 * aparelho ao pedido e guardar o pedido na aba Pedidos.
 *
 * No navegador comum `window.ReactNativeWebView` não existe e isto não faz
 * nada. Pode ser chamado de qualquer componente cliente.
 */
export type MensagemParaOApp = { tipo: "PEDIDO_FEITO"; pedidoId: string; slug: string };

export function avisarOApp(msg: MensagemParaOApp): void {
  if (typeof window === "undefined") return;
  const ponte = (window as any).ReactNativeWebView;
  if (!ponte || typeof ponte.postMessage !== "function") return;
  try {
    ponte.postMessage(JSON.stringify(msg));
  } catch {
    /* o app pode ter fechado a página no meio; não muda nada para o cliente */
  }
}
