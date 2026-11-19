"use client";

/**
 * O DIA das reservas: a ocupação de cada horário contra a capacidade (barras),
 * o salão ao longo da noite (cada linha é uma vaga de reserva ao mesmo tempo)
 * e a lista com as ações — chegou, não veio, mover, cancelar, mesa.
 */
import { useMemo, useState } from "react";
import type { ConfigDasReservas, HorarioDoDia } from "@/lib/reservas/regras";
import {
  BORDA, Botao, COR, COR_CLARA, CORES_DA_ORIGEM, SeloDaOrigem, SeloDoStatus, TINTA, TINTA_2, TINTA_3,
  cartao, corDaOcupacao, h2, reais, telefoneBonito, texto, type Mesa, type ReservaDaTela,
} from "./comum";

const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hh = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ─── Ocupação por horário ─────────────────────────────────────────────────

export function OcupacaoDoDia({ horarios, agoraMin, selecionada, onEscolher, compacta }: {
  horarios: HorarioDoDia[]; agoraMin?: number | null; selecionada?: string | null; onEscolher?: (hora: string) => void; compacta?: boolean;
}) {
  if (!horarios.length) {
    return <div style={{ padding: "28px 12px", textAlign: "center", color: TINTA_3, fontWeight: 700 }}>Este dia não aceita reserva. Mude em Configurar.</div>;
  }
  const altura = compacta ? 120 : 170;
  const primeiro = min(horarios[0].hora), ultimo = min(horarios[horarios.length - 1].hora);
  const agoraPct = agoraMin != null && agoraMin >= primeiro && agoraMin <= ultimo && ultimo > primeiro ? (agoraMin - primeiro) / (ultimo - primeiro) : null;
  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ position: "relative", minWidth: horarios.length * 46, paddingTop: 28 }}>
        {/* A linha da capacidade (100%). */}
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 28, borderTop: "1.5px dashed #FCA5A5" }} />
        <span aria-hidden style={{ position: "absolute", right: 0, top: 10, fontSize: 10.5, fontWeight: 800, color: "#DC2626" }}>capacidade</span>
        {agoraPct != null && (
          <div aria-hidden style={{ position: "absolute", top: 20, height: altura + 10, left: `calc(${(agoraPct * (horarios.length - 1) + 0.5) / horarios.length * 100}%)`, borderLeft: `2px solid ${COR}`, zIndex: 2 }}>
            <span style={{ position: "absolute", top: -14, left: -16, fontSize: 10, fontWeight: 900, color: COR, background: "#fff", padding: "0 3px" }}>agora</span>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${horarios.length}, 1fr)`, gap: 6, alignItems: "end", height: altura }}>
          {horarios.map((h) => {
            const cap = h.capacidade.reservas;
            const p = cap ? h.ocupacao.reservas / cap : 0;
            const c = corDaOcupacao(p, h.motivo === "lotado" || h.motivo === "lotado_pessoas");
            const passado = h.motivo === "passou" || h.motivo === "antecedencia";
            const ativa = selecionada === h.hora;
            return (
              <button key={h.hora} type="button" className="rsv-coluna" onClick={() => onEscolher?.(h.hora)}
                aria-label={`${h.hora}: ${h.ocupacao.reservas} de ${cap} reservas ao mesmo tempo, ${h.ocupacao.pessoas} pessoas. ${c.rotulo}.`}
                style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "stretch", background: ativa ? COR_CLARA : "transparent", border: "none", borderRadius: 8, padding: "0 3px", cursor: onEscolher ? "pointer" : "default", fontFamily: "inherit" }}>
                <span className="rsv-dica" style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translate(-50%,0)", background: TINTA, color: "#fff", fontSize: 11.5, lineHeight: 1.45, padding: "7px 9px", borderRadius: 8, whiteSpace: "nowrap", zIndex: 5, textAlign: "left", boxShadow: "0 8px 20px rgba(15,23,42,.25)" }}>
                  <b>{h.hora}</b> · {c.rotulo}<br />{h.ocupacao.reservas} de {cap} reservas na mesa<br />{h.ocupacao.pessoas} pessoas{h.capacidade.pessoas ? ` de ${h.capacidade.pessoas}` : ""} · chegam {h.chegam}
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, color: p >= 1 ? "#B91C1C" : TINTA_2, textAlign: "center", marginBottom: 3, fontVariantNumeric: "tabular-nums" }}>
                  {h.ocupacao.reservas}/{cap}
                </span>
                <span style={{ position: "relative", display: "block", height: `${Math.min(1, p) * 100}%`, minHeight: 4 }}>
                  <i className="rsv-barra" style={{ position: "absolute", inset: 0, borderRadius: "4px 4px 0 0", background: passado ? "#CBD5E1" : c.cor }} />
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${horarios.length}, 1fr)`, gap: 6, borderTop: `1px solid ${BORDA}`, paddingTop: 6 }}>
          {horarios.map((h) => (
            <span key={h.hora} style={{ fontSize: 11.5, fontWeight: selecionada === h.hora ? 900 : 700, color: selecionada === h.hora ? COR : TINTA_2, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{h.hora}</span>
          ))}
        </div>
      </div>
      {!compacta && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 12, fontWeight: 700, color: TINTA_2 }}>
          {[["#16A34A", "Livre"], ["#F59E0B", "Enchendo (70% ou mais)"], ["#DC2626", "Lotado"], ["#F87171", "Sem vaga (a reserva cruzaria um horário lotado)"], ["#CBD5E1", "Já passou"]].map(([cor, nome]) => (
            <span key={nome} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: cor }} />{nome}</span>
          ))}
          <span style={{ color: TINTA_3 }}>Passe o mouse (ou toque) num horário para ver o detalhe.</span>
        </div>
      )}
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

export function SalaoAoLongoDaNoite({ reservas, horarios, config, onAbrir }: {
  reservas: ReservaDaTela[]; horarios: HorarioDoDia[]; config: ConfigDasReservas; onAbrir?: (r: ReservaDaTela) => void;
}) {
  const ativas = reservas.filter((r) => r.status === "CONFIRMADA" || r.status === "CHEGOU");
  const { saida, vagas } = useMemo(() => emVagas(ativas, config.duracaoMin), [ativas, config.duracaoMin]);
  if (!horarios.length) return null;
  const ini = Math.min(min(horarios[0].hora), ...ativas.map((r) => min(r.hora)));
  const fim = Math.max(min(horarios[horarios.length - 1].hora), ...ativas.map((r) => min(r.hora))) + config.duracaoMin;
  const linhas = Math.max(config.maxReservasSimultaneas, vagas);
  const ALT = 30;
  const marcas: number[] = [];
  for (let t = Math.ceil(ini / 60) * 60; t <= fim; t += 60) marcas.push(t);
  const x = (m: number) => ((m - ini) / (fim - ini)) * 100;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 640, position: "relative" }}>
        <div style={{ position: "relative", height: 18 }}>
          {marcas.map((t) => (
            <span key={t} style={{ position: "absolute", left: `${x(t)}%`, transform: x(t) < 3 ? "none" : x(t) > 97 ? "translateX(-100%)" : "translateX(-50%)", fontSize: 11, fontWeight: 700, color: TINTA_3 }}>{hh(t)}</span>
          ))}
        </div>
        <div style={{ position: "relative", height: linhas * ALT, background: "repeating-linear-gradient(180deg,#F8FAFC 0 29px,#EEF2F7 29px 30px)", borderRadius: 10, border: `1px solid ${BORDA}` }}>
          {marcas.map((t) => <i key={t} aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: `${x(t)}%`, borderLeft: "1px dashed #E2E8F0" }} />)}
          {saida.map(({ r, vaga }) => {
            const chegou = r.status === "CHEGOU";
            return (
              <button key={r.id} type="button" onClick={() => onAbrir?.(r)} title={`${r.hora}–${hh(min(r.hora) + config.duracaoMin)} · ${r.nome} · ${r.pessoas} pessoas`}
                className="rsv-celula"
                style={{
                  position: "absolute", top: vaga * ALT + 3, height: ALT - 6, left: `${x(min(r.hora))}%`, width: `${x(min(r.hora) + config.duracaoMin) - x(min(r.hora))}%`,
                  background: chegou ? "#DCFCE7" : "#fff", border: `1.5px solid ${chegou ? "#16A34A" : CORES_DA_ORIGEM[r.origem]}`, borderLeftWidth: 5, borderRadius: 7,
                  display: "flex", alignItems: "center", gap: 6, padding: "0 8px", fontSize: 11.5, fontWeight: 700, color: TINTA, overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit",
                }}>
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{r.hora}</b>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.nome}</span>
                <span style={{ color: TINTA_2 }}>👥{r.pessoas}</span>
                {chegou && <span>✅</span>}
              </button>
            );
          })}
          {vagas > config.maxReservasSimultaneas && (
            <i aria-hidden style={{ position: "absolute", left: 0, right: 0, top: config.maxReservasSimultaneas * ALT, borderTop: "2px solid #DC2626" }} />
          )}
        </div>
        <p style={{ ...texto, fontSize: 12, marginTop: 8 }}>
          Cada linha é uma das <b>{config.maxReservasSimultaneas} vagas de reserva ao mesmo tempo</b>; cada bloco dura {config.duracaoMin} min (a duração média).
          Borda pela origem: <b style={{ color: CORES_DA_ORIGEM.ROBO }}>robô</b>, <b style={{ color: CORES_DA_ORIGEM.PAINEL }}>painel</b>, <b style={{ color: CORES_DA_ORIGEM.BILL }}>Bill</b>; verde = já chegou.
          {vagas > config.maxReservasSimultaneas && <b style={{ color: "#B91C1C" }}> Abaixo da linha vermelha: encaixes acima da capacidade.</b>}
        </p>
      </div>
    </div>
  );
}

// ─── A lista ──────────────────────────────────────────────────────────────

export type AcaoDaLista = "chegou" | "nao_veio" | "cancelar" | "confirmar";

export function ListaDoDia({ reservas, mesas, filtroHora, ocupado, onAcao, onMesa, onMover, onLimparFiltro, ehPassado }: {
  reservas: ReservaDaTela[]; mesas: Mesa[]; filtroHora: string | null; ocupado: string | null; ehPassado: boolean;
  onAcao: (r: ReservaDaTela, a: AcaoDaLista) => void; onMesa: (r: ReservaDaTela, mesaId: string | null) => void; onMover: (r: ReservaDaTela) => void; onLimparFiltro: () => void;
}) {
  const [verCanceladas, setVerCanceladas] = useState(false);
  const visiveis = reservas.filter((r) => (verCanceladas || r.status !== "CANCELADA") && (!filtroHora || r.hora === filtroHora));
  const grupos = new Map<string, ReservaDaTela[]>();
  for (const r of visiveis) grupos.set(r.hora, [...(grupos.get(r.hora) || []), r]);
  const canceladas = reservas.filter((r) => r.status === "CANCELADA").length;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={h2}>Reservas do dia {filtroHora && <span style={{ color: COR }}>· chegando às {filtroHora}</span>}</h2>
        {filtroHora && <Botao tipo="fantasma" onClick={onLimparFiltro} style={{ padding: "4px 8px" }}>ver todas ✕</Botao>}
        <span style={{ flex: 1 }} />
        {canceladas > 0 && (
          <label style={{ fontSize: 13, fontWeight: 700, color: TINTA_2, display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={verCanceladas} onChange={(e) => setVerCanceladas(e.target.checked)} /> mostrar {canceladas} cancelada{canceladas > 1 ? "s" : ""}
          </label>
        )}
      </div>
      {!visiveis.length && (
        <div style={{ ...cartao, textAlign: "center", padding: "30px 16px", color: TINTA_3, fontWeight: 700, borderStyle: "dashed" }}>
          {filtroHora ? `Nenhuma reserva chegando às ${filtroHora}.` : "Nenhuma reserva neste dia ainda."}
        </div>
      )}
      {[...grupos.entries()].map(([hora, lista]) => (
        <div key={hora} style={{ display: "grid", gridTemplateColumns: "64px 1fr", gap: 12 }} className="rsv-entra">
          <div style={{ paddingTop: 14 }}>
            <div style={{ fontSize: 19, fontWeight: 900, color: TINTA, fontVariantNumeric: "tabular-nums" }}>{hora}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: TINTA_3 }}>{lista.reduce((t, r) => t + (r.status === "CANCELADA" ? 0 : r.pessoas), 0)} pessoas</div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {lista.map((r) => (
              <CartaoDaReserva key={r.id} r={r} mesas={mesas} ocupado={ocupado === r.id} ehPassado={ehPassado}
                onAcao={(a) => onAcao(r, a)} onMesa={(m) => onMesa(r, m)} onMover={() => onMover(r)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CartaoDaReserva({ r, mesas, ocupado, ehPassado, onAcao, onMesa, onMover }: {
  r: ReservaDaTela; mesas: Mesa[]; ocupado: boolean; ehPassado: boolean;
  onAcao: (a: AcaoDaLista) => void; onMesa: (mesaId: string | null) => void; onMover: () => void;
}) {
  const tel = String(r.telefone || "").replace(/\D/g, "");
  const aberta = r.status === "CONFIRMADA";
  return (
    <div id={`reserva-${r.id}`} style={{ ...cartao, padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "center", opacity: r.status === "CANCELADA" ? 0.6 : 1, borderLeft: `5px solid ${r.status === "CHEGOU" ? "#16A34A" : CORES_DA_ORIGEM[r.origem]}` }}>
      <div style={{ flex: "1 1 320px", minWidth: 0, display: "grid", gap: 4 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ fontSize: 15.5, color: TINTA }}>{r.nome}</b>
          <span style={{ fontSize: 13, fontWeight: 800, color: TINTA, background: "#F1F5F9", padding: "1px 8px", borderRadius: 999 }}>👥 {r.pessoas}</span>
          <SeloDoStatus status={r.status} />
          <SeloDaOrigem origem={r.origem} />
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12.5, color: TINTA_2 }}>
          {tel && <a href={`https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}`} target="_blank" rel="noreferrer" style={{ color: "#15803D", fontWeight: 700, textDecoration: "none" }}>💬 {telefoneBonito(tel)}</a>}
          {r.observacao && <span>📝 {r.observacao}</span>}
          {r.consumo ? <span style={{ fontWeight: 800, color: "#166534" }}>💰 consumiu {reais(r.consumo)}</span> : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
        {aberta && ehPassado && <Botao tipo="verde" disabled={ocupado} onClick={() => onAcao("chegou")}>✅ Chegou</Botao>}
        {aberta && ehPassado && <Botao tipo="secundario" disabled={ocupado} onClick={() => onAcao("nao_veio")}>⌛ Não veio</Botao>}
        {aberta && <Botao tipo="secundario" disabled={ocupado} onClick={onMover}>🕒 Mover</Botao>}
        {r.status !== "CANCELADA" && mesas.length > 0 && (
          <select value={r.mesaId || ""} disabled={ocupado} onChange={(e) => onMesa(e.target.value || null)} aria-label="Mesa da reserva"
            style={{ padding: "8px 8px", borderRadius: 10, border: `1px solid ${BORDA}`, fontSize: 13, fontWeight: 700, color: r.mesaId ? TINTA : TINTA_3, background: "#fff", fontFamily: "inherit" }}>
            <option value="">🍽️ Mesa?</option>
            {mesas.map((m) => <option key={m.id} value={m.id}>{m.nome} ({m.capacidade} lug.)</option>)}
          </select>
        )}
        {!aberta && <Botao tipo="fantasma" disabled={ocupado} onClick={() => onAcao("confirmar")}>{r.status === "CANCELADA" ? "↩ Reativar" : "↩ Desfazer"}</Botao>}
        {aberta && <Botao tipo="perigo" disabled={ocupado} onClick={() => onAcao("cancelar")} title="Cancelar a reserva (dá para reativar)">Cancelar</Botao>}
      </div>
    </div>
  );
}
