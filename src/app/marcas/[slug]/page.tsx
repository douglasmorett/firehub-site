import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SELECT_DA_LOJA_NO_CARDAPIO } from "@/lib/cardapio-publico";
import { slugAtualDeUmAntigo } from "@/lib/slug-da-loja";
import { multimarcasEstaLigado } from "@/lib/multimarcas/assinatura";
import { lerConfigDaPagina } from "@/lib/multimarcas/pagina";
import { vitrineDaLoja } from "@/lib/multimarcas/carga";
import Vitrine from "@/components/multimarcas/Vitrine";

/**
 * /marcas/<slug> — a página do Multimarcas: as marcas da loja, os banners, a
 * busca em todas. Tocar numa marca abre o cardápio de sempre filtrado
 * (/loja/<slug>?marca=<id>), com a sacola da loja — um pedido, uma entrega.
 * Multimarcas desligado ou sem marca montada: vai para o cardápio da loja,
 * para link divulgado nunca dar em página vazia.
 */
export const revalidate = 60;
/**
 * Sem generateStaticParams a rota [slug] é dinâmica e o revalidate acima não
 * vale nada: cada visita refazia o cardápio e as avaliações no banco
 * (Cache-Control: no-store, 2–37 s medidos em 18/10). Lista vazia = cada loja
 * vira página em cache na primeira visita e se renova a cada 60 s (ISR).
 */
export async function generateStaticParams() {
  return [];
}

async function carregar(slug: string) {
  const franchisee = await prisma.user.findUnique({ where: { slug }, select: SELECT_DA_LOJA_NO_CARDAPIO });
  if (!franchisee) return null;
  const config = (await multimarcasEstaLigado(franchisee.id)) ? await lerConfigDaPagina(franchisee.id, franchisee.storeName || franchisee.name || "") : null;
  return { franchisee, config: config && config.marcas.some((m) => !m.oculta) ? config : null };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await carregar(slug).catch(() => null);
  if (!c?.config) return { title: "FireHub" };
  const marcas = c.config.marcas.filter((m) => !m.oculta).map((m) => m.nome);
  const descricao = c.config.frase || `Peça de ${marcas.slice(0, 4).join(", ")} numa sacola só, com uma entrega.`;
  return {
    title: c.config.nome,
    description: descricao,
    openGraph: { title: c.config.nome, description: descricao, images: c.franchisee.storeLogo ? [c.franchisee.storeLogo] : undefined, type: "website" },
  };
}

export default async function PaginaDasMarcas({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await carregar(slug);
  if (!c) {
    const atual = await slugAtualDeUmAntigo(prisma as any, slug);
    if (atual) redirect(`/marcas/${atual}`);
    notFound();
  }
  if (!c.config) redirect(`/loja/${c.franchisee.slug}`);
  const { config, produtos } = await vitrineDaLoja(c.franchisee, c.config);
  return <Vitrine config={config} produtos={produtos} publica={{ slug: c.franchisee.slug! }} />;
}
