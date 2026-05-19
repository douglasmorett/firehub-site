"use client";
import { signOut } from "next-auth/react";

export default function IceboxLogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/icebox/compras" })}
      style={{
        background: "rgba(255,255,255,0.1)",
        color: "#93C5FD",
        padding: "6px 12px",
        borderRadius: 8,
        fontSize: "0.78rem",
        fontWeight: 600,
        border: "1px solid rgba(255,255,255,0.2)",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all 0.2s",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
      onMouseEnter={e => {
        (e.target as HTMLElement).style.background = "rgba(239,68,68,0.2)";
        (e.target as HTMLElement).style.borderColor = "rgba(239,68,68,0.4)";
        (e.target as HTMLElement).style.color = "#FCA5A5";
      }}
      onMouseLeave={e => {
        (e.target as HTMLElement).style.background = "rgba(255,255,255,0.1)";
        (e.target as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)";
        (e.target as HTMLElement).style.color = "#93C5FD";
      }}
    >
      ↪ Sair
    </button>
  );
}
