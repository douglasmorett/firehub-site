import "@/app/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Totem de Autoatendimento",
  description: "Faça seu pedido aqui",
};

export default function TotemLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ 
      width: "100vw", height: "100vh", overflow: "hidden",
      fontFamily: "'Inter', sans-serif",
      userSelect: "none", WebkitUserSelect: "none",
      touchAction: "manipulation",
      backgroundColor: "#0F172A",
    }}>
      {children}
    </div>
  );
}
