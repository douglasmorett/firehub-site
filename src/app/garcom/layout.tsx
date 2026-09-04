import type { Metadata, Viewport } from "next";

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
  return <>{children}</>;
}
