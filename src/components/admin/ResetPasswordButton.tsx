"use client";
import { useState } from "react";

/**
 * "Redefinir senha" da conta de uma loja, para o suporte.
 *
 * "Esqueci a senha" depende de e-mail chegar — e o e-mail nem sempre chega
 * (Hotmail no spam, cadastro com e-mail antigo). Quando o lojista liga, o
 * admin redefine aqui para a senha padrão e o lojista troca depois. Com
 * confirmação explícita, porque um clique sem querer derruba a senha de uma
 * loja em operação.
 */
export default function ResetPasswordButton({ userId, storeName, email }: { userId: string; storeName: string; email?: string | null }) {
  const [confirmando, setConfirmando] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);

  const redefinir = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFeito(data.senha || "123456");
        setConfirmando(false);
      } else {
        alert(data.error || "Não foi possível redefinir a senha.");
      }
    } catch {
      alert("Erro ao conectar com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  if (feito) {
    return (
      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#15803D", background: "#F0FDF4", border: "1px solid #BBF7D0", padding: "4px 8px", borderRadius: 6, whiteSpace: "nowrap" }} title="A loja entra com esta senha e troca depois em Minha Loja">
        ✅ Senha agora é <b>{feito}</b>
      </span>
    );
  }

  if (confirmando) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFFBEB", border: "1px solid #FDE68A", padding: "4px 8px", borderRadius: 6, fontSize: "0.75rem", color: "#92400E", fontWeight: 700, whiteSpace: "nowrap" }}>
        Redefinir a senha de <b>{storeName}</b>{email ? ` (${email})` : ""} para <b>123456</b>?
        <button
          onClick={redefinir}
          disabled={loading}
          style={{ background: "#D97706", color: "#fff", border: "none", padding: "3px 8px", borderRadius: 5, fontWeight: 800, cursor: "pointer", fontSize: "0.72rem" }}
        >
          {loading ? "Redefinindo..." : "Sim, redefinir"}
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={loading}
          style={{ background: "#fff", color: "#64748B", border: "1px solid #CBD5E1", padding: "3px 8px", borderRadius: 5, fontWeight: 700, cursor: "pointer", fontSize: "0.72rem" }}
        >
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirmando(true)}
      style={{
        background: "rgba(217,119,6,0.1)",
        color: "#B45309",
        border: "1px solid rgba(217,119,6,0.35)",
        padding: "4px 8px",
        borderRadius: "6px",
        fontSize: "0.75rem",
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      title="Volta a senha da conta para 123456 (o lojista troca depois)"
    >
      🔑 Redefinir senha
    </button>
  );
}
