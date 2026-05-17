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
          --primary: #1565C0;
          --primary-hover: #0D47A1;
          --primary-light: #E3F2FD;
          --shadow-primary: 0 8px 20px -6px rgba(21, 101, 192, 0.4);
        }
      `}</style>
    </div>
  );
}
