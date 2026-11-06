"use client";

export default function BotaoImprimir() {
  return (
    <button type="button" onClick={() => window.print()} style={{
      padding: "10px 18px", borderRadius: 10, border: "none", background: "#0F766E", color: "#fff",
      fontSize: 15, fontWeight: 800, cursor: "pointer",
    }}>🖨️ Imprimir</button>
  );
}
