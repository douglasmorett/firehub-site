"use client";
import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { setError("A senha deve ter pelo menos 6 caracteres."); return; }
    if (password !== confirm) { setError("As senhas não coincidem."); return; }
    setLoading(true); setError("");
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setDone(true);
    else setError(data.error || "Token inválido ou expirado.");
  };

  return (
    <div style={{ background: "#fff", borderRadius: "24px", padding: "48px 40px", width: "100%", maxWidth: "420px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "center", marginBottom: "32px" }}>
        <img src="/firehub-flame.png" alt="" style={{ height: "36px", width: "36px", borderRadius: "8px" }} />
        <div style={{ fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-1px" }}>
          <span style={{ color: "#DC2626" }}>FIRE</span><span style={{ color: "#374151" }}>HUB</span>
        </div>
      </div>

      {done ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "16px" }}>✅</div>
          <h2 style={{ color: "#1E293B", fontWeight: 800, marginBottom: "12px" }}>Senha redefinida!</h2>
          <p style={{ color: "#64748B", fontSize: "0.9rem", marginBottom: "28px" }}>Sua senha foi atualizada com sucesso. Faça login com a nova senha.</p>
          <a href="/login" style={{ display: "block", background: "linear-gradient(135deg,#DC2626,#B91C1C)", color: "#fff", textDecoration: "none", padding: "12px", borderRadius: "10px", fontWeight: 700, textAlign: "center" }}>
            🔥 Entrar no FireHub
          </a>
        </div>
      ) : !token ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#DC2626" }}>Link inválido. Solicite um novo link de recuperação.</p>
          <a href="/esqueci-senha" style={{ display: "block", marginTop: "16px", color: "#DC2626", fontWeight: 700, textDecoration: "none" }}>Solicitar novo link</a>
        </div>
      ) : (
        <>
          <h2 style={{ color: "#1E293B", fontWeight: 800, fontSize: "1.2rem", marginBottom: "8px", textAlign: "center" }}>Criar nova senha</h2>
          <p style={{ color: "#6B7280", fontSize: "0.85rem", textAlign: "center", marginBottom: "28px" }}>Escolha uma senha segura para sua conta.</p>
          {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: "8px", fontSize: "0.85rem", marginBottom: "16px", textAlign: "center" }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Nova senha</label>
            <div style={{ position: "relative", marginBottom: "16px" }}>
              <input type={show ? "text" : "password"} required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                style={{ width: "100%", padding: "12px 42px 12px 16px", border: "2px solid #E5E7EB", borderRadius: "10px", fontSize: "0.95rem", fontFamily: "inherit", outline: "none" }} />
              <button type="button" onClick={() => setShow(!show)} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#94A3B8", fontSize: "1rem" }}>
                {show ? "🙈" : "👁️"}
              </button>
            </div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Confirmar nova senha</label>
            <input type={show ? "text" : "password"} required value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Repita a senha"
              style={{ width: "100%", padding: "12px 16px", border: "2px solid #E5E7EB", borderRadius: "10px", fontSize: "0.95rem", fontFamily: "inherit", outline: "none", marginBottom: "20px" }} />
            {/* Força da senha */}
            {password.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ height: "4px", borderRadius: "2px", background: "#E5E7EB", marginBottom: "4px" }}>
                  <div style={{ height: "100%", borderRadius: "2px", width: `${Math.min(password.length * 10, 100)}%`, background: password.length < 6 ? "#EF4444" : password.length < 10 ? "#F59E0B" : "#10B981", transition: "all 0.3s" }} />
                </div>
                <span style={{ fontSize: "0.72rem", color: password.length < 6 ? "#EF4444" : password.length < 10 ? "#F59E0B" : "#10B981" }}>
                  {password.length < 6 ? "Fraca" : password.length < 10 ? "Moderada" : "Forte"}
                </span>
              </div>
            )}
            <button type="submit" disabled={loading}
              style={{ width: "100%", padding: "14px", background: "linear-gradient(135deg,#DC2626,#B91C1C)", color: "#fff", border: "none", borderRadius: "10px", fontSize: "1rem", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: loading ? 0.7 : 1 }}>
              {loading ? "Salvando..." : "🔐 Redefinir senha"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#B91C1C 0%,#DC2626 50%,#991B1B 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter',sans-serif", padding: "20px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; }`}</style>
      <Suspense fallback={<div style={{ color: "#fff" }}>Carregando...</div>}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
