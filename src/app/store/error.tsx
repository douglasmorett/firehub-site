"use client";

import { useEffect } from "react";

export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Store Error]", error);
  }, [error]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "60vh",
      padding: "2rem",
      textAlign: "center",
    }}>
      <div style={{
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.2)",
        borderRadius: 16,
        padding: "2rem",
        maxWidth: 500,
      }}>
        <h2 style={{ color: "#EF4444", fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.5rem" }}>
          ⚠️ Erro ao carregar a loja
        </h2>
        <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1rem" }}>
          {error.message || "Ocorreu um erro inesperado. Tente novamente."}
        </p>
        {error.digest && (
          <p style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: "1rem" }}>
            Código: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            background: "linear-gradient(135deg, #EF4444, #DC2626)",
            color: "#fff",
            border: "none",
            padding: "10px 24px",
            borderRadius: 10,
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "0.9rem",
          }}
        >
          🔄 Tentar novamente
        </button>
      </div>
    </div>
  );
}
