import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function ComprasLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const isLoggedIn = !!session;

  // Detecta se veio pelo domínio Icebox
  const headersList = await headers();
  const host = (headersList.get("host") || "").toLowerCase();
  const isIcebox = host.includes("iceboxdistribuidora");

  return (
    <>
      <div className="icebox-theme" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", backgroundColor: "#F5F5F5" }}>
        {/* Top bar Icebox — só aparece quando acessado pelo domínio Icebox OU quando não logado */}
        {(isIcebox || !isLoggedIn) && (
          <nav style={{
            background: "linear-gradient(135deg, #0D47A1, #1565C0)",
            padding: "12px 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <img src="/firehub-flame.png" alt="FireHub" style={{ width: 32, height: 32, borderRadius: 7, objectFit: "cover" }} />
              <div>
                <span style={{ color: "#fff", fontWeight: 800, fontSize: "1.1rem", letterSpacing: "-0.3px" }}>Icebox</span>
                <span style={{ color: "#93C5FD", fontWeight: 600, fontSize: "0.75rem", marginLeft: 6 }}>Distribuidora</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {isLoggedIn ? (
                <>
                  <span style={{ color: "#BFDBFE", fontSize: "0.82rem" }}>
                    Olá, <strong style={{ color: "#fff" }}>{session?.user?.name || "Cliente"}</strong>
                  </span>
                  <a href="/store/orders" style={{
                    background: "rgba(255,255,255,0.15)",
                    color: "#fff",
                    padding: "6px 14px",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    textDecoration: "none",
                    border: "1px solid rgba(255,255,255,0.25)",
                  }}>
                    📋 Meus Pedidos
                  </a>
                </>
              ) : (
                <a href="/login?callbackUrl=/store/compras" style={{
                  background: "#fff",
                  color: "#0D47A1",
                  padding: "8px 20px",
                  borderRadius: 10,
                  fontSize: "0.88rem",
                  fontWeight: 700,
                  textDecoration: "none",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                }}>
                  🔑 Fazer Login
                </a>
              )}
            </div>
          </nav>
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
    </>
  );
}
