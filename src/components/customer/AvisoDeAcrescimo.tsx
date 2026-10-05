"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";

/**
 * "Cliente quer acrescentar no pedido" — o pop-up que abre sozinho quando o
 * robô registra um acréscimo para um pedido que já está na cozinha
 * (lib/acrescimo-do-pedido.ts).
 *
 * Regra do dono (05/10/2026): o acréscimo não entra sozinho. A loja vê o
 * pedido, os itens e o valor, e decide:
 *   - Aceitar → os itens entram no pedido, a cozinha recebe um papel só com o
 *     acréscimo e o cliente recebe o novo total no WhatsApp;
 *   - Recusar → a loja escreve o motivo (ou usa um pronto) e ele vai ao cliente.
 *
 * Montado SÓ na tela de pedidos (o dono não quer no KDS, 05/10/2026). Consulta /api/store/acrescimos sozinho,
 * como o AvisosDoDia: não depende do feed de pedidos de quem o monta.
 */

const INTERVALO_DA_CONSULTA = 8000;
const INTERVALO_DO_SOM = 6000;

const MOTIVOS_PRONTOS = [
  "O pedido já está saindo, não dá mais para incluir.",
  "Esse item acabou por hoje.",
  "Outro motivo",
];

type Acrescimo = {
  id: string;
  numero: string | null;
  cliente: string | null;
  statusDoPedido: string;
  itens: { productName: string; quantity: number; price: number; notes?: string | null }[];
  itensEmTexto: string;
  valor: number;
  totalAtual: number;
  novoTotal: number;
  criadoEm: string;
};

const reais = (n: unknown) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

const STATUS_LEGIVEL: Record<string, string> = {
  NOVO: "Novo (ainda não aceito)",
  ACEITO: "Aceito",
  CONFIRMADO: "Aceito",
  PREPARANDO: "Em preparo",
  EM_PREPARO: "Em preparo",
  EM_ANDAMENTO: "Em preparo",
  PRONTO: "Pronto",
};

export default function AvisoDeAcrescimo() {
  const [lista, setLista] = useState<Acrescimo[]>([]);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState(MOTIVOS_PRONTOS[0]);
  const [outro, setOutro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  // ── CONSULTA ─────────────────────────────────────────────────────────────
  const consultar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/acrescimos", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setLista(Array.isArray(j?.acrescimos) ? j.acrescimos : []);
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

  // ── SOM (o mesmo cuidado de autoplay do AvisosDoDia) ─────────────────────
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

  /** Três notas SUBINDO: é coisa a mais chegando, não cancelamento. */
  const tocar = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.05;
    for (const volta of [0, 0.9]) {
      [523, 659, 784].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const ganho = ctx.createGain();
        const inicio = t + volta + i * 0.2;
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, inicio);
        ganho.gain.setValueAtTime(0.0001, inicio);
        ganho.gain.exponentialRampToValueAtTime(0.4, inicio + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.19);
        osc.connect(ganho).connect(ctx.destination);
        osc.start(inicio);
        osc.stop(inicio + 0.22);
      });
    }
  }, []);

  const atual = lista[0] || null;
  useEffect(() => {
    if (!atual) return;
    tocar();
    const t = setInterval(tocar, INTERVALO_DO_SOM);
    return () => clearInterval(t);
  }, [atual?.id, tocar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Outro acréscimo na frente: o formulário de recusa volta ao começo.
  useEffect(() => {
    setRecusando(false);
    setMotivo(MOTIVOS_PRONTOS[0]);
    setOutro("");
    setErro(null);
  }, [atual?.id]);

  useEffect(() => {
    if (!feito) return;
    const t = setTimeout(() => setFeito(null), 4000);
    return () => clearTimeout(t);
  }, [feito]);

  const textoDaRecusa = motivo === "Outro motivo" ? outro.trim() : motivo;

  async function responder(acao: "aceitar" | "recusar") {
    if (!atual || enviando) return;
    if (acao === "recusar" && !textoDaRecusa) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/store/acrescimos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: atual.id, acao, texto: acao === "recusar" ? textoDaRecusa : null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(j?.error || "Não consegui registrar a resposta. Tente de novo.");
        // Respondido em outro computador, ou o pedido já saiu: some daqui.
        if (r.status === 409 || r.status === 404) setLista((l) => l.filter((a) => a.id !== atual.id));
      } else {
        const aviso = j?.avisouCliente === false ? " O WhatsApp não confirmou o envio: avise o cliente." : " O cliente foi avisado no WhatsApp.";
        setFeito(acao === "aceitar" ? `Acréscimo do pedido nº ${atual.numero ?? "—"} incluído.${aviso}` : `Acréscimo recusado.${aviso}`);
        setLista((l) => l.filter((a) => a.id !== atual.id));
      }
    } catch {
      setErro("Sem conexão. Tente de novo.");
    }
    setEnviando(false);
  }

  if (!atual) {
    return feito ? (
      <div role="status" style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 1001, background: PALETA.ok, color: "#fff", padding: "10px 16px", borderRadius: 10, fontWeight: 700, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", maxWidth: "calc(100vw - 32px)" }}>
        ✅ {feito}
      </div>
    ) : null;
  }

  const linha: React.CSSProperties = { display: "flex", gap: 8, fontSize: "0.92rem", lineHeight: 1.35 };
  const rotulo: React.CSSProperties = { minWidth: 86, color: PALETA.areiaTinta, fontWeight: 700, fontSize: "0.8rem" };
  const quantosMais = lista.length - 1;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="alertdialog" aria-label="Cliente quer acrescentar no pedido" style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.3)", fontFamily: "inherit" }}>
        <div style={{ padding: "14px 18px", background: PALETA.atencaoClaro, borderBottom: `1px solid ${PALETA.atencaoBorda}`, borderRadius: "14px 14px 0 0" }}>
          <div style={{ fontWeight: 800, fontSize: "1.15rem", color: PALETA.carvao }}>➕ Pedido nº {atual.numero ?? "—"}: cliente quer acrescentar</div>
          <div style={{ fontSize: "0.84rem", color: PALETA.atencao, marginTop: 2 }}>
            O cliente pediu pelo WhatsApp. <b>Nada entra no pedido até você aceitar</b>, e a resposta vai para ele.
          </div>
        </div>

        <div style={{ padding: "14px 18px", display: "grid", gap: 7 }}>
          <div style={linha}><span style={rotulo}>Cliente</span><span><b>{atual.cliente || "—"}</b></span></div>
          <div style={linha}><span style={rotulo}>Pedido agora</span><span>{STATUS_LEGIVEL[String(atual.statusDoPedido).toUpperCase()] || atual.statusDoPedido}</span></div>
          <div style={{ ...linha, alignItems: "flex-start" }}>
            <span style={rotulo}>Acrescentar</span>
            <span style={{ display: "grid", gap: 2 }}>
              {atual.itens.map((i, k) => (
                <span key={k}>
                  <b>{i.quantity}x {i.productName}</b> — {reais((Number(i.price) || 0) * (Number(i.quantity) || 1))}
                  {i.notes ? <span style={{ color: PALETA.areiaTinta }}> · {i.notes}</span> : null}
                </span>
              ))}
            </span>
          </div>
          <div style={linha}><span style={rotulo}>Valor</span><span>+{reais(atual.valor)} → novo total <b>{reais(atual.novoTotal)}</b></span></div>

          {recusando && (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: PALETA.grave }}>O que dizer ao cliente? Vai no WhatsApp.</div>
              {MOTIVOS_PRONTOS.map((m) => (
                <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
                  <input type="radio" name="motivo-do-acrescimo" checked={motivo === m} onChange={() => setMotivo(m)} />
                  {m}
                </label>
              ))}
              {motivo === "Outro motivo" && (
                <textarea
                  value={outro}
                  onChange={(e) => setOutro(e.target.value)}
                  placeholder="Escreva a mensagem para o cliente"
                  rows={3}
                  maxLength={500}
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
              <button onClick={() => setRecusando(true)} disabled={enviando} style={{ padding: "10px 14px", borderRadius: 8, border: `1.5px solid ${PALETA.grave}`, background: "#fff", color: PALETA.grave, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Recusar</button>
              <button onClick={() => responder("aceitar")} disabled={enviando} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: PALETA.ok, color: "#fff", fontWeight: 800, cursor: enviando ? "wait" : "pointer", fontFamily: "inherit" }}>
                {enviando ? "Incluindo…" : "Aceitar e incluir"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setRecusando(false)} disabled={enviando} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${PALETA.areiaBorda}`, background: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Voltar</button>
              <button onClick={() => responder("recusar")} disabled={enviando || !textoDaRecusa} style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: PALETA.grave, color: "#fff", fontWeight: 800, cursor: enviando ? "wait" : "pointer", fontFamily: "inherit" }}>
                {enviando ? "Enviando…" : "Recusar e avisar o cliente"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
