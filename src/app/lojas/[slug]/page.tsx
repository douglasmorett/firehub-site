import { notFound, redirect } from "next/navigation";
import { carregarVitrineDoGrupo } from "@/lib/vitrine-do-grupo";
import EscolhaDaLojaDoGrupo from "@/components/customer/EscolhaDaLojaDoGrupo";

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
  return {
    title: `${vitrine.nomeDoGrupo} | Peça online`,
    description: descricao,
    openGraph: { title: vitrine.nomeDoGrupo, description: descricao, url: `/lojas/${slug}`, siteName: vitrine.nomeDoGrupo, locale: "pt_BR", type: "website" },
  };
}

export default async function PaginaDoGrupo({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vitrine = await carregarVitrineDoGrupo(slug);
  if (!vitrine) notFound();
  // Loja sem filial: não há o que escolher.
  if (vitrine.lojas.length === 1) redirect(`/loja/${vitrine.lojas[0].slug}`);
  return <EscolhaDaLojaDoGrupo slug={slug} vitrine={vitrine} />;
}
