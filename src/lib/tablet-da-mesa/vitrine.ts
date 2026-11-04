/**
 * A vitrine do tablet: os banners do topo e os "Recomendados pela casa" que a
 * loja monta na aba Tablet na mesa, vendo a prévia (app/tablet/previa).
 *
 * Vazio = automático: o banner passa os produtos marcados como Destaque (ou as
 * ofertas) e a fileira mostra destaques e ofertas — como era antes do editor.
 *
 * Sem banco aqui: o painel, a prévia e o tablet usam a mesma limpeza.
 */

export type BannerDoTablet = {
  id: string;
  /** Foto própria do banner; vazia = a foto do produto. */
  imagem: string | null;
  /** A etiqueta amarela ("Destaque da casa", "Novidade"). */
  chapeu: string;
  /** Vazio = o nome do produto. */
  titulo: string;
  /** Vazio = a descrição do produto. */
  texto: string;
  /** O produto que abre no "Quero esse"; sem ele, o banner só mostra. */
  produtoId: string | null;
};

export type VitrineDoTablet = { banners: BannerDoTablet[]; recomendados: string[] };

export const VITRINE_AUTOMATICA: VitrineDoTablet = { banners: [], recomendados: [] };
export const MAXIMO_DE_BANNERS = 8;
export const MAXIMO_DE_RECOMENDADOS = 16;

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Foto enviada pelo painel (/uploads/…) ou endereço https; o resto cai. */
function imagemValida(v: unknown): string | null {
  const s = texto(v, 600);
  if (!s) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
}

/** O que veio do painel, limpo. `idsDaLoja`: só produtos da própria loja. */
export function limparVitrine(bruto: unknown, idsDaLoja?: Set<string>): VitrineDoTablet {
  const b: any = bruto && typeof bruto === "object" ? bruto : {};
  const produtoOk = (id: unknown) => typeof id === "string" && id.length > 0 && (!idsDaLoja || idsDaLoja.has(id));
  const banners: BannerDoTablet[] = (Array.isArray(b.banners) ? b.banners : [])
    .slice(0, MAXIMO_DE_BANNERS)
    .map((x: any, i: number) => ({
      id: texto(x?.id, 40) || `b${i}`,
      imagem: imagemValida(x?.imagem),
      chapeu: texto(x?.chapeu, 30),
      titulo: texto(x?.titulo, 60),
      texto: texto(x?.texto, 140),
      produtoId: produtoOk(x?.produtoId) ? (x.produtoId as string) : null,
    }))
    // Banner sem foto e sem produto não tem o que mostrar.
    .filter((x: BannerDoTablet) => x.imagem || x.produtoId);
  const recomendados = [...new Set<string>((Array.isArray(b.recomendados) ? b.recomendados : []).filter(produtoOk))].slice(0, MAXIMO_DE_RECOMENDADOS);
  return { banners, recomendados };
}
