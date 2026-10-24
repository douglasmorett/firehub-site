"use client";
import { useEffect, useState } from "react";

// Aviso que desce do topo (cópia local, como nas outras telas) no lugar do alert().
type Aviso = { tipo: "erro"; titulo: string; detalhe?: string };
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, 12000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  return (
    <div
      role="alert"
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 100002,
        width: "min(440px, calc(100vw - 24px))", background: "#FEF2F2", borderLeft: "4px solid #DC2626",
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer", whiteSpace: "normal",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

/**
 * "Redefinir senha" da conta de uma loja, para o suporte.
 *
 * "Esqueci a senha" depende de e-mail chegar — e o e-mail nem sempre chega
 * (Hotmail no spam, cadastro com e-mail antigo). Quando o lojista liga, o
 * admin redefine aqui — o servidor sorteia uma senha nova, que aparece só
 * nesta tela — e o lojista troca depois. Com
 * confirmação explícita, porque um clique sem querer derruba a senha de uma
 * loja em operação.
 */
export default function ResetPasswordButton({ userId, storeName, email }: { userId: string; storeName: string; email?: string | null }) {
  const [confirmando, setConfirmando] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);
  const [palavra, setPalavra] = useState("");
  const [copiada, setCopiada] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const confirmado = palavra.trim().toLowerCase() === "redefinir";

  const redefinir = async () => {
    if (!confirmado) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, confirmacao: palavra }),
      });
      const data = await res.json().catch(() => ({}));
      // A senha nova é sorteada no servidor e só existe nesta resposta.
      if (res.ok && data.ok && data.senha) {
        setFeito(data.senha);
        setConfirmando(false);
      } else {
        setAviso({ tipo: "erro", titulo: "Não foi possível redefinir a senha", detalhe: data.error });
      }
    } catch {
      setAviso({ tipo: "erro", titulo: "Erro ao conectar com o servidor" });
    } finally {
      setLoading(false);
    }
  };

  if (feito) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", fontWeight: 700, color: "#0F766E", background: "#F0FDFA", border: "1px solid #99F6E4", padding: "4px 8px", borderRadius: 6, whiteSpace: "nowrap" }} title="A loja entra com esta senha e troca depois em Minha Loja. Ela não aparece de novo depois de sair da tela.">
        ✅ Senha agora é <b style={{ fontFamily: "monospace", fontSize: "0.85rem" }}>{feito}</b>
        <button
          onClick={() => { navigator.clipboard?.writeText(feito).then(() => setCopiada(true)).catch(() => {}); }}
          style={{ background: "#fff", color: "#0F766E", border: "1px solid #99F6E4", padding: "2px 7px", borderRadius: 5, fontWeight: 700, cursor: "pointer", fontSize: "0.7rem" }}
        >
          {copiada ? "Copiada" : "Copiar"}
        </button>
      </span>
    );
  }

  if (confirmando) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFF7E6", border: "1px solid #FDE68A", padding: "4px 8px", borderRadius: 6, fontSize: "0.75rem", color: "#92400E", fontWeight: 700, whiteSpace: "nowrap" }}>
        <AvisoNoTopo aviso={aviso} onFechar={() => setAviso(null)} />
        Gerar uma senha nova para <b>{storeName}</b>{email ? ` (${email})` : ""}? Digite <b>redefinir</b>:
        <input
          autoFocus
          value={palavra}
          onChange={(e) => setPalavra(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") redefinir(); }}
          placeholder="redefinir"
          style={{ width: 90, padding: "3px 6px", borderRadius: 5, border: "1px solid #FDE68A", fontSize: "0.72rem" }}
        />
        <button
          onClick={redefinir}
          disabled={loading || !confirmado}
          style={{ background: confirmado ? "#B45309" : "#E2E8F0", color: confirmado ? "#fff" : "#94A3B8", border: "none", padding: "3px 8px", borderRadius: 5, fontWeight: 800, cursor: confirmado ? "pointer" : "not-allowed", fontSize: "0.72rem" }}
        >
          {loading ? "Redefinindo..." : "Confirmar"}
        </button>
        <button
          onClick={() => { setConfirmando(false); setPalavra(""); }}
          disabled={loading}
          style={{ background: "#fff", color: "#64748B", border: "1px solid #CBD5E1", padding: "3px 8px", borderRadius: 5, fontWeight: 700, cursor: "pointer", fontSize: "0.72rem" }}
        >
          Cancelar
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirmando(true)}
      style={{
        background: "rgba(217,119,6,0.1)",
        color: "#B45309",
        border: "1px solid rgba(217,119,6,0.35)",
        padding: "4px 8px",
        borderRadius: "6px",
        fontSize: "0.75rem",
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      title="Gera uma senha nova para a conta e mostra aqui (o lojista troca depois)"
    >
      🔑 Redefinir senha
    </button>
  );
}
