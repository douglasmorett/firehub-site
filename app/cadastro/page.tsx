"use client";
import { useState } from "react";

const API = "https://hakim-portal-grupohakim.vercel.app";
const PORTAL = API;

type CnpjData = {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao: string;
  municipio: string;
  uf: string;
  socios: { nome: string; qualificacao: string }[];
};

function fmtCPF(v: string) {
  return v.replace(/\D/g, "").slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
function fmtCNPJ(v: string) {
  return v.replace(/\D/g, "").slice(0, 14)
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
function fmtPhone(v: string) {
  return v.replace(/\D/g, "").slice(0, 11)
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}
function validaCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(c[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10) r = 0;
  if (r !== parseInt(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(c[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10) r = 0;
  return r === parseInt(c[10]);
}

export default function CadastroPage() {
  const [step, setStep] = useState<1|2|3|4>(1);
  const [cpf, setCpf] = useState("");
  const [cnpjInput, setCnpjInput] = useState("");
  const [cnpjData, setCnpjData] = useState<CnpjData|null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [createdStore, setCreatedStore] = useState("");

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Step 1 → 2: validar CPF e avançar
  function handleCpfNext() {
    setError("");
    if (!validaCPF(cpf)) {
      setError("CPF inválido. Verifique os dígitos e tente novamente.");
      return;
    }
    setStep(2);
  }

  // Step 2: buscar CNPJ na Receita Federal
  async function handleCnpjLookup() {
    setError("");
    const clean = cnpjInput.replace(/\D/g, "");
    if (clean.length !== 14) {
      setError("Digite um CNPJ válido com 14 dígitos.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/cnpj-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: clean }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "CNPJ não encontrado."); return; }
      if (data.situacao && data.situacao !== "ATIVA" && data.situacao !== "Ativa") {
        setError(`Este CNPJ está com situação "${data.situacao}" na Receita Federal. Só é possível cadastrar CNPJs com situação ATIVA.`);
        return;
      }
      setCnpjData(data);
      setStep(3);
    } catch {
      setError("Erro ao consultar. Verifique sua conexão.");
    } finally {
      setLoading(false);
    }
  }

  // Step 3: criar conta
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name || !form.email || !form.password || !form.phone) {
      setError("Preencha todos os campos."); return;
    }
    if (form.password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres."); return;
    }
    setLoading(true);
    try {
      const storeName = cnpjData?.nome_fantasia || cnpjData?.razao_social || form.name;
      const res = await fetch(`${API}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone.replace(/\D/g, ""),
          cnpj: cnpjData?.cnpj,
          cpf: cpf.replace(/\D/g, ""),
          storeName,
          city: cnpjData?.municipio,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao criar conta."); return; }
      setCreatedStore(storeName);
      setStep(4);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const stepsLabels = ["CPF", "CNPJ", "Dados", "Pronto"];
  const si = step - 1;

  return (
    <>
      <style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif}
.cad-wrap{display:flex;min-height:100vh}
.cad-l{flex:0 0 44%;background:linear-gradient(150deg,#0f172a,#1e3a5f 60%,#0f172a);display:flex;align-items:center;justify-content:center;padding:48px 40px;position:relative;overflow:hidden}
.cad-l::after{content:'';position:absolute;top:-40%;right:-20%;width:60%;height:160%;background:radial-gradient(circle,rgba(59,130,246,.08),transparent 70%);pointer-events:none}
.cad-r{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 32px;background:#fff}
.cad-inner{width:100%;max-width:420px}
.inp{width:100%;padding:14px 16px;border:2px solid #E5E7EB;border-radius:12px;font-size:1rem;outline:none;color:#111;background:#F9FAFB;font-family:inherit;transition:all .2s}
.inp:focus{border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.inp-big{font-size:1.3rem;letter-spacing:2px;text-align:center;font-weight:700}
.btn{width:100%;padding:15px;background:linear-gradient(135deg,#2563EB,#1d4ed8);color:#fff;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s;box-shadow:0 4px 14px rgba(37,99,235,.3)}
.btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 20px rgba(37,99,235,.4)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-fire{background:linear-gradient(135deg,#EF4444,#DC2626);box-shadow:0 4px 14px rgba(239,68,68,.3)}
.btn-fire:hover:not(:disabled){box-shadow:0 6px 20px rgba(239,68,68,.4)}
.err{background:#FEF2F2;border:1px solid #FECACA;color:#DC2626;border-radius:10px;padding:11px 15px;font-size:.84rem;margin-bottom:16px;animation:shake .35s}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.lbl{font-size:.82rem;font-weight:600;color:#374151;margin-bottom:5px;display:block}
.prog{display:flex;gap:6px;margin-bottom:28px}
.prog-s{flex:1;text-align:center}
.prog-dot{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 4px;font-size:.78rem;font-weight:700;transition:all .3s}
.prog-lbl{font-size:.68rem;font-weight:600}
.cnpj-box{background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:14px;padding:16px 18px;margin-bottom:22px}
.feat{display:flex;gap:10px;margin-bottom:10px;font-size:.88rem;color:rgba(255,255,255,.85)}
.back-btn{background:none;border:none;color:#6B7280;cursor:pointer;font-size:.84rem;margin-top:14px;display:block;width:100%;text-align:center;font-family:inherit}
.back-btn:hover{color:#374151}
@keyframes bounceIn{0%{transform:scale(0)}50%{transform:scale(1.15)}100%{transform:scale(1)}}
@media(max-width:768px){.cad-l{display:none!important}.cad-r{padding:28px 20px!important}}
      `}</style>

      <div className="cad-wrap">
        {/* ESQUERDA */}
        <div className="cad-l">
          <div style={{ maxWidth: 380, color: "#fff", position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40 }}>
              <img src="/firehub-flame.png" alt="" style={{ width: 38, height: 38, objectFit: "contain" }}
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span style={{ fontWeight: 900, fontSize: "1.5rem" }}>
                <span style={{ color: "#F97316" }}>FIRE</span><span>HUB</span>
              </span>
            </div>
            <h1 style={{ fontSize: "2rem", fontWeight: 900, lineHeight: 1.2, marginBottom: 16 }}>
              Comece grátis em<br /><span style={{ color: "#60A5FA" }}>menos de 2 minutos.</span>
            </h1>
            <p style={{ color: "rgba(255,255,255,.65)", lineHeight: 1.7, marginBottom: 28, fontSize: ".92rem" }}>
              Cardápio digital, pedidos, financeiro e IA — tudo num só lugar.
            </p>
            {[
              ["🔥", "15 dias grátis, sem cartão"],
              ["🔒", "CNPJ verificado na Receita Federal"],
              ["📱", "Cardápio digital + WhatsApp IA"],
              ["📊", "Relatórios e controle completo"],
              ["💬", "Suporte humano 7 dias por semana"],
            ].map(([ic, tx], i) => (
              <div key={i} className="feat"><span>{ic}</span><span>{tx}</span></div>
            ))}
          </div>
        </div>

        {/* DIREITA */}
        <div className="cad-r">
          <div className="cad-inner">
            {/* Progress */}
            <div className="prog">
              {stepsLabels.map((l, i) => {
                const done = i < si;
                const act = i === si;
                return (
                  <div className="prog-s" key={i}>
                    <div className="prog-dot" style={{
                      background: done ? "#16A34A" : act ? "#2563EB" : "#F3F4F6",
                      color: done || act ? "#fff" : "#9CA3AF",
                    }}>
                      {done ? "✓" : i + 1}
                    </div>
                    <div className="prog-lbl" style={{ color: act ? "#2563EB" : done ? "#16A34A" : "#9CA3AF" }}>{l}</div>
                  </div>
                );
              })}
            </div>

            {/* ========== STEP 1: CPF ========== */}
            {step === 1 && (
              <>
                <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111", marginBottom: 6 }}>
                  Qual é o seu CPF?
                </h2>
                <p style={{ color: "#6B7280", marginBottom: 24, fontSize: ".88rem", lineHeight: 1.6 }}>
                  Usamos seu CPF para garantir que cada empresa tenha apenas uma conta no FireHub.
                </p>
                {error && <div className="err">{error}</div>}
                <div style={{ marginBottom: 18 }}>
                  <label className="lbl">CPF do responsável</label>
                  <input className="inp inp-big" type="text" inputMode="numeric"
                    placeholder="000.000.000-00" value={cpf} autoFocus
                    onChange={e => setCpf(fmtCPF(e.target.value))}
                    onKeyDown={e => e.key === "Enter" && handleCpfNext()} />
                </div>
                <button className="btn" onClick={handleCpfNext}>Continuar →</button>
                <p style={{ textAlign: "center", marginTop: 14, fontSize: ".78rem", color: "#9CA3AF" }}>
                  🔒 Seus dados estão protegidos e não são compartilhados.
                </p>
                <p style={{ textAlign: "center", marginTop: 16, fontSize: ".85rem", color: "#6B7280" }}>
                  Já tem conta?{" "}
                  <a href={`${PORTAL}/login`} style={{ color: "#2563EB", fontWeight: 600, textDecoration: "none" }}>Entrar</a>
                </p>
              </>
            )}

            {/* ========== STEP 2: CNPJ ========== */}
            {step === 2 && (
              <>
                <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111", marginBottom: 6 }}>
                  Agora, digite o CNPJ
                </h2>
                <p style={{ color: "#6B7280", marginBottom: 24, fontSize: ".88rem", lineHeight: 1.6 }}>
                  Vamos verificar sua empresa na Receita Federal para preencher tudo automaticamente.
                </p>
                {error && <div className="err">{error}</div>}
                <div style={{ marginBottom: 18 }}>
                  <label className="lbl">CNPJ da empresa</label>
                  <input className="inp inp-big" type="text" inputMode="numeric"
                    placeholder="00.000.000/0001-00" value={cnpjInput} autoFocus
                    onChange={e => setCnpjInput(fmtCNPJ(e.target.value))}
                    onKeyDown={e => e.key === "Enter" && handleCnpjLookup()} />
                </div>
                <button className="btn" onClick={handleCnpjLookup} disabled={loading}>
                  {loading ? "🔍 Consultando Receita Federal..." : "Verificar CNPJ →"}
                </button>
                <button className="back-btn" onClick={() => { setStep(1); setError(""); }}>
                  ← Voltar
                </button>
              </>
            )}

            {/* ========== STEP 3: DADOS ========== */}
            {step === 3 && cnpjData && (
              <>
                <div className="cnpj-box">
                  <div style={{ fontSize: ".73rem", color: "#2563EB", fontWeight: 700, marginBottom: 3 }}>
                    ✅ EMPRESA VERIFICADA NA RECEITA FEDERAL
                  </div>
                  <div style={{ fontWeight: 700, color: "#1E3A5F", fontSize: ".95rem" }}>
                    {cnpjData.nome_fantasia || cnpjData.razao_social}
                  </div>
                  <div style={{ fontSize: ".78rem", color: "#4B5563", marginTop: 2 }}>
                    CNPJ {fmtCNPJ(cnpjData.cnpj)}
                    {cnpjData.municipio ? ` · ${cnpjData.municipio}/${cnpjData.uf}` : ""}
                  </div>
                  {cnpjData.socios && cnpjData.socios.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #BFDBFE" }}>
                      <div style={{ fontSize: ".7rem", color: "#6B7280", fontWeight: 600, marginBottom: 4 }}>SÓCIOS:</div>
                      {cnpjData.socios.slice(0, 3).map((s, i) => (
                        <div key={i} style={{ fontSize: ".78rem", color: "#374151" }}>
                          {s.nome} <span style={{ color: "#9CA3AF" }}>({s.qualificacao})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <h2 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#111", marginBottom: 4 }}>
                  Complete seu cadastro
                </h2>
                <p style={{ color: "#6B7280", marginBottom: 18, fontSize: ".85rem" }}>
                  Dados de acesso à sua conta FireHub.
                </p>
                {error && <div className="err">{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                  <div>
                    <label className="lbl">Seu nome completo *</label>
                    <input className="inp" type="text" placeholder="João Silva" value={form.name} autoFocus
                      onChange={e => set("name", e.target.value)} />
                  </div>
                  <div>
                    <label className="lbl">WhatsApp *</label>
                    <input className="inp" type="tel" inputMode="numeric" placeholder="(22) 99999-9999"
                      value={form.phone} onChange={e => set("phone", fmtPhone(e.target.value))} />
                  </div>
                  <div>
                    <label className="lbl">E-mail *</label>
                    <input className="inp" type="email" placeholder="joao@restaurante.com"
                      value={form.email} onChange={e => set("email", e.target.value)} />
                  </div>
                  <div>
                    <label className="lbl">Crie uma senha *</label>
                    <input className="inp" type="password" placeholder="Mínimo 6 caracteres"
                      value={form.password} onChange={e => set("password", e.target.value)} />
                  </div>
                  <button type="submit" className="btn btn-fire" disabled={loading} style={{ marginTop: 4 }}>
                    {loading ? "Criando sua conta..." : "🔥 Começar Teste Grátis de 15 Dias"}
                  </button>
                  <p style={{ fontSize: ".72rem", color: "#9CA3AF", textAlign: "center" }}>
                    Ao cadastrar, você concorda com os{" "}
                    <a href="#" style={{ color: "#2563EB" }}>Termos de Uso</a> e{" "}
                    <a href="#" style={{ color: "#2563EB" }}>Política de Privacidade</a>
                  </p>
                </form>
                <button className="back-btn" onClick={() => { setStep(2); setError(""); }}>← Voltar</button>
              </>
            )}

            {/* ========== STEP 4: SUCESSO ========== */}
            {step === 4 && (
              <div style={{ textAlign: "center", padding: "10px 0" }}>
                <div style={{ fontSize: "4rem", marginBottom: 16, animation: "bounceIn .5s" }}>🎉</div>
                <h2 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#111", marginBottom: 8 }}>
                  Conta criada com sucesso!
                </h2>
                <p style={{ color: "#6B7280", lineHeight: 1.6, marginBottom: 22, fontSize: ".92rem" }}>
                  <strong>&quot;{createdStore}&quot;</strong> está pronto.<br />
                  Seus 15 dias de teste grátis começam agora!
                </p>
                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 14, padding: "16px 18px", marginBottom: 22, textAlign: "left" }}>
                  <p style={{ fontWeight: 700, marginBottom: 8, fontSize: ".86rem" }}>📋 Próximos passos:</p>
                  {["Configure seu cardápio digital", "Adicione logo e banner", "Compartilhe o link com clientes", "Receba seus primeiros pedidos!"].map((s, i) => (
                    <p key={i} style={{ fontSize: ".82rem", color: "#374151", marginBottom: 3 }}>
                      <span style={{ color: "#16A34A", fontWeight: 700 }}>{i + 1}.</span> {s}
                    </p>
                  ))}
                </div>
                <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 16px", marginBottom: 22, textAlign: "left" }}>
                  <p style={{ fontSize: ".82rem", fontWeight: 600, marginBottom: 6 }}>Seus dados de acesso:</p>
                  <p style={{ fontSize: ".82rem", color: "#374151", marginBottom: 2 }}>📧 <strong>{form.email}</strong></p>
                  <p style={{ fontSize: ".82rem", color: "#374151" }}>🔑 A senha que você definiu</p>
                </div>
                <a href={`${PORTAL}/login`} className="btn btn-fire"
                  style={{ display: "block", textDecoration: "none", textAlign: "center" }}>
                  🚀 Acessar Meu Painel
                </a>
                <p style={{ fontSize: ".78rem", color: "#9CA3AF", marginTop: 12 }}>
                  Sem cartão de crédito · Cancele quando quiser
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
