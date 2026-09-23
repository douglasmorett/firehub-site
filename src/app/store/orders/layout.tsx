import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Icebox Congelados - Meus Pedidos",
  description: "Acompanhe seus pedidos de insumos"
};

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="icebox-theme">
      {children}
      <style>{`
        .icebox-theme {
          --primary: #1C1917;
          --primary-hover: #1C1917;
          --primary-light: #FAF6F2;
          --shadow-primary: 0 8px 20px -6px rgba(21, 101, 192, 0.4);
        }
      `}</style>
    </div>
  );
}
