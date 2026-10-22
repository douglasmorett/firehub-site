/**
 * Link do site aberto pelo app (Android App Links / iPhone Universal Links):
 * o link do garçom e o do tablet viram a tela certa do app.
 *   https://firehubfood.com.br/garcom/<loja>/celular → garçom daquela loja
 *   https://firehubfood.com.br/tablet                → tablet da mesa
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const caminho = path.replace(/^[a-z]+:\/\/[^/]+/i, "");
    const garcom = /^\/garcom\/([^/?#]+)/.exec(caminho);
    if (garcom) return `/garcom?loja=${encodeURIComponent(garcom[1])}`;
    if (/^\/tablet/.test(caminho)) return "/mesa";
    return path;
  } catch {
    return "/";
  }
}
