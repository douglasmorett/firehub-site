"use client";

/**
 * Trocar entre a LOJA e o PORTAL DO PARCEIRO sem sair — para quem é os dois
 * (o Victor: embaixador, vendedor e dono de uma loja de demonstração).
 *
 * A troca é um `signIn` com `trocarPara` (lib/auth.ts → lib/paineis-do-dono.ts):
 * conta já provada nesta sessão troca direto; a outra pede a senha dela uma
 * vez. Depois a página recarrega inteira, porque os layouts do servidor leem
 * a sessão nova só numa navegação completa.
 */
import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Briefcase, Handshake, LayoutDashboard, Store, type LucideIcon } from "lucide-react";
import type { Painel, PaineisDaSessao } from "@/lib/paineis-do-dono";

export async function trocarDePainel(para: Painel, senha?: string): Promise<{ ok: boolean; erro?: string }> {
  try {
    const res = await signIn("credentials", { trocarPara: para, password: senha || "", redirect: false });
    if (res?.ok && !res.error) return { ok: true };
    const erro = res?.error && res.error !== "CredentialsSignin" ? res.error : senha ? "Senha incorreta." : undefined;
    return { ok: false, erro };
  } catch {
    return { ok: false, erro: "Não consegui trocar agora. Tente de novo." };
  }
}

/** Nome, ícone e destino de cada painel, do jeito que a pessoa reconhece. */
export function comoChamar(paineis: PaineisDaSessao, painel: Painel): { rotulo: string; detalhe: string; Icone: LucideIcon; destino: string } {
  if (painel === "loja") {
    const l = paineis.loja!;
    return l.admin
      ? { rotulo: "Painel admin", detalhe: l.nome, Icone: LayoutDashboard, destino: l.destino }
      : { rotulo: "Minha loja", detalhe: l.nome, Icone: Store, destino: l.destino };
  }
  const p = paineis.parceiro!;
  return p.vendedor
    ? { rotulo: "Painel de vendedor", detalhe: "Suas lojas, comissão e conversas", Icone: Briefcase, destino: p.destino }
    : { rotulo: "Portal do embaixador", detalhe: "Suas lojas e comissão", Icone: Handshake, destino: p.destino };
}

/**
 * Pede a senha da outra conta quando ela ainda não foi provada nesta sessão
 * (loja e portal com senhas diferentes).
 */
export function PedirSenhaDoPainel({
  rotulo,
  para,
  destino,
  aoFechar,
}: {
  rotulo: string;
  para: Painel;
  destino: string;
  aoFechar: () => void;
}) {
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senha.trim()) return;
    setEntrando(true);
    setErro("");
    const r = await trocarDePainel(para, senha);
    if (r.ok) {
      window.location.href = destino;
      return;
    }
    setEntrando(false);
    setErro(r.erro || "Senha incorreta.");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Entrar em ${rotulo}`}
      onClick={() => !entrando && aoFechar()}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "1.25rem",
        fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      <form
        onSubmit={entrar}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 18, padding: "1.6rem",
          width: "100%", maxWidth: 380, color: "#0F172A",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)",
        }}
      >
        <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.1rem", fontWeight: 800 }}>Entrar em {rotulo}</h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.86rem", color: "#64748B", lineHeight: 1.5 }}>
          Esta conta tem outra senha. Digite uma vez — enquanto você estiver logado, a troca fica direta.
        </p>
        <label htmlFor="senha-do-painel" style={{ display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#334155", marginBottom: 6 }}>
          Senha desta conta
        </label>
        <input
          id="senha-do-painel"
          ref={campo}
          type="password"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          style={{
            width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10,
            border: `2px solid ${erro ? "#FCA5A5" : "#E2E8F0"}`, fontSize: "0.95rem", fontFamily: "inherit", outline: "none",
          }}
        />
        {erro && <p role="alert" style={{ margin: "8px 0 0", fontSize: "0.82rem", color: "#B91C1C", fontWeight: 600 }}>{erro}</p>}
        <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.1rem" }}>
          <button
            type="button"
            onClick={aoFechar}
            disabled={entrando}
            style={{ flex: 1, padding: 12, borderRadius: 12, border: "1.5px solid #E2E8F0", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={entrando || !senha.trim()}
            style={{ flex: 1, padding: 12, borderRadius: 12, border: "none", background: "#C92E09", color: "#fff", fontWeight: 800, fontSize: "0.9rem", cursor: entrando ? "wait" : "pointer", fontFamily: "inherit", opacity: entrando || !senha.trim() ? 0.7 : 1 }}
          >
            {entrando ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * O botão "outro painel": na barra da loja leva ao portal do parceiro, no
 * portal leva à loja. Não aparece para quem só tem uma das contas — a
 * consulta é feita uma vez, depois de a tela abrir, para não atrasar o painel.
 */
export function AtalhoDoOutroPainel({
  className,
  style,
  soIcone = false,
  tamanhoDoIcone = 17,
  classeDoIcone,
  classeDoRotulo,
  avisoAntes,
}: {
  className?: string;
  style?: React.CSSProperties;
  /** Barra recolhida: só o ícone, com o nome no `title`. */
  soIcone?: boolean;
  tamanhoDoIcone?: number;
  classeDoIcone?: string;
  classeDoRotulo?: string;
  /**
   * Pergunta antes de trocar. A sessão é UMA por navegador: trocando para o
   * portal, as abas da loja abertas aqui (pedidos, KDS, impressão) param de
   * receber até a pessoa voltar. A barra da loja passa este aviso com o caixa
   * aberto — loja de verdade operando, não a de demonstração.
   */
  avisoAntes?: string;
}) {
  const [paineis, setPaineis] = useState<PaineisDaSessao | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [pedindoSenha, setPedindoSenha] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/me/paineis")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => vivo && setPaineis(d?.paineis ?? null))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (!paineis?.loja || !paineis?.parceiro) return null;
  const para: Painel = paineis.ativo === "loja" ? "parceiro" : "loja";
  const { rotulo, detalhe, Icone, destino } = comoChamar(paineis, para);
  const provado = para === "loja" ? paineis.loja.provado : paineis.parceiro.provado;

  const abrir = async (confirmado = false) => {
    if (avisoAntes && !confirmado) {
      setConfirmando(true);
      return;
    }
    setConfirmando(false);
    if (!provado) {
      setPedindoSenha(true);
      return;
    }
    setTrocando(true);
    const r = await trocarDePainel(para);
    if (r.ok) {
      window.location.href = destino;
      return;
    }
    // A sessão deixou de provar a conta (senha trocada, conta desvinculada):
    // cai no pedido de senha em vez de um botão que não faz nada.
    setTrocando(false);
    setPedindoSenha(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => abrir()}
        disabled={trocando}
        className={className}
        title={soIcone ? `${rotulo} — ${detalhe}` : detalhe}
        style={{ cursor: trocando ? "wait" : "pointer", font: "inherit", ...style }}
      >
        <Icone size={tamanhoDoIcone} className={classeDoIcone} aria-hidden />
        {!soIcone && <span className={classeDoRotulo}>{trocando ? "Abrindo..." : rotulo}</span>}
      </button>
      {pedindoSenha && (
        <PedirSenhaDoPainel rotulo={rotulo} para={para} destino={destino} aoFechar={() => setPedindoSenha(false)} />
      )}
      {confirmando && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Abrir ${rotulo}`}
          onClick={() => setConfirmando(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1.25rem",
            fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 18, padding: "1.6rem", width: "100%", maxWidth: 400, color: "#0F172A", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)" }}
          >
            <h2 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", fontWeight: 800 }}>Abrir {rotulo.toLowerCase()}?</h2>
            <p style={{ margin: "0 0 1.2rem", fontSize: "0.86rem", color: "#92400E", background: "#FFF7E6", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "0.75rem 0.85rem", lineHeight: 1.5 }}>
              {avisoAntes}
            </p>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                autoFocus
                style={{ flex: 1, padding: 12, borderRadius: 12, border: "1.5px solid #E2E8F0", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                Ficar na loja
              </button>
              <button
                type="button"
                onClick={() => abrir(true)}
                style={{ flex: 1, padding: 12, borderRadius: 12, border: "none", background: "#C92E09", color: "#fff", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                Trocar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
