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
        background: "linear-gradient(135deg, #B91C1C 0%, #DC2626 50%, #991B1B 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: "24px 16px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        .amb-login-card {
          background: #FFFFFF;
          border-radius: 24px;
          padding: 44px 36px;
          width: 100%;
          max-width: 440px;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.35);
        }
        .amb-input {
          width: 100%;
          padding: 13px 16px;
          background: #F8FAFC;
          border: 1.5px solid #CBD5E1;
          border-radius: 10px;
          color: #0F172A;
          font-size: 0.95rem;
          font-family: inherit;
          outline: none;
          transition: all 0.2s;
          margin-bottom: 18px;
        }
        .amb-input:focus {
          border-color: #DC2626;
          background: #FFFFFF;
          box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.15);
        }
        .amb-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%);
          color: #FFF;
          border: none;
          border-radius: 10px;
          font-size: 1rem;
          font-weight: 800;
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
            <img src="/firehub-flame.png" alt="FireHub" style={{ width: 38, height: 38, borderRadius: "8px" }} />
            <div style={{ fontSize: "1.7rem", fontWeight: 900, letterSpacing: "-0.5px" }}>
              <span style={{ color: "#DC2626" }}>FIRE</span><span style={{ color: "#0F172A" }}>HUB</span>
            </div>
          </div>
          <div>
            <span style={{ display: "inline-block", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA", padding: "4px 14px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
              🤝 Portal do Embaixador
            </span>
          </div>
          <p style={{ color: "#64748B", fontSize: "0.88rem", marginTop: "4px", lineHeight: "1.4" }}>
            Acesse seu painel exclusivo para acompanhar suas lojas indicadas e comissões
          </p>
        </div>

        {error && (
          <div
            style={{
              background: "#FEF2F2",
              border: "1px solid #FECACA",
              color: "#DC2626",
              padding: "12px 14px",
              borderRadius: "10px",
              fontSize: "0.85rem",
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontWeight: 600,
            }}
          >
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
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
            <label style={{ fontSize: "0.85rem", fontWeight: 700, color: "#334155" }}>
              Senha de Acesso
            </label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                background: "none",
                border: "none",
                color: "#64748B",
                fontSize: "0.75rem",
                cursor: "pointer",
                padding: "2px 4px",
                fontWeight: 600,
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

        <div style={{ borderTop: "1px solid #E2E8F0", marginTop: "28px", paddingTop: "20px", textAlign: "center" }}>
          <p style={{ fontSize: "0.85rem", color: "#64748B", marginBottom: "8px" }}>
            É proprietário ou gerente de restaurante?
          </p>
          <a
            href="/login"
            style={{
              color: "#DC2626",
              fontSize: "0.85rem",
              fontWeight: 700,
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
              color: "#94A3B8",
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
