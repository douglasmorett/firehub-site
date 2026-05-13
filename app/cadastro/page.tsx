"use client";
import { useState } from "react";

const API_BASE = "https://hakim-portal-grupohakim.vercel.app";
const PORTAL_URL = API_BASE;

export default function CadastroPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", storeName: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.name || !form.email || !form.password || !form.storeName) {
      setError("Preencha todos os campos obrigatórios");
      return;
    }
    if (form.password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erro ao criar conta");
        setLoading(false);
        return;
      }

      setStep(2);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif; }
        .cad-container { display:flex; min-height:100vh; }
        .cad-left { flex:0 0 45%; background:linear-gradient(135deg,#0F172A 0%,#1E293B 50%,#0F172A 100%); display:flex; align-items:center; justify-content:center; padding:48px 40px; position:relative; overflow:hidden; }
        .cad-left::before { content:''; position:absolute; top:-50%; right:-30%; width:80%; height:200%; background:radial-gradient(circle,rgba(239,68,68,0.08) 0%,transparent 70%); pointer-events:none; }
        .cad-right { flex:1; display:flex; align-items:center; justify-content:center; padding:48px 40px; background:#fff; }
        .cad-left-inner { position:relative; z-index:2; max-width:440px; }
        .cad-right-inner { width:100%; max-width:420px; }
        .cad-logo { display:flex; align-items:center; gap:12px; margin-bottom:48px; }
        .cad-logo-fire { color:#EF4444; font-weight:900; font-size:1.5rem; }
        .cad-logo-hub { color:#fff; font-weight:900; font-size:1.5rem; }
        .cad-title { font-size:2.4rem; font-weight:900; color:#fff; line-height:1.15; margin-bottom:20px; }
        .cad-title em { color:#EF4444; font-style:normal; }
        .cad-desc { font-size:1rem; color:rgba(255,255,255,0.7); line-height:1.6; margin-bottom:32px; }
        .cad-features { display:flex; flex-direction:column; gap:14px; margin-bottom:36px; }
        .cad-feat { display:flex; align-items:center; gap:10px; font-size:.9rem; color:rgba(255,255,255,0.85); }
        .cad-feat-icon { width:32px; height:32px; border-radius:8px; background:rgba(239,68,68,0.15); display:flex; align-items:center; justify-content:center; font-size:1rem; flex-shrink:0; }
        .cad-guarantee { display:flex; align-items:center; gap:14px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:14px; padding:16px 20px; color:#fff; }
        .cad-form-title { font-size:1.8rem; font-weight:800; color:#111827; margin-bottom:8px; }
        .cad-form-sub { font-size:.95rem; color:#6B7280; margin-bottom:28px; }
        .cad-error { background:#FEF2F2; border:1px solid #FECACA; color:#DC2626; border-radius:10px; padding:12px 16px; font-size:.85rem; margin-bottom:20px; animation:shake .4s; }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
        .cad-form { display:flex; flex-direction:column; gap:18px; }
        .cad-field { display:flex; flex-direction:column; gap:6px; }
        .cad-label { font-size:.82rem; font-weight:600; color:#374151; }
        .cad-input { padding:13px 16px; border:2px solid #E5E7EB; border-radius:12px; font-size:.95rem; outline:none; transition:border-color .2s,box-shadow .2s; color:#111827; background:#F9FAFB; font-family:inherit; }
        .cad-input:focus { border-color:#EF4444; box-shadow:0 0 0 3px rgba(239,68,68,0.1); }
        .cad-submit { padding:16px 24px; background:linear-gradient(135deg,#EF4444,#DC2626); color:#fff; border:none; border-radius:14px; font-size:1rem; font-weight:700; margin-top:8px; cursor:pointer; box-shadow:0 4px 14px rgba(239,68,68,0.4); transition:transform .15s,box-shadow .15s; font-family:inherit; }
        .cad-submit:hover:not(:disabled) { transform:translateY(-1px); box-shadow:0 6px 20px rgba(239,68,68,0.5); }
        .cad-submit:disabled { opacity:.6; cursor:not-allowed; }
        .cad-terms { font-size:.75rem; color:#9CA3AF; text-align:center; line-height:1.5; }
        .cad-terms a { color:#EF4444; text-decoration:none; }
        .cad-login { text-align:center; font-size:.88rem; color:#6B7280; padding-top:8px; }
        .cad-login a { color:#EF4444; font-weight:600; text-decoration:none; }
        .cad-success { text-align:center; padding:20px 0; }
        .cad-success-icon { font-size:4rem; margin-bottom:20px; animation:bounceIn .6s; }
        @keyframes bounceIn { 0%{transform:scale(0)} 50%{transform:scale(1.2)} 100%{transform:scale(1)} }
        .cad-success h2 { font-size:1.8rem; font-weight:800; color:#111827; margin-bottom:12px; }
        .cad-success p { font-size:1rem; color:#6B7280; line-height:1.6; margin-bottom:28px; }
        .cad-credentials { background:#F0FDF4; border:1px solid #BBF7D0; border-radius:14px; padding:18px 24px; margin-bottom:28px; text-align:left; }
        .cad-access-btn { display:block; padding:16px 24px; background:linear-gradient(135deg,#EF4444,#DC2626); color:#fff; border:none; border-radius:14px; font-size:1.1rem; font-weight:700; text-decoration:none; text-align:center; box-shadow:0 4px 14px rgba(239,68,68,0.4); transition:transform .15s; }
        .cad-access-btn:hover { transform:translateY(-1px); }
        .cad-mobile-logo { display:none; align-items:center; gap:8px; margin-bottom:32px; }
        @media (max-width:768px) {
          .cad-container { flex-direction:column; }
          .cad-left { display:none; }
          .cad-right { padding:32px 24px; }
          .cad-mobile-logo { display:flex; }
          .cad-form-title { font-size:1.4rem; }
        }
      `}</style>

      <div className="cad-container">
        {/* ESQUERDA — Branding */}
        <div className="cad-left">
          <div className="cad-left-inner">
            <div className="cad-logo">
              <svg width="44" height="44" viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="48" fill="#1E293B" stroke="#EF4444" strokeWidth="3"/>
                <path d="M50 15C45 30 30 40 30 55C30 68 39 80 50 85C61 80 70 68 70 55C70 40 55 30 50 15Z" fill="#EF4444"/>
                <path d="M50 35C47 45 40 50 40 58C40 65 44 72 50 75C56 72 60 65 60 58C60 50 53 45 50 35Z" fill="#FF8C00"/>
                <circle cx="50" cy="60" r="6" fill="#FFD700"/>
              </svg>
              <div>
                <span className="cad-logo-fire">FIRE</span>
                <span className="cad-logo-hub">HUB</span>
              </div>
            </div>

            <h1 className="cad-title">
              Comece a vender mais<br/>
              <em>agora mesmo.</em>
            </h1>

            <p className="cad-desc">
              Crie sua conta gratuita em menos de 2 minutos e tenha acesso completo a todas as funcionalidades por 15 dias.
            </p>

            <div className="cad-features">
              {[
                ["📱", "Cardápio digital ilimitado"],
                ["🤖", "Chatbot WhatsApp com IA"],
                ["📦", "Gestão completa de pedidos"],
                ["📊", "Relatórios e analytics"],
                ["📸", "Leitura de notas fiscais por IA"],
                ["🏍️", "Controle de entregas e motoboys"],
                ["📋", "Checklist auditado por IA"],
                ["💰", "CMV e estoque automático"],
              ].map(([icon, text], i) => (
                <div key={i} className="cad-feat">
                  <div className="cad-feat-icon">{icon}</div>
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <div className="cad-guarantee">
              <span style={{ fontSize: "1.3rem" }}>🔒</span>
              <div>
                <p style={{ fontWeight: 700, margin: 0 }}>Sem cartão de crédito</p>
                <p style={{ fontSize: ".82rem", opacity: .7, margin: 0 }}>15 dias grátis · Sem compromisso · Cancele quando quiser</p>
              </div>
            </div>
          </div>
        </div>

        {/* DIREITA — Formulário */}
        <div className="cad-right">
          <div className="cad-right-inner">
            {step === 1 ? (
              <>
                <div className="cad-mobile-logo">
                  <svg width="32" height="32" viewBox="0 0 100 100" fill="none">
                    <circle cx="50" cy="50" r="48" fill="#FEF2F2" stroke="#EF4444" strokeWidth="3"/>
                    <path d="M50 15C45 30 30 40 30 55C30 68 39 80 50 85C61 80 70 68 70 55C70 40 55 30 50 15Z" fill="#EF4444"/>
                    <path d="M50 35C47 45 40 50 40 58C40 65 44 72 50 75C56 72 60 65 60 58C60 50 53 45 50 35Z" fill="#FF8C00"/>
                    <circle cx="50" cy="60" r="6" fill="#FFD700"/>
                  </svg>
                  <span style={{ color: "#EF4444", fontWeight: 900, fontSize: "1.2rem" }}>FIRE</span>
                  <span style={{ color: "#1F2937", fontWeight: 900, fontSize: "1.2rem" }}>HUB</span>
                </div>

                <h2 className="cad-form-title">Criar conta grátis</h2>
                <p className="cad-form-sub">Teste grátis por 15 dias. Sem cartão de crédito.</p>

                {error && <div className="cad-error">{error}</div>}

                <form onSubmit={handleSubmit} className="cad-form">
                  <div className="cad-field">
                    <label className="cad-label">Seu nome completo *</label>
                    <input className="cad-input" type="text" placeholder="João Silva" value={form.name} onChange={e => set("name", e.target.value)} autoFocus />
                  </div>

                  <div className="cad-field">
                    <label className="cad-label">Nome do restaurante *</label>
                    <input className="cad-input" type="text" placeholder="Pizzaria do João" value={form.storeName} onChange={e => set("storeName", e.target.value)} />
                  </div>

                  <div className="cad-field">
                    <label className="cad-label">WhatsApp</label>
                    <input className="cad-input" type="tel" placeholder="(22) 99999-9999" value={form.phone} onChange={e => set("phone", e.target.value)} />
                  </div>

                  <div className="cad-field">
                    <label className="cad-label">Email *</label>
                    <input className="cad-input" type="email" placeholder="joao@email.com" value={form.email} onChange={e => set("email", e.target.value)} />
                  </div>

                  <div className="cad-field">
                    <label className="cad-label">Senha *</label>
                    <input className="cad-input" type="password" placeholder="Mínimo 6 caracteres" value={form.password} onChange={e => set("password", e.target.value)} />
                  </div>

                  <button type="submit" disabled={loading} className="cad-submit">
                    {loading ? "Criando sua conta..." : "🔥 Começar Teste Grátis de 15 Dias"}
                  </button>

                  <p className="cad-terms">
                    Ao criar sua conta, você concorda com nossos{" "}
                    <a href="#">Termos de Uso</a> e{" "}
                    <a href="#">Política de Privacidade</a>
                  </p>

                  <div className="cad-login">
                    Já tem uma conta?{" "}
                    <a href={`${PORTAL_URL}/login`}>Entrar</a>
                  </div>
                </form>
              </>
            ) : (
              <div className="cad-success">
                <div className="cad-success-icon">🎉</div>
                <h2>Conta criada com sucesso!</h2>
                <p>
                  Seu restaurante <strong>&quot;{form.storeName}&quot;</strong> já está pronto!<br/>
                  Acesse o painel e comece a configurar seu cardápio.
                </p>

                <div className="cad-credentials">
                  <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: ".9rem" }}>Seus dados de acesso:</p>
                  <p style={{ margin: "0 0 4px", fontSize: ".85rem" }}>📧 <strong>{form.email}</strong></p>
                  <p style={{ margin: 0, fontSize: ".85rem" }}>🔑 Senha que você definiu</p>
                </div>

                <a href={`${PORTAL_URL}/login`} className="cad-access-btn">
                  🚀 Acessar Meu Painel Agora
                </a>

                <p style={{ fontSize: ".8rem", color: "#9CA3AF", textAlign: "center", marginTop: 16 }}>
                  Seus 15 dias de teste grátis começam agora!
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
