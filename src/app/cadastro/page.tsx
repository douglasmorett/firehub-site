"use client";
import { useState, useEffect } from "react";

const API = "";
const PORTAL = API;

type CnpjData = {
  cnpj: string; razao_social: string; nome_fantasia: string;
  situacao: string; municipio: string; uf: string;
  socios: { nome: string; qualificacao: string }[];
};

function fmtCPF(v: string) {
  return v.replace(/\D/g,"").slice(0,11).replace(/(\d{3})(\d)/,"$1.$2").replace(/(\d{3})(\d)/,"$1.$2").replace(/(\d{3})(\d{1,2})$/,"$1-$2");
}
function fmtCNPJ(v: string) {
  return v.replace(/\D/g,"").slice(0,14).replace(/(\d{2})(\d)/,"$1.$2").replace(/(\d{3})(\d)/,"$1.$2").replace(/(\d{3})(\d)/,"$1/$2").replace(/(\d{4})(\d{1,2})$/,"$1-$2");
}
function fmtPhone(v: string) {
  return v.replace(/\D/g,"").slice(0,11).replace(/(\d{2})(\d)/,"($1) $2").replace(/(\d{5})(\d)/,"$1-$2");
}
function validaCPF(cpf: string) {
  const c = cpf.replace(/\D/g,"");
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += parseInt(c[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10) r = 0; if (r !== parseInt(c[9])) return false;
  s = 0; for (let i = 0; i < 10; i++) s += parseInt(c[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10) r = 0; return r === parseInt(c[10]);
}

const COMO_CONHECEU = [
  "Instagram", "Facebook", "Google", "YouTube", "Indicação de amigo",
  "Indicação de outro restaurante", "WhatsApp", "Outro"
];
const FATURAMENTO = [
  "Ainda não faturo", "Até R$ 3.000", "R$ 3.000 a R$ 7.000",
  "R$ 7.000 a R$ 15.000", "R$ 15.000 a R$ 30.000", "Acima de R$ 30.000"
];

export default function CadastroPage() {
  const [step, setStep] = useState<1|2|3|4|5|6>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [trialDays, setTrialDays] = useState(15);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("ref") || urlParams.get("codigo")) {
        setTrialDays(30);
      }
    }
  }, []);

  // Step 1 - Qualificação
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [email, setEmail] = useState("");
  const [temPC, setTemPC] = useState<string>("");
  const [comoConheceu, setComoConheceu] = useState("");
  const [faturamento, setFaturamento] = useState("");

  // Step 2 - CPF
  const [cpf, setCpf] = useState("");

  // Step 3 - CNPJ
  const [cnpjInput, setCnpjInput] = useState("");
  const [cnpjData, setCnpjData] = useState<CnpjData|null>(null);

  // Step 4 - Senha
  const [senha, setSenha] = useState("");
  const [termos, setTermos] = useState(false);

  // Step 5 - Sucesso
  const [createdStore, setCreatedStore] = useState("");

  // Step 5 - Repasse Pix
  const [tipoChave, setTipoChave] = useState("");
  const [chavePix, setChavePix] = useState("");
  const [titularNome, setTitularNome] = useState("");
  const [titularDoc, setTitularDoc] = useState("");
  const [repFrequencia, setRepFrequencia] = useState("DAILY");
  const [repHorario, setRepHorario] = useState("03:00");

  // === HANDLERS ===
  function handleStep1() {
    setError("");
    if (!nome.trim()) { setError("Digite seu nome."); return; }
    if (!whatsapp.replace(/\D/g,"") || whatsapp.replace(/\D/g,"").length < 10) { setError("WhatsApp inválido."); return; }
    if (!empresa.trim()) { setError("Digite o nome da sua empresa."); return; }
    if (!email.trim() || !email.includes("@")) { setError("E-mail inválido."); return; }
    if (!temPC) { setError("Informe se tem computador ou notebook."); return; }
    if (!comoConheceu) { setError("Selecione como conheceu o FireHub."); return; }
    if (!faturamento) { setError("Selecione seu faturamento."); return; }
    setStep(2);
  }

  function handleStep2() {
    setError("");
    if (!validaCPF(cpf)) { setError("CPF inválido."); return; }
    setStep(3);
  }

  async function handleStep3() {
    setError("");
    const clean = cnpjInput.replace(/\D/g,"");
    if (clean.length !== 14) { setError("CNPJ inválido."); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/cnpj-lookup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cnpj: clean }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "CNPJ não encontrado."); return; }
      if (data.situacao && !["ATIVA","Ativa"].includes(data.situacao)) {
        setError(`CNPJ com situação "${data.situacao}". Só aceitamos CNPJs ativos.`); return;
      }
      setCnpjData(data);
      setStep(4);
    } catch { setError("Erro de conexão."); }
    finally { setLoading(false); }
  }

  async function handleStep4(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 6) { setError("Senha precisa ter pelo menos 6 caracteres."); return; }
    if (!termos) { setError("Aceite os termos para continuar."); return; }
    setError("");
    if (!titularNome) setTitularNome(nome);
    if (!titularDoc) setTitularDoc(cpf.replace(/\D/g, "") || cnpjData?.cnpj || "");
    setStep(5);
  }

    async function createAccount(repasseData?: any) {
    setLoading(true);
    setError("");
    try {
      const storeName = cnpjData?.nome_fantasia || cnpjData?.razao_social || empresa;
      let refCode = null;
      if (typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search);
        refCode = urlParams.get("ref") || urlParams.get("codigo") || null;
      }
      
      const body: any = {
        name: nome, email, password: senha, phone: whatsapp.replace(/\D/g, ""),
        cnpj: cnpjData?.cnpj, cpf: cpf.replace(/\D/g, ""),
        storeName, city: cnpjData?.municipio, refCode
      };
      if (repasseData) body.repasseConfig = repasseData;

      const res = await fetch(`${API}/api/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Erro ao criar conta."); return; }
      setCreatedStore(storeName);
      setStep(6);
    } catch { setError("Erro de conexão."); }
    finally { setLoading(false); }
  }

  function handleStep5(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!tipoChave) { setError("Selecione o tipo da chave Pix."); return; }
    if (!chavePix.trim()) { setError("Digite sua chave Pix."); return; }
    if (!titularNome.trim()) { setError("Digite o nome do titular."); return; }
    if (!titularDoc.replace(/\D/g, "")) { setError("Digite o CPF ou CNPJ do titular."); return; }
    createAccount({
      tipoChave,
      chavePix: chavePix.trim(),
      titularNome: titularNome.trim(),
      titularDoc: titularDoc.replace(/\D/g, ""),
      frequencia: repFrequencia,
      horario: repHorario,
      status: "ATIVO",
    });
  }



  const labels = ["Seus dados", "CPF", "CNPJ", "Senha", "Recebimento", "Pronto"];
  const si = step - 1;

  return (
    <>
      <style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif}
.wrap{display:flex;min-height:100vh}
.left{flex:0 0 42%;background:linear-gradient(150deg,#0a0a0a,#1a1a2e 60%,#0a0a0a);display:flex;align-items:center;justify-content:center;padding:48px 36px;position:relative;overflow:hidden}
.left::after{content:'';position:absolute;top:20%;left:50%;width:300px;height:300px;background:radial-gradient(circle,rgba(239,68,68,.12),transparent 70%);pointer-events:none;transform:translate(-50%,-50%)}
.right{flex:1;display:flex;align-items:center;justify-content:center;padding:36px 28px;background:#fff}
.inner{width:100%;max-width:440px}
.inp{width:100%;padding:13px 16px;border:2px solid #E5E7EB;border-radius:10px;font-size:.92rem;outline:none;color:#111;background:#F9FAFB;font-family:inherit;transition:all .2s}
.inp:focus{border-color:#EF4444;box-shadow:0 0 0 3px rgba(239,68,68,.08)}
.inp-big{font-size:1.2rem;letter-spacing:2px;text-align:center;font-weight:700}
.sel{width:100%;padding:13px 16px;border:2px solid #E5E7EB;border-radius:10px;font-size:.92rem;outline:none;color:#111;background:#F9FAFB;font-family:inherit;appearance:none;cursor:pointer}
.sel:focus{border-color:#EF4444;box-shadow:0 0 0 3px rgba(239,68,68,.08)}
.btn{width:100%;padding:15px;background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s;box-shadow:0 4px 14px rgba(239,68,68,.3)}
.btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 20px rgba(239,68,68,.4)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.err{background:#FEF2F2;border:1px solid #FECACA;color:#DC2626;border-radius:10px;padding:11px 15px;font-size:.82rem;margin-bottom:14px;animation:shake .3s}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.lbl{font-size:.8rem;font-weight:600;color:#374151;margin-bottom:4px;display:block}
.prog{display:flex;gap:4px;margin-bottom:24px}
.prog-s{flex:1;height:4px;border-radius:4px;transition:background .3s}
.radio-group{display:flex;gap:16px;margin-top:4px}
.radio-opt{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.88rem;color:#374151}
.radio-opt input{accent-color:#EF4444;width:16px;height:16px}
.check-opt{display:flex;align-items:center;gap:8px;font-size:.8rem;color:#6B7280;cursor:pointer}
.check-opt input{accent-color:#EF4444;width:16px;height:16px}
.cnpj-box{background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:12px;padding:14px 16px;margin-bottom:18px}
.back{background:none;border:none;color:#6B7280;cursor:pointer;font-size:.82rem;margin-top:12px;display:block;width:100%;text-align:center;font-family:inherit}
.back:hover{color:#374151}
@keyframes bounceIn{0%{transform:scale(0)}50%{transform:scale(1.12)}100%{transform:scale(1)}}
@media(max-width:768px){.left{display:none!important}.right{padding:24px 18px!important}}
      `}</style>

      <div className="wrap">
        {/* ESQUERDA */}
        <div className="left">
          <div style={{ maxWidth: 360, color: "#fff", position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
              <img src="/firehub-flame.png" alt="" style={{ width: 36, height: 36, objectFit: "contain" }}
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span style={{ fontWeight: 900, fontSize: "1.4rem" }}>
                <span style={{ color: "#EF4444" }}>FIRE</span><span>HUB</span>
              </span>
            </div>
            <div style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)", borderRadius: 8, padding: "6px 14px", display: "inline-block", fontSize: ".75rem", fontWeight: 700, color: "#EF4444", marginBottom: 20, letterSpacing: .5 }}>
              PRONTO PARA COMEÇAR?
            </div>
            <h1 style={{ fontSize: "1.9rem", fontWeight: 900, lineHeight: 1.2, marginBottom: 14 }}>
              Crie sua conta grátis e veja o FireHub em ação
            </h1>
            <p style={{ color: "rgba(255,255,255,.6)", lineHeight: 1.7, marginBottom: 28, fontSize: ".9rem" }}>
              Fale com nosso time, entenda qual plano faz mais sentido para sua operação e comece a vender mais no seu canal próprio.
            </p>
            {[
              `🔥 ${trialDays} dias grátis, sem cartão`,
              "📱 Cardápio digital + WhatsApp IA",
              "📊 Relatórios e controle completo",
              "💬 Suporte humano 7 dias por semana",
            ].map((tx, i) => (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: ".86rem", color: "rgba(255,255,255,.8)" }}>
                <span>{tx}</span>
              </div>
            ))}
          </div>
        </div>

        {/* DIREITA */}
        <div className="right">
          <div className="inner">
            {/* Progress bar */}
            <div className="prog">
              {labels.map((_, i) => (
                <div key={i} className="prog-s" style={{ background: i <= si ? "#EF4444" : "#E5E7EB" }} />
              ))}
            </div>

            {/* ===== STEP 1: QUALIFICAÇÃO ===== */}
            {step === 1 && (
              <>
                <h2 style={{ fontSize: "1.35rem", fontWeight: 800, color: "#111", marginBottom: 4, textAlign: "center" }}>
                  Transforme o seu delivery agora <span style={{ color: "#EF4444" }}>gratuitamente</span>
                </h2>
                <p style={{ color: "#9CA3AF", fontSize: ".82rem", textAlign: "center", marginBottom: 20 }}>
                  Preencha seus dados e comece seu teste grátis de {trialDays} dias
                </p>
                {error && <div className="err">{error}</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <input className="inp" placeholder="Seu nome*" value={nome} autoFocus onChange={e => setNome(e.target.value)} />
                  <input className="inp" placeholder="WhatsApp Pessoal para Contato*" type="tel" inputMode="numeric"
                    value={whatsapp} onChange={e => setWhatsapp(fmtPhone(e.target.value))} />
                  <input className="inp" placeholder="Nome da sua empresa*" value={empresa} onChange={e => setEmpresa(e.target.value)} />
                  <input className="inp" placeholder="Email*" type="email" value={email} onChange={e => setEmail(e.target.value)} />

                  <div>
                    <label className="lbl">Você tem computador ou notebook para trabalhar?*</label>
                    <div className="radio-group">
                      <label className="radio-opt">
                        <input type="radio" name="pc" checked={temPC==="sim"} onChange={() => setTemPC("sim")} /> Sim
                      </label>
                      <label className="radio-opt">
                        <input type="radio" name="pc" checked={temPC==="nao"} onChange={() => setTemPC("nao")} /> Não
                      </label>
                    </div>
                  </div>

                  <div>
                    <select className="sel" value={comoConheceu} onChange={e => setComoConheceu(e.target.value)}>
                      <option value="">Como você conheceu o FireHub?*</option>
                      {COMO_CONHECEU.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>

                  <div>
                    <select className="sel" value={faturamento} onChange={e => setFaturamento(e.target.value)}>
                      <option value="">Qual seu faturamento no canal próprio (WhatsApp + Cardápio Digital)?*</option>
                      {FATURAMENTO.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>

                  <button className="btn" onClick={handleStep1}>Testar Grátis</button>
                </div>
                <p style={{ textAlign: "center", marginTop: 14, fontSize: ".82rem", color: "#6B7280" }}>
                  Já tem conta? <a href={`${PORTAL}/login`} style={{ color: "#EF4444", fontWeight: 600, textDecoration: "none" }}>Entrar</a>
                </p>
              </>
            )}

            {/* ===== STEP 2: CPF ===== */}
            {step === 2 && (
              <>
                <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#111", marginBottom: 6 }}>Qual é o seu CPF?</h2>
                <p style={{ color: "#6B7280", marginBottom: 22, fontSize: ".86rem", lineHeight: 1.6 }}>
                  Usamos seu CPF para garantir que cada empresa tenha apenas uma conta no FireHub.
                </p>
                {error && <div className="err">{error}</div>}
                <div style={{ marginBottom: 16 }}>
                  <input className="inp inp-big" type="text" inputMode="numeric" placeholder="000.000.000-00"
                    value={cpf} autoFocus onChange={e => setCpf(fmtCPF(e.target.value))}
                    onKeyDown={e => e.key === "Enter" && handleStep2()} />
                </div>
                <button className="btn" onClick={handleStep2}>Continuar →</button>
                <p style={{ textAlign: "center", marginTop: 12, fontSize: ".76rem", color: "#9CA3AF" }}>🔒 Dados protegidos e não compartilhados</p>
                <button className="back" onClick={() => { setStep(1); setError(""); }}>← Voltar</button>
              </>
            )}

            {/* ===== STEP 3: CNPJ ===== */}
            {step === 3 && (
              <>
                <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#111", marginBottom: 6 }}>Digite o CNPJ da empresa</h2>
                <p style={{ color: "#6B7280", marginBottom: 22, fontSize: ".86rem", lineHeight: 1.6 }}>
                  Vamos verificar sua empresa para preencher tudo automaticamente.
                </p>
                {error && <div className="err">{error}</div>}
                <div style={{ marginBottom: 16 }}>
                  <input className="inp inp-big" type="text" inputMode="numeric" placeholder="00.000.000/0001-00"
                    value={cnpjInput} autoFocus onChange={e => setCnpjInput(fmtCNPJ(e.target.value))}
                    onKeyDown={e => e.key === "Enter" && handleStep3()} />
                </div>
                <button className="btn" onClick={handleStep3} disabled={loading}>
                  {loading ? "🔍 Verificando..." : "Verificar CNPJ →"}
                </button>
                <button className="back" onClick={() => { setStep(2); setError(""); }}>← Voltar</button>
              </>
            )}

            {/* ===== STEP 4: SENHA ===== */}
            {step === 4 && cnpjData && (
              <>
                <div className="cnpj-box">
                  <div style={{ fontSize: ".72rem", color: "#16A34A", fontWeight: 700, marginBottom: 2 }}>✅ EMPRESA VERIFICADA</div>
                  <div style={{ fontWeight: 700, color: "#111", fontSize: ".92rem" }}>
                    {cnpjData.nome_fantasia || cnpjData.razao_social}
                  </div>
                  <div style={{ fontSize: ".76rem", color: "#6B7280", marginTop: 2 }}>
                    CNPJ {fmtCNPJ(cnpjData.cnpj)}{cnpjData.municipio ? ` · ${cnpjData.municipio}/${cnpjData.uf}` : ""}
                  </div>
                </div>

                <h2 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#111", marginBottom: 4 }}>Crie sua senha</h2>
                <p style={{ color: "#6B7280", marginBottom: 18, fontSize: ".84rem" }}>Defina uma senha para acessar seu painel.</p>
                {error && <div className="err">{error}</div>}

                <form onSubmit={handleStep4} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label className="lbl">Senha de acesso *</label>
                    <input className="inp" type="password" placeholder="Mínimo 6 caracteres" value={senha} autoFocus
                      onChange={e => setSenha(e.target.value)} />
                  </div>
                  <label className="check-opt">
                    <input type="checkbox" checked={termos} onChange={e => setTermos(e.target.checked)} />
                    Aceito os <a href="#" style={{ color: "#EF4444", marginLeft: 3 }}>Termos de Uso</a>
                    <span style={{ margin: "0 3px" }}>e</span>
                    <a href="#" style={{ color: "#EF4444" }}>Política de Privacidade</a>
                  </label>
                  <button type="submit" className="btn" disabled={loading}>
                    {loading ? "Criando sua conta..." : "🔥 Começar Teste Grátis"}
                  </button>
                </form>
                <button className="back" onClick={() => { setStep(3); setError(""); }}>← Voltar</button>
              </>
            )}

            {/* ===== STEP 5: REPASSE PIX ===== */}
            {step === 5 && (
              <>
                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{ fontSize: "2rem", marginBottom: 8 }}>💰</div>
                  <h2 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#111", marginBottom: 4 }}>Onde você quer receber?</h2>
                  <p style={{ color: "#6B7280", fontSize: ".84rem", lineHeight: 1.6 }}>
                    Configure sua conta Pix para receber os pagamentos das vendas online automaticamente.
                  </p>
                </div>
                {error && <div className="err">{error}</div>}

                <form onSubmit={handleStep5} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label className="lbl">Tipo de Chave Pix *</label>
                    <select className="sel" value={tipoChave} onChange={e => setTipoChave(e.target.value)}>
                      <option value="">Selecione...</option>
                      <option value="CPF">CPF</option>
                      <option value="CNPJ">CNPJ</option>
                      <option value="EMAIL">E-mail</option>
                      <option value="TELEFONE">Telefone</option>
                      <option value="ALEATORIA">Chave Aleatória</option>
                    </select>
                  </div>

                  <div>
                    <label className="lbl">Chave Pix *</label>
                    <input className="inp" placeholder="Digite sua chave Pix" value={chavePix}
                      onChange={e => setChavePix(e.target.value)} />
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label className="lbl">Nome do Titular</label>
                      <input className="inp" placeholder="Nome completo" value={titularNome}
                        onChange={e => setTitularNome(e.target.value)} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="lbl">CPF/CNPJ do Titular</label>
                      <input className="inp" placeholder="Documento" value={titularDoc}
                        onChange={e => setTitularDoc(e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <label className="lbl">Frequência do repasse</label>
                    <div className="radio-group">
                      <label className="radio-opt">
                        <input type="radio" name="freq" checked={repFrequencia==="DAILY"} onChange={() => setRepFrequencia("DAILY")} /> Todos os dias
                      </label>
                      <label className="radio-opt">
                        <input type="radio" name="freq" checked={repFrequencia==="WEEKLY"} onChange={() => setRepFrequencia("WEEKLY")} /> Semanal
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="lbl">Horário do repasse (Brasília)</label>
                    <select className="sel" value={repHorario} onChange={e => setRepHorario(e.target.value)}>
                      <option value="03:00">03:00 — Madrugada (mais usado)</option>
                      <option value="06:00">06:00 — Manhã</option>
                      <option value="12:00">12:00 — Meio-dia</option>
                      <option value="18:00">18:00 — Fim de tarde</option>
                      <option value="22:00">22:00 — Noite</option>
                    </select>
                  </div>

                  <button type="submit" className="btn" disabled={loading}>
                    {loading ? "Criando sua conta..." : "🔥 Salvar e Começar"}
                  </button>
                </form>

                <button className="back" onClick={() => { setStep(4); setError(""); }}>← Voltar</button>
                <p style={{ textAlign: "center", fontSize: ".74rem", color: "#9CA3AF", marginTop: 8 }}>
                  🔒 Seus dados financeiros são protegidos e usados exclusivamente para o repasse.
                </p>
              </>
            )}

            {/* ===== STEP 6: SUCESSO ===== */}
            {step === 6 && (
              <div style={{ textAlign: "center", padding: "10px 0" }}>
                <div style={{ fontSize: "3.5rem", marginBottom: 14, animation: "bounceIn .5s" }}>🎉</div>
                <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#111", marginBottom: 8 }}>Conta criada!</h2>
                <p style={{ color: "#6B7280", lineHeight: 1.6, marginBottom: 20, fontSize: ".9rem" }}>
                  <strong>&quot;{createdStore}&quot;</strong> está pronto.<br />
                  Seus {trialDays} dias de teste grátis começam agora!
                </p>
                <p style={{ fontSize: ".82rem", color: "#9CA3AF", marginBottom: 16 }}>
                  ⏳ Redirecionando para o seu painel em instantes...
                </p>
                <a href={`${PORTAL}/login`} className="btn" style={{ display: "block", textDecoration: "none", textAlign: "center" }}>
                  🚀 Acessar Meu Painel Agora
                </a>
                <p style={{ fontSize: ".76rem", color: "#9CA3AF", marginTop: 12 }}>Sem cartão · Cancele quando quiser</p>
                <script dangerouslySetInnerHTML={{ __html: `setTimeout(function(){ window.location.href="${PORTAL}/login"; }, 3000);` }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
