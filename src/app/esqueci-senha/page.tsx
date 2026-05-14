"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setLoading(false);
    if (res.ok) setSent(true);
    else setError("Erro ao enviar. Tente novamente.");
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#B91C1C 0%,#DC2626 50%,#991B1B 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter',sans-serif", padding: "20px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; }`}</style>
      <div style={{ background: "#fff", borderRadius: "24px", padding: "48px 40px", width: "100%", maxWidth: "420px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "center", marginBottom: "32px" }}>
          <img src="/firehub-flame.png" alt="" style={{ height: "36px", width: "36px", borderRadius: "8px" }} />
          <div style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-1px" }}>
            <span style={{ color: "#DC2626" }}>FIRE</span><span style={{ color: "#374151" }}>HUB</span>
          </div>
        </div>

        {sent ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: "16px" }}>📧</div>
            <h2 style={{ color: "#1E293B", fontWeight: 800, marginBottom: "12px" }}>E-mail enviado!</h2>
            <p style={{ color: "#64748B", fontSize: "0.9rem", lineHeight: 1.6, marginBottom: "28px" }}>
              Verifique sua caixa de entrada em <strong>{email}</strong> e clique no link para criar uma nova senha.
            </p>
            <p style={{ color: "#94A3B8", fontSize: "0.78rem", marginBottom: "24px" }}>
              O link expira em 1 hora. Verifique também a pasta de spam.
            </p>
            <a href="/login" style={{ display: "block", background: "linear-gradient(135deg,#DC2626,#B91C1C)", color: "#fff", textDecoration: "none", padding: "12px", borderRadius: "10px", fontWeight: 700, textAlign: "center" }}>
              ← Voltar para o login
            </a>
          </div>
        ) : (
          <>
            <h2 style={{ color: "#1E293B", fontWeight: 800, fontSize: "1.2rem", marginBottom: "8px", textAlign: "center" }}>Esqueci minha senha</h2>
            <p style={{ color: "#6B7280", fontSize: "0.85rem", textAlign: "center", marginBottom: "28px", lineHeight: 1.5 }}>
              Digite o e-mail da sua conta e enviaremos um link para criar uma nova senha.
            </p>
            {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: "8px", fontSize: "0.85rem", marginBottom: "16px", textAlign: "center" }}>{error}</div>}
            <form onSubmit={handleSubmit}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>E-mail cadastrado</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                style={{ width: "100%", padding: "12px 16px", border: "2px solid #E5E7EB", borderRadius: "10px", fontSize: "0.95rem", fontFamily: "inherit", outline: "none", marginBottom: "20px" }} />
              <button type="submit" disabled={loading}
                style={{ width: "100%", padding: "14px", background: "linear-gradient(135deg,#DC2626,#B91C1C)", color: "#fff", border: "none", borderRadius: "10px", fontSize: "1rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: loading ? 0.7 : 1 }}>
                {loading ? "Enviando..." : "📧 Enviar link de recuperação"}
              </button>
            </form>
            <a href="/login" style={{ display: "block", textAlign: "center", marginTop: "20px", color: "#9CA3AF", fontSize: "0.85rem", textDecoration: "none" }}>← Voltar para o login</a>
          </>
        )}
      </div>
    </div>
  );
}
