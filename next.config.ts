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
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
