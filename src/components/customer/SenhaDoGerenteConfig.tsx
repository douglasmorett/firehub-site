"use client";
/**
 * Minha Loja → Senha do gerente. Só o DONO vê o cartão (MinhaLojaClient) e só
 * o dono grava (api/store-settings/senha-do-gerente). A senha protege as ações
 * de ACOES_PROTEGIDAS (lib/senha-do-gerente-regras.ts) — cada uma com o seu
 * interruptor, todos desligados até o dono ligar.
 *
 * Loja que já tem senha: qualquer mudança pede a senha atual (ou a senha de
 * acesso da conta do dono). É o que impede quem está no caixa, logado na
 * conta do dono, de desligar a proteção.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { AvisoNoTopo, type Aviso } from "@/components/mesas/SelecionarItensParaImpressao";
import { ACOES_PROTEGIDAS, type AcaoProtegida, type ExigeSenha } from "@/lib/senha-do-gerente-regras";

type Estado = { temSenha: boolean; exige: ExigeSenha; podeMudar: boolean };

const caixa: CSSProperties = { background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 1px 6px rgba(0,0,0,0.05)", padding: "1.25rem" };
const campo: CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.95rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const rotulo: CSSProperties = { display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 5 };

export default function SenhaDoGerenteConfig() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erroAoCarregar, setErroAoCarregar] = useState(false);
  const [exige, setExige] = useState<ExigeSenha | null>(null);
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ver, setVer] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store-settings/senha-do-gerente", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setEstado({ temSenha: Boolean(d.temSenha), exige: d.exige, podeMudar: Boolean(d.podeMudar) });
      setExige(d.exige);
    } catch {
      setErroAoCarregar(true);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async (corpo: Record<string, unknown>, ok: Aviso) => {
    setSalvando(true);
    try {
      const r = await fetch("/api/store-settings/senha-do-gerente", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...corpo, ...(estado?.temSenha ? { senhaAtual } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setAviso({ tipo: "erro", titulo: "Não foi salvo", detalhe: d?.error || "Tente de novo." });
      setEstado((e) => (e ? { ...e, temSenha: Boolean(d.temSenha), exige: d.exige } : e));
      setExige(d.exige);
      setSenhaAtual(""); setNovaSenha(""); setConfirmar("");
      setAviso(ok);
    } catch {
      setAviso({ tipo: "erro", titulo: "Sem conexão", detalhe: "Tente de novo." });
    } finally {
      setSalvando(false);
    }
  };

  const salvar = () => {
    if (!exige) return;
    if (novaSenha || confirmar) {
      if (novaSenha !== confirmar) return setAviso({ tipo: "atencao", titulo: "As duas senhas não são iguais" });
      if (novaSenha.trim().length < 4) return setAviso({ tipo: "atencao", titulo: "A senha precisa de pelo menos 4 caracteres" });
    }
    if (estado?.temSenha && !senhaAtual) return setAviso({ tipo: "atencao", titulo: "Digite a senha atual", detalhe: "A senha do gerente de agora (ou a senha de acesso da sua conta)." });
    if (!estado?.temSenha && !novaSenha) return setAviso({ tipo: "atencao", titulo: "Cadastre a senha primeiro", detalhe: "Digite a senha nova e a confirmação." });
    enviar(
      { exige, ...(novaSenha ? { novaSenha } : {}) },
      { tipo: "ok", titulo: novaSenha ? "Senha do gerente salva" : "Proteções salvas", detalhe: "Vale na hora para todas as telas. Quem estava com uma tela aberta pode precisar apertar F5." },
    );
  };

  const remover = () => {
    if (!senhaAtual) return setAviso({ tipo: "atencao", titulo: "Digite a senha atual para remover" });
    enviar({ removerSenha: true }, { tipo: "ok", titulo: "Senha do gerente removida", detalhe: "Nenhuma ação pede senha agora." });
  };

  if (erroAoCarregar) return <div style={caixa}>Não deu para carregar a senha do gerente. Recarregue a página.</div>;
  if (!estado || !exige) return <div style={caixa}>Carregando…</div>;
  if (!estado.podeMudar) return <div style={caixa}>Só o dono da loja mexe na senha do gerente.</div>;

  const alternar = (chave: AcaoProtegida) => setExige((e) => (e ? { ...e, [chave]: !e[chave] } : e));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <div style={{ ...caixa, background: estado.temSenha ? "#F0FDFA" : "#FFF7E6", borderColor: estado.temSenha ? "#99F6E4" : "#FDE68A" }}>
        <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>
          {estado.temSenha ? "🔒 Senha do gerente cadastrada" : "Nenhuma senha cadastrada"}
        </div>
        <div style={{ fontSize: "0.85rem", color: "#475569", lineHeight: 1.5 }}>
          A senha que você cadastra aqui autoriza as ações marcadas abaixo. Quem estiver na tela (até na sua conta) precisa digitá-la — passe só para quem pode autorizar.
          Errar 5 vezes trava a senha por 15 minutos.
        </div>
      </div>

      <div style={caixa}>
        <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 10 }}>O que pede a senha</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {ACOES_PROTEGIDAS.map((a) => {
            const ligada = exige[a.chave];
            return (
              <label key={a.chave} style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <button type="button" role="switch" aria-checked={ligada} onClick={() => alternar(a.chave)}
                  style={{ flexShrink: 0, width: 44, height: 24, borderRadius: 999, border: "none", padding: 2, cursor: "pointer", background: ligada ? "#C92E09" : "#CBD5E1", transition: "background 0.15s" }}>
                  <span style={{ display: "block", width: 20, height: 20, borderRadius: "50%", background: "#fff", transform: `translateX(${ligada ? 20 : 0}px)`, transition: "transform 0.15s" }} />
                </button>
                <span>
                  <strong style={{ fontSize: "0.9rem", color: "#0F172A" }}>{a.rotulo}</strong>
                  <span style={{ display: "block", fontSize: "0.78rem", color: "#64748B", lineHeight: 1.45 }}>{a.ajuda}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{ ...caixa, display: "grid", gap: "0.9rem" }}>
        <div style={{ fontWeight: 800, color: "#0F172A" }}>{estado.temSenha ? "Trocar a senha (opcional)" : "Cadastrar a senha"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
          <div>
            <label style={rotulo}>{estado.temSenha ? "Senha nova" : "Senha"}</label>
            <input type={ver ? "text" : "password"} value={novaSenha} autoComplete="new-password" onChange={(e) => setNovaSenha(e.target.value)} placeholder="Mínimo 4 caracteres" style={campo} />
          </div>
          <div>
            <label style={rotulo}>Repita a senha</label>
            <input type={ver ? "text" : "password"} value={confirmar} autoComplete="new-password" onChange={(e) => setConfirmar(e.target.value)} placeholder="A mesma senha"
              style={{ ...campo, borderColor: confirmar && confirmar !== novaSenha ? "#C92E09" : "#E2E8F0" }} />
          </div>
        </div>
        {estado.temSenha && (
          <div>
            <label style={rotulo}>Senha atual do gerente (ou a senha de acesso da sua conta) — para salvar qualquer mudança</label>
            <input type={ver ? "text" : "password"} value={senhaAtual} autoComplete="off" onChange={(e) => setSenhaAtual(e.target.value)} style={campo} />
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "#64748B", cursor: "pointer" }}>
          <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Mostrar o que estou digitando
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={salvar} disabled={salvando}
            style={{ flex: "1 1 200px", padding: "11px", borderRadius: 10, background: "#C92E09", color: "#fff", border: "none", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", opacity: salvando ? 0.7 : 1 }}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          {estado.temSenha && (
            <button type="button" onClick={remover} disabled={salvando}
              style={{ padding: "11px 16px", borderRadius: 10, background: "#fff", color: "#B91C1C", border: "1.5px solid #FECACA", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
              Remover a senha
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
