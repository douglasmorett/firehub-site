import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.vercel-storage.com" },
      { protocol: "https", hostname: "**.blob.vercel-storage.com" },
      { protocol: "https", hostname: "**.public.blob.vercel-storage.com" },
    ],
  },
  async rewrites() {
    return {
      beforeFiles: [
        // ─── Icebox: raiz → catálogo Icebox independente ───
        {
          source: "/",
          has: [{ type: "host", value: "iceboxdistribuidora.com.br" }],
          destination: "/icebox/compras",
        },
        {
          source: "/",
          has: [{ type: "host", value: "www.iceboxdistribuidora.com.br" }],
          destination: "/icebox/compras",
        },
        // ─── Icebox: login → login Icebox azul ───
        {
          source: "/login",
          has: [{ type: "host", value: "iceboxdistribuidora.com.br" }],
          destination: "/icebox/login",
        },
        {
          source: "/login",
          has: [{ type: "host", value: "www.iceboxdistribuidora.com.br" }],
          destination: "/icebox/login",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    // Content-Security-Policy: fecha os vetores de injeção sem quebrar o app.
    // script/style ficam com 'unsafe-inline' porque a hidratação do Next e os
    // estilos inline (style={{}}) dependem disso — mas object-src 'none',
    // base-uri 'self', form-action 'self' e frame-ancestors 'none' cortam
    // injeção de plugin, sequestro de <base>, POST de formulário para fora e
    // clickjacking. Terceiros de pagamento/pixel/fontes entram na allowlist.
    //
    // ── O Assistente de Impressão precisa estar no connect-src ────────────
    //
    // Ele não é um servidor na internet: roda NO PC da loja, em HTTP puro
    // (http://localhost:7899) e WebSocket puro (ws://localhost:7899). Um
    // `connect-src 'self' https:` barra os dois — 'self' é o domínio do site e
    // o esquema `https:` não cobre nem `http:` nem `ws:`. O navegador matava
    // cada chamada ANTES de sair, e o `catch {}` de getAssistantUrl engolia o
    // erro: nenhuma mensagem, nenhum alerta, nada na fila do Windows. Para a
    // loja era "o sistema parou de imprimir" — e reinstalar o Assistente não
    // resolvia, porque o Assistente nunca foi o problema.
    //
    // Isso derruba os TRÊS caminhos de uma vez, inclusive o que não parece
    // depender do navegador: é o POST /config da tela de Impressoras que
    // entrega o `franchiseeId` ao Assistente, e sem esse id ele nem chega a
    // consultar a fila da nuvem. Bloqueado o POST, o pedido para de aparecer
    // na fila mesmo com o painel fechado.
    //
    // Liberar loopback não afrouxa o que o CSP protege: 127.0.0.1 é a própria
    // máquina, não é destino de exfiltração. Portas em sincronia com
    // ASSISTANT_URLS (src/lib/print.ts) e PORTS (firehub-print-assistant/
    // server.js) — mexeu lá, mexa aqui, ou a impressão cai de novo em silêncio.
    const portasDoAssistente = [7899, 7900, 7901, 7891];
    const origensDoAssistente = portasDoAssistente
      .flatMap((porta) => [
        `http://localhost:${porta}`,
        `http://127.0.0.1:${porta}`,
        `ws://localhost:${porta}`,
        `ws://127.0.0.1:${porta}`,
      ])
      .join(" ");
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com https://*.mercadopago.com https://connect.facebook.net https://*.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      `connect-src 'self' https: ${origensDoAssistente}`,
      "frame-src 'self' https://*.mercadopago.com https://*.mercadolibre.com",
      "media-src 'self' data: blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Permissions-Policy",
            // Tem que ser IGUAL ao de middleware.ts — o middleware sobrescreve
            // este valor em toda resposta, entao os dois divergirem so serve
            // para o proximo leitor acreditar no arquivo errado. Ver la o
            // motivo de `camera` e `geolocation` precisarem de (self).
            value: "camera=(self), microphone=(), geolocation=(self)",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
