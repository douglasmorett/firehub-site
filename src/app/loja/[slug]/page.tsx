import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import { slugAtualDeUmAntigo } from "@/lib/slug-da-loja";
import CustomerStorePage from "@/components/customer/CustomerStorePage";
import { propsDoCardapio, SELECT_DA_LOJA_NO_CARDAPIO } from "@/lib/cardapio-publico";

export const revalidate = 60; // ⚡ Cache de Borda (Edge) de 60 segundos


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const franchisee = await prisma.user.findUnique({
    where: { slug },
    select: { storeName: true, name: true, city: true }
  });
  
  if (!franchisee) return { title: "Loja não encontrada" };
  
  const name = franchisee.storeName || franchisee.name;
  const descricao = franchisee.city
    ? `Peça online em ${name} — ${franchisee.city}. Cardápio, promoções e entrega.`
    : `Peça online em ${name}. Cardápio, promoções e entrega.`;

  // ── QUEM APARECE NA PRÉVIA É A LOJA ───────────────────────────────────────
  //
  // Só `title` e `description` não bastam: o WhatsApp lê as tags OpenGraph, e
  // sem um `openGraph` próprio aqui o Next herda o do layout raiz — a
  // propaganda do FireHub. O lojista mandava o link do cardápio dele e o
  // cliente via o nosso anúncio. A IMAGEM vem do opengraph-image.tsx desta
  // mesma pasta (a logo do lojista), que tem prioridade sobre este bloco.
  return {
    title: `${name} | Cardápio Online`,
    description: descricao,
    openGraph: {
      title: name,
      description: descricao,
      url: `/loja/${slug}`,
      siteName: name,
      locale: "pt_BR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description: descricao,
    },
  };
}

export default async function PublicStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const franchisee = await prisma.user.findUnique({ where: { slug }, select: SELECT_DA_LOJA_NO_CARDAPIO });

  // ── O ENDEREÇO ANTIGO CONTINUA LEVANDO À LOJA ───────────────────────
  //
  // Trocar o nome da loja troca o link do cardápio. Sem isto, o QR já
  // impresso em centenas de comandas, o link no perfil do Instagram e o
  // print salvo no WhatsApp do cliente morreriam todos na hora em que o
  // lojista corrigisse o nome — que é justamente o que a gente quer que ele
  // faça.
  if (!franchisee) {
    const atual = await slugAtualDeUmAntigo(prisma as any, slug);
    if (atual) redirect(`/loja/${atual}`);
    notFound();
  }

  // Este É o delivery: o que está liberado para delivery, com o preço dele.
  // A carga inteira (produtos, avaliações, estoque, nota fiscal) mora em
  // lib/cardapio-publico.ts, a mesma do cardápio da mesa pelo QR.
  const props = await propsDoCardapio(franchisee, "delivery");
  return <CustomerStorePage {...props} />;
}
