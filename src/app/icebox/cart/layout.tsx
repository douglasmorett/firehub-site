import { CartProvider } from "@/components/CartProvider";
import { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Carrinho — Icebox Distribuidora",
  description: "Finalize seu pedido na Icebox",
  icons: { icon: "/icebox-favicon.png" },
};

export default function IceboxCartLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <head>
        <link rel="icon" href="/icebox-favicon.png" type="image/png" />
      </head>
      <div className="icebox-theme" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#F5F5F5" }}>
        {/* Top bar */}
        <nav style={{
          background: "linear-gradient(135deg, #0D47A1, #1565C0)",
          padding: "10px 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          boxShadow: "0 2px 12px rgba(13,71,161,0.3)",
        }}>
          <Link href="/icebox/compras" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "1.3rem" }}>🧊</span>
            </div>
            <div>
              <span style={{ color: "#fff", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "-0.3px" }}>Icebox</span>
              <span style={{ color: "#93C5FD", fontWeight: 600, fontSize: "0.72rem", marginLeft: 6 }}>Distribuidora</span>
            </div>
          </Link>
        </nav>

        <main style={{ flex: 1 }}>
          {children}
        </main>
      </div>
      <style>{`
        .icebox-theme {
          --primary: #1565C0;
          --primary-hover: #0D47A1;
          --primary-light: #E3F2FD;
          --shadow-primary: 0 8px 20px -6px rgba(21, 101, 192, 0.4);
        }
      `}</style>
    </CartProvider>
  );
}
