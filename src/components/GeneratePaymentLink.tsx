"use client";

import { useState, useEffect } from "react";

export default function GeneratePaymentLink({ orderId, shortId }: { orderId: string; shortId: string }) {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [url, setUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const generate = async () => {
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/generate-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (res.ok && data.boletoUrl) {
        setUrl(data.boletoUrl);
        setStatus("success");
      } else {
        setErrorMsg(data.error || "Falha ao gerar link");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Erro de conexão");
      setStatus("error");
    }
  };

  useEffect(() => { generate(); }, []);

  if (status === "success" && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        width: "100%", padding: "11px", borderRadius: 10,
        background: "linear-gradient(135deg, #16A34A, #22C55E)", color: "#fff",
        fontWeight: 800, fontSize: "0.9rem", textDecoration: "none",
        boxShadow: "0 3px 10px rgba(22,163,74,0.25)",
      }}>
        💳 Pagar Agora
      </a>
    );
  }

  if (status === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{
          padding: "10px 14px", borderRadius: 8,
          background: "#FEF2F2", border: "1px solid #FECACA",
          fontSize: "0.8rem", color: "#DC2626", fontWeight: 600, textAlign: "center",
        }}>
          ❌ {errorMsg}
        </div>
        <button onClick={generate} style={{
          padding: "8px", borderRadius: 8, border: "1.5px solid #E2E8F0",
          background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.82rem",
          cursor: "pointer", fontFamily: "inherit",
        }}>
          🔄 Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div style={{
      padding: "11px", borderRadius: 10,
      background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#fff",
      fontWeight: 700, fontSize: "0.85rem", textAlign: "center",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    }}>
      <span style={{
        display: "inline-block", width: 16, height: 16, border: "2.5px solid #fff",
        borderTopColor: "transparent", borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      Gerando link de pagamento...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
