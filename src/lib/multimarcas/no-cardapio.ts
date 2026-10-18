/**
 * O Multimarcas dentro do cardápio da loja (/loja/<slug>?marca=<id>): o que
 * o cardápio precisa saber das marcas e a regra de quais categorias aparecem.
 * Sem banco: o CustomerStorePage importa.
 */
import type { ConfigDaPagina } from "./pagina";

export type MarcasNoCardapio = {
  marcas: { id: string; nome: string; logo: string | null; capa: string | null; cor: string; categorias: string[] }[];
};

const chave = (n: string | null | undefined) => String(n || "").trim().toLowerCase();

/** Só as marcas visíveis, com o que o cardápio usa. */
export function marcasNoCardapio(config: Pick<ConfigDaPagina, "marcas">): MarcasNoCardapio | null {
  const marcas = config.marcas.filter((m) => !m.oculta).map((m) => ({ id: m.id, nome: m.nome, logo: m.logo, capa: m.capa, cor: m.cor, categorias: m.categorias }));
  return marcas.length ? { marcas } : null;
}

/**
 * A categoria aparece no cardápio aberto pela marca? Sim se é da marca, ou se
 * não é de nenhuma marca ("para acompanhar": bebida, sobremesa). Puro.
 */
export function categoriaEntraNaMarca(mm: MarcasNoCardapio, marcaId: string, categoria: string | null | undefined): boolean {
  const k = chave(categoria);
  for (const m of mm.marcas) if (m.categorias.some((c) => chave(c) === k)) return m.id === marcaId;
  return true;
}

/** "Smash da Vila" → "SV". */
export function siglaDaMarca(nome: string): string {
  const p = nome.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter((x) => x.length > 2);
  const u = p.length ? p : nome.split(/\s+/);
  return ((u[0]?.[0] ?? "?") + (u[1]?.[0] ?? "")).toUpperCase();
}
