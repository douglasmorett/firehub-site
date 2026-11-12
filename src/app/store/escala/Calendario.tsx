"use client";

/**
 * As três visões da escala: Dia (o "hoje vem fulano e sicrano"), Semana (a
 * grade de segunda a domingo, a que o Lucas monta) e Mês (o calendário, para
 * ver de longe onde falta gente). Clicar num turno abre o detalhe; clicar
 * num dia do mês abre o dia.
 */

import {
  NOMES_CURTOS_DOS_DIAS, diaDaSemana, diaEMes, diasDaSemanaDe, horarioDoTurno, semanasDoMes, situacaoDasVagas, viraAMeiaNoite,
} from "@/lib/escala-da-equipe/regras";
import { COR, COR_CLARA, COR_DA_SITUACAO, S, SeloDoLink, SeloDoTipo, reais, type Turno } from "./ui";

export function PilulaDasVagas({ turno, grande = false }: { turno: Turno; grande?: boolean }) {
  const v = situacaoDasVagas(turno.inscritos.length, turno.vagas);
  const c = COR_DA_SITUACAO[v.estado];
  return (
    <span title={c.texto} style={{ ...S.chip, color: c.cor, background: c.fundo, border: `1px solid ${c.borda}`, fontSize: grande ? 13 : 11.5, padding: grande ? "4px 10px" : "2px 8px" }}>
      {v.preenchidas}/{v.vagas}{v.faltam > 0 && grande ? ` · faltam ${v.faltam}` : ""}{v.sobram > 0 && grande ? ` · ${v.sobram} a mais` : ""}
    </span>
  );
}

/** O cartão do turno: horário, função, vagas e quem vem. */
export function CartaoDoTurno({ turno, onAbrir, compacto = false, mostrarDiaria = false }: { turno: Turno; onAbrir: () => void; compacto?: boolean; mostrarDiaria?: boolean }) {
  const v = situacaoDasVagas(turno.inscritos.length, turno.vagas);
  const c = COR_DA_SITUACAO[v.estado];
  return (
    <button type="button" onClick={onAbrir} className="esc-cartao" style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit",
      background: "#fff", border: "1px solid #E2E8F0", borderLeft: `4px solid ${c.cor}`, borderRadius: 12,
      padding: compacto ? "8px 10px" : "12px 14px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <strong style={{ fontSize: compacto ? 13 : 15, color: "#0F172A" }}>{turno.inicio}–{turno.fim}</strong>
        {viraAMeiaNoite(turno.inicio, turno.fim) && <span title="Termina no dia seguinte" style={{ fontSize: 10.5, fontWeight: 800, color: "#64748B" }}>+1</span>}
        <span style={{ marginLeft: "auto" }}><PilulaDasVagas turno={turno} grande={!compacto} /></span>
      </div>
      <div style={{ fontSize: compacto ? 12.5 : 14, fontWeight: 800, color: COR, marginTop: 2 }}>{turno.funcao}</div>
      {turno.inscritos.length > 0 ? (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
          {turno.inscritos.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: compacto ? 12 : 13.5, color: "#1E293B", minWidth: 0 }}>
              <SeloDoTipo tipo={i.pessoaTipo} compacto />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{i.nome}</span>
              {i.origem === "link" && (compacto ? <span title="Se inscreveu pelo link" style={{ fontSize: 10.5, flexShrink: 0 }}>🔗</span> : <SeloDoLink />)}
              {mostrarDiaria && !compacto && i.diaria ? <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748B" }}>{reais(i.diaria)}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 4, fontSize: 12.5, color: c.cor, fontWeight: 700 }}>Ninguém inscrito</div>
      )}
      {v.faltam > 0 && turno.inscritos.length > 0 && (
        <div style={{ marginTop: 4, fontSize: 12, color: c.cor, fontWeight: 800 }}>Falta{v.faltam > 1 ? "m" : ""} {v.faltam}</div>
      )}
      {turno.obs && !compacto && <div style={{ marginTop: 6, fontSize: 12.5, color: "#64748B" }}>📝 {turno.obs}</div>}
    </button>
  );
}

// ── Dia ─────────────────────────────────────────────────────────────────────

export function VisaoDoDia({ data, hoje, turnos, onAbrir, onNovo, mostrarDiaria }: {
  data: string; hoje: string; turnos: Turno[]; onAbrir: (t: Turno) => void; onNovo: () => void; mostrarDiaria: boolean;
}) {
  const doDia = turnos.filter((t) => t.data === data);
  // Quem vem, uma linha por pessoa (a mesma pessoa em dois turnos aparece com os dois horários).
  const vem = new Map<string, { nome: string; tipo: Turno["inscritos"][number]["pessoaTipo"]; horarios: string[] }>();
  for (const t of doDia) {
    for (const i of t.inscritos) {
      const k = `${i.pessoaTipo}:${i.pessoaId}`;
      const p = vem.get(k) || { nome: i.nome, tipo: i.pessoaTipo, horarios: [] };
      p.horarios.push(`${t.funcao} ${horarioDoTurno(t.inicio, t.fim)}`);
      vem.set(k, p);
    }
  }
  const faltam = doDia.reduce((s, t) => s + situacaoDasVagas(t.inscritos.length, t.vagas).faltam, 0);
  return (
    <div className="esc-dia">
      <div style={{ ...S.cartao, background: COR_CLARA, borderColor: "#99F6E4" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ ...S.h2, color: COR }}>{data === hoje ? "Hoje vem" : "Neste dia vêm"}</h2>
          <span style={{ fontSize: 13, color: "#475569" }}>{vem.size} pessoa{vem.size === 1 ? "" : "s"}{faltam > 0 ? ` · faltam ${faltam}` : ""}</span>
        </div>
        {vem.size === 0 ? (
          <p style={{ ...S.texto, marginTop: 6 }}>Ninguém escalado ainda.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {[...vem.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((p) => (
              <div key={p.nome + p.horarios.join()} style={{ background: "#fff", border: "1px solid #CCFBF1", borderRadius: 12, padding: "8px 12px", minWidth: 150 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}><SeloDoTipo tipo={p.tipo} compacto /><strong style={{ fontSize: 14.5 }}>{p.nome}</strong></div>
                {p.horarios.map((h) => <div key={h} style={{ fontSize: 12.5, color: "#475569", marginTop: 2 }}>{h}</div>)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 14 }}>
        {doDia.map((t) => <CartaoDoTurno key={t.id} turno={t} onAbrir={() => onAbrir(t)} mostrarDiaria={mostrarDiaria} />)}
        <button type="button" onClick={onNovo} className="esc-novo" style={{ minHeight: 96, border: "2px dashed #CBD5E1", borderRadius: 12, background: "none", color: "#64748B", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
          + Novo turno neste dia
        </button>
      </div>
    </div>
  );
}

// ── Semana ──────────────────────────────────────────────────────────────────

export function VisaoDaSemana({ data, hoje, turnos, onAbrir, onNovo, onDia }: {
  data: string; hoje: string; turnos: Turno[]; onAbrir: (t: Turno) => void; onNovo: (data: string) => void; onDia: (data: string) => void;
}) {
  const dias = diasDaSemanaDe(data);
  return (
    <div className="esc-semana">
      {dias.map((d) => {
        const doDia = turnos.filter((t) => t.data === d);
        const ehHoje = d === hoje;
        return (
          <div key={d} className="esc-coluna" style={{ background: ehHoje ? COR_CLARA : "#F8FAFC", border: `1px solid ${ehHoje ? "#99F6E4" : "#E2E8F0"}`, borderRadius: 14, padding: 8, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <button type="button" onClick={() => onDia(d)} title="Ver o dia" style={{ border: 0, background: "none", cursor: "pointer", textAlign: "left", padding: "2px 4px", fontFamily: "inherit" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: ehHoje ? COR : "#64748B", textTransform: "uppercase" }}>{NOMES_CURTOS_DOS_DIAS[diaDaSemana(d)]}{ehHoje ? " · hoje" : ""}</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: "#0F172A" }}>{diaEMes(d)}</div>
            </button>
            {doDia.map((t) => <CartaoDoTurno key={t.id} turno={t} compacto onAbrir={() => onAbrir(t)} />)}
            <button type="button" onClick={() => onNovo(d)} className="esc-novo" style={{ border: "1.5px dashed #CBD5E1", borderRadius: 10, background: "none", color: "#94A3B8", fontWeight: 800, fontSize: 13, cursor: "pointer", padding: "8px 0", fontFamily: "inherit" }}>+ turno</button>
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
          <div key={n} style={{ fontSize: 12, fontWeight: 800, color: "#64748B", textAlign: "center", padding: "4px 0" }}>{n}</div>
        ))}
        {semanasDoMes(data).flat().map((d) => {
          const doDia = turnos.filter((t) => t.data === d);
          const fora = d.slice(0, 7) !== mes;
          const faltam = doDia.reduce((s, t) => s + situacaoDasVagas(t.inscritos.length, t.vagas).faltam, 0);
          return (
            <button key={d} type="button" onClick={() => onDia(d)} disabled={fora} style={{
              minHeight: 96, textAlign: "left", verticalAlign: "top", fontFamily: "inherit", cursor: fora ? "default" : "pointer",
              background: d === hoje ? COR_CLARA : fora ? "#F8FAFC" : "#fff", opacity: fora ? 0.45 : 1,
              border: `1px solid ${d === hoje ? "#5EEAD4" : "#E2E8F0"}`, borderRadius: 10, padding: 6, display: "flex", flexDirection: "column", gap: 3,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <strong style={{ fontSize: 14, color: d === hoje ? COR : "#0F172A" }}>{Number(d.slice(8, 10))}</strong>
                {faltam > 0 && !fora && <span title={`Faltam ${faltam}`} style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 900, color: "#fff", background: "#DC2626", borderRadius: 999, padding: "0 6px" }}>-{faltam}</span>}
              </div>
              {!fora && doDia.slice(0, 4).map((t) => {
                const c = COR_DA_SITUACAO[situacaoDasVagas(t.inscritos.length, t.vagas).estado];
                return (
                  <div key={t.id} style={{ fontSize: 11, fontWeight: 700, color: c.cor, background: c.fundo, borderRadius: 6, padding: "1px 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.inicio} {t.funcao} {t.inscritos.length}/{t.vagas}
                  </div>
                );
              })}
              {!fora && doDia.length > 4 && <div style={{ fontSize: 11, color: "#64748B", fontWeight: 700 }}>+{doDia.length - 4} turnos</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const CSS_DO_CALENDARIO = `
.esc-semana { display: grid; grid-template-columns: repeat(7, minmax(150px, 1fr)); gap: 8px; overflow-x: auto; padding-bottom: 6px; }
.esc-mes-rolagem { overflow-x: auto; }
.esc-mes { display: grid; grid-template-columns: repeat(7, minmax(84px, 1fr)); gap: 6px; min-width: 620px; }
.esc-cartao:hover { border-color: #5EEAD4 !important; box-shadow: 0 4px 14px rgba(15,118,110,.10); }
.esc-novo:hover { color: ${COR} !important; border-color: #5EEAD4 !important; }
`;
