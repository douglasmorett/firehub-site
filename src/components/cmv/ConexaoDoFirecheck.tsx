"use client";

/**
 * Ligar esta loja ao FireCheck dela (api/store/firecheck/conexao): todo
 * descarte lançado naquele FireCheck vira perda NESTA loja. A tela avisa isso
 * antes, e só conecta com o "Entendi" marcado — uma loja tem um FireCheck; com
 * duas lojas, cada uma liga o seu.
 */
import { useEffect, useState } from "react";
import { Link2, Unlink, Trash2, Loader2, CheckCircle2 } from "lucide-react";

type Status = {
  conectado: boolean;
  podeConectar: boolean;
  loja: string;
  store?: string;
  storeName?: string;
  email?: string;
  conectadoEm?: string;
  descartes30d?: number;
  ultimos?: { item: string; quantidade: number | null; unidade: string | null; situacao: string; casouCom: string | null; registradoEm: string; funcionario: string | null }[];
};

const data = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function ConexaoDoFirecheck() {
  const [status, setStatus] = useState<Status | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [entendi, setEntendi] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarSaida, setConfirmarSaida] = useState(false);

  const carregar = () =>
    fetch("/api/store/firecheck/conexao", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setStatus(s))
      .catch(() => null);

  useEffect(() => { carregar(); }, []);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await fetch("/api/store/firecheck/conexao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha, confirmo: entendi }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || "Não deu para conectar."); return; }
      setSenha(""); setAbrir(false); setEntendi(false);
      await carregar();
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  async function desconectar() {
    setEnviando(true);
    try {
      await fetch("/api/store/firecheck/conexao", { method: "DELETE" });
      setConfirmarSaida(false);
      await carregar();
    } finally {
      setEnviando(false);
    }
  }

  if (!status) return null;

  const caixa: React.CSSProperties = { background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "18px 20px", marginBottom: "1.5rem", boxShadow: "0 4px 6px rgba(0,0,0,0.02)" };
  const botao = (cor: string): React.CSSProperties => ({ background: cor, color: "#FFF", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 800, fontSize: "0.88rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 });
  const campo: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #CBD5E1", borderRadius: 10, fontSize: "0.92rem", boxSizing: "border-box" };

  if (status.conectado) {
    return (
      <div style={{ ...caixa, borderColor: "#99F6E4", background: "#F0FDFA" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#0F766E", fontSize: "1rem" }}>
              <CheckCircle2 size={18} /> FireCheck conectado
            </div>
            <div style={{ fontSize: "0.86rem", color: "#334155", marginTop: 6, lineHeight: 1.5 }}>
              Os descartes do FireCheck <strong>{status.storeName}</strong> ({status.email}) contam como perda em <strong>{status.loja}</strong>
              {status.conectadoEm ? ` desde ${data(status.conectadoEm)}` : ""}. {status.descartes30d ? `${status.descartes30d} descarte(s) nos últimos 30 dias.` : "Nenhum descarte recebido ainda."}
            </div>
          </div>
          {status.podeConectar && !confirmarSaida && (
            <button onClick={() => setConfirmarSaida(true)} style={{ ...botao("#FFF"), color: "#B91C1C", border: "1px solid #FECACA" }}>
              <Unlink size={16} /> Desconectar
            </button>
          )}
        </div>
        {confirmarSaida && (
          <div style={{ marginTop: 12, padding: 12, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, fontSize: "0.86rem", color: "#7F1D1D", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 240px" }}>Os próximos descartes do FireCheck deixam de contar como perda nesta loja. Os já recebidos continuam.</span>
            <button disabled={enviando} onClick={desconectar} style={botao("#B91C1C")}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Desconectar</button>
            <button onClick={() => setConfirmarSaida(false)} style={{ ...botao("#FFF"), color: "#334155", border: "1px solid #CBD5E1" }}>Voltar</button>
          </div>
        )}
        {!!status.ultimos?.length && (
          <div style={{ marginTop: 12, fontSize: "0.82rem", color: "#475569" }}>
            {status.ultimos.map((d, i) => (
              <div key={i} style={{ padding: "4px 0", borderTop: i ? "1px solid #CCFBF1" : "none" }}>
                {dataHora(d.registradoEm)} · {d.quantidade != null ? `${d.quantidade} ${d.unidade || ""} ` : ""}{d.casouCom || d.item}
                {d.funcionario ? ` · ${d.funcionario}` : ""}
                {d.situacao === "SEM_CORRESPONDENCIA" ? <span style={{ color: "#B45309" }}> · não casou com o cardápio</span> : <span style={{ color: "#0F766E" }}> · baixou do estoque</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={caixa}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#0F172A", fontSize: "1rem" }}>
            <Link2 size={18} color="#FF4D00" /> Já usa o FireCheck? Conecte à loja
          </div>
          <div style={{ fontSize: "0.86rem", color: "#64748B", marginTop: 4, lineHeight: 1.5 }}>
            Cada descarte que a equipe lança no FireCheck entra como perda no estoque e no CMV desta loja.
          </div>
        </div>
        {status.podeConectar && !abrir && (
          <button onClick={() => setAbrir(true)} style={botao("#FF4D00")}><Link2 size={16} /> Conectar FireCheck</button>
        )}
        {!status.podeConectar && <span style={{ fontSize: "0.82rem", color: "#64748B" }}>Só o dono da loja conecta.</span>}
      </div>

      {abrir && (
        <form onSubmit={conectar} style={{ marginTop: 16, display: "grid", gap: 12, maxWidth: 520 }}>
          <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: 12, fontSize: "0.86rem", color: "#7C2D12", lineHeight: 1.5 }}>
            <strong>Antes de conectar:</strong> todo descarte lançado no FireCheck deste login vai contar como <strong>perda na loja {status.loja}</strong>.
            Uma loja do FireHub fica ligada a um FireCheck só. Se você tem duas lojas, conecte em cada uma o FireCheck daquela loja.
          </div>
          <input style={campo} type="email" autoComplete="off" placeholder="E-mail do FireCheck (dono ou gestor)" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input style={campo} type="password" autoComplete="new-password" placeholder="Senha do FireCheck" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.86rem", color: "#334155", cursor: "pointer" }}>
            <input type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Entendi: os descartes desse FireCheck vão contar como perda em {status.loja}.</span>
          </label>
          <div style={{ fontSize: "0.78rem", color: "#94A3B8" }}>A senha vai só para o FireCheck confirmar a conta. O FireHub não guarda.</div>
          {erro && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", borderRadius: 10, padding: "10px 12px", fontSize: "0.86rem" }}>{erro}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="submit" disabled={!entendi || enviando} style={{ ...botao("#FF4D00"), opacity: !entendi || enviando ? 0.5 : 1, cursor: !entendi || enviando ? "not-allowed" : "pointer" }}>
              {enviando ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />} Conectar
            </button>
            <button type="button" onClick={() => { setAbrir(false); setErro(null); }} style={{ ...botao("#FFF"), color: "#334155", border: "1px solid #CBD5E1" }}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
