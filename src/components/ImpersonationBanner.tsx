"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";

/**
 * Faixa fixa no topo enquanto o admin está acessando a conta de uma loja.
 *
 * Serve a duas coisas, e a segunda importa tanto quanto a primeira:
 *
 * 1. **Sair num clique.** A impersonação SUBSTITUI a sessão do admin pela da
 *    loja, e a checagem que a autoriza exige `role === "ADMIN"` — ou seja,
 *    depois de entrar o admin perde exatamente a permissão que precisaria para
 *    desfazer. Antes disto, a única saída era sair e entrar de novo, a cada
 *    atendimento.
 *
 * 2. **Deixar claro em nome de quem se está agindo.** Sem aviso na tela, é
 *    questão de tempo até alguém do suporte fechar o caixa, cancelar um pedido
 *    ou mandar mensagem ao cliente achando que está na própria conta. A faixa é
 *    vermelha e fixa de propósito.
 */
export default function ImpersonationBanner({ storeName }: { storeName: string }) {
  const [voltando, setVoltando] = useState(false);

  const voltar = async () => {
    setVoltando(true);
    try {
      // Quem decide o destino é o `impersonatedBy` do token, no servidor. Aqui
      // não vai id nenhum — não há o que forjar no navegador.
      await signIn("credentials", { returnToAdmin: "true", callbackUrl: "/admin" });
    } catch {
      setVoltando(false);
      alert("Não consegui voltar para o admin. Saia e entre novamente.");
    }
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 9999,
        background: "linear-gradient(135deg,#B91C1C,#DC2626)",
        color: "#fff",
        padding: "8px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        flexWrap: "wrap",
        fontSize: "0.82rem",
        fontWeight: 700,
        boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
      }}
    >
      <span style={{ minWidth: "fit-content" }}>
        👁 Você está acessando como <strong>{storeName}</strong> — modo suporte
      </span>
      <button
        onClick={voltar}
        disabled={voltando}
        style={{
          minWidth: "fit-content",
          padding: "5px 14px",
          borderRadius: 8,
          border: "1.5px solid rgba(255,255,255,0.75)",
          background: voltando ? "rgba(255,255,255,0.25)" : "#fff",
          color: voltando ? "#fff" : "#B91C1C",
          fontWeight: 800,
          fontSize: "0.8rem",
          cursor: voltando ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {voltando ? "Voltando…" : "↩ Voltar ao admin"}
      </button>
    </div>
  );
}
