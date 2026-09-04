"use client";

import { useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";

/**
 * Formulário de login do garçom. Simples de propósito: é digitado no celular,
 * muitas vezes com a mão molhada, entre uma mesa e outra.
 */
export default function LoginDoGarcom({
  slug,
  nomeDaLoja,
  logo,
}: {
  slug: string;
  nomeDaLoja: string;
  logo: string | null;
}) {
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  // Logo que não carrega (URL antiga, blob apagado) vira o ícone padrão em
  // vez do quadrado quebrado do navegador.
  const [logoQuebrada, setLogoQuebrada] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setErro("");
    setEnviando(true);
    try {
      const res = await fetch("/api/garcom/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, login, senha }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data?.error || "Não foi possível entrar. Tente de novo.");
        return;
      }
      // Navegação completa, e não router.push: a página de mesas é renderizada
      // no servidor lendo o cookie que acabou de ser gravado.
      window.location.assign(data?.destino || `/garcom/${encodeURIComponent(slug)}/mesas`);
    } catch {
      setErro("Sem conexão. Verifique a internet e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const campo: React.CSSProperties = {
    width: "100%", padding: "14px 16px", borderRadius: 12,
    border: "1.5px solid #E2E8F0", fontSize: 16, fontFamily: "inherit",
    background: "#fff", color: "#0F172A", outline: "none",
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, background: "linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 100%)",
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    }}>
      <form onSubmit={entrar} style={{
        width: "100%", maxWidth: 380, background: "#fff", borderRadius: 20, padding: 28,
        boxShadow: "0 10px 40px rgba(15,23,42,0.08)", border: "1px solid #E2E8F0",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 24 }}>
          {logo && !logoQuebrada ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt=""
              onError={() => setLogoQuebrada(true)}
              style={{ width: 64, height: 64, borderRadius: 16, objectFit: "cover" }}
            />
          ) : (
            <div style={{
              width: 64, height: 64, borderRadius: 16, background: "#7C3AED",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30,
              boxShadow: "0 2px 8px rgba(124,58,237,0.25)",
            }}>🍽️</div>
          )}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", letterSpacing: 1, textTransform: "uppercase" }}>
              Acesso do garçom
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 800, color: "#0F172A" }}>{nomeDaLoja}</h1>
          </div>
        </div>

        <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
          Usuário
        </label>
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          inputMode="text"
          placeholder="seu login"
          required
          style={{ ...campo, marginBottom: 14 }}
        />

        <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
          Senha
        </label>
        <div style={{ position: "relative", marginBottom: 18 }}>
          <input
            type={mostrarSenha ? "text" : "password"}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••"
            required
            style={{ ...campo, paddingRight: 48 }}
          />
          <button
            type="button"
            onClick={() => setMostrarSenha((v) => !v)}
            aria-label={mostrarSenha ? "Esconder senha" : "Mostrar senha"}
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", padding: 8, cursor: "pointer", color: "#64748B",
            }}
          >
            {mostrarSenha ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </div>

        {erro && (
          <div role="alert" style={{
            background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA",
            borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 600, marginBottom: 14,
          }}>
            {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={enviando}
          style={{
            width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
            background: "#7C3AED", color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: "0 4px 12px rgba(124,58,237,0.3)", opacity: enviando ? 0.7 : 1,
          }}
        >
          <LogIn size={18} /> {enviando ? "Entrando..." : "Entrar"}
        </button>

        <p style={{ margin: "18px 0 0", fontSize: 12, color: "#94A3B8", textAlign: "center", lineHeight: 1.5 }}>
          Esqueceu a senha? Peça ao gerente para redefinir na aba Garçons do painel.
        </p>
      </form>
    </div>
  );
}
