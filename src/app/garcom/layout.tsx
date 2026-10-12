import type { Metadata, Viewport } from "next";
import TrocaDeContingencia from "@/components/contingencia/TrocaDeContingencia";

export const metadata: Metadata = {
  title: "Acesso do Garçom — FireHub",
  description: "Lançamento de pedidos na mesa",
  robots: { index: false, follow: false },
};

/**
 * Tela de operação em tablet e celular: sem zoom por pinça, sem "puxar para
 * atualizar" no meio da comanda. Mesma decisão do totem.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#7C3AED",
};

export default function GarcomLayout({ children }: { children: React.ReactNode }) {
  // Modo Contingência: o celular do garçom também pula para o computador da
  // loja quando a nuvem cai (components/contingencia/TrocaDeContingencia.tsx).
  return (
    <>
      <TrocaDeContingencia tipo="garcom" />
      {children}
    </>
  );
}
