"use client";

/**
 * As três visões da escala: Dia (o "hoje vem fulano e sicrano"), Semana (a
 * grade de segunda a domingo, a que o Lucas monta) e Mês (o calendário, para
 * ver de longe onde falta gente). Clicar num turno abre o detalhe; clicar
 * num dia do mês abre o dia.
 *
 * Douglas (12/11/2026, na prévia): "usar a tela toda e mais dinâmica" — a
 * grade ocupa a largura e a altura da tela, cada vaga vazia aparece como um
 * lugar a preencher, e dá para ARRASTAR: da lista de pessoas ao lado para o
 * turno (escalar), de um turno para outro (mudar) e do turno para a lista
 * (tirar). Clicar continua fazendo tudo, para quem não arrasta (celular).
 */

import { useState } from "react";
import {
  NOMES_CURTOS_DOS_DIAS, diaDaSemana, diaEMes, diasDaSemanaDe, horarioDoTurno, semanasDoMes, situacaoDasVagas, viraAMeiaNoite,
} from "@/lib/escala-da-equipe/regras";
import { Avatar, COR, COR_CLARA, COR_DA_SITUACAO, S, SeloDoLink, TIPO_DO_ARRASTO, comecarArrasto, lerArrasto, reais, arrastoAtual, type Arrasto, type Turno } from "./ui";

export type AoSoltar = (turno: Turno, a: Arrasto) => void;

export function PilulaDasVagas({ turno, grande = false }: { turno: Turno; grande?: boolean }) {
  const v = situacaoDasVagas(turno.inscritos.length, turno.vagas);
  const c = COR_DA_SITUACAO[v.estado];
  return (
    <span title={c.texto} style={{ ...S.chip, color: c.cor, background: c.fundo, border: `1px solid ${c.borda}`, fontSize: grande ? 13 : 12, padding: grande ? "4px 10px" : "2px 8px" }}>
      {v.preenchidas}/{v.vagas}{v.faltam > 0 && grande ? ` · faltam ${v.faltam}` : ""}{v.sobram > 0 && grande ? ` · ${v.sobram} a mais` : ""}
    </span>
  );
}

/** Barra fina de quanto do turno (ou do dia) já está preenchido. */
export function BarraDasVagas({ preenchidas, vagas, cor }: { preenchidas: number; vagas: number; cor: string }) {
  const pct = vagas > 0 ? Math.min(100, Math.round((preenchidas / vagas) * 100)) : 0;
  return (
    <div style={{ height: 5, borderRadius: 999, background: "#E2E8F0", overflow: "hidden" }}>
      <div className="esc-barra-cheia" style={{ width: `${pct}%`, height: "100%", background: cor, borderRadius: 999 }} />
    </div>
  );
}

/** O cartão do turno: horário, função, vagas, quem vem e os lugares vazios. Recebe gente arrastada. */
export function CartaoDoTurno({ turno, onAbrir, onSoltar, compacto = false, mostrarDiaria = false }: {
  turno: Turno; onAbrir: () => void; onSoltar?: AoSoltar; compacto?: boolean; mostrarDiaria?: boolean;
}) {
  const [alvo, setAlvo] = useState(false);
  const v = situacaoDasVagas(turno.inscritos.length, turno.vagas);
  const c = COR_DA_SITUACAO[v.estado];
  // O mesmo turno de onde a pessoa saiu não é destino (soltar ali não faz nada).
  const aceita = () => {
    const a = arrastoAtual.valor;
    if (!a || !onSoltar) return false;
    if (a.tipo === "inscricao" && a.turnoId === turno.id) return false;
    return !turno.inscritos.some((i) => i.pessoaTipo === a.pessoaTipo && i.pessoaId === a.pessoaId);
  };
  const vazias = Math.min(v.faltam, compacto ? 4 : 8);
  return (
    <div
      role="button" tabIndex={0} onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(); } }}
      onDragOver={(e) => { if (aceita()) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!alvo) setAlvo(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvo(false); }}
      onDrop={(e) => { e.preventDefault(); setAlvo(false); const a = lerArrasto(e); arrastoAtual.valor = null; if (a && onSoltar) onSoltar(turno, a); }}
      className={`esc-cartao${alvo ? " esc-alvo" : ""}`}
      style={{
        display: "block", width: "100%", textAlign: "left", cursor: "pointer", boxSizing: "border-box",
        background: "#fff", border: "1px solid #E2E8F0", borderLeft: `5px solid ${c.cor}`, borderRadius: 14,
        padding: compacto ? "10px 11px" : "14px 16px",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: compacto ? 15 : 17, color: "#0F172A", letterSpacing: -0.2 }}>{turno.inicio}–{turno.fim}</strong>
        {viraAMeiaNoite(turno.inicio, turno.fim) && <span title="Termina no dia seguinte" style={{ fontSize: 11, fontWeight: 800, color: "#64748B" }}>+1</span>}
        <span style={{ marginLeft: "auto" }}><PilulaDasVagas turno={turno} grande={!compacto} /></span>
      </div>
      <div style={{ fontSize: compacto ? 13.5 : 15, fontWeight: 800, color: COR, margin: "3px 0 8px" }}>{turno.funcao}</div>
      <BarraDasVagas preenchidas={Math.min(v.preenchidas, v.vagas)} vagas={v.vagas} cor={c.cor} />
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        {turno.inscritos.map((i) => (
          <div key={i.id} draggable={!!onSoltar}
            onDragStart={(e) => { e.stopPropagation(); comecarArrasto(e, { tipo: "inscricao", inscricaoId: i.id, turnoId: turno.id, pessoaTipo: i.pessoaTipo, pessoaId: i.pessoaId, nome: i.nome }); }}
            onDragEnd={() => { arrastoAtual.valor = null; }}
            className="esc-pessoa-no-turno"
            title={onSoltar ? "Arraste para outro turno, ou para a lista ao lado para tirar" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: compacto ? 13 : 14.5, color: "#1E293B", minWidth: 0, padding: "3px 4px", borderRadius: 8, cursor: onSoltar ? "grab" : "pointer" }}>
            <Avatar nome={i.nome} tipo={i.pessoaTipo} tamanho={compacto ? 24 : 28} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700 }}>{i.nome}</span>
            {i.origem === "link" && (compacto ? <span title="Se inscreveu pelo link" style={{ fontSize: 11, flexShrink: 0 }}>🔗</span> : <SeloDoLink />)}
            {mostrarDiaria && !compacto && i.diaria ? <span style={{ marginLeft: "auto", fontSize: 12.5, color: "#64748B" }}>{reais(i.diaria)}</span> : null}
          </div>
        ))}
        {Array.from({ length: vazias }, (_, k) => (
          <div key={`vaga-${k}`} className="esc-vaga" style={{
            display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", borderRadius: 8, fontSize: compacto ? 12.5 : 13.5, fontWeight: 700, color: c.cor,
          }}>
            <span style={{ width: compacto ? 24 : 28, height: compacto ? 24 : 28, borderRadius: "50%", border: `2px dashed ${c.borda}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 14 }}>+</span>
            Vaga aberta
          </div>
        ))}
        {v.faltam > vazias && <div style={{ fontSize: 12, color: c.cor, fontWeight: 800, paddingLeft: 4 }}>+{v.faltam - vazias} vagas abertas</div>}
      </div>
      {turno.obs && <div style={{ marginTop: 8, fontSize: compacto ? 12 : 13, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: compacto ? "nowrap" : "normal" }}>📝 {turno.obs}</div>}
    </div>
  );
}

// ── Dia ─────────────────────────────────────────────────────────────────────

export function VisaoDoDia({ data, hoje, turnos, onAbrir, onNovo, onSoltar, mostrarDiaria }: {
  data: string; hoje: string; turnos: Turno[]; onAbrir: (t: Turno) => void; onNovo: () => void; onSoltar: AoSoltar; mostrarDiaria: boolean;
}) {
  const doDia = turnos.filter((t) => t.data === data).sort((a, b) => a.inicio.localeCompare(b.inicio));
  // Quem vem, uma linha por pessoa (a mesma pessoa em dois turnos aparece com os dois horários).
  const vem = new Map<string, { nome: string; tipo: Turno["inscritos"][number]["pessoaTipo"]; horarios: string[] }>();
  for (const t of doDia) {
    for (const i of t.inscritos) {
      const k = `${i.pessoaTipo}:${i.pessoaId}`;
      const p = vem.get(k) || { nome: i.nome, tipo: i.pessoaTipo, horarios: [] };
      p.horarios.push(`${t.funcao} · ${horarioDoTurno(t.inicio, t.fim)}`);
      vem.set(k, p);
    }
  }
  const faltam = doDia.reduce((s, t) => s + situacaoDasVagas(t.inscritos.length, t.vagas).faltam, 0);
  return (
    <div className="esc-dia">
      <div style={{ ...S.cartao, background: `linear-gradient(135deg, ${COR_CLARA}, #fff)`, borderColor: "#99F6E4" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ ...S.h2, fontSize: 20, color: COR }}>{data === hoje ? "Hoje vem" : "Neste dia vêm"}</h2>
          <span style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>{vem.size} pessoa{vem.size === 1 ? "" : "s"}</span>
          {faltam > 0 && <span style={{ ...S.chip, color: "#B91C1C", background: "#FEE2E2" }}>faltam {faltam}</span>}
        </div>
        {vem.size === 0 ? (
          <p style={{ ...S.texto, marginTop: 6 }}>Ninguém escalado ainda.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10, marginTop: 12 }}>
            {[...vem.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((p) => (
              <div key={p.nome + p.horarios.join()} className="esc-entra" style={{ background: "#fff", border: "1px solid #CCFBF1", borderRadius: 14, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                <Avatar nome={p.nome} tipo={p.tipo} tamanho={38} />
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontSize: 15, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nome}</strong>
                  {p.horarios.map((h) => <div key={h} style={{ fontSize: 12.5, color: "#475569" }}>{h}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, marginTop: 16 }}>
        {doDia.map((t) => <div key={t.id} className="esc-entra"><CartaoDoTurno turno={t} onAbrir={() => onAbrir(t)} onSoltar={onSoltar} mostrarDiaria={mostrarDiaria} /></div>)}
        <button type="button" onClick={onNovo} className="esc-novo" style={{ minHeight: 120, border: "2px dashed #CBD5E1", borderRadius: 14, background: "none", color: "#64748B", fontWeight: 800, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
          + Novo turno neste dia
        </button>
      </div>
    </div>
  );
}

// ── Semana ──────────────────────────────────────────────────────────────────

export function VisaoDaSemana({ data, hoje, turnos, onAbrir, onNovo, onDia, onSoltar }: {
  data: string; hoje: string; turnos: Turno[]; onAbrir: (t: Turno) => void; onNovo: (data: string) => void; onDia: (data: string) => void; onSoltar: AoSoltar;
}) {
  const dias = diasDaSemanaDe(data);
  return (
    <div className="esc-semana">
      {dias.map((d) => {
        const doDia = turnos.filter((t) => t.data === d).sort((a, b) => a.inicio.localeCompare(b.inicio));
        const ehHoje = d === hoje;
        const passou = d < hoje;
        let vagas = 0, preenchidas = 0;
        for (const t of doDia) { const v = situacaoDasVagas(t.inscritos.length, t.vagas); vagas += v.vagas; preenchidas += Math.min(v.preenchidas, v.vagas); }
        const corDoDia = vagas === 0 ? "#CBD5E1" : preenchidas >= vagas ? "#047857" : preenchidas === 0 ? "#DC2626" : "#B45309";
        return (
          <div key={d} className="esc-coluna" style={{
            background: ehHoje ? COR_CLARA : "#F8FAFC", border: `1px solid ${ehHoje ? "#5EEAD4" : "#E2E8F0"}`, boxShadow: ehHoje ? "0 0 0 3px rgba(20,184,166,.15)" : "none",
            borderRadius: 16, padding: 10, display: "flex", flexDirection: "column", gap: 10, minWidth: 0, opacity: passou ? 0.72 : 1,
          }}>
            <button type="button" onClick={() => onDia(d)} title="Ver o dia" className="esc-cabeca-do-dia" style={{ border: 0, background: "none", cursor: "pointer", textAlign: "left", padding: "2px 4px 0", fontFamily: "inherit" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: ehHoje ? COR : "#64748B", textTransform: "uppercase", letterSpacing: 0.4 }}>{NOMES_CURTOS_DOS_DIAS[diaDaSemana(d)]}{ehHoje ? " · hoje" : ""}</span>
                {vagas > 0 && <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: corDoDia }}>{preenchidas}/{vagas}</span>}
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#0F172A", letterSpacing: -0.3, marginBottom: 6 }}>{diaEMes(d)}</div>
              <BarraDasVagas preenchidas={preenchidas} vagas={vagas} cor={corDoDia} />
            </button>
            {doDia.map((t) => <div key={t.id} className="esc-entra"><CartaoDoTurno turno={t} compacto onAbrir={() => onAbrir(t)} onSoltar={onSoltar} /></div>)}
            <button type="button" onClick={() => onNovo(d)} className="esc-novo" style={{ border: "1.5px dashed #CBD5E1", borderRadius: 12, background: "none", color: "#94A3B8", fontWeight: 800, fontSize: 13.5, cursor: "pointer", padding: "10px 0", fontFamily: "inherit", marginTop: doDia.length ? 0 : 4 }}>+ turno</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Mês ─────────────────────────────────────────────────────────────────────

export function VisaoDoMes({ data, hoje, turnos, onDia }: { data: string; hoje: string; turnos: Turno[]; onDia: (data: string) => void }) {
  const mes = data.slice(0, 7);
  return (
    <div className="esc-mes-rolagem">
      <div className="esc-mes">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((n) => (
          <div key={n} style={{ fontSize: 13, fontWeight: 900, color: "#64748B", textAlign: "center", padding: "4px 0", textTransform: "uppercase", letterSpacing: 0.4 }}>{n}</div>
        ))}
        {semanasDoMes(data).flat().map((d) => {
          const doDia = turnos.filter((t) => t.data === d).sort((a, b) => a.inicio.localeCompare(b.inicio));
          const fora = d.slice(0, 7) !== mes;
          let vagas = 0, preenchidas = 0, faltam = 0;
          for (const t of doDia) { const v = situacaoDasVagas(t.inscritos.length, t.vagas); vagas += v.vagas; preenchidas += Math.min(v.preenchidas, v.vagas); faltam += v.faltam; }
          const corDoDia = vagas === 0 ? "#CBD5E1" : faltam === 0 ? "#047857" : preenchidas === 0 ? "#DC2626" : "#B45309";
          return (
            <button key={d} type="button" onClick={() => onDia(d)} disabled={fora} className={fora ? "" : "esc-dia-do-mes"} style={{
              minHeight: 130, textAlign: "left", verticalAlign: "top", fontFamily: "inherit", cursor: fora ? "default" : "pointer",
              background: d === hoje ? COR_CLARA : fora ? "#F8FAFC" : "#fff", opacity: fora ? 0.45 : d < hoje ? 0.75 : 1,
              border: `1px solid ${d === hoje ? "#5EEAD4" : "#E2E8F0"}`, boxShadow: d === hoje ? "0 0 0 3px rgba(20,184,166,.15)" : "none",
              borderRadius: 12, padding: 8, display: "flex", flexDirection: "column", gap: 4,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <strong style={{ fontSize: 16, color: d === hoje ? COR : "#0F172A" }}>{Number(d.slice(8, 10))}</strong>
                {faltam > 0 && !fora && <span title={`Faltam ${faltam}`} style={{ marginLeft: "auto", fontSize: 11, fontWeight: 900, color: "#fff", background: "#DC2626", borderRadius: 999, padding: "1px 7px" }}>faltam {faltam}</span>}
                {faltam === 0 && vagas > 0 && !fora && <span title="Tudo preenchido" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 900, color: "#047857" }}>✓</span>}
              </div>
              {!fora && vagas > 0 && <BarraDasVagas preenchidas={preenchidas} vagas={vagas} cor={corDoDia} />}
              {!fora && doDia.slice(0, 5).map((t) => {
                const c = COR_DA_SITUACAO[situacaoDasVagas(t.inscritos.length, t.vagas).estado];
                return (
                  <div key={t.id} style={{ fontSize: 11.5, fontWeight: 700, color: c.cor, background: c.fundo, borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.inicio} {t.funcao} {t.inscritos.length}/{t.vagas}
                  </div>
                );
              })}
              {!fora && doDia.length > 5 && <div style={{ fontSize: 11, color: "#64748B", fontWeight: 700 }}>+{doDia.length - 5} turnos</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const CSS_DO_CALENDARIO = `
.esc-semana { display: grid; grid-template-columns: repeat(7, minmax(190px, 1fr)); gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.esc-semana .esc-coluna { min-height: calc(100vh - 360px); }
.esc-mes-rolagem { overflow-x: auto; }
.esc-mes { display: grid; grid-template-columns: repeat(7, minmax(110px, 1fr)); gap: 8px; min-width: 720px; }
.esc-cartao { transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
.esc-cartao:hover { border-color: #5EEAD4 !important; box-shadow: 0 8px 22px rgba(15,118,110,.14); transform: translateY(-2px); }
.esc-cartao:focus-visible { outline: 3px solid #5EEAD4; outline-offset: 2px; }
.esc-cartao.esc-alvo { border-color: ${COR} !important; background: ${COR_CLARA} !important; box-shadow: 0 0 0 3px rgba(20,184,166,.35), 0 10px 26px rgba(15,118,110,.18); transform: scale(1.02); }
.esc-pessoa-no-turno:hover { background: #F1F5F9; }
.esc-pessoa-no-turno:active { cursor: grabbing; }
.esc-vaga { opacity: .85; }
.esc-cartao:hover .esc-vaga, .esc-cartao.esc-alvo .esc-vaga { opacity: 1; }
.esc-novo { transition: color .15s, border-color .15s, background .15s; }
.esc-novo:hover { color: ${COR} !important; border-color: #5EEAD4 !important; background: ${COR_CLARA} !important; }
.esc-cabeca-do-dia:hover { opacity: .8; }
.esc-dia-do-mes { transition: transform .15s ease, box-shadow .15s ease; }
.esc-dia-do-mes:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(15,23,42,.10); border-color: #5EEAD4 !important; }
.esc-barra-cheia { transition: width .5s cubic-bezier(.2,.8,.2,1); }
@keyframes esc-entra { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.esc-entra { animation: esc-entra .28s ease both; }
@media (prefers-reduced-motion: reduce) { .esc-entra, .esc-cartao, .esc-barra-cheia, .esc-dia-do-mes { animation: none; transition: none; } .esc-cartao:hover, .esc-dia-do-mes:hover { transform: none; } }
`;
