/**
 * O link que a loja cola para o cliente avaliar no Google.
 *
 * Pedido do Rafa (R&D Pizzaria, 23/09/2026): o agradecimento do pedido
 * entregue já pede a avaliação no site; ele quer que peça também no Google,
 * que é onde a avaliação traz cliente novo.
 *
 * O link vem colado à mão, e o Google entrega vários formatos conforme o
 * caminho que o lojista fez: "g.page/r/.../review" (Perfil da Empresa →
 * "Pedir avaliações"), "maps.app.goo.gl/..." (Compartilhar no Maps),
 * "search.google.com/local/writereview?placeid=..." e "google.com/maps/...".
 * Aceitamos os endereços do Google e mais nada: é um link que vai, com a
 * marca da loja, para todo cliente que recebeu pedido — um link errado ou de
 * outro site ali é pior do que nenhum.
 */

const DOMINIOS_DO_GOOGLE = ["g.page", "goo.gl", "g.co", "google.com", "google.com.br"];

function ehDoGoogle(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return DOMINIOS_DO_GOOGLE.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * O link pronto para mandar ao cliente, ou null quando não há link ou ele não
 * é do Google. Sem "https://" colado, completa.
 */
export function linkDeAvaliacaoNoGoogle(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const texto = bruto.trim();
  if (!texto || /\s/.test(texto)) return null;
  const comProtocolo = /^[a-z][a-z0-9+.-]*:/i.test(texto) ? texto : `https://${texto}`;
  let url: URL;
  try {
    url = new URL(comProtocolo);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!ehDoGoogle(url.hostname)) return null;
  url.protocol = "https:";
  return url.toString();
}
