"use client";
/**
 * "Ativar meu plano" — a conta do plano pré-pago que terminou o teste sem
 * cobrança emitida (não usou o teste, então a varredura não emitiu) gera a
 * cobrança de ativação na hora e abre a fatura do Asaas (Pix, boleto ou
 * cartão). Rota: /api/billing/pre-pago/ativar.
 */
import { useState } from "react";

export default function AtivarPlano({ texto = "⚡ Ativar meu plano e pagar →" }: { texto?: string }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function ativar() {
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/billing/pre-pago/ativar", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (d.url) { window.location.href = d.url; return; }
      if (r.ok) { window.location.reload(); return; }
      setErro(d.error || "Não deu para gerar a cobrança agora. Tente de novo ou fale com o suporte.");
    } catch {
      setErro("Sem conexão. Tente de novo em instantes.");
    }
    setEnviando(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        onClick={ativar}
        disabled={enviando}
        style={{ width: "100%", background: "#C92E09", color: "#fff", padding: "14px", borderRadius: 12, fontSize: "1rem", fontWeight: 800, border: "none", cursor: enviando ? "wait" : "pointer", fontFamily: "inherit", opacity: enviando ? 0.7 : 1 }}
      >
        {enviando ? "Gerando a cobrança…" : texto}
      </button>
      {erro && <span style={{ color: "#B91C1C", fontSize: "0.82rem" }}>{erro}</span>}
    </div>
  );
}
