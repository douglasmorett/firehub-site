import type { MetadataRoute } from "next";

// Painéis logados ficam fora da busca; cardápio das lojas (/loja) e /api continuam abertos
// (o Google precisa do /api para montar o cardápio da loja).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/store", "/vendedor", "/garcom", "/kds", "/tablet", "/tv", "/totem"],
    },
    sitemap: "https://firehubfood.com.br/sitemap.xml",
  };
}
