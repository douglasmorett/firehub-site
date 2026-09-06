"use client";

import { useEffect, useState } from "react";
import { ehErroDeChunk, recarregarParaBuildNovo } from "@/lib/erro-de-chunk";

export default function StoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Enquanto a recarga não acontece o React ainda pinta esta tela por um
  // instante; sem este estado o lojista via um "erro" vermelho piscando antes
  // de a página voltar sozinha.
  const [recarregando, setRecarregando] = useState(false);

  useEffect(() => {
    console.error("[Store Error]", error);

    // Deploy com a aba aberta: o arquivo que a tela pede sumiu do servidor.
    // Não é bug da aplicação e `reset()` não resolve — ele remonta o mesmo
    // componente, que pede o mesmo arquivo inexistente. Ver lib/erro-de-chunk.ts.
    if (ehErroDeChunk(error) && recarregarParaBuildNovo()) {
      setRecarregando(true);
    }
  }, [error]);

  const chunk = ehErroDeChunk(error);

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
        background: recarregando ? "rgba(59,130,246,0.08)" : "rgba(239,68,68,0.08)",
        border: `1px solid ${recarregando ? "rgba(59,130,246,0.2)" : "rgba(239,68,68,0.2)"}`,
        borderRadius: 16,
        padding: "2rem",
        maxWidth: 500,
      }}>
        {recarregando ? (
          <>
            <h2 style={{ color: "#2563EB", fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.5rem" }}>
              🔄 Atualizando o sistema
            </h2>
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
              Saiu uma versão nova enquanto esta tela estava aberta. Recarregando, é só um instante.
            </p>
          </>
        ) : (
          <>
            <h2 style={{ color: "#EF4444", fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.5rem" }}>
              ⚠️ Erro ao carregar a loja
            </h2>
            <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1rem" }}>
              {chunk
                ? "O sistema foi atualizado e esta aba ficou com a versão antiga. Recarregue a página para continuar."
                : error.message || "Ocorreu um erro inesperado. Tente novamente."}
            </p>
            {error.digest && (
              <p style={{ color: "#94a3b8", fontSize: "0.75rem", marginBottom: "1rem" }}>
                Código: {error.digest}
              </p>
            )}
            <button
              // Erro de chunk: recarregar de verdade é a única saída, porque
              // `reset()` remonta o componente que pede o arquivo que sumiu.
              onClick={() => (chunk ? window.location.reload() : reset())}
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
              🔄 {chunk ? "Recarregar página" : "Tentar novamente"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
