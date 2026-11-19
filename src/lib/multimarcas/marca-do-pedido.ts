/**
 * De QUAL MARCA é o pedido (Multimarcas) — para o QR da comanda e a mensagem
 * de volta levarem o cliente ao cardápio DAQUELA marca, não à loja inteira.
 *
 * Lucas (Frangoso/Braseou/Salzburg, 13/11/2026): pedido que entrou pelo iFood
 * do Braseou leva ao link do Braseou, o do Frangoso ao do Frangoso. Cada loja
 * do iFood/99 da conta é ligada a uma marca na tela do Multimarcas
 * (`MarcaDaPagina.lojas`, chaves de lib/loja-de-origem.ts); o pedido do site
 * já traz a marca no nome do item ("[BRASEOU] X-Brasa", lib/multimarcas/itens.ts).
 *
 * Browser-safe: o navegador (print.ts) e a fila da nuvem decidem igual.
 * Loja sem Multimarcas (lista vazia) = null = o link de sempre.
 */
import { chavesDeLojaDoPedido, type PedidoComOrigem } from "../loja-de-origem";

/** O que o QR precisa de cada marca: o id (vai no ?marca=), o nome (prefixo do item) e as lojas dos apps. */
export type MarcaDoQr = { id: string; nome: string; lojas: string[] };

type PedidoComItens = PedidoComOrigem & { items?: { productName?: string | null }[] | null };

export function marcaDoPedido(marcas: MarcaDoQr[] | null | undefined, pedido: PedidoComItens | null | undefined): string | null {
  if (!marcas?.length || !pedido) return null;
  // 1. A loja do iFood/99 em que o pedido entrou.
  const chaves = chavesDeLojaDoPedido(pedido);
  const pelaLoja = marcas.find((m) => m.lojas.some((k) => chaves.includes(k)));
  if (pelaLoja) return pelaLoja.id;
  // 2. Pedido do site: a marca no nome dos itens, se for UMA só.
  const achadas = new Set<string>();
  for (const item of pedido.items ?? []) {
    const nome = String(item?.productName || "").toUpperCase();
    const m = marcas.find((x) => nome.startsWith(`[${x.nome.toUpperCase()}] `));
    if (m) achadas.add(m.id);
  }
  return achadas.size === 1 ? [...achadas][0] : null;
}

/** `/loja/<slug>` com `?marca=` (ou `&marca=` quando já há query). Sem marca, o link como veio. */
export function linkComMarca(link: string, marcaId: string | null | undefined): string {
  if (!marcaId) return link;
  return `${link}${link.includes("?") ? "&" : "?"}marca=${encodeURIComponent(marcaId)}`;
}

/**
 * A mensagem de volta (recuperação) com o link da loja trocado pelo da marca.
 * Só o link EXATO da loja: um que o lojista escreveu com caminho ou query
 * ("…/loja/x/produto", "…/loja/x?cupom=") fica como ele escreveu.
 */
export function textoComLinkDaMarca(texto: string, linkDaLoja: string, marcaId: string | null | undefined): string {
  if (!marcaId || !linkDaLoja) return texto;
  const exato = new RegExp(linkDaLoja.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w/?&#=-])", "g");
  return texto.replace(exato, linkComMarca(linkDaLoja, marcaId));
}
