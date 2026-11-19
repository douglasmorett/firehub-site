import type { MetadataRoute } from "next";

// Painéis logados e telas de operação ficam fora da busca. Além do Disallow,
// eles saem com `X-Robots-Tag: noindex` (next.config.ts), que vale também
// para link que o Google achou fora daqui.
//
// Continuam ABERTOS: o cardápio das lojas (/loja/<slug>), /api (o Google
// precisa dela para desenhar o cardápio) e /uploads (as fotos dos produtos,
// que aparecem na busca de imagens e na prévia dos links). /login,
// /esqueci-senha e /redefinir-senha também não entram no Disallow de
// propósito: o Google precisa abrir a página para ler o noindex e tirá-la
// do índice.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/store",
        "/vendedor",
        "/garcom",
        "/kds",
        "/tablet",
        "/tv",
        "/totem",
        "/embaixador",
        "/atendimento-lateral",
        "/contingencia",
        "/icebox",
        "/escala",
        "/nfce",
        "/e/",
        "/material/",
        // As telas do cliente dentro do cardápio: acompanhamento do pedido,
        // avaliação, mesa pelo QR, lanche da equipe e o portal do motoboy.
        "/loja/*/pedido",
        "/loja/*/avaliar",
        "/loja/*/mesa",
        "/loja/*/equipe",
        "/loja/*/motoboy",
      ],
    },
    sitemap: "https://firehubfood.com.br/sitemap.xml",
  };
}
