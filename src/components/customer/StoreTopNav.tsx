"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, ClipboardList, Store, Users, ShoppingBag, ExternalLink, LogOut, UtensilsCrossed, Bike, BarChart2, Printer, Zap } from "lucide-react";
import { useState, useTransition } from "react";

const NAV_ITEMS = [
  { href: "/store", label: "Início", icon: Home },
  { href: "/store/pedidos-clientes", label: "Pedidos", icon: ClipboardList, highlight: true },
  { href: "/store/venda-presencial", label: "PDV", icon: ShoppingBag },
  { href: "/store/cardapio", label: "Cardápio", icon: UtensilsCrossed },
  { href: "/store/financeiro", label: "Financeiro", icon: BarChart2 },
  { href: "/store/meta-ads", label: "Tráfego Pago", icon: Zap, badge: "IA" },
  { href: "/store/motoboys", label: "Motoboys", icon: Bike },
  { href: "/store/minha-loja", label: "Minha Loja", icon: Store },
  { href: "/store/profile", label: "Perfil", icon: Users },
];

export default function StoreTopNav({
  userName, userCity, userSlug, isFranqueado,
  initialStoreOpen = true, initialCashOpen = false,
}: {
  userName: string; userCity: string; userSlug?: string | null;
  isFranqueado: boolean; initialStoreOpen?: boolean; initialCashOpen?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const isCompras = pathname?.startsWith("/store/compras");
  const storeUrl = userSlug ? `/loja/${userSlug}` : null;

  const [storeOpen, setStoreOpen] = useState(initialStoreOpen);
  const [cashOpen, setCashOpen] = useState(initialCashOpen);
  const [toggling, setToggling] = useState<"store" | "cash" | null>(null);

  const toggle = async (type: "store" | "cash") => {
    setToggling(type);
    const newVal = type === "store" ? !storeOpen : !cashOpen;
    try {
      const res = await fetch("/api/store/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type === "store" ? { storeOpen: newVal } : { cashOpen: newVal }),
      });
      if (res.ok) {
        if (type === "store") setStoreOpen(newVal);
        else setCashOpen(newVal);
        startTransition(() => router.refresh());
      }
    } finally { setToggling(null); }
  };

  const ToggleBtn = ({ type, label, isOn }: { type: "store" | "cash"; label: string; isOn: boolean }) => (
    <button
      onClick={() => toggle(type)}
      disabled={toggling === type}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 12px", borderRadius: 20,
        border: `1.5px solid ${isOn ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)"}`,
        background: isOn ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
        color: "#fff", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer",
        transition: "all 0.2s", fontFamily: "inherit",
        opacity: toggling === type ? 0.6 : 1,
      }}
    >
      {/* Toggle switch visual */}
      <span style={{
        display: "inline-block", width: 28, height: 15, borderRadius: 8,
        background: isOn ? "#4ADE80" : "#64748B",
        position: "relative", transition: "background 0.2s",
      }}>
        <span style={{
          position: "absolute", top: 2,
          left: isOn ? 15 : 2,
          width: 11, height: 11, borderRadius: "50%",
          background: "#fff", transition: "left 0.2s",
        }} />
      </span>
      {label} {isOn ? "aberto" : "fechado"}
    </button>
  );

  return (
    <>
      {/* Barra de status: loja fechada */}
      {!storeOpen && (
        <div style={{ background: "#EF4444", color: "#fff", textAlign: "center", padding: "6px", fontSize: "0.78rem", fontWeight: 700 }}>
          🔴 LOJA FECHADA — Clientes não conseguem fazer pedidos
        </div>
      )}

      <div style={{
        background: isCompras
          ? "linear-gradient(135deg, #0D47A1 0%, #1565C0 100%)"
          : "linear-gradient(135deg, #B71C1C 0%, #C62828 100%)",
        padding: "0.45rem 0.85rem",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: "0.4rem",
      }}>
        {/* LOGO + TOGGLES */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          {isCompras ? (
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 7, background: "rgba(255,255,255,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", flexShrink: 0
              }}>🧊</div>
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                <span style={{ color: "#fff", fontWeight: 900, fontSize: "0.95rem", letterSpacing: "-0.5px" }}>
                  Ice<span style={{ color: "#90CAF9" }}>box</span>
                </span>
                <span style={{ color: "rgba(255,255,255,0.65)", fontWeight: 500, fontSize: "0.55rem", letterSpacing: "0.5px", textTransform: "uppercase" }}>Congelados &amp; Insumos</span>
              </div>
            </div>
          ) : (
            <Link href="/firehub" style={{ display: "flex", alignItems: "center", gap: 7, textDecoration: "none" }}>
              <img
                src="/firehub-icon.png"
                alt="FireHub"
                style={{ width: 30, height: 30, borderRadius: 7, objectFit: "cover", flexShrink: 0 }}
              />
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                <span style={{ color: "#fff", fontWeight: 900, fontSize: "0.95rem", letterSpacing: "-0.5px" }}>
                  Fire<span style={{ color: "#FF6B35" }}>Hub</span>
                </span>
                <span style={{ color: "rgba(255,255,255,0.65)", fontWeight: 500, fontSize: "0.55rem", letterSpacing: "0.5px", textTransform: "uppercase" }}>Sistema de Pedidos</span>
              </div>
            </Link>
          )}

          {/* Toggles */}
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <ToggleBtn type="cash" label="Caixa" isOn={cashOpen} />
            <ToggleBtn type="store" label="Loja" isOn={storeOpen} />
          </div>
        </div>

        {/* Ações direita */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
          {/* Impressora */}
          <a
            href="/store/impressoras"
            title="Configurar Impressora"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 9,
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.25)",
              color: "#fff", textDecoration: "none",
              flexShrink: 0,
            }}
          >
            <Printer size={15} />
          </a>

          {/* Fazer Compras — SEMPRE visível em destaque */}
          {isFranqueado && (
            <a
              href="/store/compras"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "0.38rem 0.8rem", borderRadius: 8,
                background: isCompras ? "rgba(255,255,255,0.2)" : "#FF8A00",
                color: "#fff", fontWeight: 700, fontSize: "0.78rem",
                textDecoration: "none",
                boxShadow: isCompras ? "none" : "0 2px 8px rgba(255,138,0,0.4)",
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              <ShoppingBag size={13} /> {isCompras ? "Comprando..." : "Fazer Compras"}
            </a>
          )}

          {/* Ver Loja - oculto em telas muito pequenas */}
          {storeUrl && (
            <a
              href={storeUrl}
              target="_blank"
              className="nav-view-store"
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "0.38rem 0.65rem", borderRadius: 8,
                background: "rgba(255,255,255,0.15)", color: "#fff",
                fontWeight: 600, fontSize: "0.72rem", textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.25)", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              <ExternalLink size={12} /> Ver Loja
            </a>
          )}

          {/* Nome — oculto em mobile pequeno */}
          <span className="nav-user-label" style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.72rem", padding: "0 0.2rem" }}>
            {userName} • {userCity}
          </span>

          <a
            href="/api/auth/signout"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "0.38rem 0.6rem", borderRadius: 8,
              background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.85)",
              fontSize: "0.72rem", textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.2)", flexShrink: 0,
            }}
          >
            <LogOut size={12} /> Sair
          </a>
        </div>
      </div>

      {/* NAV */}
      <nav style={{ background: "#fff", borderBottom: "2px solid #E2E8F0", padding: "0 0.75rem", position: "sticky", top: 0, zIndex: 50, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto", display: "flex", alignItems: "stretch", gap: 0, overflowX: "auto", scrollbarWidth: "none" }}>
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = item.href === "/store" ? pathname === "/store" : pathname?.startsWith(item.href);
            const activeColor = "#C62828";
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "0.65rem 0.8rem", fontSize: "0.8rem",
                  fontWeight: active ? 700 : 500,
                  color: active ? activeColor : "#475569",
                  textDecoration: "none",
                  borderBottom: active ? `3px solid ${activeColor}` : "3px solid transparent",
                  whiteSpace: "nowrap", flexShrink: 0,
                }}
              >
                <Icon size={14} /> {item.label}
                {item.highlight && <span style={{ width: 7, height: 7, borderRadius: "50%", background: activeColor, display: "inline-block" }} />}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* CSS responsivo */}
      <style>{`
        @media (max-width: 520px) {
          .nav-user-label { display: none !important; }
          .nav-view-store { display: none !important; }
        }
        /* Nav bar scroll sem scrollbar visível */
        .store-nav-inner::-webkit-scrollbar { display: none; }
        .store-nav-inner { scrollbar-width: none; }
      `}</style>
    </>
  );
}
