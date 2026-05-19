"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function IceboxLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.ok) {
      if (rememberMe) {
        localStorage.setItem("fh_remember", "true");
      }
      router.push("/icebox/compras");
    } else {
      setError("E-mail ou senha incorretos. Tente novamente.");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0D47A1 0%, #1565C0 40%, #1976D2 70%, #0D47A1 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
      padding: "20px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .ice-card {
          background: #fff;
          border-radius: 24px;
          padding: 48px 40px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 25px 60px rgba(0,0,0,0.3);
        }
        .ice-logo {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: center;
          margin-bottom: 8px;
        }
        .ice-logo-icon {
          width: 52px;
          height: 52px;
          background: linear-gradient(135deg, #0D47A1, #1565C0);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.8rem;
          box-shadow: 0 8px 24px rgba(13,71,161,0.3);
        }
        .ice-logo-text {
          font-size: 1.2rem;
          font-weight: 800;
          letter-spacing: -0.5px;
          line-height: 1.1;
        }
        .ice-logo-text .brand { color: #0D47A1; font-size: 1.5rem; }
        .ice-logo-text .sub { color: #64748B; font-size: 0.82rem; font-weight: 600; }
        .ice-subtitle {
          text-align: center;
          color: #6B7280;
          font-size: 0.88rem;
          margin: 20px 0 28px;
        }
        .ice-label {
          display: block;
          font-size: 0.85rem;
          font-weight: 600;
          color: #374151;
          margin-bottom: 6px;
        }
        .ice-input {
          width: 100%;
          padding: 12px 16px;
          border: 2px solid #E5E7EB;
          border-radius: 10px;
          font-size: 0.95rem;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s;
          margin-bottom: 20px;
        }
        .ice-input:focus { border-color: #1565C0; }
        .ice-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #0D47A1, #1565C0);
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.2s;
          margin-top: 4px;
        }
        .ice-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(21,101,192,0.4); }
        .ice-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .ice-error {
          background: #FEF2F2;
          border: 1px solid #FECACA;
          color: #DC2626;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 16px;
          text-align: center;
        }
        .ice-divider {
          text-align: center;
          color: #9CA3AF;
          font-size: 0.75rem;
          margin: 20px 0;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .ice-divider::before, .ice-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #E5E7EB;
        }
        .ice-whats {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px;
          border: 2px solid #25D366;
          border-radius: 10px;
          color: #25D366;
          font-weight: 600;
          font-size: 0.9rem;
          text-decoration: none;
          transition: all 0.2s;
        }
        .ice-whats:hover { background: #25D366; color: #fff; }
      `}</style>

      <div className="ice-card">
        {/* Logo Icebox */}
        <div className="ice-logo">
          <div className="ice-logo-icon">🧊</div>
          <div className="ice-logo-text">
            <div className="brand">Icebox</div>
            <div className="sub">Distribuidora</div>
          </div>
        </div>

        <p className="ice-subtitle">
          Acesse sua conta para ver produtos e fazer pedidos
        </p>

        {error && <div className="ice-error">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <label className="ice-label">E-mail</label>
          <input
            type="email"
            className="ice-input"
            placeholder="seu@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />

          <label className="ice-label">Senha</label>
          <input
            type="password"
            className="ice-input"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          {/* Lembrar acesso + Esqueci senha */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", marginTop: "-8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.85rem", color: "#374151" }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                style={{ accentColor: "#1565C0", width: "16px", height: "16px", cursor: "pointer" }}
              />
              Lembrar acesso
            </label>
            <a href="/esqueci-senha" style={{ fontSize: "0.85rem", color: "#1565C0", textDecoration: "none", fontWeight: 600 }}>
              Esqueci minha senha
            </a>
          </div>

          <button type="submit" className="ice-btn" disabled={loading}>
            {loading ? "Entrando..." : "🧊 Entrar na Icebox"}
          </button>
        </form>

        <div className="ice-divider">ou</div>

        <a
          href="https://wa.me/5522981118514?text=Ol%C3%A1!%20Preciso%20de%20ajuda%20para%20acessar%20a%20Icebox%20Distribuidora"
          className="ice-whats"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Falar com um consultor
        </a>

        <div style={{ borderTop: "1px solid #E5E7EB", marginTop: "20px", paddingTop: "20px", textAlign: "center" }}>
          <p style={{ fontSize: "0.85rem", color: "#6B7280", marginBottom: "10px" }}>Não tem cadastro?</p>
          <p style={{ fontSize: "0.82rem", color: "#94A3B8" }}>
            Fale com um de nossos consultores para criar sua conta.
          </p>
        </div>
      </div>
    </div>
  );
}
