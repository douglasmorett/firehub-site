import "@/app/globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Totem de Autoatendimento",
  description: "Faça seu pedido aqui",
};

/**
 * Quiosque não é celular do cliente: a tela é fixa, o dedo é o único apontador
 * e não existe ninguém para desfazer um zoom acidental. O layout raiz libera
 * `maximumScale: 5`, e bastava um cliente encostar dois dedos para o cardápio
 * ficar gigante e torto até alguém do salão perceber e reiniciar o navegador.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0F172A",
};

export default function TotemLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "'Inter', sans-serif",
        userSelect: "none",
        WebkitUserSelect: "none",
        // `pan-y` deixa a lista de produtos rolar mas mata o duplo-toque que
        // dá zoom; `overscrollBehavior` impede o efeito de "puxar para
        // atualizar" que recarregava a tela no meio do pedido.
        touchAction: "pan-y",
        overscrollBehavior: "none",
        WebkitTapHighlightColor: "transparent",
        backgroundColor: "#0F172A",
      }}
    >
      {children}
    </div>
  );
}
