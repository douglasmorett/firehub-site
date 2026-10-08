"use client";
/**
 * O aviso que TOCA: pedido cancelado por quem não é a loja, cancelamento
 * PARCIAL feito pelo app (iFood/99 tirou parte do pedido — o pedido continua,
 * lib/cancelamento-parcial.ts) e disputa aberta.
 *
 * SÓ NA TELA DE PEDIDOS (montado em app/store/pedidos-clientes/page.tsx). Já
 * morou no layout da loja, para aparecer em qualquer tela, e abria no meio do
 * KDS da cozinha — "iFood espera sua resposta" numa tela onde ninguém responde
 * nada. O dono decidiu (25/09/2026): aqui e em mais lugar nenhum.
 *
 * A disputa não tem janela própria: a tela de pedidos já tem o modal de
 * resposta dela (StoreOrdersDashboard). Daqui ela só ganha o som.
 *
 * A regra do que vira aviso mora no servidor (lib/avisos-do-dia.ts): só do
 * dia, só os de fora, e o "Ciente" vale para todas as telas de pedidos abertas.
 *
 * ── Três sons, três coisas ──────────────────────────────────────────────────
 *
 * Pedido novo SOBE (880 → 1100 Hz, StoreOrdersDashboard). Cancelamento DESCE,
 * em três notas — é o som de "desfaz". Disputa ALTERNA duas notas, como
 * sirene: pede resposta com prazo. A loja aprende o som antes de olhar a tela,
 * e por isso eles não podem se parecer.
 *
 * Repetem a cada 6 segundos até alguém resolver, igual ao pedido novo, que
 * toca até ser aceito. Aviso que toca uma vez só se perde no barulho da
 * cozinha.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";
import type { AvisoDeCancelamento, AvisoDeCancelamentoParcial, AvisoDeDisputa } from "@/lib/avisos-do-dia";

const INTERVALO_DA_CONSULTA = 8000;
const INTERVALO_DO_SOM = 6000;

const reais = (v: number) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

/** "Nº no iFood: 4035" — é por este número que se acha o pedido no portal. */
function numeroNoParceiro(a: { canal: string; referencia: string | null }) {
  return a.referencia ? `Nº no ${a.canal}: ${a.referencia}` : null;
}

function porQuem(quem: string | null) {
  if (!quem) return "";
  return quem === "cliente" ? " pelo cliente" : ` pelo ${quem}`;
}

export default function AvisosDoDia() {
  const [cancelamentos, setCancelamentos] = useState<AvisoDeCancelamento[]>([]);
  const [disputas, setDisputas] = useState<AvisoDeDisputa[]>([]);
  // Cancelamento PARCIAL feito pelo app (lib/cancelamento-parcial.ts): o pedido
  // continua, só parte saiu. Um aviso por corte, com "Ciente".
  const [parciais, setParciais] = useState<AvisoDeCancelamentoParcial[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [somBloqueado, setSomBloqueado] = useState(false);
  // "Ciente" dado AQUI e que o servidor ainda não devolveu sem ele: sem isto a
  // janela piscava de volta na consulta que já estava no ar quando o clique
  // aconteceu. O corte entra como "<pedido>:<registro>".
  const cienteLocalRef = useRef<Set<string>>(new Set());

  // ── CONSULTA ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const consultar = async () => {
      clearTimeout(timer);
      try {
        const r = await fetch("/api/store/avisos", { cache: "no-store" });
        if (r.ok && vivo) {
          const j = await r.json();
          setCancelamentos(((j.cancelamentos || []) as AvisoDeCancelamento[]).filter((c) => !cienteLocalRef.current.has(c.id)));
          setDisputas((j.disputas || []) as AvisoDeDisputa[]);
          setParciais(((j.parciais || []) as AvisoDeCancelamentoParcial[]).filter((p) => !cienteLocalRef.current.has(`${p.id}:${p.registroId}`)));
        }
      } catch {
        // Sem rede: tenta de novo na próxima volta. O aviso não some por isso.
      }
      if (vivo) timer = setTimeout(consultar, INTERVALO_DA_CONSULTA);
    };
    consultar();
    const aoVoltar = () => { if (document.visibilityState === "visible") consultar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  // ── SOM ──────────────────────────────────────────────────────────────────
  //
  // Contexto de áudio próprio, destravado no primeiro gesto (a política de
  // autoplay do navegador). O mesmo cuidado do painel de pedidos: sem gesto,
  // resume() fica pendente para sempre — então não espera, só não toca.
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    let ctx: AudioContext;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return; // navegador sem Web Audio: a janela aparece do mesmo jeito
    }
    ctxRef.current = ctx;
    const conferir = () => setSomBloqueado(ctx.state !== "running");
    conferir();
    ctx.addEventListener("statechange", conferir);
    const destravar = () => { ctx.resume().then(conferir).catch(() => {}); };
    document.addEventListener("click", destravar);
    document.addEventListener("touchstart", destravar);
    document.addEventListener("keydown", destravar);
    return () => {
      ctx.removeEventListener("statechange", conferir);
      document.removeEventListener("click", destravar);
      document.removeEventListener("touchstart", destravar);
      document.removeEventListener("keydown", destravar);
      ctx.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  const nota = useCallback((freq: number, inicio: number, dur: number, tipo: OscillatorType, volume: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, inicio);
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.exponentialRampToValueAtTime(volume, inicio + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    osc.connect(ganho).connect(ctx.destination);
    osc.start(inicio);
    osc.stop(inicio + dur + 0.03);
  }, []);

  /** Três notas DESCENDO, duas vezes: o "desfaz" do cancelamento. */
  const somDeCancelamento = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.05;
    for (const volta of [0, 0.95]) {
      [784, 622, 494].forEach((f, i) => nota(f, t + volta + i * 0.25, 0.24, "triangle", 0.45));
    }
  }, [nota]);

  /** Duas notas ALTERNANDO, como sirene: a disputa tem prazo. */
  const somDeDisputa = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.05;
    for (let i = 0; i < 6; i++) nota(i % 2 === 0 ? 988 : 740, t + i * 0.2, 0.18, "square", 0.12);
  }, [nota]);

  const temCancelamento = cancelamentos.length > 0;
  const temDisputa = disputas.length > 0;
  // O corte também "desfaz" (parte do pedido): o mesmo som do cancelamento.
  const temParcial = parciais.length > 0;
  useEffect(() => {
    if (!temCancelamento && !temDisputa && !temParcial) return;
    const tocar = () => {
      if (temCancelamento || temParcial) somDeCancelamento();
      if (temDisputa) setTimeout(somDeDisputa, temCancelamento || temParcial ? 2200 : 0);
    };
    tocar();
    const t = setInterval(tocar, INTERVALO_DO_SOM);
    return () => clearInterval(t);
  }, [temCancelamento, temDisputa, temParcial, somDeCancelamento, somDeDisputa]);

  // ── CIENTE ───────────────────────────────────────────────────────────────
  const ciente = async () => {
    const ids = cancelamentos.map((c) => c.id);
    ids.forEach((id) => cienteLocalRef.current.add(id));
    setCancelamentos([]);
    setEnviando(true);
    try {
      await fetch("/api/store/avisos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ciente: ids }),
      });
    } catch {
      // Falhou a gravação: nesta tela o aviso já saiu (o atendente viu); as
      // outras telas continuam avisando até alguém dar ciente nelas.
    } finally {
      setEnviando(false);
    }
  };

  /** "Ciente" dos cortes na tela: grava no registro de cada um. */
  const cienteDoParcial = async () => {
    const porPedido = new Map<string, string[]>();
    for (const p of parciais) {
      cienteLocalRef.current.add(`${p.id}:${p.registroId}`);
      porPedido.set(p.id, [...(porPedido.get(p.id) || []), p.registroId]);
    }
    setParciais([]);
    setEnviando(true);
    try {
      await fetch("/api/store/avisos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cienteParcial: [...porPedido].map(([id, registros]) => ({ id, registros })) }),
      });
    } catch {
      // Igual ao cancelamento: aqui já saiu; as outras telas seguem avisando.
    } finally {
      setEnviando(false);
    }
  };

  const cartao: React.CSSProperties = {
    width: "min(440px, calc(100vw - 32px))", background: "#FFF", borderRadius: 14, overflow: "hidden",
    boxShadow: "0 24px 60px rgba(28,25,23,0.35)", fontFamily: "inherit",
  };
  const fundo: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 10000, background: "rgba(28,25,23,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
  };
  const botaoPrincipal: React.CSSProperties = {
    width: "100%", padding: "14px 16px", borderRadius: 10, border: "none", background: PALETA.marca, color: "#FFF",
    fontSize: "1.05rem", fontWeight: 900, letterSpacing: 0.5, cursor: "pointer", fontFamily: "inherit",
  };
  const avisoDeSom = somBloqueado ? (
    <div style={{ marginTop: 10, fontSize: "0.74rem", color: PALETA.areiaTinta, textAlign: "center" }}>
      🔇 O som está bloqueado neste navegador. Clique em qualquer lugar da tela para liberar.
    </div>
  ) : null;

  if (temCancelamento) {
    const um = cancelamentos.length === 1 ? cancelamentos[0] : null;
    return (
      <div style={fundo} role="alertdialog" aria-modal="true" aria-labelledby="aviso-cancelamento-titulo">
        <div style={cartao}>
          <div id="aviso-cancelamento-titulo" style={{ background: PALETA.grave, color: "#FFF", padding: "14px 18px", fontWeight: 900, fontSize: "1.1rem", letterSpacing: 0.3 }}>
            🔴 {um ? "PEDIDO CANCELADO" : `${cancelamentos.length} PEDIDOS CANCELADOS`}
          </div>
          <div style={{ padding: "16px 18px 18px" }}>
            {um ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, color: PALETA.carvao }}>
                <div style={{ fontSize: "1.35rem", fontWeight: 900 }}>
                  Pedido {um.numero != null ? `#${um.numero}` : ""} · {um.canal}
                </div>
                {numeroNoParceiro(um) && (
                  <div style={{ alignSelf: "flex-start", background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, color: PALETA.grave, borderRadius: 8, padding: "4px 10px", fontWeight: 900, fontSize: "1.05rem" }}>
                    {numeroNoParceiro(um)}
                  </div>
                )}
                {um.cliente && <div style={{ fontSize: "0.95rem" }}>Cliente: <b>{um.cliente}</b></div>}
                <div style={{ fontSize: "0.95rem" }}>Valor: <b>{reais(um.valor)}</b></div>
                <div style={{ fontSize: "0.95rem" }}>Cancelado às <b>{hora(um.canceladoEm)}</b>{porQuem(um.quem)}</div>
                {um.motivo && <div style={{ fontSize: "0.9rem", color: PALETA.carvao2 }}>Motivo: {um.motivo}</div>}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
                {cancelamentos.map((c) => (
                  <div key={c.id} style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 10, padding: "8px 12px", color: PALETA.carvao }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <b>
                        {c.numero != null ? `#${c.numero} ` : ""}{c.canal}
                        {c.referencia ? <span style={{ color: PALETA.grave }}> {c.referencia}</span> : null}
                      </b>
                      <span style={{ fontWeight: 800 }}>{reais(c.valor)} · {hora(c.canceladoEm)}</span>
                    </div>
                    {(c.cliente || c.quem || c.motivo) && (
                      <div style={{ fontSize: "0.8rem", color: PALETA.areiaTinta, marginTop: 2 }}>
                        {[c.cliente, c.quem ? `cancelado${porQuem(c.quem)}` : "", c.motivo].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{ margin: "14px 0 12px", fontSize: "0.85rem", color: PALETA.areiaTinta }}>
              Se já está na cozinha, pare o preparo.
            </div>
            <button type="button" style={botaoPrincipal} onClick={ciente} disabled={enviando} autoFocus>
              {um ? "CIENTE" : `CIENTE DOS ${cancelamentos.length}`}
            </button>
            {avisoDeSom}
          </div>
        </div>
      </div>
    );
  }

  // ── CANCELAMENTO PARCIAL ─────────────────────────────────────────────────
  //
  // "Foi feito um cancelamento parcial no seu iFood" (dono, 08/10/2026). O
  // pedido continua — o que saiu vem riscado, com o total de antes e o de
  // agora, e quem cortou foi o app. Sai depois dos cancelamentos (que param a
  // cozinha) e antes da disputa (que tem o modal próprio na tela de pedidos).
  if (temParcial) {
    const um = parciais.length === 1 ? parciais[0] : null;
    const quemDoTitulo = (um?.quem || parciais[0]?.quem || "aplicativo").toUpperCase();
    const riscados = (p: AvisoDeCancelamentoParcial) =>
      p.itens.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "4px 0" }}>
          {p.itens.map((i, k) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.92rem" }}>
              <span style={{ textDecoration: "line-through", color: PALETA.areiaTinta }}>{i.quantidade}x {i.nome}</span>
              {i.valor != null && <span style={{ fontWeight: 800, color: PALETA.grave, whiteSpace: "nowrap" }}>−{reais(i.valor)}</span>}
            </div>
          ))}
        </div>
      ) : null;
    return (
      <div style={fundo} role="alertdialog" aria-modal="true" aria-labelledby="aviso-parcial-titulo">
        <div style={cartao}>
          <div id="aviso-parcial-titulo" style={{ background: PALETA.atencao, color: "#FFF", padding: "14px 18px", fontWeight: 900, fontSize: "1.05rem", letterSpacing: 0.3 }}>
            ✂️ {um ? `CANCELAMENTO PARCIAL NO SEU ${quemDoTitulo}` : `${parciais.length} CANCELAMENTOS PARCIAIS`}
          </div>
          <div style={{ padding: "16px 18px 18px" }}>
            {um ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, color: PALETA.carvao }}>
                <div style={{ fontSize: "1rem", fontWeight: 800 }}>
                  Foi feito um cancelamento parcial no seu {um.quem}.
                </div>
                <div style={{ fontSize: "1.25rem", fontWeight: 900 }}>
                  Pedido {um.numero != null ? `#${um.numero}` : ""} · {um.canal}
                </div>
                {numeroNoParceiro(um) && (
                  <div style={{ alignSelf: "flex-start", background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, color: PALETA.atencao, borderRadius: 8, padding: "4px 10px", fontWeight: 900, fontSize: "1rem" }}>
                    {numeroNoParceiro(um)}
                  </div>
                )}
                {um.cliente && <div style={{ fontSize: "0.95rem" }}>Cliente: <b>{um.cliente}</b></div>}
                {riscados(um)}
                <div style={{ fontSize: "0.95rem" }}>
                  Total do pedido:{" "}
                  <span style={{ textDecoration: "line-through", color: PALETA.areiaTinta }}>{reais(um.totalAntes)}</span>{" "}
                  <b>{reais(um.totalDepois)}</b>
                </div>
                <div style={{ fontSize: "0.85rem", color: PALETA.carvao2 }}>Feito pelo {um.quem} às <b>{hora(um.quando)}</b> — não pela loja.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "50vh", overflowY: "auto" }}>
                {parciais.map((p) => (
                  <div key={`${p.id}:${p.registroId}`} style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 10, padding: "8px 12px", color: PALETA.carvao }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <b>
                        {p.numero != null ? `#${p.numero} ` : ""}{p.canal}
                        {p.referencia ? <span style={{ color: PALETA.atencao }}> {p.referencia}</span> : null}
                      </b>
                      <span style={{ fontWeight: 800 }}>
                        <span style={{ textDecoration: "line-through", color: PALETA.areiaTinta, fontWeight: 600 }}>{reais(p.totalAntes)}</span> {reais(p.totalDepois)}
                      </span>
                    </div>
                    {riscados(p)}
                    <div style={{ fontSize: "0.8rem", color: PALETA.areiaTinta }}>pelo {p.quem} às {hora(p.quando)}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ margin: "14px 0 12px", fontSize: "0.85rem", color: PALETA.areiaTinta }}>
              O pedido continua — só o que está riscado saiu.
            </div>
            <button type="button" style={botaoPrincipal} onClick={cienteDoParcial} disabled={enviando} autoFocus>
              {um ? "CIENTE" : `CIENTE DOS ${parciais.length}`}
            </button>
            {avisoDeSom}
          </div>
        </div>
      </div>
    );
  }

  // Disputa: a janela é o modal de resposta da própria tela de pedidos. Aqui
  // só a sirene, que o modal não tem.
  return null;
}
