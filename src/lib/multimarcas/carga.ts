/**
 * Monta a vitrine do Multimarcas a partir da loja de verdade: o cardápio do
 * delivery (o mesmo de /loja/<slug>, lib/cardapio-publico.ts), as marcas que o
 * dono montou (lib/multimarcas/pagina.ts), a nota de cada marca e se a loja
 * está aberta. Usado pela página pública /marcas/<slug> e pela prévia do editor.
 */
import { prisma } from "@/lib/prisma";
import { propsDoCardapio } from "@/lib/cardapio-publico";
import { estadoDaLoja } from "@/lib/loja-aberta";
import { filtroDoCardapio, minimoDeEstrelas } from "@/lib/avaliacoes-no-cardapio";
import { ordenarComoALoja } from "@/lib/cardapio-da-loja";
import { comPrazoDaExtensao } from "@/lib/prazo-automatico";
import { disponivelAgora } from "@/lib/cardapio-interno";
import { chaveDaCategoria, mapaDeCategorias, type ConfigDaPagina } from "./pagina";
import { MARCA_DOS_EXTRAS, type ConfigDaVitrine, type ProdutoDaVitrine } from "./vitrine";

/**
 * Nota de cada marca: a média das avaliações dos pedidos que tiveram item da
 * marca (um pedido com duas marcas conta para as duas; categoria que está em
 * várias marcas conta para cada uma delas). Mesmas regras do
 * cardápio: só se a loja mostra avaliações, e só as de nota mínima que ela
 * escolheu. Puro, para o teste.
 */
export function notasPorMarca(
  avaliacoes: { rating: number; categorias: (string | null | undefined)[] }[],
  mapa: Map<string, string[]>,
): Map<string, { media: number; total: number }> {
  const soma = new Map<string, { s: number; n: number }>();
  for (const a of avaliacoes) {
    const marcas = new Set(a.categorias.flatMap((c) => mapa.get(chaveDaCategoria(c || "")) ?? []));
    for (const m of marcas) {
      const x = soma.get(m) ?? { s: 0, n: 0 };
      x.s += a.rating;
      x.n += 1;
      soma.set(m, x);
    }
  }
  return new Map([...soma].map(([m, x]) => [m, { media: Math.round((x.s / x.n) * 10) / 10, total: x.n }]));
}

/**
 * O item vai para "Promoções do dia"? A mesma regra do botão Ofertas do
 * cardápio (promoProducts em components/customer/CustomerStorePage.tsx): o
 * preço promocional de verdade (`precoDe`, já resolvido para o delivery), a
 * promoção só numa opção, ou a etiqueta/nome "promo" que as lojas usavam antes
 * do campo existir. Esgotado e fora do dia/horário não entram (com agendamento
 * ligado o cardápio vem inteiro). Puro, para o teste.
 */
export function emPromocao(p: any, timeZone?: string | null): boolean {
  if (!p || p.esgotado === true || !disponivelAgora(p, timeZone)) return false;
  if (Number(p.precoDe) > 0) return true;
  if ((p.comboGroups || []).some((g: any) => (g?.items || []).some((i: any) => Number(i?.adicionalDe) > 0))) return true;
  const tags = String(p.tags || "");
  return tags.includes("Promoção") || tags.includes("Oferta")
    || String(p.name || "").toLowerCase().includes("promo") || String(p.category || "").toLowerCase().includes("promo");
}

async function avaliacoesComCategorias(franchisee: any) {
  if (franchisee.showReviewsOnMenu === false) return null;
  const desde = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const linhas = await prisma.storeReview.findMany({
    where: { franchiseeId: franchisee.id, createdAt: { gte: desde }, ...filtroDoCardapio(minimoDeEstrelas(franchisee.reviewsMinStars)) },
    select: { rating: true, order: { select: { items: { select: { menuProduct: { select: { category: true } } } } } } },
    take: 2000,
    orderBy: { createdAt: "desc" },
  }).catch(() => []);
  return linhas.map((l: any) => ({ rating: l.rating, categorias: (l.order?.items ?? []).map((i: any) => i.menuProduct?.category) }));
}

/**
 * Prazo da entrega pelas áreas da loja: o menor e o maior tempo (o maior + 15,
 * como o checkout mostra). Recebe as áreas JÁ com o prazo automático do iFood
 * somado (comPrazoDaExtensao): sem ele, o topo da página dizia o tempo
 * cadastrado enquanto o checkout, o robô e o iFood diziam o da fila (Lucas,
 * Frangoso, 11/11/2026: "não está atualizando no site, está ficando diferente").
 */
function prazoDasAreas(zonas: unknown): { min: number | null; max: number | null } {
  const tempos = (Array.isArray(zonas) ? zonas : []).map((z: any) => Number(z?.time)).filter((t) => t > 0 && t < 300);
  if (!tempos.length) return { min: null, max: null };
  return { min: Math.min(...tempos), max: Math.max(...tempos) + 15 };
}

export async function vitrineDaLoja(franchisee: any, config: ConfigDaPagina): Promise<{ config: ConfigDaVitrine; produtos: ProdutoDaVitrine[] }> {
  const [cardapio, avaliacoes] = await Promise.all([propsDoCardapio(franchisee, "delivery"), avaliacoesComCategorias(franchisee)]);
  const mapa = mapaDeCategorias(config);
  const notas = avaliacoes ? notasPorMarca(avaliacoes, mapa) : new Map();
  const estado = estadoDaLoja({ storeHours: franchisee.storeHours, storePause: franchisee.storePause, storeOpen: franchisee.storeOpen, timezone: franchisee.storeTimezone });
  const dc = (franchisee.deliveryConfig || {}) as any;

  // O banco entrega os produtos por NOME da categoria; a página segue a ordem
  // que a loja escolheu em "Reordenar Cardápio" (Lucas, 23/10: "vai para a
  // ordem alfabética, não vai na ordem que a gente tem").
  const ordem = new Map(((cardapio.storeCategories as any[]) || []).map((c, i) => [chaveDaCategoria(c.name), i]));
  const produtos: ProdutoDaVitrine[] = ordenarComoALoja(((cardapio.menuProducts as any[]) || []), ordem).map((p: any) => ({
    id: String(p.id),
    marca: mapa.get(chaveDaCategoria(p.category))?.[0] ?? MARCA_DOS_EXTRAS,
    marcas: mapa.get(chaveDaCategoria(p.category)) ?? [],
    categoria: String(p.category || ""),
    nome: String(p.name || ""),
    descricao: String(p.description || ""),
    preco: Number(p.price) || 0,
    precoDe: Number(p.precoDe) > Number(p.price) ? Number(p.precoDe) : null,
    promocao: emPromocao(p, franchisee.storeTimezone),
    foto: p.imageUrl || null,
  }));

  return {
    produtos,
    config: {
      nome: config.nome,
      frase: config.frase,
      local: franchisee.city || "",
      cor: config.cor,
      logo: franchisee.storeLogo || null,
      avisoFechada: estado.aberta ? undefined : estado.texto,
      entrega: { taxa: null, ...prazoDasAreas(comPrazoDaExtensao(franchisee).deliveryZones), minimo: Number(dc.minimumOrderValue) || 0 },
      marcas: config.marcas.map((m) => ({
        id: m.id, nome: m.nome, tipo: m.tipo, cor: m.cor, logo: m.logo, capa: m.capa, fundo: m.fundo, oculta: m.oculta,
        nota: notas.get(m.id)?.media ?? null,
        avaliacoes: notas.get(m.id)?.total ?? 0,
        aberta: estado.aberta,
      })),
      banners: config.banners,
      destaques: config.destaques,
      atalhos: config.atalhos,
    },
  };
}
