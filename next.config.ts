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
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.mercadopago.com https://*.mercadopago.com https://connect.facebook.net https://*.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https:",
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
            value: "camera=(), microphone=(), geolocation=(self)",
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
