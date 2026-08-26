"use client";
import { useState } from "react";

/**
 * /seja-embaixador — o influenciador demonstra interesse.
 *
 * Substitui o antigo /indique-ganhe, que era um programa de indicação aberto a
 * qualquer lojista. Aqui NINGUÉM vira embaixador sozinho: o formulário só
 * registra a inscrição, e quem cadastra de verdade é a equipe, à mão, no admin
 * — porque é lá que se define código, comissão e carteira do Asaas.
 *
 * Por isso a página não promete link, painel nem comissão automática. Promete
 * exatamente o que acontece: a equipe analisa e entra em contato.
 */

const LOGIN = "https://firehubfood.com.br/login";

export default function SejaEmbaixadorPage() {
  const [fullName, setFullName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [followers, setFollowers] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [message, setMessage] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState("");

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const r = await fetch("/api/embaixador/inscricao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, instagram, followers, whatsapp, message }),
      });
      const d = await r.json();
      if (r.ok && d.ok) setPronto(true);
      else setErro(d.error || "Não consegui enviar agora. Tente de novo.");
    } catch {
      setErro("Sem conexão com o servidor. Tente de novo em instantes.");
    } finally {
      setEnviando(false);
    }
  };

  const campo: React.CSSProperties = {
    width: "100%",
    padding: "13px 15px",
    borderRadius: 12,
    border: "1.5px solid #E2E8F0",
    fontSize: "0.95rem",
    fontFamily: "inherit",
    outline: "none",
    background: "#fff",
  };
  const rotulo: React.CSSProperties = {
    display: "block",
    fontSize: "0.82rem",
    fontWeight: 800,
    color: "#0F172A",
    marginBottom: 6,
  };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#F8FAFC", minHeight: "100vh" }}>
      <nav
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", background: "#fff", borderBottom: "1px solid #E2E8F0",
          position: "sticky", top: 0, zIndex: 10,
        }}
      >
        <a href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <img src="/firehub-flame.png" alt="FireHub" style={{ height: 32 }} />
          <div style={{ marginLeft: 12 }}>
            <div style={{ fontSize: "1.15rem", fontWeight: 900 }}>
              <span style={{ color: "#EF4444" }}>FIRE</span>
              <span style={{ color: "#0F172A" }}>HUB</span>
            </div>
            <div style={{ fontSize: "0.72rem", color: "#64748B" }}>Programa de Embaixadores</div>
          </div>
        </a>
        <a
          href={LOGIN}
          style={{
            padding: "9px 18px", borderRadius: 50, background: "#EF4444", color: "#fff",
            fontWeight: 800, fontSize: "0.85rem", textDecoration: "none",
          }}
        >
          Acessar
        </a>
      </nav>

      <main style={{ maxWidth: 780, margin: "0 auto", padding: "48px 20px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div
            style={{
              display: "inline-block", padding: "6px 16px", borderRadius: 50,
              background: "rgba(239,68,68,0.1)", color: "#EF4444",
              fontWeight: 800, fontSize: "0.78rem", marginBottom: 18,
            }}
          >
            ⭐ PROGRAMA DE EMBAIXADORES
          </div>
          <h1 style={{ fontSize: "2.3rem", fontWeight: 900, color: "#0F172A", lineHeight: 1.15, margin: "0 0 16px" }}>
            É influenciador?<br />Ganhe com o FireHub.
          </h1>
          <p style={{ fontSize: "1.05rem", color: "#475569", lineHeight: 1.65, maxWidth: 560, margin: "0 auto" }}>
            Indique o FireHub para donos de restaurante e receba <strong>lucros recorrentes</strong> —
            todo mês, enquanto a loja continuar com a gente. Preencha abaixo demonstrando
            interesse e <strong>nossa equipe entra em contato com você</strong>.
          </p>
        </div>

        {pronto ? (
          <div
            style={{
              background: "#fff", border: "1.5px solid #BBF7D0", borderRadius: 20,
              padding: "40px 28px", textAlign: "center",
              boxShadow: "0 4px 20px rgba(15,23,42,0.06)",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: 12 }}>🎉</div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 900, color: "#15803D", margin: "0 0 10px" }}>
              Inscrição enviada!
            </h2>
            <p style={{ color: "#475569", lineHeight: 1.6, margin: 0 }}>
              Nossa equipe vai analisar seu perfil e entrar em contato. Fique de olho no
              seu WhatsApp e no direct do Instagram.
            </p>
            <a
              href="/"
              style={{
                display: "inline-block", marginTop: 24, padding: "11px 22px", borderRadius: 12,
                background: "#0F172A", color: "#fff", fontWeight: 800,
                fontSize: "0.88rem", textDecoration: "none",
              }}
            >
              Voltar ao site
            </a>
          </div>
        ) : (
          <form
            onSubmit={enviar}
            style={{
              background: "#fff", border: "1px solid #E2E8F0", borderRadius: 20,
              padding: "30px 26px", boxShadow: "0 4px 20px rgba(15,23,42,0.06)",
              display: "flex", flexDirection: "column", gap: 18,
            }}
          >
            <div>
              <label style={rotulo}>Nome completo *</label>
              <input
                style={campo} value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder="Como está no seu documento" required maxLength={120}
              />
            </div>

            <div>
              <label style={rotulo}>Seu Instagram *</label>
              <input
                style={campo} value={instagram} onChange={(e) => setInstagram(e.target.value)}
                placeholder="@seuperfil" required maxLength={80}
              />
            </div>

            <div>
              <label style={rotulo}>Quantos seguidores você tem, em média? *</label>
              <input
                style={campo} value={followers} onChange={(e) => setFollowers(e.target.value)}
                placeholder="Ex.: 12 mil" required maxLength={20} inputMode="numeric"
              />
            </div>

            <div>
              <label style={rotulo}>WhatsApp</label>
              <input
                style={campo} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(22) 90000-0000" maxLength={20} inputMode="tel"
              />
              <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 5 }}>
                Opcional, mas é por onde a gente costuma responder mais rápido.
              </div>
            </div>

            <div>
              <label style={rotulo}>Quer contar mais alguma coisa?</label>
              <textarea
                style={{ ...campo, minHeight: 90, resize: "vertical" }}
                value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder="Seu nicho, cidade, se já trabalha com restaurantes…" maxLength={1000}
              />
            </div>

            {erro && (
              <div
                style={{
                  background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#991B1B",
                  padding: "11px 14px", borderRadius: 12, fontSize: "0.85rem",
                }}
              >
                {erro}
              </div>
            )}

            <button
              type="submit"
              disabled={enviando}
              style={{
                padding: "15px 24px", borderRadius: 14, border: "none",
                background: enviando ? "#94A3B8" : "linear-gradient(135deg,#EF4444,#DC2626)",
                color: "#fff", fontWeight: 900, fontSize: "1rem",
                cursor: enviando ? "not-allowed" : "pointer",
                boxShadow: "0 6px 18px rgba(239,68,68,0.28)",
              }}
            >
              {enviando ? "Enviando…" : "Quero ser embaixador"}
            </button>

            <p style={{ fontSize: "0.78rem", color: "#64748B", textAlign: "center", margin: 0, lineHeight: 1.55 }}>
              Isto é uma demonstração de interesse — não gera cadastro automático.
              Nossa equipe analisa cada perfil antes de aprovar.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
