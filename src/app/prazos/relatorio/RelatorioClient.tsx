"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Evento = { em: string; tipo: "prazo" | "parou"; pedidos: number | null; minutos: number | null; pausar: boolean; preparo99: number | null };
type Resposta = {
  success: boolean;
  agora: string;
  dias: number;
  conta: { nomeLoja: string; motoboys: number; modo: string; status: string };
  visto: string | null;
  lendo: boolean;
  lojas: { ifood: string[]; n99: string[]; ultimaAplicacao: any; aplicadoEm: string | null };
  anterior: Evento | null;
  eventos: Evento[];
};
type Trecho = { inicio: number; fim: number; minutos: number; pausar: boolean; preparo99: number | null; pedidos: number | null };
type Dia = { chave: string; rotulo: string; monitorado: number; porFaixa: Map<string, number>; alto: number; estouro: number; episodios: number; pico: number; trechos: Trecho[] };

const LARANJA = "#FF5722";

function corDaFaixa(minutos: number, pausar: boolean): string {
  if (pausar) return "#DC2626";
  if (minutos >= 78) return "#F97316";
  if (minutos >= 58) return "#F59E0B";
  if (minutos >= 38) return "#84CC16";
  return "#22C55E";
}

function duracao(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "0 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

function chaveDoDia(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rotuloDoDia(chave: string, hoje: string): string {
  if (chave === hoje) return "Hoje";
  const [a, m, d] = chave.split("-").map(Number);
  const data = new Date(a, m - 1, d);
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  if (chave === chaveDoDia(ontem.getTime())) return "Ontem";
  return data.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Eventos → trechos fechados (o aberto fecha em `agora` se ainda lendo, senão no último sinal). */
function montarTrechos(r: Resposta, desdeMs: number): Trecho[] {
  const agora = new Date(r.agora).getTime();
  const fimAberto = r.lendo ? agora : Math.max(desdeMs, r.visto ? new Date(r.visto).getTime() : agora);
  const trechos: Trecho[] = [];
  let aberto: Trecho | null = null;
  const abrir = (e: Evento, em: number) => {
    if (e.minutos === null) return;
    aberto = { inicio: em, fim: em, minutos: e.minutos, pausar: !!e.pausar, preparo99: e.preparo99, pedidos: e.pedidos };
  };
  const fechar = (em: number) => {
    if (!aberto) return;
    aberto.fim = Math.max(aberto.inicio, em);
    if (aberto.fim > aberto.inicio) trechos.push(aberto);
    aberto = null;
  };
  if (r.anterior && r.anterior.tipo === "prazo") abrir(r.anterior, desdeMs);
  for (const e of r.eventos) {
    const em = new Date(e.em).getTime();
    fechar(em);
    if (e.tipo === "prazo") abrir(e, em);
  }
  fechar(fimAberto);
  return trechos;
}

function porDia(trechos: Trecho[], hoje: string): Dia[] {
  const mapa = new Map<string, Dia>();
  for (const t of trechos) {
    // Um trecho pode cruzar a meia-noite: parte em pedaços por dia.
    let ini = t.inicio;
    while (ini < t.fim) {
      const d = new Date(ini);
      const fimDoDia = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const fim = Math.min(t.fim, fimDoDia);
      const chave = chaveDoDia(ini);
      let dia = mapa.get(chave);
      if (!dia) { dia = { chave, rotulo: rotuloDoDia(chave, hoje), monitorado: 0, porFaixa: new Map(), alto: 0, estouro: 0, episodios: 0, pico: 0, trechos: [] }; mapa.set(chave, dia); }
      const dur = fim - ini;
      dia.monitorado += dur;
      const faixa = t.pausar ? "pausar" : String(t.minutos);
      dia.porFaixa.set(faixa, (dia.porFaixa.get(faixa) || 0) + dur);
      if (t.pausar || t.minutos >= 58) dia.alto += dur;
      if (t.pausar) { dia.estouro += dur; if (ini === t.inicio) dia.episodios += 1; }
      if (typeof t.pedidos === "number") dia.pico = Math.max(dia.pico, t.pedidos);
      dia.trechos.push({ ...t, inicio: ini, fim });
      ini = fim;
    }
  }
  return Array.from(mapa.values()).sort((a, b) => (a.chave < b.chave ? 1 : -1));
}

export default function RelatorioClient() {
  const [token, setToken] = useState<string | null>(null);
  const [dias, setDias] = useState(7);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const doHash = (typeof window !== "undefined" ? window.location.hash : "").match(/token=([^&]+)/);
    let t = doHash ? decodeURIComponent(doHash[1]) : null;
    try {
      if (t) sessionStorage.setItem("fhprazos_token", t);
      else t = sessionStorage.getItem("fhprazos_token");
    } catch {}
    if (doHash) { try { history.replaceState(null, "", window.location.pathname); } catch {} }
    setToken(t);
    if (!t) { setCarregando(false); setErro("Abra o relatório pelo botão 📊 Relatório da extensão FireHub Prazos."); }
  }, []);

  const carregar = useCallback(async () => {
    if (!token) return;
    setCarregando(true);
    try {
      const r = await fetch(`/api/prazos/relatorio?dias=${dias}`, { headers: { "x-prazos-token": token }, cache: "no-store" });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d?.error || "não consegui carregar");
      setDados(d);
      setErro("");
    } catch (e: any) {
      setErro(e?.message || "não consegui carregar");
    } finally {
      setCarregando(false);
    }
  }, [token, dias]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const hoje = chaveDoDia(Date.now());
  const diasCalc = useMemo(() => {
    if (!dados) return [] as Dia[];
    const desde = new Date(dados.agora).getTime() - dados.dias * 24 * 60 * 60 * 1000;
    return porDia(montarTrechos(dados, desde), hoje);
  }, [dados, hoje]);
  const deHoje = diasCalc.find((d) => d.chave === hoje);

  const card: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1rem 1.1rem" };
  const chip = (texto: string, cor: string) => (
    <span key={texto} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 999, padding: "3px 10px", fontSize: ".78rem", fontWeight: 700, marginRight: 6, marginBottom: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 999, background: cor, display: "inline-block" }} /> {texto}
    </span>
  );

  const faixasDoDia = (d: Dia) =>
    Array.from(d.porFaixa.entries())
      .sort((a, b) => (a[0] === "pausar" ? 1 : b[0] === "pausar" ? -1 : Number(a[0]) - Number(b[0])))
      .map(([faixa, ms]) => chip(`${faixa === "pausar" ? "Estouro/pausar" : faixa + " min"}: ${duracao(ms)}`, faixa === "pausar" ? "#DC2626" : corDaFaixa(Number(faixa), false)));

  const linhaDoTempo = (d: Dia) => {
    const inicioDia = new Date(Number(d.chave.slice(0, 4)), Number(d.chave.slice(5, 7)) - 1, Number(d.chave.slice(8, 10))).getTime();
    const total = 24 * 60 * 60 * 1000;
    return (
      <div>
        <div style={{ position: "relative", height: 22, background: "#F1F5F9", borderRadius: 6, overflow: "hidden" }}>
          {d.trechos.map((t, i) => (
            <div key={i} title={`${new Date(t.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}–${new Date(t.fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}: ${t.pausar ? "estouro" : t.minutos + " min"}${typeof t.pedidos === "number" ? ` · ${t.pedidos} ped.` : ""}`}
              style={{ position: "absolute", top: 0, bottom: 0, left: `${((t.inicio - inicioDia) / total) * 100}%`, width: `${Math.max(0.15, ((t.fim - t.inicio) / total) * 100)}%`, background: corDaFaixa(t.minutos, t.pausar) }} />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".66rem", color: "#94A3B8", marginTop: 2 }}>
          {["0h", "6h", "12h", "18h", "24h"].map((h) => <span key={h}>{h}</span>)}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", color: "#0F172A", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", color: "#fff", padding: "1.2rem 1.5rem" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${LARANJA}, #F44336)`, display: "grid", placeItems: "center", fontSize: "1.1rem" }}>🔥</div>
            <div>
              <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>FireHub Prazos · {dados?.conta.nomeLoja || "relatório"}</div>
              <div style={{ fontSize: ".72rem", color: "#FF7A59", fontWeight: 700, letterSpacing: ".3px" }}>QUANTO TEMPO O PRAZO FICOU ALTO, BAIXO OU EM ESTOURO</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 7, 30].map((n) => (
              <button key={n} onClick={() => setDias(n)} style={{ border: "1px solid #475569", background: dias === n ? LARANJA : "#1E293B", color: "#fff", borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: ".8rem", cursor: "pointer" }}>
                {n === 1 ? "Hoje" : `${n} dias`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "1.2rem 1rem 3rem" }}>
        {erro && <div style={{ ...card, borderColor: "#FCA5A5", background: "#FEF2F2", color: "#B91C1C", fontWeight: 700, marginBottom: 12 }}>{erro}</div>}
        {carregando && !dados && <div style={{ color: "#64748B" }}>Carregando…</div>}

        {dados && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
              {[
                { t: "Monitorado hoje", v: duracao(deHoje?.monitorado || 0), s: dados.lendo ? "painel lendo agora" : `último sinal ${dados.visto ? new Date(dados.visto).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}` },
                { t: "Prazo alto hoje (≥ 58 min)", v: duracao(deHoje?.alto || 0), s: deHoje && deHoje.monitorado ? `${Math.round((deHoje.alto / deHoje.monitorado) * 100)}% do tempo` : "—", cor: "#F59E0B" },
                { t: "Em estouro hoje", v: duracao(deHoje?.estouro || 0), s: `${deHoje?.episodios || 0} vez(es) pediu pausar`, cor: "#DC2626" },
                { t: "Pico de pedidos hoje", v: String(deHoje?.pico || 0), s: `${dados.conta.motoboys} motoboy(s) · modo ${dados.conta.modo}` },
              ].map((c) => (
                <div key={c.t} style={card}>
                  <div style={{ fontSize: ".7rem", color: "#64748B", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px" }}>{c.t}</div>
                  <div style={{ fontSize: "1.6rem", fontWeight: 900, color: c.cor || "#0F172A", margin: "2px 0" }}>{c.v}</div>
                  <div style={{ fontSize: ".74rem", color: "#64748B" }}>{c.s}</div>
                </div>
              ))}
            </div>

            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>🏪 Lojas que a extensão ajusta</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: ".84rem" }}>
                <div>
                  <div style={{ color: "#64748B", fontWeight: 700, fontSize: ".72rem", marginBottom: 4 }}>🛵 IFOOD — PRAZO DE ENTREGA</div>
                  {dados.lojas.ifood.length === 0 && <div style={{ color: "#94A3B8" }}>nenhuma loja marcada</div>}
                  {dados.lojas.ifood.map((n) => {
                    const r = (dados.lojas.ultimaAplicacao?.ifood || []).find((x: any) => x.nome === n);
                    return <div key={n}>{n} {r ? <span style={{ color: r.ok ? "#15803D" : "#B91C1C", fontWeight: 700 }}>{r.ok ? `✓ ${r.minutos} min` : `✗ ${r.erro || "falhou"}`}</span> : null}</div>;
                  })}
                </div>
                <div>
                  <div style={{ color: "#64748B", fontWeight: 700, fontSize: ".72rem", marginBottom: 4 }}>🟡 99FOOD — TEMPO DE PREPARO</div>
                  {dados.lojas.n99.length === 0 && <div style={{ color: "#94A3B8" }}>nenhuma loja marcada</div>}
                  {dados.lojas.n99.map((n) => {
                    const r = (dados.lojas.ultimaAplicacao?.n99 || []).find((x: any) => x.nome === n);
                    return <div key={n}>{n} {r ? <span style={{ color: r.ok ? "#15803D" : "#B91C1C", fontWeight: 700 }}>{r.ok ? `✓ ${r.minutos} min` : `✗ ${r.erro || "falhou"}`}</span> : null}</div>;
                  })}
                </div>
              </div>
              {dados.lojas.aplicadoEm && <div style={{ color: "#94A3B8", fontSize: ".72rem", marginTop: 6 }}>última aplicação {new Date(dados.lojas.aplicadoEm).toLocaleString("pt-BR")}</div>}
            </div>

            {diasCalc.length === 0 && <div style={{ ...card, color: "#64748B" }}>Ainda não há histórico neste período. Com o robô ligado e o painel aberto, cada mudança de prazo passa a aparecer aqui.</div>}

            {diasCalc.map((d) => (
              <div key={d.chave} style={{ ...card, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: "1rem" }}>{d.rotulo} <span style={{ color: "#94A3B8", fontWeight: 600, fontSize: ".8rem" }}>{d.chave.split("-").reverse().join("/")}</span></div>
                  <div style={{ fontSize: ".8rem", color: "#475569" }}>
                    monitorado <b>{duracao(d.monitorado)}</b> · alto <b style={{ color: "#B45309" }}>{duracao(d.alto)}{d.monitorado ? ` (${Math.round((d.alto / d.monitorado) * 100)}%)` : ""}</b> · estouro <b style={{ color: "#B91C1C" }}>{duracao(d.estouro)} · {d.episodios}×</b> · pico <b>{d.pico} ped.</b>
                  </div>
                </div>
                {linhaDoTempo(d)}
                <div style={{ marginTop: 8 }}>{faixasDoDia(d)}</div>
              </div>
            ))}

            <div style={{ color: "#94A3B8", fontSize: ".72rem", marginTop: 10 }}>
              O relatório conta o tempo em que a extensão estava lendo o painel. Prazo alto = 58 min ou mais, ou estouro (pausar). Horários no fuso deste computador.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
