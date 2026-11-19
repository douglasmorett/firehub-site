import type { Metadata } from "next";
import { metadataDaPagina } from "@/lib/seo";

// A página é "use client" e não exporta metadata: título, descrição e prévia ficam aqui.
export const metadata: Metadata = metadataDaPagina({
  titulo: "Teste grátis o sistema FireHub por 15 dias",
  descricao: "Crie sua conta no FireHub em poucos minutos: cardápio digital, pedidos, WhatsApp com IA e iFood num só painel. 15 dias grátis, sem cartão e sem multa.",
  caminho: "/cadastro",
});

export default function CadastroLayout({ children }: { children: React.ReactNode }) {
  return children;
}
