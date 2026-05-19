import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
        // ─── Icebox: raiz → catálogo ───
        {
          source: "/",
          has: [{ type: "host", value: "iceboxdistribuidora.com.br" }],
          destination: "/store/compras",
        },
        {
          source: "/",
          has: [{ type: "host", value: "www.iceboxdistribuidora.com.br" }],
          destination: "/store/compras",
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
};

export default nextConfig;
