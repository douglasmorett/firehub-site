import type { Metadata } from "next";
import VitrineDaRede from "@/components/rede/VitrineDaRede";

// PRÉVIA da página da rede de marcas (Lucas / Frangoso). Sem banco.
export const metadata: Metadata = {
  title: "Rede Trindade — prévia",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <VitrineDaRede />;
}
