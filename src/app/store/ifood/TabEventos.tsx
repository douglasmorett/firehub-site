"use client";
/**
 * Aba Eventos — os cenários 1 e 2 da homologação do módulo Logistics.
 *
 * Cenário 1 (Polling): o critério pede "requests regulares no endpoint de
 * polling com excludeHeartbeat, acknowledgment 200 imediato de todos os
 * eventos, header x-polling-merchants" — então a tela mostra exatamente isso:
 * a URL completa, o valor do header, uma rodada a cada 30 segundos e o status
 * do ack de cada rodada que trouxe evento.
 *
 * Cenário 2 (Webhook): "endpoint configurado, respondendo 200, disponível,
 * teste de conectividade". A prova viva são os KEEPALIVE que o iFood manda a
 * cada meio minuto — a lista se atualiza sozinha; o botão de teste percorre o
 * caminho público (o mesmo que o iFood usa) e mostra status e latência.
 */
import React, { useEffect, useRef, useState } from "react";
import { RefreshCw, Radio, Webhook, PlugZap, Loader } from "lucide-react";

const VERDE = "#16A34A";
const TINTA = "#0F172A";
const CINZA = "#64748B";
const LINHA = "#E2E8F0";

const agora = () => new Date().toLocaleTimeString("pt-BR");
const horaLocal = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR");
const corDoStatus = (s: number) => (s >= 200 && s < 300 ? VERDE : s >= 400 && s < 500 ? "#D97706" : "#DC2626");

type Rodada = {
  hora: string;
  status: number;
  eventos: { codigo: string; orderId: string | null; id: string | null }[];
  ack: { status: number; enviados: number } | null;
  erro?: string;
};

const cartao: React.CSSProperties = {
  background: "#fff", border: `1.5px solid ${LINHA}`, borderRadius: 14,
  padding: "1.1rem 1.25rem", boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
};
const titulo: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, fontWeight: 700,
  fontSize: "0.98rem", color: TINTA, marginBottom: 4,
};
const legenda: React.CSSProperties = { fontSize: "0.8rem", color: CINZA, lineHeight: 1.5, marginBottom: 12 };
const codigo: React.CSSProperties = {
  fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "0.76rem",
  background: "#F8FAFC", border: `1px solid ${LINHA}`, borderRadius: 8,
  padding: "8px 10px", color: TINTA, wordBreak: "break-all",
};
const selo = (cor: string): React.CSSProperties => ({
  display: "inline-block", minWidth: 34, textAlign: "center", fontWeight: 800,
  fontSize: "0.72rem", color: "#fff", background: cor, borderRadius: 7, padding: "2px 7px",
});

export default function TabEventos() {
  // ── Cenário 1: polling ────────────────────────────────────────────────────
  const [rodadas, setRodadas] = useState<Rodada[]>([]);
  const [pollingInfo, setPollingInfo] = useState<{ endpoint: string; header: string } | null>(null);
  const [automatico, setAutomatico] = useState(true);
  const [rodando, setRodando] = useState(false);
  const rodandoRef = useRef(false);

  async function rodarPolling() {
    if (rodandoRef.current) return;
    rodandoRef.current = true;
    setRodando(true);
    try {
      const r = await fetch("/api/ifood/homologacao/polling?distribuido=1");
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setRodadas((a) => [{ hora: agora(), status: d?.ifood?.status ?? r.status, eventos: [], ack: null, erro: d?.error }, ...a].slice(0, 30));
        return;
      }
      setPollingInfo({ endpoint: d.polling.endpoint, header: d.polling.headers["x-polling-merchants"] || "—" });
      setRodadas((a) => [{
        hora: agora(),
        status: d.polling.status,
        eventos: d.polling.eventos ?? [],
        ack: d.ack ?? null,
      }, ...a].slice(0, 30));
    } finally {
      rodandoRef.current = false;
      setRodando(false);
    }
  }

  useEffect(() => {
    rodarPolling();
    if (!automatico) return;
    const t = setInterval(rodarPolling, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automatico]);

  // ── Cenário 2: webhook ────────────────────────────────────────────────────
  const [webhook, setWebhook] = useState<{ url: string; chamadas: { quando: string; codigo: string; status: number }[] } | null>(null);
  const [teste, setTeste] = useState<null | { ok: boolean; status: number; ms: number }>(null);
  const [testando, setTestando] = useState(false);

  async function carregarWebhook() {
    const r = await fetch("/api/ifood/homologacao/webhook-status");
    if (r.ok) setWebhook(await r.json());
  }

  useEffect(() => {
    carregarWebhook();
    const t = setInterval(carregarWebhook, 15_000);
    return () => clearInterval(t);
  }, []);

  async function testarConectividade() {
    setTestando(true);
    setTeste(null);
    try {
      const r = await fetch("/api/ifood/homologacao/webhook-status", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      setTeste({ ok: Boolean(d?.ok), status: d?.status ?? 0, ms: d?.ms ?? 0 });
      // A chamada de teste entra na lista do webhook — recarrega para aparecer.
      setTimeout(carregarWebhook, 800);
    } finally {
      setTestando(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "start" }}>
      {/* ── Cenário 1 — Polling ── */}
      <div style={cartao}>
        <div style={titulo}><Radio size={17} color="#E8360C" /> Cenário 1 · Polling de eventos</div>
        <p style={legenda}>
          Uma rodada a cada 30 segundos: consulta o endpoint de polling (heartbeats
          excluídos pela própria URL) e confirma <b>todos</b> os eventos recebidos com
          acknowledgment imediato.
        </p>

        <div style={{ ...codigo, marginBottom: 8 }}>{pollingInfo?.endpoint ?? "GET /events/v1.0/events:polling?excludeHeartbeat=true"}</div>
        <div style={{ ...codigo, marginBottom: 12 }}>x-polling-merchants: {pollingInfo?.header ?? "…"}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button
            onClick={rodarPolling}
            disabled={rodando}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
              background: "#E8360C", color: "#fff", border: "none", borderRadius: 9,
              padding: "8px 14px", fontWeight: 700, fontSize: "0.82rem", opacity: rodando ? 0.6 : 1,
            }}
          >
            {rodando ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />} Rodar agora
          </button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: CINZA, cursor: "pointer" }}>
            <input type="checkbox" checked={automatico} onChange={(e) => setAutomatico(e.target.checked)} />
            rodadas automáticas (30s)
          </label>
        </div>

        <div style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {rodadas.length === 0 && <span style={{ fontSize: "0.8rem", color: CINZA }}>Aguardando a primeira rodada…</span>}
          {rodadas.map((r, i) => (
            <div key={i} style={{ border: `1px solid ${LINHA}`, borderRadius: 9, padding: "7px 10px", fontSize: "0.78rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ color: CINZA, fontVariantNumeric: "tabular-nums" }}>{r.hora}</span>
                <span style={selo(corDoStatus(r.status))}>{r.status}</span>
                <span style={{ color: TINTA, fontWeight: 600 }}>
                  {r.erro ? r.erro : r.eventos.length === 0 ? "nenhum evento (heartbeats excluídos)" : `${r.eventos.length} evento(s)`}
                </span>
                {r.ack && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ color: CINZA }}>ack:</span>
                    <span style={selo(corDoStatus(r.ack.status))}>{r.ack.status}</span>
                    <span style={{ color: CINZA }}>({r.ack.enviados} confirmado{r.ack.enviados === 1 ? "" : "s"})</span>
                  </span>
                )}
              </div>
              {r.eventos.length > 0 && (
                <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 3 }}>
                  {r.eventos.map((e, j) => (
                    <div key={j} style={{ ...codigo, padding: "4px 8px" }}>
                      {e.codigo}{e.orderId ? ` · pedido ${e.orderId}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Cenário 2 — Webhook ── */}
      <div style={cartao}>
        <div style={titulo}><Webhook size={17} color="#E8360C" /> Cenário 2 · Webhook</div>
        <p style={legenda}>
          Endpoint público configurado no Portal do Desenvolvedor. A lista abaixo mostra as
          últimas chamadas <b>reais</b> recebidas do iFood e a resposta dada — os KEEPALIVE
          chegam a cada meio minuto e a lista se atualiza sozinha.
        </p>

        <div style={{ ...codigo, marginBottom: 12 }}>{webhook?.url ?? "…"}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            onClick={testarConectividade}
            disabled={testando}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
              background: "#0F766E", color: "#fff", border: "none", borderRadius: 9,
              padding: "8px 14px", fontWeight: 700, fontSize: "0.82rem", opacity: testando ? 0.6 : 1,
            }}
          >
            {testando ? <Loader size={14} className="animate-spin" /> : <PlugZap size={14} />} Testar conectividade
          </button>
          {teste && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem" }}>
              <span style={selo(corDoStatus(teste.status))}>{teste.status || "sem resposta"}</span>
              <span style={{ color: CINZA }}>em {teste.ms} ms pela URL pública</span>
            </span>
          )}
        </div>

        <div style={{ fontSize: "0.74rem", fontWeight: 700, color: CINZA, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
          Últimas chamadas recebidas
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
          {!webhook && <span style={{ fontSize: "0.8rem", color: CINZA }}>Carregando…</span>}
          {webhook && webhook.chamadas.length === 0 && (
            <span style={{ fontSize: "0.8rem", color: CINZA }}>
              Nenhuma chamada desde a última reinicialização — o próximo KEEPALIVE do iFood aparece aqui em instantes.
            </span>
          )}
          {webhook?.chamadas.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, border: `1px solid ${LINHA}`, borderRadius: 9, padding: "6px 10px", fontSize: "0.78rem" }}>
              <span style={{ color: CINZA, fontVariantNumeric: "tabular-nums" }}>{horaLocal(c.quando)}</span>
              <span style={{ color: TINTA, fontWeight: 600, flex: 1 }}>{c.codigo}</span>
              <span style={selo(corDoStatus(c.status))}>{c.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
