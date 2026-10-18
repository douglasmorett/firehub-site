/**
 * A marca na comanda (Multimarcas): o pedido do site grava cada item com o
 * nome da marca na frente — "[SMASH DA VILA] Smash em dobro" — e os itens
 * agrupados por marca, na ordem das marcas da página. É o `productName` que a
 * comanda, o KDS e o painel mostram (lib/nome-do-item.ts), então funciona em
 * qualquer versão do Assistente de impressão, sem instalar nada. O que é "para
 * acompanhar" (bebida, sobremesa) fica sem marca, no fim.
 */
import type { ConfigDaPagina } from "./pagina";
import { chaveDaCategoria } from "./pagina";

type ItemComNome = { menuProductId?: string | null; productName?: string | null };

/** Puro, para o teste. `categoriaDoProduto`: id do produto → categoria. */
export function itensComMarca<T extends ItemComNome>(itens: T[], categoriaDoProduto: Map<string, string>, config: Pick<ConfigDaPagina, "marcas">): T[] {
  const visiveis = config.marcas.filter((m) => !m.oculta);
  const ordem = new Map(visiveis.map((m, i) => [m.id, i]));
  const dono = new Map<string, (typeof visiveis)[number]>();
  for (const m of visiveis) for (const c of m.categorias) dono.set(chaveDaCategoria(c), m);

  const marcados = itens.map((item, i) => {
    const cat = item.menuProductId ? categoriaDoProduto.get(item.menuProductId) : undefined;
    const marca = cat !== undefined ? dono.get(chaveDaCategoria(cat)) : undefined;
    if (!marca) return { item, i, pos: Number.MAX_SAFE_INTEGER };
    const prefixo = `[${marca.nome.toUpperCase()}] `;
    const nome = String(item.productName || "");
    return { item: nome.startsWith(prefixo) ? item : { ...item, productName: prefixo + nome }, i, pos: ordem.get(marca.id)! };
  });
  if (!marcados.some((x) => x.pos !== Number.MAX_SAFE_INTEGER)) return itens;
  return marcados.sort((a, b) => a.pos - b.pos || a.i - b.i).map((x) => x.item);
}

/** Com o banco: só se o Multimarcas está ligado e a página tem marcas. Nunca lança — na dúvida, os itens como vieram. */
export async function aplicarMarcasNosItens<T extends ItemComNome>(
  franchiseeId: string,
  itens: T[],
  produtos: { id: string; category?: string | null }[],
): Promise<T[]> {
  try {
    const { multimarcasEstaLigado } = await import("./assinatura");
    if (!(await multimarcasEstaLigado(franchiseeId))) return itens;
    const { lerConfigDaPagina } = await import("./pagina");
    const config = await lerConfigDaPagina(franchiseeId);
    if (!config || !config.marcas.length) return itens;
    return itensComMarca(itens, new Map(produtos.map((p) => [p.id, String(p.category || "")])), config);
  } catch (err: any) {
    console.error("[Multimarcas] marca nos itens falhou:", err?.message);
    return itens;
  }
}
