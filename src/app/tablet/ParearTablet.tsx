"use client";

import { useState } from "react";

/** O tablet novo digita o número de 6 dígitos gerado no painel. */
export default function ParearTablet() {
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function parear(numero: string) {
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/tablet-mesa/parear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: numero }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(d?.error || "Não deu certo. Confira o número.");
        setCodigo("");
        return;
      }
      window.location.replace("/tablet/mesa");
    } catch {
      setErro("Sem internet. Confira o Wi-Fi do tablet.");
    } finally {
      setEnviando(false);
    }
  }

  function tecla(t: string) {
    if (enviando) return;
    if (t === "apagar") return setCodigo((c) => c.slice(0, -1));
    const novo = (codigo + t).slice(0, 6);
    setCodigo(novo);
    if (novo.length === 6) void parear(novo);
  }

  return (
    <main style={S.fundo}>
      <div style={S.cartao}>
        <div style={{ fontSize: 44 }} aria-hidden>🍽️</div>
        <h1 style={S.titulo}>Tablet da mesa</h1>
        <p style={S.texto}>
          No painel do FireHub, abra <b>Tablet na mesa</b>, toque em <b>Adicionar tablet</b>, escolha a mesa e digite aqui o número que aparecer.
        </p>
        <div style={S.casas} aria-label="Código de 6 dígitos" aria-live="polite">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} style={{ ...S.casa, borderColor: codigo.length === i ? "#EA580C" : "#E2E8F0" }}>{codigo[i] ?? ""}</span>
          ))}
        </div>
        {erro && <p role="alert" style={S.erro}>{erro}</p>}
        <div style={S.teclado}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "apagar"].map((t, i) =>
            t ? (
              <button key={i} type="button" onClick={() => tecla(t)} disabled={enviando} style={S.tecla} aria-label={t === "apagar" ? "Apagar" : t}>
                {t === "apagar" ? "⌫" : t}
              </button>
            ) : <span key={i} />,
          )}
        </div>
        {enviando && <p style={S.texto}>Conferindo…</p>}
      </div>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  fundo: { minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "linear-gradient(160deg,#0B1220,#1E293B)", fontFamily: "system-ui, -apple-system, sans-serif" },
  cartao: { width: "min(460px, 100%)", background: "#fff", borderRadius: 24, padding: "28px 22px", textAlign: "center", boxShadow: "0 24px 60px rgba(0,0,0,.35)" },
  titulo: { margin: "8px 0 6px", fontSize: 26, fontWeight: 900, color: "#0F172A" },
  texto: { margin: "0 0 14px", color: "#475569", lineHeight: 1.5, fontSize: 15 },
  casas: { display: "flex", gap: 8, justifyContent: "center", margin: "10px 0 14px" },
  casa: { width: 46, height: 58, border: "2px solid #E2E8F0", borderRadius: 12, display: "grid", placeItems: "center", fontSize: 28, fontWeight: 900, color: "#0F172A" },
  erro: { margin: "0 0 12px", color: "#B91C1C", background: "#FEF2F2", borderRadius: 10, padding: "8px 10px", fontSize: 14 },
  teclado: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 },
  tecla: { height: 64, borderRadius: 14, border: "1px solid #E2E8F0", background: "#F8FAFC", fontSize: 26, fontWeight: 800, color: "#0F172A", cursor: "pointer" },
};
