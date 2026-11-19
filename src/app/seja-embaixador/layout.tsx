import type { Metadata } from "next";
import { metadataDaPagina } from "@/lib/seo";

// A página é "use client" e não exporta metadata: título, descrição e prévia ficam aqui.
export const metadata: Metadata = metadataDaPagina({
  titulo: "Seja embaixador do FireHub e ganhe todo mês",
  descricao: "Indique o FireHub para donos de restaurante e receba lucros recorrentes todo mês, enquanto a loja continuar com a gente. Demonstre interesse e falamos com você.",
  caminho: "/seja-embaixador",
});

export default function SejaEmbaixadorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
