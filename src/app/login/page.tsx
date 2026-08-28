"use client";
import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

const CHAVE_LEMBRAR = "fh_remember";
const CHAVE_EMAIL = "fh_remember_email";

export default function FireHubLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const passwordRef = useRef<HTMLInputElement>(null);

  // Restaura o acesso lembrado: checkbox marcado e e-mail já preenchido.
  // Quem desmarcou no login anterior não tem nada guardado e cai no formulário limpo.
  useEffect(() => {
    try {
      if (localStorage.getItem(CHAVE_LEMBRAR) !== "true") return;
      setRememberMe(true);
      const salvo = localStorage.getItem(CHAVE_EMAIL);
      if (salvo) {
        setEmail(salvo);
        passwordRef.current?.focus();
      }
    } catch {
      // navegador com storage bloqueado: segue com o formulário em branco
    }
  }, []);

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
      // Preferência de lembrar acesso: gravada quando marcada, apagada quando não.
      try {
        if (rememberMe) {
          localStorage.setItem(CHAVE_LEMBRAR, "true");
          localStorage.setItem(CHAVE_EMAIL, email);
        } else {
          localStorage.removeItem(CHAVE_LEMBRAR);
          localStorage.removeItem(CHAVE_EMAIL);
        }
      } catch {}
      // ── VOLTAR PARA ONDE A PESSOA QUERIA IR ──────────────────────────────
      //
      // O middleware já grava `callbackUrl` ao mandar para cá (middleware.ts),
      // mas isto aqui NUNCA lia o parâmetro: o login sempre despejava em
      // /store. Quem escaneava o QR de uma etiqueta com a sessão expirada —
      // o caso mais comum no celular de cozinha — entrava e aterrissava na
      // home, sem nenhuma pista de qual etiqueta tinha lido.
      //
      // Só caminho interno é aceito: um `callbackUrl` absoluto vindo da barra
      // de endereço mandaria o lojista recém-logado para fora do sistema.
      const bruto = new URLSearchParams(window.location.search).get("callbackUrl") || "";
      let destino = "";
      try {
        // Aceita "/store/estoque" e também a URL absoluta deste mesmo site
        // (é o formato que o middleware grava, com `request.url`).
        const u = new URL(bruto, window.location.origin);
        if (u.origin === window.location.origin && u.pathname.startsWith("/") && !u.pathname.startsWith("//")) {
          destino = u.pathname + u.search;
        }
      } catch {}
      // Nunca voltar para o próprio login: viraria laço.
      if (destino.startsWith("/login")) destino = "";

      if (destino) {
        window.location.href = destino;
        return;
      }

      // Busca role para redirecionar corretamente
      const meRes = await fetch("/api/me");
      const meData = meRes.ok ? await meRes.json() : null;
      const role = meData?.role;
      // Redireciona com navegação completa (full page) para garantir que cookies sejam lidos
      if (role === "AMBASSADOR") {
        window.location.href = "/embaixador";
      } else {
        window.location.href = role === "ADMIN" ? "/admin" : "/store";
      }
    } else {
      setError("E-mail ou senha incorretos. Tente novamente.");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #B91C1C 0%, #DC2626 50%, #991B1B 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', sans-serif",
      padding: "20px"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .fhl-card {
          background: #fff;
          border-radius: 24px;
          padding: 48px 40px;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 25px 60px rgba(0,0,0,0.3);
        }
        .fhl-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          justify-content: center;
          margin-bottom: 32px;
        }
        .fhl-logo-text { font-size: 1.8rem; font-weight: 800; letter-spacing: -1px; }
        .fhl-logo-text span:first-child { color: #DC2626; }
        .fhl-logo-text span:last-child { color: #374151; }
        .fhl-subtitle {
          text-align: center;
          color: #6B7280;
          font-size: 0.9rem;
          margin-bottom: 32px;
        }
        .fhl-label {
          display: block;
          font-size: 0.85rem;
          font-weight: 600;
          color: #374151;
          margin-bottom: 6px;
        }
        .fhl-input {
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
        .fhl-input:focus { border-color: #DC2626; }
        .fhl-pass-wrap { position: relative; }
        .fhl-input-pass { padding-right: 46px; }
        .fhl-eye {
          position: absolute;
          top: 13px;
          right: 12px;
          background: none;
          border: none;
          padding: 2px;
          line-height: 0;
          color: #9CA3AF;
          cursor: pointer;
          border-radius: 6px;
          transition: color 0.2s;
        }
        .fhl-eye:hover { color: #DC2626; }
        .fhl-eye:focus-visible { outline: 2px solid #DC2626; outline-offset: 2px; }
        .fhl-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #DC2626, #B91C1C);
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
        .fhl-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(220,38,38,0.4); }
        .fhl-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .fhl-error {
          background: #FEF2F2;
          border: 1px solid #FECACA;
          color: #DC2626;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.85rem;
          margin-bottom: 16px;
          text-align: center;
        }
        .fhl-back {
          display: block;
          text-align: center;
          margin-top: 24px;
          color: #9CA3AF;
          font-size: 0.85rem;
          text-decoration: none;
        }
        .fhl-back:hover { color: #DC2626; }
        .fhl-divider {
          text-align: center;
          color: #9CA3AF;
          font-size: 0.75rem;
          margin: 20px 0;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .fhl-divider::before, .fhl-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #E5E7EB;
        }
        .fhl-whats {
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
        .fhl-whats:hover { background: #25D366; color: #fff; }
      `}</style>

      <div className="fhl-card">
        <div className="fhl-logo">
          <img src="/firehub-flame.png" alt="" style={{ height: "36px", width: "36px", borderRadius: "8px" }} />
          <div className="fhl-logo-text">
            <span>FIRE</span><span>HUB</span>
          </div>
        </div>

        <p className="fhl-subtitle">Acesse sua conta para gerenciar seu restaurante</p>

        {error && <div className="fhl-error">⚠️ {error}</div>}

        <form onSubmit={handleSubmit}>
          <label className="fhl-label" htmlFor="fhl-email">E-mail</label>
          <input
            id="fhl-email"
            name="email"
            type="email"
            autoComplete="username"
            className="fhl-input"
            placeholder="seu@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />

          <label className="fhl-label" htmlFor="fhl-password">Senha</label>
          <div className="fhl-pass-wrap">
            <input
              id="fhl-password"
              name="password"
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              className="fhl-input fhl-input-pass"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="fhl-eye"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              title={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Lembrar acesso + Esqueci senha */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", marginTop: "-8px" }}>
            <label
              style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.85rem", color: "#374151" }}
              title="Guarda seu e-mail neste computador e deixa esta opção já marcada no próximo acesso."
            >
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => {
                  const marcado = e.target.checked;
                  setRememberMe(marcado);
                  // Desmarcou: esquece na hora, mesmo que não chegue a entrar agora.
                  if (!marcado) {
                    try {
                      localStorage.removeItem(CHAVE_LEMBRAR);
                      localStorage.removeItem(CHAVE_EMAIL);
                    } catch {}
                  }
                }}
                style={{ accentColor: "#DC2626", width: "16px", height: "16px", cursor: "pointer" }}
              />
              Lembrar acesso
            </label>
            <a href="/esqueci-senha" style={{ fontSize: "0.85rem", color: "#DC2626", textDecoration: "none", fontWeight: 600 }}>
              Esqueci minha senha
            </a>
          </div>

          <button type="submit" className="fhl-btn" disabled={loading}>
            {loading ? "Entrando..." : "🔥 Entrar no FireHub"}
          </button>
        </form>

        <div className="fhl-divider">ou</div>

        <a
          href="https://wa.me/5522981118514?text=Ol%C3%A1!%20Preciso%20de%20ajuda%20para%20acessar%20o%20FireHub"
          className="fhl-whats"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Suporte via WhatsApp
        </a>

        <div style={{ borderTop: "1px solid #E5E7EB", marginTop: "20px", paddingTop: "20px", textAlign: "center" }}>
          <p style={{ fontSize: "0.85rem", color: "#6B7280", marginBottom: "10px" }}>Não tem conta ainda?</p>
          <a href="https://www.firehubfood.com.br/cadastro" style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "10px 24px", background: "#FEF2F2", color: "#DC2626",
            borderRadius: "10px", fontWeight: 700, fontSize: "0.88rem",
            textDecoration: "none", border: "1.5px solid #FECACA",
          }}>
            🔥 Teste grátis por 15 dias
          </a>
        </div>

        <a
          href="/embaixador"
          style={{
            marginTop: "18px",
            padding: "12px 16px",
            background: "#F8FAFC",
            borderRadius: "12px",
            border: "1.5px solid #E2E8F0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            textDecoration: "none",
            transition: "all 0.2s ease",
          }}
          onMouseOver={e => {
            e.currentTarget.style.borderColor = "#DC2626";
            e.currentTarget.style.background = "#FEF2F2";
          }}
          onMouseOut={e => {
            e.currentTarget.style.borderColor = "#E2E8F0";
            e.currentTarget.style.background = "#F8FAFC";
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.1rem" }}>🤝</span>
            <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "#334155" }}>
              Você é embaixador(a)?
            </span>
          </div>
          <span style={{
            fontSize: "0.85rem",
            fontWeight: 800,
            color: "#DC2626",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px"
          }}>
            Acesse aqui →
          </span>
        </a>

        <a href="https://www.firehubfood.com.br" className="fhl-back">← Voltar para o site</a>
      </div>
    </div>
  );
}
