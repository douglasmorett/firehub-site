import type { Metadata } from "next";
import PainelDaRede from "@/components/rede/PainelDaRede";

// PRÉVIA do painel da rede (banners, lojas, cor). Sem login e sem banco.
export const metadata: Metadata = {
  title: "Painel da rede — prévia",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PainelDaRede />;
}
