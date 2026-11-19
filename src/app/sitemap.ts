import type { MetadataRoute } from "next";

// Páginas públicas do FireHub. Os cardápios das lojas (/loja/<slug>) o Google acha pelos links.
const PAGINAS = ["", "/cadastro", "/tutoriais", "/seja-embaixador", "/ia", "/prazos", "/termos", "/privacidade"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGINAS.map((p) => ({
    url: `https://firehubfood.com.br${p}`,
    changeFrequency: "weekly",
    priority: p === "" ? 1 : 0.7,
  }));
}
