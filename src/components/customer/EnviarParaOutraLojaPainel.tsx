"use client";
import { useEffect, useState } from "react";
import { PALAVRA_DE_CONFIRMACAO, confirmacaoValida } from "@/lib/transferencia-do-pedido";

/**
 * "🏪 Enviar para outra loja" — na aba ✏️ Editar do pedido, para quem tem mais
 * de uma loja no mesmo acesso (lib/transferencia-do-pedido.ts).
 *
 * Escolhe a loja, escreve "transferir" e o pedido vai para a OUTRA loja
 * aceitar. Até ela responder, o pedido continua aqui; aceito, sai daqui e
 * entra lá no fim da fila, com o número de lá.
 */

type Leitura = {
  lojas: { id: string; storeName: string | null }[];
  lojaDoPedido: string | null;
  impede: string | null;
  pendente: { id: string; paraNome: string } | null;
};

export default function EnviarParaOutraLojaPainel({
  pedido,
  aoMudar,
}: {
  pedido: any;
  /** Enviou ou desfez: quem abriu avisa e relê a lista. */
  aoMudar: (r: { enviado?: string; desfeito?: boolean }) => void;
}) {
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ler = async () => {
    try {
      const r = await fetch(`/api/store/transferencias?pedido=${encodeURIComponent(pedido.id)}`, { cache: "no-store" });
      if (r.ok) setLeitura(await r.json());
    } catch { /* sem rede: o painel não aparece */ }
  };
  useEffect(() => { ler(); }, [pedido.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!leitura || leitura.lojas.length < 2) return null;

  const nomeDe = (id: string | null) => leitura.lojas.find((l) => l.id === id)?.storeName || "esta loja";
  const outras = leitura.lojas.filter((l) => l.id !== leitura.lojaDoPedido);
  const pronto = !!para && confirmacaoValida(confirmacao) && !salvando;

  async function enviar() {
    if (!pronto) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch("/api/store/transferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "enviar", pedidoId: pedido.id, paraLojaId: para, confirmacao }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j?.error || "Não consegui enviar. Tente de novo."); return; }
      setAberto(false);
      setConfirmacao("");
      await ler();
      aoMudar({ enviado: j?.paraNome || nomeDe(para) });
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  async function desfazer() {
    if (!leitura?.pendente || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch("/api/store/transferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "desfazer", id: leitura.pendente.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j?.error || "Não consegui desfazer.");
      await ler();
      if (r.ok) aoMudar({ desfeito: true });
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  if (leitura.pendente) {
    return (
      <div style={{ ...caixa, background: "#FFFBEB", border: "1.5px solid #FDE68A" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.8rem", color: "#92400E" }}>
            ⏳ <b>Enviado para {leitura.pendente.paraNome}</b> — esperando a loja de lá aceitar. Até lá o pedido continua aqui.
          </span>
          <button type="button" onClick={desfazer} disabled={salvando} style={botaoLeve}>{salvando ? "Desfazendo…" : "Desfazer"}</button>
        </div>
        {erro && <div style={avisoVermelho}>{erro}</div>}
      </div>
    );
  }

  if (!aberto) {
    return (
      <div style={{ ...caixa, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "#334155" }}>🏪 <b>Loja:</b> {nomeDe(leitura.lojaDoPedido)}</span>
        <button
          type="button"
          onClick={() => { setAberto(true); setPara(outras.length === 1 ? outras[0].id : ""); setConfirmacao(""); setErro(null); }}
          disabled={!!leitura.impede}
          title={leitura.impede || undefined}
          style={{ ...botaoLeve, ...(leitura.impede ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
        >
          Enviar para outra loja
        </button>
        {leitura.impede && <div style={{ width: "100%", fontSize: "0.72rem", color: "#92400E" }}>{leitura.impede}</div>}
      </div>
    );
  }

  return (
    <div style={caixaAberta}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "#5B21B6" }}>🏪 Enviar para outra loja</span>
        <button type="button" onClick={() => setAberto(false)} style={botaoLeve}>Cancelar</button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {outras.map((l) => (
          <button key={l.id} type="button" onClick={() => setPara(l.id)} style={opcao(para === l.id)}>
            {l.storeName || "Loja"}
          </button>
        ))}
      </div>

      <div style={{ fontSize: "0.76rem", color: "#475569", lineHeight: 1.45, margin: "10px 0 6px" }}>
        A outra loja recebe um aviso para <b>aceitar ou não</b>. Se aceitar, o pedido sai desta loja e entra lá no fim da fila,
        com o número de lá, e a comanda sai na impressora de lá. Se não aceitar, ele continua aqui e você vê o motivo.
      </div>

      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
        Para confirmar, escreva <span style={{ color: "#5B21B6", fontWeight: 900 }}>{PALAVRA_DE_CONFIRMACAO}</span>:
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") enviar(); }}
          placeholder={PALAVRA_DE_CONFIRMACAO}
          autoComplete="off"
          spellCheck={false}
          style={{ flex: "1 1 140px", padding: "7px 10px", borderRadius: 8, border: `2px solid ${confirmacaoValida(confirmacao) ? "#5B21B6" : "#CBD5E1"}`, fontSize: "0.88rem", fontFamily: "inherit", outline: "none" }}
        />
        <button
          type="button"
          onClick={enviar}
          disabled={!pronto}
          style={{
            padding: "8px 14px", borderRadius: 8, border: "none", fontWeight: 800, fontSize: "0.8rem", fontFamily: "inherit",
            background: pronto ? "#5B21B6" : "#CBD5E1", color: "#FFF", cursor: pronto ? "pointer" : "not-allowed",
          }}
        >
          {salvando ? "Enviando…" : para ? `Enviar para ${nomeDe(para)}` : "Escolha a loja"}
        </button>
      </div>
      {erro && <div style={{ ...avisoVermelho, marginTop: 8 }}>{erro}</div>}
    </div>
  );
}

const caixa: React.CSSProperties = {
  marginBottom: 12, background: "#F8FAFC", padding: "8px 12px", borderRadius: 10, border: "1px solid #E2E8F0",
};
const caixaAberta: React.CSSProperties = { ...caixa, background: "#F5F3FF", border: "1.5px solid #DDD6FE" };
const avisoVermelho: React.CSSProperties = {
  fontSize: "0.76rem", color: "#991B1B", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "6px 8px", marginTop: 6,
};
const botaoLeve: React.CSSProperties = {
  padding: "4px 10px", borderRadius: 6, fontSize: "0.75rem", fontWeight: 700, border: "1.5px solid #E2E8F0",
  background: "#FFF", color: "#334155", cursor: "pointer", fontFamily: "inherit",
};
const opcao = (ativa: boolean): React.CSSProperties => ({
  padding: "8px 14px", borderRadius: 8, fontSize: "0.82rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
  border: `1.5px solid ${ativa ? "#5B21B6" : "#DDD6FE"}`, background: ativa ? "#EDE9FE" : "#FFF", color: ativa ? "#4C1D95" : "#334155",
});
