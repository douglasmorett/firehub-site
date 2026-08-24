"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

const WA_URL = "https://wa.me/5522981118514?text=Ol%C3%A1!%20Quero%20saber%20mais%20sobre%20o%20FireHub";

export default function FloatingContactWidget({
  ifoodWidgetId,
  ifoodMerchantId,
}: {
  ifoodWidgetId?: string;
  ifoodMerchantId?: string;
} = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(true);

  // Não renderiza em telas de venda presencial ou KDS para não sobrepor botões.
  //
  // O totem entrou na lista pelo mesmo motivo, e por um pior: este widget é a
  // venda do FireHub para o LOJISTA ("Quero saber mais sobre o FireHub"), e ele
  // aparecia flutuando na frente do cliente que está comprando um lanche. Fixo
  // com z-index 9999 no canto inferior direito, ficava exatamente por cima do
  // "Ver carrinho" do quiosque — o dedo mirava o carrinho e abria o WhatsApp
  // comercial.
  if (
    pathname?.startsWith("/store/venda-presencial") ||
    pathname?.startsWith("/store/kds") ||
    pathname?.startsWith("/totem")
  ) {
    return null;
  }

  // Stop pulsing after first open
  useEffect(() => {
    if (open) setPulse(false);
  }, [open]);

  // Close on scroll (mobile UX)
  useEffect(() => {
    const fn = () => { if (open) setOpen(false); };
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, [open]);

  // Close on ESC
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // Load iFood Widget script
  useEffect(() => {
    if (!ifoodWidgetId || !ifoodMerchantId) return;

    // Don't load twice
    if (document.getElementById("ifood-widget-script")) return;

    const script = document.createElement("script");
    script.id = "ifood-widget-script";
    script.src = "https://widgets.ifood.com.br/widget.js";
    script.async = true;
    script.onload = () => {
      if (typeof (window as any).iFoodWidget !== "undefined") {
        (window as any).iFoodWidget.init({
          widgetId: ifoodWidgetId,
          merchantIds: [ifoodMerchantId],
        });
      }
    };
    document.head.appendChild(script);
  }, [ifoodWidgetId, ifoodMerchantId]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fcw-backdrop"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="fcw-container" id="floating-contact-widget">
        {/* Channel options */}
        <div className={`fcw-menu ${open ? "fcw-menu-open" : ""}`}>
          <div className="fcw-menu-header">
            <span className="fcw-menu-title">💬 Fale conosco</span>
            <span className="fcw-menu-subtitle">Escolha o melhor canal</span>
          </div>

          {/* WhatsApp */}
          <a
            href={WA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="fcw-option"
            style={{ "--ch-color": "#25D366", "--delay": "0ms" } as React.CSSProperties}
            onClick={() => setOpen(false)}
          >
            <span className="fcw-option-icon" style={{ background: "#25D366" }}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </span>
            <span className="fcw-option-text">
              <span className="fcw-option-label">WhatsApp</span>
              <span className="fcw-option-sub">Resposta rápida</span>
            </span>
            <span className="fcw-option-arrow">→</span>
          </a>

          {/* iFood Chat — only show if widget is configured */}
          {ifoodWidgetId && (
            <button
              className="fcw-option"
              style={{ "--ch-color": "#EA1D2C", "--delay": "60ms", border: "none", background: "none", cursor: "pointer", width: "100%", textAlign: "left", fontFamily: "inherit", fontSize: "inherit" } as React.CSSProperties}
              onClick={() => {
                setOpen(false);
                // Trigger the iFood widget open if available
                if (typeof (window as any).iFoodWidget !== "undefined") {
                  try { (window as any).iFoodWidget.open(); } catch {}
                }
              }}
            >
              <span className="fcw-option-icon" style={{ background: "#EA1D2C" }}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-3 12H7v-2h10v2zm0-3H7V9h10v2zm0-3H7V6h10v2z"/>
                </svg>
              </span>
              <span className="fcw-option-text">
                <span className="fcw-option-label">Chat iFood</span>
                <span className="fcw-option-sub">Fale com a loja</span>
              </span>
              <span className="fcw-option-arrow">→</span>
            </button>
          )}
        </div>

        {/* Main FAB button */}
        <button
          className={`fcw-fab ${open ? "fcw-fab-active" : ""} ${pulse ? "fcw-fab-pulse" : ""}`}
          onClick={() => setOpen(!open)}
          aria-label={open ? "Fechar menu de contato" : "Abrir menu de contato"}
          aria-expanded={open}
          id="contact-widget-fab"
        >
          <span className="fcw-fab-icon fcw-fab-icon-chat">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zM7 9h2v2H7V9zm4 0h2v2h-2V9zm4 0h2v2h-2V9z"/>
            </svg>
          </span>
          <span className="fcw-fab-icon fcw-fab-icon-close">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </span>
        </button>
      </div>
    </>
  );
}
