"use client";

/**
 * O DIA das reservas: a ocupação de cada horário contra a capacidade (barras),
 * o salão ao longo da noite (cada linha é uma vaga de reserva ao mesmo tempo),
 * a lista com as ações — chegou, não veio, mover, cancelar, mesa — e o painel
 * do lado com as próximas chegadas e a situação do dia.
 */
import { useMemo, useState } from "react";
import { Bot, CalendarPlus, CalendarX2, CircleCheck, Clock, Hourglass, MessageCircle, MoveRight, StickyNote, Undo2, Users, Utensils, X } from "lucide-react";
import type { ConfigDasReservas, HorarioDoDia } from "@/lib/reservas/regras";
import {
  BORDA, BORDA_FORTE, Botao, CALHA, CARVAO, COR, COR_BORDA, COR_CLARA, ICONE_DA_ORIGEM, CORES_DA_ORIGEM, STATUS, SeloDaOrigem, SeloDoStatus, TINTA, TINTA_2, TINTA_3,
  Vazio, cartao, corDaOcupacao, h2, micro, reais, telefoneBonito, texto, type Mesa, type ReservaDaTela,
} from "./comum";

const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hh = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const duracaoCurta = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`);

// ─── Ocupação por horário ─────────────────────────────────────────────────

const LEGENDA_DA_OCUPACAO: [string, string][] = [
  ["#0F766E", "Livre"], ["#D97706", "Enchendo (70% ou mais)"], ["#B71C1C", "Lotado"],
  ["repeating-linear-gradient(135deg,#B71C1C 0 3px,#F5B5B5 3px 7px)", "Sem vaga (cruzaria um horário lotado)"], [BORDA_FORTE, "Já passou"],
];

export function LegendaDaOcupacao() {
  return (
    <div style={{ display: "flex", gap: "6px 16px", flexWrap: "wrap", font: "500 12.5px/1.3 Inter, system-ui, sans-serif", color: TINTA_3 }}>
      {LEGENDA_DA_OCUPACAO.map(([cor, nome]) => (
        <span key={nome} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: cor }} />{nome}</span>
      ))}
    </div>
  );
}

export function OcupacaoDoDia({ horarios, agoraMin, selecionada, onEscolher, compacta }: {
  horarios: HorarioDoDia[]; agoraMin?: number | null; selecionada?: string | null; onEscolher?: (hora: string) => void; compacta?: boolean;
}) {
  if (!horarios.length) {
    return <Vazio icone={CalendarX2} titulo="Este dia não aceita reserva">Para abrir reservas neste dia da semana, ligue o dia em Configurar.</Vazio>;
  }
  const altura = compacta ? "clamp(140px, 20vh, 200px)" : "clamp(180px, 28vh, 320px)";
  const primeiro = min(horarios[0].hora), ultimo = min(horarios[horarios.length - 1].hora);
  const agoraPct = agoraMin != null && agoraMin >= primeiro && agoraMin <= ultimo && ultimo > primeiro ? (agoraMin - primeiro) / (ultimo - primeiro) : null;
  const cap = horarios[0].capacidade.reservas;
  return (
    <div className="rsv-rolagem" style={{ paddingBottom: 4 }}>
      <div style={{ position: "relative", minWidth: horarios.length * 52, paddingTop: 26 }}>
        {/* Linhas de 50% e da capacidade (100%). */}
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 26, height: altura, pointerEvents: "none" }}>
          <i style={{ position: "absolute", left: 0, right: 0, top: "50%", borderTop: `1px dashed ${BORDA}` }} />
          <i style={{ position: "absolute", left: 0, right: 0, top: 0, borderTop: "1.5px dashed #F5A3A3" }} />
          <span style={{ position: "absolute", right: 0, top: -19, font: "800 11px/1 Inter, system-ui, sans-serif", letterSpacing: ".04em", textTransform: "uppercase", color: "#B71C1C" }}>capacidade · {cap}</span>
        </div>
        {agoraPct != null && (
          <div aria-hidden style={{ position: "absolute", top: 14, height: `calc(${altura} + 14px)`, left: `${((agoraPct * (horarios.length - 1) + 0.5) / horarios.length) * 100}%`, borderLeft: `2px solid ${CARVAO}`, zIndex: 3, pointerEvents: "none" }}>
            <span style={{ position: "absolute", top: -14, left: 0, transform: "translateX(-50%)", font: "800 10.5px/1 Inter, system-ui, sans-serif", color: "#fff", background: CARVAO, padding: "3px 6px", borderRadius: 99, whiteSpace: "nowrap" }}>agora</span>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${horarios.length}, minmax(0,1fr))`, gap: 6, alignItems: "end", height: altura }}>
          {horarios.map((h) => {
            const c0 = h.capacidade.reservas;
            const p = c0 ? h.ocupacao.reservas / c0 : 0;
            const c = corDaOcupacao(p, h.motivo === "lotado" || h.motivo === "lotado_pessoas");
            const passado = h.motivo === "passou" || h.motivo === "antecedencia";
            const ativa = selecionada === h.hora;
            return (
              <button key={h.hora} type="button" className="rsv-coluna" onClick={() => onEscolher?.(h.hora)}
                aria-pressed={onEscolher ? ativa : undefined}
                aria-label={`${h.hora}: ${h.ocupacao.reservas} de ${c0} reservas ao mesmo tempo, ${h.ocupacao.pessoas} pessoas. ${c.rotulo}.`}
                style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", background: ativa ? COR_CLARA : "transparent", border: ativa ? `1px solid ${COR_BORDA}` : "1px solid transparent", borderRadius: 10, padding: "0 4px", cursor: onEscolher ? "pointer" : "default", fontFamily: "inherit" }}>
                <span className="rsv-dica" style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translate(-50%,0)", background: TINTA, color: "#fff", font: "500 12px/1.5 Inter, system-ui, sans-serif", padding: "8px 10px", borderRadius: 10, whiteSpace: "nowrap", zIndex: 5, textAlign: "left", boxShadow: "0 16px 32px -12px rgba(15,23,42,.4)" }}>
                  <b style={{ fontWeight: 800 }}>{h.hora}</b> · {passado ? "Já passou" : c.rotulo}<br />{h.ocupacao.reservas} de {c0} reservas na mesa<br />{h.ocupacao.pessoas} pessoas{h.capacidade.pessoas ? ` de ${h.capacidade.pessoas}` : ""} · chegam {h.chegam}
                </span>
                <span style={{ font: "800 12px/1 Inter, system-ui, sans-serif", color: p >= 1 ? "#B71C1C" : h.ocupacao.reservas ? TINTA : TINTA_3, marginBottom: 6, fontVariantNumeric: "tabular-nums" }}>
                  {h.ocupacao.reservas ? `${h.ocupacao.reservas}/${c0}` : "—"}
                </span>
                <span style={{ position: "relative", display: "block", width: "100%", maxWidth: 64, height: `${Math.min(1, p) * 100}%`, minHeight: 4 }}>
                  <i className="rsv-barra-v" style={{ position: "absolute", inset: 0, borderRadius: "6px 6px 2px 2px", background: passado ? BORDA_FORTE : c.barra }} />
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${horarios.length}, minmax(0,1fr))`, gap: 6, borderTop: `1px solid ${BORDA_FORTE}`, paddingTop: 8 }}>
          {horarios.map((h) => (
            <span key={h.hora} style={{ font: `${selecionada === h.hora ? 900 : 800} 12px/1 Inter, system-ui, sans-serif`, color: selecionada === h.hora ? COR : TINTA_2, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{h.hora}</span>
          ))}
        </div>
      </div>
      {!compacta && <div style={{ marginTop: 14 }}><LegendaDaOcupacao /></div>}
    </div>
  );
}

// ─── O salão ao longo da noite ────────────────────────────────────────────

/** Distribui as reservas em "vagas" (linhas) sem sobrepor: a primeira vaga livre no horário. */
function emVagas(reservas: ReservaDaTela[], duracao: number) {
  const fimDaVaga: number[] = [];
  const saida: { r: ReservaDaTela; vaga: number }[] = [];
  for (const r of [...reservas].sort((a, b) => min(a.hora) - min(b.hora))) {
    const ini = min(r.hora);
    let v = fimDaVaga.findIndex((f) => f <= ini);
    if (v === -1) { v = fimDaVaga.length; fimDaVaga.push(0); }
    fimDaVaga[v] = ini + duracao;
    saida.push({ r, vaga: v });
  }
  return { saida, vagas: fimDaVaga.length };
}

export function SalaoAoLongoDaNoite({ reservas, horarios, config, onAbrir, agoraMin, mesas }: {
  reservas: ReservaDaTela[]; horarios: HorarioDoDia[]; config: ConfigDasReservas; onAbrir?: (r: ReservaDaTela) => void; agoraMin?: number | null; mesas?: Mesa[];
}) {
  const ativas = reservas.filter((r) => r.status === "CONFIRMADA" || r.status === "CHEGOU");
  const { saida, vagas } = useMemo(() => emVagas(ativas, config.duracaoMin), [ativas, config.duracaoMin]);
  if (!horarios.length) return null;
  const ini = Math.min(min(horarios[0].hora), ...ativas.map((r) => min(r.hora)));
  const fim = Math.max(min(horarios[horarios.length - 1].hora), ...ativas.map((r) => min(r.hora))) + config.duracaoMin;
  const linhas = Math.max(config.maxReservasSimultaneas, vagas);
  const ALT = 40;
  const marcas: number[] = [];
  for (let t = Math.ceil(ini / 60) * 60; t <= fim; t += 60) marcas.push(t);
  const x = (m: number) => ((m - ini) / (fim - ini)) * 100;
  const agora = agoraMin != null && agoraMin >= ini && agoraMin <= fim ? x(agoraMin) : null;
  const nomeDaMesa = (id: string | null) => (id ? mesas?.find((m) => m.id === id)?.nome : null);
  return (
    <div>
      <div className="rsv-rolagem">
        <div style={{ minWidth: 760, display: "grid", gridTemplateColumns: "58px minmax(0,1fr)", columnGap: 10 }}>
          <span />
          <div style={{ position: "relative", height: 22 }}>
            {marcas.map((t) => (
              <span key={t} style={{ position: "absolute", left: `${x(t)}%`, transform: x(t) < 3 ? "none" : x(t) > 97 ? "translateX(-100%)" : "translateX(-50%)", font: "800 12px/1 Inter, system-ui, sans-serif", color: TINTA_3, fontVariantNumeric: "tabular-nums" }}>{hh(t)}</span>
            ))}
          </div>
          <div style={{ display: "grid", gridAutoRows: ALT }}>
            {Array.from({ length: linhas }, (_, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", font: "800 11px/1 Inter, system-ui, sans-serif", letterSpacing: ".04em", textTransform: "uppercase", color: i >= config.maxReservasSimultaneas ? "#B71C1C" : "#94A3B8" }}>
                {i >= config.maxReservasSimultaneas ? "extra" : `vaga ${i + 1}`}
              </span>
            ))}
          </div>
          <div style={{ position: "relative", height: linhas * ALT, background: `repeating-linear-gradient(180deg,#fff 0 ${ALT - 1}px,${BORDA} ${ALT - 1}px ${ALT}px)`, borderRadius: 12, border: `1px solid ${BORDA}`, overflow: "hidden" }}>
            {marcas.map((t) => <i key={t} aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: `${x(t)}%`, borderLeft: `1px solid ${BORDA}` }} />)}
            {vagas > config.maxReservasSimultaneas && (
              <i aria-hidden style={{ position: "absolute", left: 0, right: 0, top: config.maxReservasSimultaneas * ALT, bottom: 0, background: "rgba(254,242,242,.7)", borderTop: "2px solid #B71C1C" }} />
            )}
            {saida.map(({ r, vaga }) => {
              const s = STATUS[r.status];
              const Origem = ICONE_DA_ORIGEM[r.origem];
              const mesa = nomeDaMesa(r.mesaId);
              return (
                <button key={r.id} type="button" onClick={() => onAbrir?.(r)} title={`${r.hora}–${hh(min(r.hora) + config.duracaoMin)} · ${r.nome} · ${r.pessoas} pessoas · ${s.nome}`}
                  className="rsv-celula"
                  style={{
                    position: "absolute", top: vaga * ALT + 4, height: ALT - 8, left: `calc(${x(min(r.hora))}% + 2px)`, width: `calc(${x(min(r.hora) + config.duracaoMin) - x(min(r.hora))}% - 4px)`,
                    background: r.status === "CHEGOU" ? "#E6FAF5" : "#EEF2F6", border: `1px solid ${r.status === "CHEGOU" ? "#7DDCCB" : BORDA_FORTE}`, borderRadius: 9,
                    display: "flex", alignItems: "center", gap: 7, padding: "0 10px", font: "800 12.5px/1 Inter, system-ui, sans-serif", color: TINTA, overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit",
                    boxShadow: "0 1px 2px rgba(15,23,42,.06)",
                  }}>
                  <i aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: s.forte, flex: "none" }} />
                  <span style={{ fontVariantNumeric: "tabular-nums", color: TINTA_2 }}>{r.hora}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.nome}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: TINTA_3, fontWeight: 800 }}><Users size={13} aria-hidden />{r.pessoas}</span>
                  {mesa && <span style={{ color: TINTA_3, fontWeight: 500 }}>· {mesa}</span>}
                  <Origem size={13} color={CORES_DA_ORIGEM[r.origem]} aria-hidden style={{ marginLeft: "auto", flex: "none" }} />
                </button>
              );
            })}
            {agora != null && (
              <i aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: `${agora}%`, borderLeft: `2px solid ${CARVAO}`, zIndex: 2 }} />
            )}
          </div>
        </div>
      </div>
      <p style={{ ...texto, fontSize: 13, marginTop: 12 }}>
        Cada linha é uma das <b style={{ color: TINTA_2 }}>{config.maxReservasSimultaneas} vagas de reserva ao mesmo tempo</b>; cada bloco dura {duracaoCurta(config.duracaoMin)} (a duração média).
        {agora != null && " A linha escura é agora."}
        {vagas > config.maxReservasSimultaneas && <b style={{ color: "#B71C1C" }}> Na faixa vermelha: encaixes acima da capacidade.</b>}
      </p>
    </div>
  );
}

// ─── O lado: próximas chegadas e a situação do dia ────────────────────────

export function ProximasChegadas({ reservas, ehHoje, agoraMin, onAbrir }: {
  reservas: ReservaDaTela[]; ehHoje: boolean; agoraMin?: number | null; onAbrir: (r: ReservaDaTela) => void;
}) {
  const agora = ehHoje && agoraMin != null ? agoraMin : null;
  const lista = reservas
    .filter((r) => r.status === "CONFIRMADA" && (agora == null || min(r.hora) >= agora - 60))
    .sort((a, b) => min(a.hora) - min(b.hora))
    .slice(0, 6);
  return (
    <section className="rsv-proximas" style={{ ...cartao, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "#F1F5F9", color: TINTA_2 }}><Clock size={17} strokeWidth={2.2} /></span>
        <h2 style={{ ...h2, fontSize: 16 }}>{agora != null ? "Próximas chegadas" : "Chegadas do dia"}</h2>
      </div>
      {!lista.length ? (
        <p style={{ ...texto, fontSize: 13.5, padding: "0 18px 18px" }}>{agora != null ? "Ninguém mais para chegar hoje." : "Nenhuma reserva confirmada neste dia."}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 6px 8px" }}>
          {lista.map((r) => {
            const d = agora != null ? min(r.hora) - agora : null;
            const atrasada = d != null && d < 0;
            return (
              <li key={r.id}>
                <button type="button" className="rsv-linha-btn" onClick={() => onAbrir(r)}
                  style={{ width: "100%", display: "grid", gridTemplateColumns: "52px minmax(0,1fr) auto", alignItems: "center", gap: 10, padding: "10px 12px", border: "none", background: "none", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                  <span style={{ font: "900 16px/1 Inter, system-ui, sans-serif", color: TINTA, fontVariantNumeric: "tabular-nums" }}>{r.hora}</span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", font: "800 14px/1.25 Inter, system-ui, sans-serif", color: TINTA, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nome}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, font: "500 12.5px/1.3 Inter, system-ui, sans-serif", color: TINTA_3 }}><Users size={12} aria-hidden />{r.pessoas} {r.pessoas === 1 ? "pessoa" : "pessoas"}</span>
                  </span>
                  {d != null && (
                    <span style={{ font: "800 12px/1 Inter, system-ui, sans-serif", padding: "5px 8px", borderRadius: 99, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", ...(atrasada ? { background: "#FFF7E6", color: "#B45309", border: "1px solid #FDE68A" } : { background: CALHA, color: TINTA_2, border: `1px solid ${BORDA}` }) }}>
                      {atrasada ? `atrasada ${-d} min` : d === 0 ? "agora" : `em ${duracaoCurta(d)}`}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** O robô trabalhando: o que ele fez no dia e o que ele faz sozinho. */
export function RoboNoDia({ reservas }: { reservas: ReservaDaTela[] }) {
  const doRobo = reservas.filter((r) => r.origem === "ROBO" && r.status !== "CANCELADA").length;
  return (
    <section className="rsv-situacao" style={{ ...cartao, background: "#1C1917", borderColor: "#1C1917", color: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(255,255,255,.1)", color: "#FFB59E" }}><Bot size={17} strokeWidth={2.2} /></span>
        <h2 style={{ ...h2, fontSize: 16, color: "#fff" }}>O robô reserva sozinho</h2>
      </div>
      <p style={{ ...texto, fontSize: 13.5, color: "#D6D3D1", marginTop: 10 }}>
        No WhatsApp ele consulta se tem mesa, reserva, lista e cancela pelo que está aqui. Lotou, oferece o horário livre mais perto. Nunca passa da capacidade.
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.12)" }}>
        <b style={{ font: "900 26px/1 Inter, system-ui, sans-serif", fontVariantNumeric: "tabular-nums" }}>{doRobo}</b>
        <span style={{ font: "500 13px/1.3 Inter, system-ui, sans-serif", color: "#D6D3D1" }}>{doRobo === 1 ? "reserva feita pelo robô neste dia" : "reservas feitas pelo robô neste dia"}</span>
      </div>
    </section>
  );
}

export function SituacaoDoDia({ reservas, config, onConfigurar }: { reservas: ReservaDaTela[]; config: ConfigDasReservas; onConfigurar: () => void }) {
  const conta = (s: ReservaDaTela["status"]) => reservas.filter((r) => r.status === s).length;
  const partes = (["CONFIRMADA", "CHEGOU", "NAO_VEIO", "CANCELADA"] as const).map((s) => ({ s, n: conta(s) }));
  const total = partes.reduce((t, p) => t + p.n, 0);
  return (
    <section className="rsv-situacao" style={cartao}>
      <h2 style={{ ...h2, fontSize: 16 }}>Situação do dia</h2>
      <div aria-hidden style={{ display: "flex", gap: 2, height: 10, borderRadius: 99, overflow: "hidden", background: "#EEF2F7", margin: "14px 0 12px" }}>
        {total > 0 && partes.filter((p) => p.n).map((p) => <i key={p.s} style={{ width: `${(p.n / total) * 100}%`, background: STATUS[p.s].forte }} />)}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {partes.map((p) => (
          <div key={p.s} style={{ display: "flex", alignItems: "center", gap: 8, font: "500 13.5px/1.2 Inter, system-ui, sans-serif", color: TINTA_2 }}>
            <i aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: STATUS[p.s].forte }} />
            {STATUS[p.s].nome}
            <span style={{ flex: 1, borderBottom: `1px dotted ${BORDA_FORTE}`, transform: "translateY(3px)" }} />
            <b style={{ color: TINTA, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{p.n}</b>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BORDA}`, display: "grid", gap: 6 }}>
        <span style={micro}>A capacidade</span>
        <p style={{ ...texto, fontSize: 13.5, color: TINTA_2 }}>
          <b style={{ color: TINTA }}>{config.maxReservasSimultaneas} reservas</b> ao mesmo tempo{config.maxPessoasSimultaneas ? `, até ${config.maxPessoasSimultaneas} pessoas` : ""} · {duracaoCurta(config.duracaoMin)} cada · horários a cada {config.intervaloMin} min.
        </p>
        <button type="button" onClick={onConfigurar} style={{ justifySelf: "start", border: "none", background: "none", padding: 0, font: "800 13.5px/1.3 Inter, system-ui, sans-serif", color: COR, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
          Mudar em Configurar <MoveRight size={14} aria-hidden />
        </button>
      </div>
    </section>
  );
}

// ─── A lista ──────────────────────────────────────────────────────────────

export type AcaoDaLista = "chegou" | "nao_veio" | "cancelar" | "confirmar";

export function ListaDoDia({ reservas, mesas, filtroHora, ocupado, onAcao, onMesa, onMover, onLimparFiltro, ehPassado, foco, onNova }: {
  reservas: ReservaDaTela[]; mesas: Mesa[]; filtroHora: string | null; ocupado: string | null; ehPassado: boolean; foco?: string | null;
  onAcao: (r: ReservaDaTela, a: AcaoDaLista) => void; onMesa: (r: ReservaDaTela, mesaId: string | null) => void; onMover: (r: ReservaDaTela) => void; onLimparFiltro: () => void; onNova?: () => void;
}) {
  const [verCanceladas, setVerCanceladas] = useState(false);
  // Em ordem de chegada, numa grade só: em tela larga cabem 2–3 por linha, sem buraco por horário.
  const visiveis = reservas
    .filter((r) => (verCanceladas || r.status !== "CANCELADA") && (!filtroHora || r.hora === filtroHora))
    .sort((a, b) => min(a.hora) - min(b.hora));
  const canceladas = reservas.filter((r) => r.status === "CANCELADA").length;
  const pessoas = visiveis.reduce((t, r) => t + (r.status === "CANCELADA" ? 0 : r.pessoas), 0);

  return (
    <section style={cartao}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={h2}>Reservas do dia</h2>
        <span style={{ font: "800 13px/1 Inter, system-ui, sans-serif", color: TINTA_3, fontVariantNumeric: "tabular-nums" }}>{visiveis.length} · {pessoas} pessoas</span>
        {filtroHora && (
          <button type="button" onClick={onLimparFiltro} aria-label={`Tirar o filtro das ${filtroHora}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 10px 0 12px", borderRadius: 99, border: `1px solid ${COR_BORDA}`, background: COR_CLARA, color: COR, font: "800 13px/1 Inter, system-ui, sans-serif", cursor: "pointer" }}>
            chegando às {filtroHora} <X size={14} aria-hidden />
          </button>
        )}
        <span style={{ flex: 1 }} />
        {canceladas > 0 && (
          <label style={{ font: "800 13px/1 Inter, system-ui, sans-serif", color: TINTA_2, display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={verCanceladas} onChange={(e) => setVerCanceladas(e.target.checked)} style={{ width: 18, height: 18, accentColor: CARVAO }} /> mostrar {canceladas} cancelada{canceladas > 1 ? "s" : ""}
          </label>
        )}
      </div>
      {!visiveis.length ? (
        <Vazio icone={CalendarPlus} titulo={filtroHora ? `Ninguém chegando às ${filtroHora}` : "Nenhuma reserva neste dia ainda"}
          acao={onNova && <Botao tipo="secundario" onClick={onNova}>Lançar uma reserva</Botao>}>
          {filtroHora ? "Escolha outro horário no gráfico ou tire o filtro." : "As reservas do robô aparecem aqui sozinhas. A de quem ligou ou pediu no balcão, lance pelo botão."}
        </Vazio>
      ) : (
        <div className="rsv-cartoes">
          {visiveis.map((r) => (
            <CartaoDaReserva key={r.id} r={r} mesas={mesas} ocupado={ocupado === r.id} ehPassado={ehPassado} foco={foco === r.id}
              onAcao={(a) => onAcao(r, a)} onMesa={(m) => onMesa(r, m)} onMover={() => onMover(r)} />
          ))}
        </div>
      )}
    </section>
  );
}

function CartaoDaReserva({ r, mesas, ocupado, ehPassado, foco, onAcao, onMesa, onMover }: {
  r: ReservaDaTela; mesas: Mesa[]; ocupado: boolean; ehPassado: boolean; foco: boolean;
  onAcao: (a: AcaoDaLista) => void; onMesa: (mesaId: string | null) => void; onMover: () => void;
}) {
  const tel = String(r.telefone || "").replace(/\D/g, "");
  const aberta = r.status === "CONFIRMADA";
  const s = STATUS[r.status];
  const cancelada = r.status === "CANCELADA";
  return (
    <article id={`reserva-${r.id}`} className={`rsv-reserva rsv-reserva--${r.status.toLowerCase()}${foco ? " rsv-reserva--foco" : ""}`}>
      <div style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: 14, padding: "14px 14px 12px" }}>
        {/* A hora e o grupo são o que o salão precisa ver de longe: no bloco com a cor do status. */}
        <div style={{ borderRadius: 14, background: s.forte, color: "#fff", display: "grid", placeItems: "center", alignContent: "center", gap: 5, padding: "10px 4px", alignSelf: "start", opacity: cancelada ? 0.7 : 1 }}>
          <span style={{ font: "900 17px/1 Inter, system-ui, sans-serif", fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em" }}>{r.hora}</span>
          <span aria-label={`${r.pessoas} pessoas`} style={{ display: "inline-flex", alignItems: "center", gap: 3, font: "800 13px/1 Inter, system-ui, sans-serif", opacity: 0.9 }}><Users size={13} aria-hidden strokeWidth={2.4} />{r.pessoas}</span>
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: 7, alignContent: "start" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <b style={{ font: "800 16px/1.25 Inter, system-ui, sans-serif", color: TINTA, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: cancelada ? "line-through" : "none" }}>{r.nome}</b>
            <SeloDoStatus status={r.status} />
          </div>
          <div style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", alignItems: "center", font: "500 13px/1.35 Inter, system-ui, sans-serif", color: TINTA_3 }}>
            {tel && (
              <a href={`https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}`} target="_blank" rel="noreferrer" style={{ color: "#0F766E", fontWeight: 800, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
                <MessageCircle size={14} aria-hidden />{telefoneBonito(tel)}
              </a>
            )}
            <SeloDaOrigem origem={r.origem} curto />
            {r.consumo ? <span style={{ fontWeight: 800, color: "#0F766E" }}>consumiu {reais(r.consumo)}</span> : null}
          </div>
          {r.observacao && (
            <div style={{ display: "flex", gap: 7, alignItems: "flex-start", font: "500 13px/1.4 Inter, system-ui, sans-serif", color: "#44403C", background: "#FFFBF5", border: "1px solid #E7DDD3", borderRadius: 10, padding: "6px 10px" }}>
              <StickyNote size={14} aria-hidden style={{ flex: "none", marginTop: 1 }} /><span>{r.observacao}</span>
            </div>
          )}
          {!cancelada && mesas.length > 0 && (
            <label style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Utensils size={14} aria-hidden style={{ position: "absolute", left: 11, color: r.mesaId ? TINTA : TINTA_3, pointerEvents: "none" }} />
              <select value={r.mesaId || ""} disabled={ocupado} onChange={(e) => onMesa(e.target.value || null)} aria-label="Mesa da reserva"
                style={{ width: "100%", height: 38, padding: "0 10px 0 32px", borderRadius: 10, border: `1px solid ${r.mesaId ? "#7C8DA5" : BORDA_FORTE}`, font: "800 14px/1 Inter, system-ui, sans-serif", color: r.mesaId ? TINTA : TINTA_3, background: "#fff" }}>
                <option value="">Escolher a mesa</option>
                {mesas.map((m) => <option key={m.id} value={m.id}>{m.nome} ({m.capacidade} lug.)</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
      <div className="rsv-reserva__acoes">
        {aberta && ehPassado && <Botao pequeno tipo="verde" disabled={ocupado} onClick={() => onAcao("chegou")}><CircleCheck size={16} aria-hidden /> Chegou</Botao>}
        {aberta && ehPassado && <Botao pequeno tipo="secundario" disabled={ocupado} onClick={() => onAcao("nao_veio")}><Hourglass size={15} aria-hidden /> Não veio</Botao>}
        {aberta && <Botao pequeno tipo="secundario" disabled={ocupado} onClick={onMover}><Clock size={15} aria-hidden /> Mover</Botao>}
        {!aberta && <Botao pequeno tipo="secundario" disabled={ocupado} onClick={() => onAcao("confirmar")}><Undo2 size={15} aria-hidden /> {cancelada ? "Reativar" : "Desfazer"}</Botao>}
        {aberta && (
          <Botao pequeno tipo="perigo" disabled={ocupado} onClick={() => onAcao("cancelar")} title="Cancelar a reserva (dá para reativar)" style={{ width: 40, padding: 0 }}>
            <X size={18} aria-label="Cancelar a reserva" />
          </Botao>
        )}
      </div>
    </article>
  );
}
