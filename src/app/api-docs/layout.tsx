import type { Metadata } from "next";
import { metadataDaPagina } from "@/lib/seo";

// A página é "use client" e não exporta metadata: título, descrição e prévia ficam aqui.
export const metadata: Metadata = metadataDaPagina({
  titulo: "FireHub Open API: integração REST e Open Delivery",
  descricao: "Documentação da API do FireHub para integrar PDV, ERP ou app de entregadores: cardápio, pedidos e status da cozinha por REST, JSON, webhooks e Open Delivery.",
  caminho: "/api-docs",
});

export default function ApiDocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
