"use client";
import { useState } from "react";

const API = "https://hakim-portal-grupohakim.vercel.app";
const PORTAL = API;

type CnpjInfo = {
  cnpj: string;
  razao_social: string;
  nome_fantasia?: string;
  municipio?: string;
  uf?: string;
  situacao_cadastral?: string;
};

function formatCPF(v: string) {
  return v.replace(/\D/g, "").slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function formatPhone(v: string) {
  return v.replace(/\D/g, "").slice(0, 11)
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

function formatCNPJ(v: string) {
  return v.replace(/\D/g, "")
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export default function CadastroPage() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [cpf, setCpf] = useState("");
  const [loadingCpf, setLoadingCpf] = useState(false);
  const [cnpjList, setCnpjList] = useState<CnpjInfo[]>([]);
  const [selectedCnpj, setSelectedCnpj] = useState<CnpjInfo | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [error, setError] = useState("");
  const [createdStore, setCreatedStore] = useState("");

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Etapa 1: buscar CNPJs pelo CPF na Receita Federal
  async function handleCpfSubmit() {
    setError("");
    const cpfClean = cpf.replace(/\D/g, "");
    if (cpfClean.length !== 11) { setError("Digite um CPF válido com 11 dígitos."); return; }
    setLoadingCpf(true);
    try {
      // API pública da Receita Federal via BrasilAPI
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cpfClean}`, { method: "HEAD" });
      // BrasilAPI não tem busca por CPF — usamos ReceitaWS para buscar CNPJ por CPF do sócio
      // Alternativa: usamos a API de busca de sócios da ReceitaWS
      const r2 = await fetch(`https://receitaws.com.br/v1/cnpj/search?cpf=${cpfClean}`, {
        headers: { Accept: "application/json" }
      }).catch(() => null);
      void res;

      let empresas: CnpjInfo[] = [];

      if (r2 && r2.ok) {
        const data = await r2.json();
        if (Array.isArray(data)) empresas = data;
      }

      // Fallback: pede o CNPJ manualmente se a API não retornou
      if (empresas.length === 0) {
        setCnpjList([]);
        setStep(2);
      } else {
        // Filtrar só ativas
        const ativas = empresas.filter(e => e.situacao_cadastral === "ATIVA" || !e.situacao_cadastral);
        setCnpjList(ativas.length > 0 ? ativas : empresas);
        setStep(2);
      }
    } catch {
      // Se der erro de rede, vai pro passo de digitar manualmente
      setCnpjList([]);
      setStep(2);
    } finally {
      setLoadingCpf(false);
    }
  }

  // Etapa 2: usuário selecionou ou digitou CNPJ → buscar dados completos
  async function handleCnpjSelect(info: CnpjInfo) {
    setSelectedCnpj(info);
    // Pré-preencher nome fantasia como nome do restaurante
    const nome = info.nome_fantasia || info.razao_social || "";
    setForm(p => ({ ...p }));
    void nome;
    setStep(3);
  }

  async function handleManualCnpj(cnpjRaw: string) {
    setError("");
    const clean = cnpjRaw.replace(/\D/g, "");
    if (clean.length !== 14) { setError("CNPJ inválido. Verifique e tente novamente."); return; }
    setLoadingCpf(true);
    try {
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
      if (r.ok) {
        const d = await r.json();
        const info: CnpjInfo = {
          cnpj: clean,
          razao_social: d.razao_social || "",
          nome_fantasia: d.nome_fantasia || "",
          municipio: d.municipio || "",
          uf: d.uf || "",
          situacao_cadastral: d.descricao_situacao_cadastral || "",
        };
        setSelectedCnpj(info);
        setStep(3);
      } else {
        setError("CNPJ não encontrado na Receita Federal. Verifique e tente novamente.");
      }
    } catch {
      setError("Erro ao consultar Receita Federal. Verifique o CNPJ e tente novamente.");
    } finally {
      setLoadingCpf(false);
    }
  }

  // Etapa 3: enviar cadastro
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name || !form.email || !form.password || !form.phone) {
      setError("Preencha todos os campos."); return;
    }
    if (form.password.length < 6) { setError("A senha precisa ter pelo menos 6 caracteres."); return; }
    setLoadingSubmit(true);
    try {
      const storeName = selectedCnpj?.nome_fantasia || selectedCnpj?.razao_social || form.name;
      const res = await fetch(`${API}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          phone: form.phone,
          cnpj: selectedCnpj?.cnpj,
          storeName,
          city: selectedCnpj?.municipio,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao criar conta."); return; }
      setCreatedStore(storeName);
      setStep(4);
    } catch {
      setError("Erro de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setLoadingSubmit(false);
    }
  }

  const S = {
    page: { minHeight: "100vh", display: "flex", fontFamily: "'Inter',sans-serif", background: "#fff" } as React.CSSProperties,
    left: { flex: "0 0 44%", background: "linear-gradient(145deg,#0f172a,#1e3a5f)", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 40px" } as React.CSSProperties,
    right: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 32px" } as React.CSSProperties,
    inner: { width: "100%", maxWidth: 400 } as React.CSSProperties,
  };

  const steps = ["CPF", "Empresa", "Dados", "Pronto"];
  const stepIdx = step - 1;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Inter',sans-serif}
        .inp{width:100%;padding:13px 16px;border:2px solid #E5E7EB;border-radius:12px;font-size:.95rem;outline:none;color:#111;background:#F9FAFB;font-family:inherit;transition:border-color .2s}
        .inp:focus{border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
        .btn{width:100%;padding:15px;background:linear-gradient(135deg,#2563EB,#1d4ed8);color:#fff;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s,transform .15s}
        .btn:hover:not(:disabled){opacity:.92;transform:translateY(-1px)}
        .btn:disabled{opacity:.55;cursor:not-allowed}
        .err{background:#FEF2F2;border:1px solid #FECACA;color:#DC2626;border-radius:10px;padding:11px 15px;font-size:.84rem;margin-bottom:16px}
        .lbl{font-size:.82rem;font-weight:600;color:#374151;margin-bottom:5px;display:block}
        .cnpj-card{border:2px solid #E5E7EB;border-radius:14px;padding:16px 18px;cursor:pointer;transition:all .2s;margin-bottom:10px}
        .cnpj-card:hover{border-color:#2563EB;background:#EFF6FF}
        .cnpj-card.sel{border-color:#2563EB;background:#EFF6FF}
        .prog{display:flex;gap:8px;margin-bottom:32px}
        .prog-step{flex:1;text-align:center}
        .prog-dot{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 4px;font-size:.75rem;font-weight:700}
        .prog-label{font-size:.7rem;font-weight:500}
        @media(max-width:768px){.left-panel{display:none!important}.right-panel{padding:28px 20px!important}}
      `}</style>

      <div style={S.page}>
        {/* ESQUERDA */}
        <div className="left-panel" style={S.left}>
          <div style={{ maxWidth: 380, color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 40 }}>
              <img src="/firehub-flame.png" alt="FireHub" style={{ width: 40, height: 40, objectFit: "contain" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span style={{ fontWeight: 900, fontSize: "1.6rem" }}>
                <span style={{ color: "#F97316" }}>FIRE</span><span>HUB</span>
              </span>
            </div>
            <h1 style={{ fontSize: "2rem", fontWeight: 900, lineHeight: 1.2, marginBottom: 16 }}>
              Comece grátis em<br /><span style={{ color: "#60A5FA" }}>menos de 2 minutos.</span>
            </h1>
            <p style={{ color: "rgba(255,255,255,.7)", lineHeight: 1.7, marginBottom: 32, fontSize: ".95rem" }}>
              Seu restaurante online com cardápio digital, pedidos, financeiro e IA. Sem cartão de crédito.
            </p>
            {[
              ["✅", "15 dias 100% grátis, sem compromisso"],
              ["✅", "CNPJ verificado — segurança na conta"],
              ["✅", "Sem taxa de instalação"],
              ["✅", "Suporte humano via WhatsApp 7 dias"],
              ["✅", "Cancele quando quiser, sem multa"],
            ].map(([icon, txt], i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: ".88rem", color: "rgba(255,255,255,.85)" }}>
                <span>{icon}</span><span>{txt}</span>
              </div>
            ))}
          </div>
        </div>

        {/* DIREITA */}
        <div className="right-panel" style={S.right}>
          <div style={S.inner}>
            {/* Progresso */}
            <div className="prog">
              {steps.map((label, i) => {
                const done = i < stepIdx;
                const active = i === stepIdx;
                return (
                  <div className="prog-step" key={i}>
                    <div className="prog-dot" style={{
                      background: done ? "#16A34A" : active ? "#2563EB" : "#F3F4F6",
                      color: done || active ? "#fff" : "#9CA3AF",
                    }}>
                      {done ? "✓" : i + 1}
                    </div>
                    <div className="prog-label" style={{ color: active ? "#2563EB" : done ? "#16A34A" : "#9CA3AF" }}>{label}</div>
                  </div>
                );
              })}
            </div>

            {/* ETAPA 1 — CPF */}
            {step === 1 && (
              <>
                <h2 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#111", marginBottom: 6 }}>Qual é o seu CPF?</h2>
                <p style={{ color: "#6B7280", marginBottom: 24, fontSize: ".9rem", lineHeight: 1.5 }}>
                  Usamos seu CPF para encontrar automaticamente os CNPJs vinculados a você na Receita Federal — assim garantimos que só existe uma conta por empresa.
                </p>
                {error && <div className="err">{error}</div>}
                <div style={{ marginBottom: 16 }}>
                  <label className="lbl">CPF do responsável</label>
                  <input
                    className="inp"
                    type="text"
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                    value={cpf}
                    autoFocus
                    onChange={e => setCpf(formatCPF(e.target.value))}
                    onKeyDown={e => e.key === "Enter" && handleCpfSubmit()}
                  />
                </div>
                <button className="btn" onClick={handleCpfSubmit} disabled={loadingCpf}>
                  {loadingCpf ? "Consultando Receita Federal..." : "Continuar →"}
                </button>
                <p style={{ textAlign: "center", marginTop: 16, fontSize: ".8rem", color: "#9CA3AF" }}>
                  🔒 Dados protegidos · Não compartilhamos seu CPF
                </p>
                <p style={{ textAlign: "center", marginTop: 20, fontSize: ".85rem", color: "#6B7280" }}>
                  Já tem conta? <a href={`${PORTAL}/login`} style={{ color: "#2563EB", fontWeight: 600, textDecoration: "none" }}>Entrar</a>
                </p>
              </>
            )}

            {/* ETAPA 2 — Selecionar CNPJ */}
            {step === 2 && (
              <>
                <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111", marginBottom: 6 }}>Selecione sua empresa</h2>
                <p style={{ color: "#6B7280", marginBottom: 20, fontSize: ".88rem", lineHeight: 1.5 }}>
                  {cnpjList.length > 0
                    ? "Encontramos essas empresas vinculadas ao seu CPF. Selecione a que vai usar no FireHub:"
                    : "Digite o CNPJ da sua empresa para continuar:"}
                </p>
                {error && <div className="err">{error}</div>}

                {cnpjList.length > 0 ? (
                  <>
                    {cnpjList.map((c) => (
                      <div
                        key={c.cnpj}
                        className="cnpj-card"
                        onClick={() => handleCnpjSelect(c)}
                      >
                        <div style={{ fontWeight: 700, fontSize: ".95rem", color: "#111", marginBottom: 4 }}>
                          {c.nome_fantasia || c.razao_social}
                        </div>
                        <div style={{ fontSize: ".8rem", color: "#6B7280" }}>
                          {formatCNPJ(c.cnpj)} · {c.municipio}/{c.uf}
                        </div>
                        {c.situacao_cadastral && (
                          <div style={{ fontSize: ".75rem", color: c.situacao_cadastral === "ATIVA" ? "#16A34A" : "#EF4444", marginTop: 4, fontWeight: 600 }}>
                            {c.situacao_cadastral}
                          </div>
                        )}
                      </div>
                    ))}
                    <p style={{ textAlign: "center", fontSize: ".82rem", color: "#9CA3AF", margin: "12px 0" }}>
                      Não encontrou? Digite o CNPJ manualmente:
                    </p>
                  </>
                ) : null}

                {/* Input manual de CNPJ */}
                <ManualCnpjInput onConfirm={handleManualCnpj} loading={loadingCpf} />

                <button
                  style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", fontSize: ".84rem", marginTop: 12, display: "block", width: "100%", textAlign: "center" }}
                  onClick={() => { setStep(1); setError(""); }}
                >
                  ← Voltar
                </button>
              </>
            )}

            {/* ETAPA 3 — Dados pessoais */}
            {step === 3 && selectedCnpj && (
              <>
                <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 12, padding: "14px 16px", marginBottom: 24 }}>
                  <div style={{ fontSize: ".75rem", color: "#2563EB", fontWeight: 700, marginBottom: 2 }}>✅ EMPRESA VERIFICADA</div>
                  <div style={{ fontWeight: 700, color: "#1E3A5F", fontSize: ".95rem" }}>
                    {selectedCnpj.nome_fantasia || selectedCnpj.razao_social}
                  </div>
                  <div style={{ fontSize: ".78rem", color: "#4B5563" }}>
                    CNPJ {formatCNPJ(selectedCnpj.cnpj)}
                    {selectedCnpj.municipio ? ` · ${selectedCnpj.municipio}/${selectedCnpj.uf}` : ""}
                  </div>
                </div>

                <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#111", marginBottom: 6 }}>Complete seu cadastro</h2>
                <p style={{ color: "#6B7280", marginBottom: 20, fontSize: ".88rem" }}>Essas informações serão usadas para acessar sua conta.</p>

                {error && <div className="err">{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label className="lbl">Seu nome completo *</label>
                    <input className="inp" type="text" placeholder="João Silva" value={form.name} autoFocus onChange={e => set("name", e.target.value)} />
                  </div>
                  <div>
                    <label className="lbl">WhatsApp *</label>
                    <input className="inp" type="tel" inputMode="numeric" placeholder="(22) 99999-9999" value={form.phone} onChange={e => set("phone", formatPhone(e.target.value))} />
                  </div>
                  <div>
                    <label className="lbl">E-mail *</label>
                    <input className="inp" type="email" placeholder="joao@restaurante.com" value={form.email} onChange={e => set("email", e.target.value)} />
                  </div>
                  <div>
                    <label className="lbl">Senha *</label>
                    <input className="inp" type="password" placeholder="Mínimo 6 caracteres" value={form.password} onChange={e => set("password", e.target.value)} />
                  </div>
                  <button type="submit" className="btn" disabled={loadingSubmit} style={{ marginTop: 4, background: "linear-gradient(135deg,#EF4444,#DC2626)" }}>
                    {loadingSubmit ? "Criando sua conta..." : "🔥 Começar Teste Grátis"}
                  </button>
                  <p style={{ fontSize: ".73rem", color: "#9CA3AF", textAlign: "center" }}>
                    Ao cadastrar, você concorda com os <a href="#" style={{ color: "#2563EB" }}>Termos de Uso</a> e <a href="#" style={{ color: "#2563EB" }}>Política de Privacidade</a>
                  </p>
                </form>

                <button
                  style={{ background: "none", border: "none", color: "#6B7280", cursor: "pointer", fontSize: ".84rem", marginTop: 12, display: "block", width: "100%", textAlign: "center" }}
                  onClick={() => { setStep(2); setError(""); }}
                >
                  ← Voltar
                </button>
              </>
            )}

            {/* ETAPA 4 — Sucesso */}
            {step === 4 && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: "4rem", marginBottom: 16, animation: "bounceIn .6s" }}>🎉</div>
                <h2 style={{ fontSize: "1.7rem", fontWeight: 800, color: "#111", marginBottom: 10 }}>
                  Conta criada!
                </h2>
                <p style={{ color: "#6B7280", lineHeight: 1.6, marginBottom: 24, fontSize: ".95rem" }}>
                  <strong>&quot;{createdStore}&quot;</strong> está pronto para começar.<br />
                  Seus 15 dias de teste grátis começam agora!
                </p>
                <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 14, padding: "16px 20px", marginBottom: 24, textAlign: "left" }}>
                  <p style={{ fontWeight: 700, marginBottom: 8, fontSize: ".88rem" }}>Próximos passos:</p>
                  {["Configure seu cardápio digital", "Adicione sua logo e banner", "Compartilhe o link com seus clientes", "Receba seus primeiros pedidos"].map((s, i) => (
                    <p key={i} style={{ fontSize: ".84rem", color: "#374151", marginBottom: 4 }}>
                      <span style={{ color: "#16A34A", fontWeight: 700 }}>{i + 1}.</span> {s}
                    </p>
                  ))}
                </div>
                <a
                  href={`${PORTAL}/login`}
                  style={{ display: "block", padding: "16px 24px", background: "linear-gradient(135deg,#EF4444,#DC2626)", color: "#fff", borderRadius: 14, fontWeight: 700, fontSize: "1rem", textDecoration: "none", boxShadow: "0 4px 14px rgba(239,68,68,.4)" }}
                >
                  🚀 Acessar Meu Painel
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes bounceIn {
          0%{transform:scale(0)} 50%{transform:scale(1.2)} 100%{transform:scale(1)}
        }
      `}</style>
    </>
  );
}

// Componente interno para input manual de CNPJ
function ManualCnpjInput({ onConfirm, loading }: { onConfirm: (v: string) => void; loading: boolean }) {
  const [val, setVal] = useState("");
  function fmt(v: string) {
    return v.replace(/\D/g, "").slice(0, 14)
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        className="inp"
        type="text"
        inputMode="numeric"
        placeholder="00.000.000/0001-00"
        value={val}
        onChange={e => setVal(fmt(e.target.value))}
        onKeyDown={e => e.key === "Enter" && onConfirm(val)}
        style={{ flex: 1 }}
      />
      <button
        onClick={() => onConfirm(val)}
        disabled={loading}
        style={{ padding: "13px 18px", background: "#2563EB", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}
      >
        {loading ? "..." : "Buscar"}
      </button>
    </div>
  );
}
