/**
 * SEO DAS PÁGINAS PÚBLICAS — título, descrição, canônica e prévia de link
 * (OpenGraph/Twitter) num lugar só, para toda página pública sair igual.
 *
 * Por que a imagem vai explícita em cada página: no Next, o `openGraph` de uma
 * página SUBSTITUI o do layout inteiro (lib/metadata/resolve-metadata.js do
 * node_modules) — página que declarasse `openGraph` sem `images` ficava sem
 * imagem na prévia, mesmo com uma no layout raiz.
 *
 * Endereço sem "www": é o domínio divulgado (ver metadataBase em app/layout.tsx).
 */
import type { Metadata } from "next";

export const SITE = "https://firehubfood.com.br";

/** A prévia padrão do FireHub (public/og/firehub-og.png, 1200x630). */
export const IMAGEM_OG_PADRAO = {
  url: "/og/firehub-og.png",
  width: 1200,
  height: 630,
  alt: "FireHub: sistema para restaurante e delivery com cardápio digital, pedidos e WhatsApp com IA",
};

type Imagem = { url: string; width?: number; height?: number; alt?: string };

export function metadataDaPagina(p: {
  titulo: string;
  descricao: string;
  /** Caminho a partir da raiz ("/tutoriais") ou endereço absoluto (domínio próprio da loja). */
  caminho: string;
  /** Sem imagem: a prévia padrão do FireHub. `null`: não declara (a página usa a do opengraph-image da pasta). */
  imagem?: Imagem | null;
  tipo?: "website" | "article" | "video.other";
  /** Nome do site na prévia (a loja, no cardápio dela). */
  site?: string;
}): Metadata {
  const imagens = p.imagem === null ? undefined : [p.imagem || IMAGEM_OG_PADRAO];
  return {
    title: p.titulo,
    description: p.descricao,
    alternates: { canonical: p.caminho },
    openGraph: {
      title: p.titulo,
      description: p.descricao,
      url: p.caminho,
      siteName: p.site || "FireHub",
      locale: "pt_BR",
      type: p.tipo || "website",
      ...(imagens ? { images: imagens } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: p.titulo,
      description: p.descricao,
      ...(imagens ? { images: imagens.map((i) => i.url) } : {}),
    },
  };
}

/** Corta no limite sem partir palavra (descrição do Google ~160, título ~60). */
export function cortar(texto: string, limite: number): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite - 1);
  const espaco = corte.lastIndexOf(" ");
  return (espaco > limite * 0.6 ? corte.slice(0, espaco) : corte).replace(/[\s,;:.—-]+$/, "") + "…";
}

/**
 * JSON-LD pronto para `dangerouslySetInnerHTML`. O `<` vira <: nome de loja
 * e de produto é texto do lojista, e um "</script>" nele fecharia a tag.
 */
export function jsonLd(dados: unknown): string {
  return JSON.stringify(dados).replace(/</g, "\\u003c");
}

/** Trilha de navegação (BreadcrumbList) a partir de pares [nome, caminho]. */
export function trilha(itens: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: itens.map(([nome, caminho], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: nome,
      item: caminho.startsWith("http") ? caminho : `${SITE}${caminho === "/" ? "" : caminho}`,
    })),
  };
}
