import { notFound, redirect } from "next/navigation";
import { carregarVitrineDoGrupo, slugValido } from "@/lib/vitrine-do-grupo";
import EscolhaDaLojaDoGrupo from "@/components/customer/EscolhaDaLojaDoGrupo";
import { conviteDoApp } from "@/lib/app-da-loja/links";
import { iconesDaLoja } from "@/lib/imagem-da-loja";
import { cortar, metadataDaPagina } from "@/lib/seo";

/**
 * /lojas/[slug]: o link único de quem tem mais de uma loja. O cliente diz
 * onde está e cai no cardápio da loja que entrega para ele
 * (lib/escolha-de-loja-do-grupo.ts). Qualquer slug do grupo serve.
 */

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vitrine = await carregarVitrineDoGrupo(slug);
  if (!vitrine) return { title: "Loja não encontrada" };
  const descricao = `Peça online em ${vitrine.nomeDoGrupo}: escolha seu bairro e a gente leva você para a loja mais perto.`;
  const daLogo = vitrine.lojas.find((l) => l.logo && l.logo === vitrine.logo)?.slug ?? slug;
  // Prévia com a logo do grupo pelo opengraph-image do cardápio (JPEG, que o
  // WhatsApp desenha; a logo gravada é WebP), nunca a propaganda do FireHub.
  const meta = metadataDaPagina({
    titulo: cortar(`${vitrine.nomeDoGrupo} | Peça online`, 60),
    descricao: descricao,
    caminho: `/lojas/${slug}`,
    imagem: { url: `/loja/${encodeURIComponent(daLogo)}/opengraph-image`, width: 1200, height: 630, alt: vitrine.nomeDoGrupo },
    site: vitrine.nomeDoGrupo,
  });
  return {
    ...meta,
    openGraph: { ...meta.openGraph, title: vitrine.nomeDoGrupo },
    // Ícone com a logo do grupo (a da loja de onde ela veio), não a chama do FireHub.
    icons: iconesDaLoja(daLogo),
  };
}

export default async function PaginaDoGrupo({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vitrine = await carregarVitrineDoGrupo(slug);
  if (!vitrine) {
    // Loja que trocou de nome: o link antigo (QR, Instagram) leva ao novo.
    const atual = await slugValido(slug);
    if (atual && atual !== slug) redirect(`/lojas/${atual}`);
    notFound();
  }
  // Loja sem filial: não há o que escolher.
  if (vitrine.lojas.length === 1) redirect(`/loja/${vitrine.lojas[0].slug}`);
  // O app é da marca: qualquer unidade responde pelo plano e pelos links (lib/app-da-loja/links.ts).
  const appDaLoja = await conviteDoApp(vitrine.lojas[0].id);
  return <EscolhaDaLojaDoGrupo slug={slug} vitrine={vitrine} appDaLoja={appDaLoja} />;
}
