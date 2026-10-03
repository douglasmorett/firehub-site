/**
 * O que o entregador digita (ou escaneia) no campo "Loja" vira o que o login
 * do FireHub entende (api/motoboys/login acha a loja pelo slug, pelos slugs
 * antigos ou pelo nome).
 *
 * Aceita tudo o que ele tem na mão:
 *   - o link do app que a loja mandou: firehubfood.com.br/loja/frangoso/motoboy
 *   - o QR de qualquer comanda: .../loja/frangoso/motoboy?p=20261003-47
 *   - o slug ("frangoso") ou o nome ("Frangoso Trindade")
 */

export type LidoDoQr = {
  loja: string;
  /** O pedido da comanda escaneada (AAAAMMDD-numero), para puxar depois de entrar. */
  comanda: string | null;
};

/** Lê um link ou QR do FireHub. Nulo se não for de loja nenhuma. */
export function lerLinkDaLoja(texto: string): LidoDoQr | null {
  const bruto = String(texto || "").trim();
  const m = bruto.match(/\/loja\/([a-z0-9-]+)/i);
  if (!m) return null;
  const comanda = bruto.match(/[?&]p=(\d{8}-\d{1,6})/);
  return { loja: m[1].toLowerCase(), comanda: comanda ? comanda[1] : null };
}

/** O que vai no `storeSlug` do login. */
export function lojaParaOLogin(texto: string): string {
  const doLink = lerLinkDaLoja(texto);
  if (doLink) return doLink.loja;
  return texto.trim();
}

/** O código da comanda num QR (só o código, sem a loja), ou nulo. */
export function lerComanda(texto: string): string | null {
  const m = String(texto || "").match(/(\d{8}-\d{1,6})/);
  return m ? m[1] : null;
}
