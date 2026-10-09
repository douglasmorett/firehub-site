"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";

/**
 * "Pedido enviado da loja X para esta loja. Aceitar?" — o lado de LÁ do
 * "Enviar para outra loja" (lib/transferencia-do-pedido.ts), e a resposta que
 * volta para quem enviou.
 *
 *   - Loja de destino: pop-up com o pedido, Aceitar ou Não aceitar (com o
 *     motivo, que a loja que enviou vê). Aceito, o pedido entra aqui no fim
 *     da fila, com o número desta loja, e a comanda sai na impressora daqui.
 *   - Loja que enviou: um cartão no topo com a resposta — aceito (o número
 *     novo lá), recusado (o motivo: o pedido continua aqui e precisa ser
 *     feito) ou "esperando".
 *
 * Montado na tela de pedidos, ao lado do AvisoDeAcrescimo, e consulta
 * /api/store/transferencias sozinho.
 */

const INTERVALO_DA_CONSULTA = 8000;
const INTERVALO_DO_SOM = 6000;

const MOTIVOS_PRONTOS = [
  "Estamos sem condição de produzir agora.",
  "O endereço não é da nossa área de entrega.",
  "Outro motivo",
];

type ParaEstaLoja = {
  id: string;
  numero: string | null;
  deNome: string;
  paraNome: string;
  pedidoPor: string | null;
  cliente: string | null;
  tipo: string | null;
  endereco: string | null;
  pagamento: string | null;
  total: number;
  itens: string;
};

type Enviada = {
  id: string;
  numero: string | null;
  numeroDepois: string | null;
  paraNome: string;
  status: "PENDENTE" | "ACEITA" | "RECUSADA" | "EXPIRADA";
  motivo: string | null;
  respondidoPor: string | null;
};

const reais = (n: unknown) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

/** O painel de pedidos relê a lista quando ouve isto (StoreOrdersDashboard). */
const avisarQueOsPedidosMudaram = () => {
  try { window.dispatchEvent(new Event("firehub:pedidos-mudaram")); } catch { /* sem window */ }
};

export default function AvisoDeTransferencia() {
  const [paraEstaLoja, setParaEstaLoja] = useState<ParaEstaLoja[]>([]);
  const [enviadas, setEnviadas] = useState<Enviada[]>([]);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState(MOTIVOS_PRONTOS[0]);
  const [outro, setOutro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const consultar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/transferencias", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setParaEstaLoja(Array.isArray(j?.paraEstaLoja) ? j.paraEstaLoja : []);
      const novas: Enviada[] = Array.isArray(j?.enviadas) ? j.enviadas : [];
      setEnviadas((antes) => {
        // Saiu de "esperando" para aceito/recusado: a lista daqui mudou.
        if (novas.some((n) => n.status !== "PENDENTE" && antes.some((a) => a.id === n.id && a.status === "PENDENTE"))) avisarQueOsPedidosMudaram();
        return novas;
      });
    } catch {
      /* sem rede: tenta de novo na próxima volta */
    }
  }, []);

  useEffect(() => {
    consultar();
    const t = setInterval(consultar, INTERVALO_DA_CONSULTA);
    const aoVoltar = () => { if (document.visibilityState === "visible") consultar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [consultar]);

  // ── SOM (o mesmo cuidado de autoplay do AvisoDeAcrescimo) ────────────────
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    let ctx: AudioContext;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return;
    }
    ctxRef.current = ctx;
    const destravar = () => { ctx.resume().catch(() => {}); };
    document.addEventListener("click", destravar);
    document.addEventListener("touchstart", destravar);
    document.addEventListener("keydown", destravar);
    return () => {
      document.removeEventListener("click", destravar);
      document.removeEventListener("touchstart", destravar);
      document.removeEventListener("keydown", destravar);
      ctx.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  /** Duas notas, duas vezes: pedido chegando de outra loja. */
  const tocar = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.05;
    for (const volta of [0, 0.7]) {
      [659, 880].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const ganho = ctx.createGain();
        const inicio = t + volta + i * 0.22;
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, inicio);
        ganho.gain.setValueAtTime(0.0001, inicio);
        ganho.gain.exponentialRampToValueAtTime(0.4, inicio + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.2);
        osc.connect(ganho).connect(ctx.destination);
        osc.start(inicio);
        osc.stop(inicio + 0.24);
      });
    }
  }, []);

  const atual = paraEstaLoja[0] || null;
  useEffect(() => {
    if (!atual) return;
    tocar();
    const t = setInterval(tocar, INTERVALO_DO_SOM);
    return () => clearInterval(t);
  }, [atual?.id, tocar]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setRecusando(false);
    setMotivo(MOTIVOS_PRONTOS[0]);
    setOutro("");
    setErro(null);
  }, [atual?.id]);

  useEffect(() => {
    if (!feito) return;
    const t = setTimeout(() => setFeito(null), 5000);
    return () => clearTimeout(t);
  }, [feito]);

  const textoDaRecusa = motivo === "Outro motivo" ? outro.trim() : motivo;

  async function responder(acao: "aceitar" | "recusar") {
    if (!atual || enviando) return;
    if (acao === "recusar" && textoDaRecusa.replace(/[^\p{L}]/gu, "").length < 3) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/store/transferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, id: atual.id, motivo: acao === "recusar" ? textoDaRecusa : null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(j?.error || "Não consegui registrar a resposta. Tente de novo.");
        if (r.status === 409 || r.status === 404) setParaEstaLoja((l) => l.filter((a) => a.id !== atual.id));
      } else {
        setFeito(
          acao === "aceitar"
            ? `Pedido aceito: agora é o nº ${j?.numero ?? "—"} desta loja. A comanda vai sair na impressora daqui.`
            : `Pedido recusado. A loja ${atual.deNome} vai ver o motivo.`
        );
        setParaEstaLoja((l) => l.filter((a) => a.id !== atual.id));
        avisarQueOsPedidosMudaram();
      }
    } catch {
      setErro("Sem conexão. Tente de novo.");
    }
    setEnviando(false);
  }

  async function entendi(id: string) {
    setEnviadas((l) => l.filter((e) => e.id !== id));
    fetch("/api/store/transferencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "visto", id }),
    }).catch(() => {});
  }

  // ── A RESPOSTA PARA QUEM ENVIOU (cartões no topo, sem travar a tela) ─────
  const respostas = enviadas.filter((e) => e.status !== "PENDENTE");
  const esperando = enviadas.filter((e) => e.status === "PENDENTE");
  const cartoes = (respostas.length > 0 || esperando.length > 0 || feito) && (
    <div style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 999, display: "grid", gap: 8, width: "min(480px, calc(100vw - 32px))" }}>
      {feito && (
        <div role="status" style={{ background: PALETA.ok, color: "#fff", padding: "10px 14px", borderRadius: 10, fontWeight: 700, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>✅ {feito}</div>
      )}
      {respostas.map((e) => {
        const aceita = e.status === "ACEITA";
        return (
          <div key={e.id} role="alert" style={{ background: "#fff", border: `2px solid ${aceita ? PALETA.ok : PALETA.grave}`, borderRadius: 12, padding: "10px 14px", boxShadow: "0 10px 30px rgba(0,0,0,0.18)", display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800, color: aceita ? PALETA.ok : PALETA.grave, fontSize: "0.95rem" }}>
              {aceita
                ? `✅ ${e.paraNome} aceitou o pedido nº ${e.numero ?? "—"}`
                : e.status === "EXPIRADA"
                  ? `⚠️ O pedido nº ${e.numero ?? "—"} não foi para ${e.paraNome}`
                  : `❌ ${e.paraNome} não aceitou o pedido nº ${e.numero ?? "—"}`}
            </div>
            <div style={{ fontSize: "0.85rem", color: PALETA.carvao, lineHeight: 1.4 }}>
              {aceita
                ? <>Lá ele é o <b>nº {e.numeroDepois ?? "—"}</b>{e.respondidoPor ? ` (aceito por ${e.respondidoPor})` : ""}. Saiu desta loja.</>
                : <>{e.motivo ? <><b>Motivo:</b> {e.motivo}<br /></> : null}<b>O pedido continua nesta loja</b> e precisa ser feito aqui.</>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => entendi(e.id)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: aceita ? PALETA.ok : PALETA.grave, color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Entendi</button>
            </div>
          </div>
        );
      })}
      {esperando.map((e) => (
        <div key={e.id} style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 10, padding: "6px 12px", fontSize: "0.8rem", fontWeight: 700, boxShadow: "0 6px 18px rgba(0,0,0,0.08)" }}>
          ⏳ Pedido nº {e.numero ?? "—"} enviado para {e.paraNome} — esperando a loja de lá aceitar
        </div>
      ))}
    </div>
  );

  if (!atual) return cartoes || null;

  const linha: React.CSSProperties = { display: "flex", gap: 8, fontSize: "0.92rem", lineHeight: 1.35 };
  const rotulo: React.CSSProperties = { minWidth: 86, color: PALETA.areiaTinta, fontWeight: 700, fontSize: "0.8rem" };
  const quantosMais = paraEstaLoja.length - 1;
  const recusaValida = textoDaRecusa.replace(/[^\p{L}]/gu, "").length >= 3;

  return (
    <>
      {cartoes}
      <div style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div role="alertdialog" aria-label="Pedido enviado por outra loja" style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.3)", fontFamily: "inherit" }}>
          <div style={{ padding: "14px 18px", background: "#F5F3FF", borderBottom: "1px solid #DDD6FE", borderRadius: "14px 14px 0 0" }}>
            <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#4C1D95" }}>🏪 Pedido enviado da loja {atual.deNome} para esta loja</div>
            <div style={{ fontSize: "0.84rem", color: "#5B21B6", marginTop: 2 }}>
              Aceitar pedido? Se aceitar, ele entra aqui no fim da fila, com o número desta loja, e a comanda sai na impressora daqui.
            </div>
          </div>

          <div style={{ padding: "14px 18px", display: "grid", gap: 7 }}>
            <div style={linha}><span style={rotulo}>Lá era o</span><span><b>nº {atual.numero ?? "—"}</b>{atual.pedidoPor ? ` · enviado por ${atual.pedidoPor}` : ""}</span></div>
            <div style={linha}><span style={rotulo}>Cliente</span><span><b>{atual.cliente || "—"}</b></span></div>
            <div style={linha}><span style={rotulo}>{String(atual.tipo || "").toUpperCase() === "DELIVERY" ? "Entrega" : "Tipo"}</span><span>{String(atual.tipo || "").toUpperCase() === "DELIVERY" ? atual.endereco || "—" : "Retirada / balcão"}</span></div>
            <div style={{ ...linha, alignItems: "flex-start" }}><span style={rotulo}>Itens</span><span>{atual.itens || "—"}</span></div>
            <div style={linha}><span style={rotulo}>Total</span><span><b>{reais(atual.total)}</b>{atual.pagamento ? ` · ${atual.pagamento}` : ""}</span></div>

            {recusando && (
              <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: "0.85rem", color: PALETA.grave }}>Por que não aceitar? A loja {atual.deNome} vê o motivo.</div>
                {MOTIVOS_PRONTOS.map((m) => (
                  <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
                    <input type="radio" name="motivo-da-transferencia" checked={motivo === m} onChange={() => setMotivo(m)} />
                    {m}
                  </label>
                ))}
                {motivo === "Outro motivo" && (
                  <textarea
                    value={outro}
                    onChange={(e) => setOutro(e.target.value)}
                    placeholder="Escreva o motivo"
                    rows={2}
                    maxLength={300}
                    autoFocus
                    style={{ padding: "7px 9px", borderRadius: 8, border: `1px solid ${PALETA.areiaBorda}`, fontFamily: "inherit", resize: "vertical" }}
                  />
                )}
              </div>
            )}
            {erro && <div style={{ color: PALETA.grave, fontSize: "0.85rem" }}>{erro}</div>}
          </div>

          <div style={{ padding: "12px 18px", borderTop: `1px solid ${PALETA.areiaBorda}`, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            {quantosMais > 0 && <span style={{ marginRight: "auto", fontSize: "0.78rem", color: PALETA.areiaTinta }}>+{quantosMais} esperando</span>}
            {!recusando ? (
              <>
                <button onClick={() => setRecusando(true)} disabled={enviando} style={{ padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${PALETA.grave}`, background: "#fff", color: PALETA.grave, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Não aceitar</button>
                <button onClick={() => responder("aceitar")} disabled={enviando} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: PALETA.ok, color: "#fff", fontWeight: 800, cursor: enviando ? "wait" : "pointer", fontFamily: "inherit" }}>
                  {enviando ? "Trazendo…" : "Aceitar pedido"}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setRecusando(false)} disabled={enviando} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${PALETA.areiaBorda}`, background: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Voltar</button>
                <button onClick={() => responder("recusar")} disabled={enviando || !recusaValida} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: recusaValida ? PALETA.grave : "#CBD5E1", color: "#fff", fontWeight: 800, cursor: enviando ? "wait" : "pointer", fontFamily: "inherit" }}>
                  {enviando ? "Enviando…" : "Não aceitar"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
