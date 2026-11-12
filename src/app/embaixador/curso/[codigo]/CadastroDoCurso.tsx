"use client";
import { useState } from "react";

export default function CadastroDoCurso({ codigoDoCurso, comissao }: { codigoDoCurso: string; comissao: number }) {
  const [f, setF] = useState({ nome: "", email: "", whatsapp: "", senha: "", walletId: "" });
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [link, setLink] = useState("");
  const [copiado, setCopiado] = useState(false);

  const muda = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const r = await fetch("/api/embaixador/curso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, aceite, codigoDoCurso }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) setLink(d.link);
      else setErro(d.error || "Não consegui cadastrar agora. Tente de novo.");
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo em instantes.");
    } finally {
      setEnviando(false);
    }
  };

  const campo: React.CSSProperties = { width: "100%", padding: "13px 15px", borderRadius: 12, border: "1.5px solid #E2E8F0", fontSize: "0.95rem", fontFamily: "inherit", outline: "none", background: "#fff", boxSizing: "border-box" };
  const rotulo: React.CSSProperties = { display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", margin: "14px 0 6px" };
  const ajuda: React.CSSProperties = { fontSize: "0.78rem", color: "#64748B", marginTop: 6, lineHeight: 1.45 };

  return (
    <main style={{ minHeight: "100vh", background: "#F8FAFC", padding: "32px 16px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 460, margin: "0 auto", background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 10px 40px -20px #0f172a40" }}>
        <img src="/firehub-flame.png" alt="" width={36} height={36} />
        {link ? (
          <>
            <h1 style={{ fontSize: "1.4rem", margin: "12px 0 8px", color: "#0F172A" }}>Pronto, você é embaixador FireHub!</h1>
            <p style={{ color: "#475569", lineHeight: 1.5 }}>Este é o seu link. Toda loja que se cadastrar por ele te paga {comissao}% da mensalidade, todo mês, enquanto ela pagar.</p>
            <div style={{ ...campo, marginTop: 14, wordBreak: "break-all", fontWeight: 700 }}>{link}</div>
            <button
              onClick={() => { navigator.clipboard?.writeText(link); setCopiado(true); }}
              style={{ width: "100%", marginTop: 10, padding: 14, borderRadius: 12, border: 0, background: "#FF4D00", color: "#fff", fontWeight: 800, fontSize: "1rem", cursor: "pointer" }}
            >{copiado ? "Copiado!" : "Copiar meu link"}</button>
            <p style={ajuda}>Acompanhe as lojas e as comissões em <a href="/embaixador">firehubfood.com.br/embaixador</a>, com o seu e-mail e a senha que você criou.</p>
          </>
        ) : (
          <form onSubmit={enviar}>
            <h1 style={{ fontSize: "1.4rem", margin: "12px 0 6px", color: "#0F172A" }}>Seja embaixador FireHub</h1>
            <p style={{ color: "#475569", lineHeight: 1.5, margin: 0 }}>Cadastro dos alunos do curso. Você recebe {comissao}% da mensalidade de cada loja que indicar, todo mês, direto na sua conta do Asaas.</p>

            <label style={rotulo}>Nome completo</label>
            <input style={campo} value={f.nome} onChange={muda("nome")} required autoComplete="name" />
            <label style={rotulo}>E-mail</label>
            <input style={campo} type="email" value={f.email} onChange={muda("email")} required autoComplete="email" />
            <label style={rotulo}>WhatsApp com DDD</label>
            <input style={campo} inputMode="tel" value={f.whatsapp} onChange={muda("whatsapp")} required placeholder="(22) 99999-9999" />
            <label style={rotulo}>Crie uma senha</label>
            <input style={campo} type="password" value={f.senha} onChange={muda("senha")} required minLength={6} autoComplete="new-password" />
            <label style={rotulo}>Código da sua carteira no Asaas (Wallet ID)</label>
            <input style={campo} value={f.walletId} onChange={muda("walletId")} required placeholder="1a2b3c4d-1a2b-1a2b-1a2b-1a2b3c4d5e6f" autoCapitalize="off" spellCheck={false} />
            <p style={ajuda}>No app ou site do Asaas: Menu › Integrações › Wallet ID. É por ele que a comissão cai na sua conta. A gente confere com o Asaas antes de cadastrar.</p>

            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 16, fontSize: "0.85rem", color: "#334155", lineHeight: 1.45 }}>
              <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} style={{ marginTop: 3 }} />
              <span>Entendi: a comissão é de {comissao}% da mensalidade que a loja indicada por mim pagar, cai pelo Asaas enquanto ela pagar, e não existe valor garantido.</span>
            </label>

            {erro && <p style={{ color: "#B91C1C", background: "#FEF2F2", borderRadius: 10, padding: "10px 12px", fontSize: "0.88rem", marginTop: 14 }}>{erro}</p>}

            <button
              disabled={enviando}
              style={{ width: "100%", marginTop: 16, padding: 15, borderRadius: 12, border: 0, background: enviando ? "#FDBA9A" : "#FF4D00", color: "#fff", fontWeight: 800, fontSize: "1rem", cursor: enviando ? "wait" : "pointer" }}
            >{enviando ? "Conferindo seu código no Asaas…" : "Quero ser embaixador"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
