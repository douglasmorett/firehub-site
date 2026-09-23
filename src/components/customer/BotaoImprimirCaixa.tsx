"use client";
import { useState } from "react";

/**
 * "Imprimir de novo" no histórico de caixa.
 *
 * Papel some — acaba a bobina, a impressora está desligada, alguém joga fora.
 * Sem segunda via, a conferência do dinheiro passa a depender de alguém
 * transcrever a tela à mão.
 *
 * Manda para a FILA (o mesmo caminho da abertura e do fechamento), então sai
 * nas impressoras que a loja marcou para papel de caixa, esteja o navegador
 * aberto ou não.
 */
export default function BotaoImprimirCaixa({ sessionId }: { sessionId: string }) {
  const [estado, setEstado] = useState<"parado" | "enviando" | "ok" | "erro">("parado");
  const [erro, setErro] = useState("");

  const imprimir = async (tipo: "ABERTURA" | "FECHAMENTO") => {
    setEstado("enviando");
    setErro("");
    try {
      const r = await fetch("/api/cash-session/imprimir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, tipo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || "Não consegui imprimir."); setEstado("erro"); return; }
      setEstado("ok");
      setTimeout(() => setEstado("parado"), 3000);
    } catch {
      setErro("Sem conexão.");
      setEstado("erro");
    }
  };

  const botao: React.CSSProperties = {
    padding: "6px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#FFF",
    color: "#475569", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  };

  if (estado === "ok") {
    return <span style={{ fontSize: "0.76rem", fontWeight: 800, color: "#0F766E" }}>✅ Enviado para a impressora</span>;
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" style={botao} disabled={estado === "enviando"} onClick={() => imprimir("FECHAMENTO")}>
        🖨️ {estado === "enviando" ? "Enviando…" : "Imprimir fechamento"}
      </button>
      <button type="button" style={botao} disabled={estado === "enviando"} onClick={() => imprimir("ABERTURA")}>
        🖨️ Abertura
      </button>
      {erro && <span style={{ fontSize: "0.74rem", color: "#B71C1C", fontWeight: 700 }}>{erro}</span>}
    </div>
  );
}
