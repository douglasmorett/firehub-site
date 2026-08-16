"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";

export default function AmbassadorLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await signIn("credentials", {
        email: email.trim(),
        password: password.trim(),
        isAmbassador: "true",
        loginType: "ambassador",
        redirect: false,
      });

      if (res?.ok) {
        window.location.href = "/embaixador";
      } else {
        setError("E-mail ou senha de embaixador incorretos. Verifique suas credenciais.");
      }
    } catch (err: any) {
      console.error(err);
      setError("Erro ao autenticar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: "24px 16px",
        color: "#F8FAFC",
      }}
    >
      <style>{`
        * { box-sizing: border-box; }
        .amb-login-card {
          background: #1E293B;
          border: 1px solid #334155;
          border-radius: 20px;
          padding: 40px 32px;
          width: 100%;
          max-width: 440px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        .amb-input {
          width: 100%;
          padding: 13px 16px;
          background: #0F172A;
          border: 1.5px solid #334155;
          border-radius: 10px;
          color: #F8FAFC;
          font-size: 0.95rem;
          font-family: inherit;
          outline: none;
          transition: all 0.2s;
          margin-bottom: 18px;
        }
        .amb-input:focus {
          border-color: #EF4444;
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2);
        }
        .amb-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%);
          color: #FFF;
          border: none;
          border-radius: 10px;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 6px;
        }
        .amb-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px -4px rgba(220, 38, 38, 0.4);
        }
        .amb-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
      `}</style>

      <div className="amb-login-card">
        {/* Header Branding */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <img src="/firehub-flame.png" alt="FireHub" style={{ width: 36, height: 36, borderRadius: "8px" }} />
            <div style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.5px" }}>
              <span style={{ color: "#EF4444" }}>FIRE</span><span style={{ color: "#FFF" }}>HUB</span>
            </div>
          </div>
          <div style={{ display: "inline-block", background: "rgba(239, 68, 68, 0.15)", color: "#FCA5A5", border: "1px solid rgba(239, 68, 68, 0.3)", padding: "4px 12px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
            🤝 Portal do Embaixador
          </div>
          <p style={{ color: "#94A3B8", fontSize: "0.88rem", marginTop: "4px", lineHeight: "1.4" }}>
            Acesse seu painel exclusivo para gerenciar suas lojas indicadas e comissões
          </p>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#FCA5A5",
              padding: "12px 14px",
              borderRadius: "10px",
              fontSize: "0.85rem",
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#CBD5E1", marginBottom: "6px" }}>
            E-mail do Embaixador
          </label>
          <input
            type="email"
            className="amb-input"
            placeholder="seu.email@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#CBD5E1" }}>
              Senha de Acesso
            </label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                background: "none",
                border: "none",
                color: "#94A3B8",
                fontSize: "0.75rem",
                cursor: "pointer",
                padding: "2px 4px",
              }}
            >
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          <input
            type={showPassword ? "text" : "password"}
            className="amb-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button type="submit" className="amb-btn" disabled={loading}>
            {loading ? "Entrando..." : "🚀 Acessar Painel do Embaixador"}
          </button>
        </form>

        <div style={{ borderTop: "1px solid #334155", marginTop: "28px", paddingTop: "20px", textAlign: "center" }}>
          <p style={{ fontSize: "0.85rem", color: "#94A3B8", marginBottom: "8px" }}>
            É proprietário ou gerente de restaurante?
          </p>
          <a
            href="/login"
            style={{
              color: "#38BDF8",
              fontSize: "0.85rem",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            ← Acessar Painel do Lojista (Restaurante)
          </a>
        </div>

        <div style={{ textAlign: "center", marginTop: "16px" }}>
          <a
            href="https://firehubfood.com.br"
            style={{
              color: "#64748B",
              fontSize: "0.8rem",
              textDecoration: "none",
            }}
          >
            ← Voltar para o site FireHub
          </a>
        </div>
      </div>
    </div>
  );
}
