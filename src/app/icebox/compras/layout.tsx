import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { CartProvider } from "@/components/CartProvider";
import { Metadata } from "next";
import Link from "next/link";
import IceboxLogoutButton from "@/components/IceboxLogoutButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Icebox Distribuidora - Catálogo de Produtos",
  description: "Congelados, resfriados e insumos para o seu negócio",
  icons: { icon: "/icebox-favicon.png" },
};

export default async function IceboxLayout({ children }: { children: React.ReactNode }) {
  let session: any = null;
  try {
    session = await getServerSession(authOptions);
  } catch (_) {}

  const isLoggedIn = !!session;

  return (
    <CartProvider>
      <head>
        <link rel="icon" href="/icebox-favicon.png" type="image/png" />
        <link rel="shortcut icon" href="/icebox-favicon.png" type="image/png" />
      </head>
      <div className="icebox-theme" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#F5F5F5" }}>
        {/* Top bar Icebox */}
        <nav style={{
          background: "linear-gradient(135deg, #0D47A1, #1565C0)",
          padding: "10px 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isLoggedIn ? (
              <>
                <span style={{ color: "#BFDBFE", fontSize: "0.82rem" }}>
                  Olá, <strong style={{ color: "#fff" }}>{session?.user?.name || "Cliente"}</strong>
                </span>
                <Link href="/store/orders" style={{
                  background: "rgba(255,255,255,0.15)",
                  color: "#fff",
                  padding: "6px 14px",
                  borderRadius: 8,
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.25)",
                }}>
                  📋 Meus Pedidos
                </Link>
                <IceboxLogoutButton />
              </>
            ) : (
              <Link href="/icebox/login" style={{
                background: "#fff",
                color: "#0D47A1",
                padding: "8px 20px",
                borderRadius: 10,
                fontSize: "0.85rem",
                fontWeight: 700,
                textDecoration: "none",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
              }}>
                🔑 Fazer Login
              </Link>
            )}
          </div>
        </nav>

        {/* Banner de "faça login" para quem não está logado */}
        {!isLoggedIn && (
          <div style={{
            background: "linear-gradient(135deg, #E3F2FD, #BBDEFB)",
            padding: "10px 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            fontSize: "0.85rem",
            color: "#0D47A1",
            fontWeight: 600,
          }}>
            <span>🛒</span>
            <span>Quer fazer seu pedido?</span>
            <Link href="/icebox/login" style={{
              background: "#0D47A1",
              color: "#fff",
              padding: "5px 14px",
              borderRadius: 8,
              fontSize: "0.8rem",
              fontWeight: 700,
              textDecoration: "none",
            }}>
              Faça login
            </Link>
          </div>
        )}

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
        .icebox-theme .gradient-text {
          background: linear-gradient(135deg, #1565C0 0%, #42A5F5 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
        }
        .icebox-theme .btn-primary {
          background: linear-gradient(135deg, #1565C0 0%, #1976D2 100%) !important;
          box-shadow: 0 8px 20px -6px rgba(21, 101, 192, 0.4) !important;
        }
        .icebox-theme .btn-primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #0D47A1 0%, #1565C0 100%) !important;
        }
        .icebox-theme .btn-outline:hover {
          border-color: #1565C0 !important;
          color: #1565C0 !important;
          background-color: #E3F2FD !important;
        }
        .icebox-theme .input-field:focus {
          border-color: #1565C0 !important;
        }
      `}</style>
    </CartProvider>
  );
}
