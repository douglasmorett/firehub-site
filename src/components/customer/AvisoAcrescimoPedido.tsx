"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * O aviso "o cliente quer acrescentar itens — ainda dá tempo?".
 *
 * O cliente pede pelo robô do WhatsApp para incluir itens num pedido que ainda
 * está na cozinha (Gabi, #48, Hakim Centro, 12/09/2026). Quem sabe se dá tempo
 * é a loja: este aviso aparece em qualquer tela do painel, com som, até alguém
 * responder. No "não", a loja escreve o motivo, que vai para o cliente.
 *
 * Montado em app/store/layout.tsx, ao lado do chat de atendimento (que fica no
 * canto direito — por isso o aviso minimizado fica no esquerdo). A regra e os
 * efeitos da resposta moram em lib/acrescimo-servidor.ts.
 */

type Item = { name: string; quantity: number; price: number };
type Pendente = {
  id: string;
  orderId: string;
  numero: number | null;
  cliente: string;
  statusDoPedido: string;
  totalDoPedido: number;
  itens: Item[];
  subtotal: number;
  cobrarNaEntrega: boolean;
  criadoEm: string;
};

const reais = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",");

const MOTIVOS_RAPIDOS = [
  "O pedido já está saindo para entrega",
  "A cozinha já finalizou esse pedido",
  "Esse item está em falta agora",
];

const STATUS_LEGIVEL: Record<string, string> = {
  NOVO: "aguardando aceite",
  ACEITO: "em preparo",
  PREPARANDO: "em preparo",
  EM_PREPARO: "em preparo",
  EM_ANDAMENTO: "em preparo",
  PRONTO: "pronto, ainda na loja",
};

/** Dois toques curtos, no mesmo espírito do som de pedido novo do painel. */
function tocarAviso() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.28].forEach((atraso, i) => {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(i === 0 ? 880 : 1175, ctx.currentTime + atraso);
      ganho.gain.setValueAtTime(0.0001, ctx.currentTime + atraso);
      ganho.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + atraso + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + atraso + 0.25);
      osc.connect(ganho);
      ganho.connect(ctx.destination);
      osc.start(ctx.currentTime + atraso);
      osc.stop(ctx.currentTime + atraso + 0.26);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    // Sem áudio (navegador bloqueou antes do primeiro clique): o aviso na tela basta.
  }
}

export default function AvisoAcrescimoPedido() {
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [minimizado, setMinimizado] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [recado, setRecado] = useState("");
  const vistos = useRef<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/acrescimos", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      const lista: Pendente[] = Array.isArray(d?.pendentes) ? d.pendentes : [];
      // Chegou pedido de acréscimo novo: som, e o aviso volta a abrir mesmo que
      // alguém tenha minimizado o anterior.
      const novos = lista.filter((p) => !vistos.current.has(p.id));
      if (novos.length > 0) {
        novos.forEach((p) => vistos.current.add(p.id));
        setMinimizado(false);
        tocarAviso();
      }
      setPendentes(lista);
    } catch {
      // Silêncio de propósito: o aviso é um extra e não pode atrapalhar o painel.
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [carregar]);

  // Enquanto houver pergunta sem resposta e o aviso estiver aberto, lembra a
  // cada 30 s: cozinha barulhenta não ouve o primeiro toque.
  useEffect(() => {
    if (pendentes.length === 0 || minimizado) return;
    const t = setInterval(tocarAviso, 30_000);
    return () => clearInterval(t);
  }, [pendentes.length, minimizado]);

  useEffect(() => {
    if (!recado) return;
    const t = setTimeout(() => setRecado(""), 6000);
    return () => clearTimeout(t);
  }, [recado]);

  const atual = pendentes[0];

  // Trocou o pedido da vez (respondido, expirado): volta ao começo da pergunta.
  useEffect(() => {
    setRecusando(false);
    setMotivo("");
    setErro("");
  }, [atual?.id]);

  const responder = async (decisao: "ACEITAR" | "RECUSAR") => {
    if (!atual || enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/store/acrescimos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: atual.id, decisao, motivo: decisao === "RECUSAR" ? motivo : undefined }),
      });
      const d = await r.json().catch(() => ({}));
      const pedido = atual.numero ? `#${atual.numero}` : "";
      if (r.ok && d?.ok) {
        setRecado(
          decisao === "ACEITAR"
            ? `✅ Itens incluídos no pedido ${pedido}. Novo total: R$ ${reais(d.novoTotal)}.${d.clienteAvisado ? " O cliente foi avisado." : " Não consegui avisar o cliente no WhatsApp."}`
            : `Resposta enviada. ${d.clienteAvisado ? "O cliente foi avisado." : "Não consegui avisar o cliente no WhatsApp."}`
        );
        setPendentes((lista) => lista.filter((p) => p.id !== atual.id));
      } else if (d?.codigo === "JA_RESPONDIDO" || d?.codigo === "PEDIDO_SAIU" || d?.codigo === "NAO_ENCONTRADO") {
        // Outra tela respondeu, ou o pedido saiu no meio: a lista manda.
        setRecado(d?.erro || "Este acréscimo já foi resolvido.");
        setPendentes((lista) => lista.filter((p) => p.id !== atual.id));
      } else {
        setErro(d?.erro || "Não consegui registrar a resposta. Tente de novo.");
      }
    } catch {
      setErro("Sem conexão — a resposta NÃO foi registrada. Tente de novo.");
    } finally {
      setEnviando(false);
      carregar();
    }
  };

  const recadoFlutuante = recado ? (
    <div
      role="status"
      style={{
        position: "fixed", left: 16, right: 16, bottom: 90, margin: "0 auto", maxWidth: 440, zIndex: 10001,
        background: "#0F172A", color: "#fff", borderRadius: 12, padding: "12px 16px",
        fontSize: "0.9rem", fontWeight: 600, boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
      }}
    >
      {recado}
    </div>
  ) : null;

  if (!atual) return recadoFlutuante;

  if (minimizado) {
    return (
      <>
        {recadoFlutuante}
        <button
          type="button"
          onClick={() => setMinimizado(false)}
          style={{
            position: "fixed", left: 24, bottom: 24, zIndex: 9999,
            background: "#F59E0B", color: "#1F2937", border: "none", borderRadius: 999,
            padding: "12px 18px", fontWeight: 800, fontSize: "0.95rem", cursor: "pointer",
            boxShadow: "0 8px 24px rgba(245,158,11,0.45)",
          }}
          aria-label="Abrir pedidos de acréscimo"
        >
          🔔 {pendentes.length === 1 ? "1 acréscimo aguardando" : `${pendentes.length} acréscimos aguardando`}
        </button>
      </>
    );
  }

  const pedido = atual.numero ? `#${atual.numero}` : "";
  const novoTotal = (Number(atual.totalDoPedido) || 0) + (Number(atual.subtotal) || 0);

  return (
    <>
      {recadoFlutuante}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="aviso-acrescimo-titulo"
          style={{
            width: "100%", maxWidth: 440, background: "#fff", borderRadius: 18, overflow: "hidden",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35)", fontFamily: "inherit",
          }}
        >
          <div style={{ background: "#F59E0B", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <strong id="aviso-acrescimo-titulo" style={{ fontSize: "1.05rem", color: "#1F2937" }}>
              🔔 Cliente quer acrescentar itens
            </strong>
            {pendentes.length > 1 && (
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#1F2937" }}>1 de {pendentes.length}</span>
            )}
          </div>

          <div style={{ padding: "16px 18px" }}>
            <p style={{ margin: "0 0 10px", color: "#334155", fontSize: "0.95rem", lineHeight: 1.45 }}>
              <strong>{atual.cliente}</strong> pediu pelo WhatsApp para incluir no pedido{" "}
              <strong style={{ color: "#B45309" }}>{pedido}</strong>, que está{" "}
              <strong>{STATUS_LEGIVEL[atual.statusDoPedido] || "na cozinha"}</strong>:
            </p>

            <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, border: "1px solid #E2E8F0", borderRadius: 12 }}>
              {atual.itens.map((i, idx) => (
                <li
                  key={idx}
                  style={{
                    display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 12px",
                    borderTop: idx === 0 ? "none" : "1px solid #F1F5F9", fontSize: "0.95rem",
                  }}
                >
                  <span style={{ color: "#0F172A", fontWeight: 600 }}>{i.quantity}x {i.name}</span>
                  <span style={{ color: "#475569", whiteSpace: "nowrap" }}>R$ {reais(i.price * i.quantity)}</span>
                </li>
              ))}
            </ul>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", color: "#475569", marginBottom: 4 }}>
              <span>Acréscimo</span>
              <strong style={{ color: "#0F172A" }}>R$ {reais(atual.subtotal)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem", color: "#475569", marginBottom: 12 }}>
              <span>Novo total do pedido</span>
              <strong style={{ color: "#0F172A" }}>R$ {reais(novoTotal)}</strong>
            </div>

            {atual.cobrarNaEntrega && (
              <div style={{ background: "#FEF3C7", color: "#92400E", borderRadius: 10, padding: "8px 10px", fontSize: "0.85rem", marginBottom: 12 }}>
                Este pedido já foi pago online: a diferença de R$ {reais(atual.subtotal)} é cobrada na entrega.
              </div>
            )}

            {!recusando ? (
              <>
                <p style={{ margin: "4px 0 12px", fontWeight: 800, color: "#0F172A", fontSize: "1rem" }}>
                  Ainda dá tempo de incluir?
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    autoFocus
                    disabled={enviando}
                    onClick={() => responder("ACEITAR")}
                    style={{
                      flex: "1 1 160px", background: "#16A34A", color: "#fff", border: "none", borderRadius: 12,
                      padding: "13px 14px", fontWeight: 800, fontSize: "1rem", cursor: enviando ? "wait" : "pointer",
                      opacity: enviando ? 0.7 : 1,
                    }}
                  >
                    {enviando ? "Incluindo…" : "✅ Sim, incluir"}
                  </button>
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => setRecusando(true)}
                    style={{
                      flex: "1 1 120px", background: "#fff", color: "#B91C1C", border: "2px solid #FCA5A5", borderRadius: 12,
                      padding: "11px 14px", fontWeight: 800, fontSize: "1rem", cursor: "pointer",
                    }}
                  >
                    ❌ Não
                  </button>
                </div>
              </>
            ) : (
              <>
                <label htmlFor="motivo-acrescimo" style={{ display: "block", fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
                  Por que não dá? <span style={{ fontWeight: 500, color: "#64748B" }}>(o cliente recebe esta resposta)</span>
                </label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {MOTIVOS_RAPIDOS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMotivo(m)}
                      style={{
                        background: motivo === m ? "#FEE2E2" : "#F8FAFC", color: "#334155",
                        border: `1px solid ${motivo === m ? "#FCA5A5" : "#E2E8F0"}`, borderRadius: 999,
                        padding: "6px 10px", fontSize: "0.8rem", cursor: "pointer",
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <textarea
                  id="motivo-acrescimo"
                  autoFocus
                  value={motivo}
                  maxLength={300}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex.: o pedido já está saindo para entrega"
                  rows={3}
                  style={{
                    width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", borderRadius: 10,
                    padding: "10px 12px", fontSize: "0.95rem", resize: "vertical", fontFamily: "inherit",
                  }}
                />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => responder("RECUSAR")}
                    style={{
                      flex: "1 1 160px", background: "#DC2626", color: "#fff", border: "none", borderRadius: 12,
                      padding: "12px 14px", fontWeight: 800, fontSize: "0.95rem", cursor: enviando ? "wait" : "pointer",
                      opacity: enviando ? 0.7 : 1,
                    }}
                  >
                    {enviando ? "Enviando…" : "Enviar resposta ao cliente"}
                  </button>
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => { setRecusando(false); setMotivo(""); }}
                    style={{
                      flex: "0 1 100px", background: "#fff", color: "#475569", border: "1px solid #CBD5E1", borderRadius: 12,
                      padding: "12px 14px", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer",
                    }}
                  >
                    Voltar
                  </button>
                </div>
              </>
            )}

            {erro && (
              <p role="alert" style={{ color: "#B91C1C", fontWeight: 600, fontSize: "0.9rem", margin: "12px 0 0" }}>
                {erro}
              </p>
            )}

            <button
              type="button"
              onClick={() => setMinimizado(true)}
              style={{
                display: "block", margin: "14px auto 0", background: "none", border: "none",
                color: "#64748B", textDecoration: "underline", fontSize: "0.85rem", cursor: "pointer",
              }}
            >
              Responder depois
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
