"use client";
/**
 * A CAIXINHA "NO SITE AGORA" da barra da tela de Pedidos.
 *
 * Douglas, 16/10/2026: o funcionário da loja (Jerrajê) só tem a tela de
 * Pedidos e não via quantos clientes estão no cardápio — número que a Início
 * ganhou no mesmo dia (FunilDoSite). É a MESMA pergunta: GET /api/store/funil
 * sem período devolve só o `online` (lib/funil-do-site.ts → onlineAgora: sinal
 * nos últimos 2 minutos), no mesmo ritmo da Início (PERGUNTA_DO_ONLINE_MS) e
 * só com a aba à vista. Sem acesso (403) a caixinha some, sem aviso.
 */
import { useEffect, useState } from "react";
import { dicaDoOnline, PERGUNTA_DO_ONLINE_MS, textoDoOnline } from "@/lib/funil-do-site-regras";

type Online = { agora: number; comCarrinho: number; finalizando: number };

export default function PessoasNoSiteAgora({ loja, className }: { loja?: string | null; className?: string }) {
  const [online, setOnline] = useState<Online | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);

  useEffect(() => {
    let vivo = true;
    const qs = loja ? `?loja=${encodeURIComponent(loja)}` : "";
    const ler = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/store/funil${qs}`, { cache: "no-store" })
        .then((r) => {
          if (r.status === 401 || r.status === 403) { if (vivo) setSemAcesso(true); return null; }
          return r.ok ? r.json() : null;
        })
        .then((j) => { if (vivo && j?.online) setOnline(j.online); })
        .catch(() => {});
    };
    ler();
    const t = window.setInterval(ler, PERGUNTA_DO_ONLINE_MS);
    // Voltou para a aba: o número velho não fica parado 20 s na tela.
    const aoVoltar = () => { if (document.visibilityState === "visible") ler(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { vivo = false; window.clearInterval(t); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [loja]);

  if (semAcesso) return null;
  const agora = online?.agora ?? 0;
  const tem = agora > 0;
  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      title={online ? dicaDoOnline(online) : "Contando quem está no cardápio da loja agora…"}
      style={{
        height: 30, boxSizing: "border-box", display: "inline-flex", alignItems: "center", gap: 7,
        padding: "0 11px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0,
        border: `1.5px solid ${tem ? "#BBF7D0" : "#E2E8F0"}`,
        background: tem ? "#F0FDF4" : "#F8FAFC",
        color: tem ? "#14532D" : "#64748B",
        fontSize: "0.76rem", fontWeight: 800,
      }}
    >
      <span
        className={tem ? "fh-online-ponto" : undefined}
        aria-hidden
        style={{
          width: 9, height: 9, borderRadius: 999, flex: "0 0 auto",
          background: tem ? "#16A34A" : "#CBD5E1",
          animation: tem ? "fh-online-barra 1.8s ease-out infinite" : "none",
        }}
      />
      <span>{online ? textoDoOnline(agora) : "… no site agora"}</span>
      {online && online.comCarrinho > 0 && (
        <span style={{ fontWeight: 700, color: "#166534", opacity: 0.85 }}>· 🛒 {online.comCarrinho}</span>
      )}
      <style>{`
        @keyframes fh-online-barra { 0% { box-shadow: 0 0 0 0 rgba(22,163,74,.5); } 70% { box-shadow: 0 0 0 6px rgba(22,163,74,0); } 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); } }
        @media (prefers-reduced-motion: reduce) { .fh-online-ponto { animation: none !important; } }
      `}</style>
    </div>
  );
}
