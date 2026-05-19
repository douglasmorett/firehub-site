"use client";

import Link from "next/link";
import { LogOut, ShoppingCart, User } from "lucide-react";
import { useCart } from "./CartProvider";

export default function StoreNavbar({ userName, userCity }: { userName: string, userCity: string }) {
  const { items } = useCart();
  const itemCount = items.reduce((acc, item) => acc + item.quantity, 0);

  return (
    <header style={{ 
      backgroundColor: "var(--surface)", 
      borderBottom: "1px solid var(--border-color)",
      padding: "1rem 2rem",
      position: "sticky",
      top: 0,
      zIndex: 10,
      boxShadow: "var(--shadow-sm)"
    }}>
      <div className="container flex justify-between items-center">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Hakim Loja" style={{ height: "70px" }} />
          <div>
            <p className="text-muted" style={{ fontSize: "0.85rem", fontWeight: 500 }}>{userName} • {userCity}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Link href="/store" className="btn btn-outline" style={{ border: "none", color: "var(--primary)" }}>
            Início
          </Link>
          <Link href="/store/orders" className="btn btn-outline" style={{ border: "none" }}>
            Meus Pedidos
          </Link>
          <Link href="/store/cardapio" className="btn btn-outline" style={{ border: "none", color: "var(--primary)" }}>
            🍽️ Cardápio Digital
          </Link>
          <Link href="/store/minha-loja" className="btn btn-outline" style={{ border: "none" }}>
            ⚙️ Minha Loja
          </Link>
          <Link href="/store/cart?emergency=true" className="btn" style={{ backgroundColor: "var(--danger)", color: "white", fontWeight: "bold", border: "none" }} title="Finalizar como Emergência">
            🚨 Emergência
          </Link>
          <Link href="/store/cart" className="btn btn-outline" style={{ position: "relative" }}>
            <ShoppingCart size={18} style={{ marginRight: "8px" }} /> Carrinho
            {itemCount > 0 && (
              <span style={{
                position: "absolute",
                top: "-8px",
                right: "-8px",
                backgroundColor: "var(--primary)",
                color: "white",
                borderRadius: "50%",
                width: "24px",
                height: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: "bold",
                boxShadow: "var(--shadow-sm)"
              }}>
                {itemCount}
              </span>
            )}
          </Link>
          <Link href="/store/minha-loja" className="btn btn-outline" style={{ border: "none" }} title="Minha Loja">
            <User size={18} />
          </Link>
          <a href="/api/auth/signout" className="btn" style={{ color: "var(--danger)" }}>
            <LogOut size={18} />
          </a>
        </div>
      </div>
    </header>
  );
}
