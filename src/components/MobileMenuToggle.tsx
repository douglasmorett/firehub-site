"use client";

import { Menu, X } from "lucide-react";
import { useState, useEffect } from "react";

export default function MobileMenuToggle() {
  const [open, setOpen] = useState(false);

  const toggle = () => {
    const sidebar = document.getElementById("admin-sidebar");
    if (!sidebar) return;
    if (open) {
      sidebar.style.transform = "translateX(-100%)";
    } else {
      sidebar.style.transform = "translateX(0)";
    }
    setOpen(!open);
  };

  const close = () => {
    const sidebar = document.getElementById("admin-sidebar");
    if (sidebar) sidebar.style.transform = "translateX(-100%)";
    setOpen(false);
  };

  // Fecha o menu automaticamente ao clicar em qualquer link da sidebar
  useEffect(() => {
    const handleLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.sidebar-link')) {
        close();
      }
    };

    document.addEventListener('click', handleLinkClick);
    return () => document.removeEventListener('click', handleLinkClick);
  }, []);

  return (
    <>
      <button
        onClick={toggle}
        aria-label="Menu"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-color)",
          borderRadius: "8px",
          cursor: "pointer",
          color: "var(--text-primary)",
          padding: "0.4rem 0.6rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "fixed",
          top: "12px",
          left: "12px",
          zIndex: 1100,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
        }}
        className="mobile-only-btn"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* Overlay removido para testes de bloqueio */}
      {/* {open && (
        <div
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 900,
          }}
        />
      )} */}
      <style>{`
        .mobile-only-btn { display: none; }
        @media (max-width: 768px) {
          .mobile-only-btn { display: flex; }
        }
      `}</style>
    </>
  );
}



