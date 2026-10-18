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
import { chaveDaCategoria, mapaDeCategorias, type ConfigDaPagina } from "./pagina";
import { MARCA_DOS_EXTRAS, type ConfigDaVitrine, type ProdutoDaVitrine } from "./vitrine";

/**
 * Nota de cada marca: a média das avaliações dos pedidos que tiveram item da
 * marca (um pedido com duas marcas conta para as duas). Mesmas regras do
 * cardápio: só se a loja mostra avaliações, e só as de nota mínima que ela
 * escolheu. Puro, para o teste.
 */
export function notasPorMarca(
  avaliacoes: { rating: number; categorias: (string | null | undefined)[] }[],
  mapa: Map<string, string>,
): Map<string, { media: number; total: number }> {
  const soma = new Map<string, { s: number; n: number }>();
  for (const a of avaliacoes) {
    const marcas = new Set(a.categorias.map((c) => mapa.get(chaveDaCategoria(c || ""))).filter(Boolean) as string[]);
    for (const m of marcas) {
      const x = soma.get(m) ?? { s: 0, n: 0 };
      x.s += a.rating;
      x.n += 1;
      soma.set(m, x);
    }
  }
  return new Map([...soma].map(([m, x]) => [m, { media: Math.round((x.s / x.n) * 10) / 10, total: x.n }]));
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

/** Prazo da entrega pelas áreas da loja: o menor e o maior tempo (o maior + 15, como o checkout mostra). */
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

  const produtos: ProdutoDaVitrine[] = ((cardapio.menuProducts as any[]) || []).map((p) => ({
    id: String(p.id),
    marca: mapa.get(chaveDaCategoria(p.category)) ?? MARCA_DOS_EXTRAS,
    categoria: String(p.category || ""),
    nome: String(p.name || ""),
    descricao: String(p.description || ""),
    preco: Number(p.price) || 0,
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
      entrega: { taxa: null, ...prazoDasAreas(franchisee.deliveryZones), minimo: Number(dc.minimumOrderValue) || 0 },
      marcas: config.marcas.map((m) => ({
        id: m.id, nome: m.nome, tipo: m.tipo, cor: m.cor, logo: m.logo, capa: m.capa, oculta: m.oculta,
        nota: notas.get(m.id)?.media ?? null,
        avaliacoes: notas.get(m.id)?.total ?? 0,
        aberta: estado.aberta,
      })),
      banners: config.banners,
    },
  };
}
