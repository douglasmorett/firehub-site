"use client";

/**
 * A SEMANA (dias × horários, cada célula com a ocupação) e o MÊS (calendário:
 * reservas e pessoas por dia, a cor pelo horário mais cheio). Clicar abre o dia.
 */
import { CalendarX2, MoveRight } from "lucide-react";
import { NOMES_DOS_DIAS, diaDaSemana } from "@/lib/reservas/regras";
import { BORDA, CALHA, COR, COR_BORDA, COR_CLARA, TINTA, TINTA_2, TINTA_3, Vazio, cartao, corDaOcupacao, h2, micro, nomeDoMes, texto, type Dados } from "./comum";
import { LegendaDaOcupacao } from "./VisaoDoDia";

const DIAS_CURTOS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const LISTRADO = "repeating-linear-gradient(135deg,#F8FAFC 0 6px,#EEF2F7 6px 12px)";

const CSS = `
.rsv-semana td,.rsv-semana th{padding:0}
.rsv-semana__celula{height:clamp(38px,5.2vh,56px)}
.rsv-mes__celula{min-height:clamp(78px,11vh,140px)}
@container rsv (max-width:640px){.rsv-mes__pessoas{display:none}.rsv-mes__celula{min-height:62px;padding:6px!important}}
`;

export function VisaoDaSemana({ dados, onDia }: { dados: Dados; onDia: (d: string) => void }) {
  const semana = dados.semana || [];
  const cap = dados.config?.maxReservasSimultaneas || 1;
  const horas = [...new Set(semana.flatMap((d) => d.horarios.map((h) => h.hora)))].sort();
  const totalReservas = semana.reduce((t, d) => t + d.reservas, 0);
  const totalPessoas = semana.reduce((t, d) => t + d.pessoas, 0);
  return (
    <section style={cartao} className="rsv-entra">
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: "1 1 280px" }}>
          <h2 style={h2}>Semana de {semana[0] && dm(semana[0].data)} a {semana[6] && dm(semana[6].data)}</h2>
          <p style={{ ...texto, fontSize: 13, marginTop: 3 }}>Cada quadrado: reservas na mesa naquele horário, de {cap}. Toque para abrir o dia.</p>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          <div><div style={micro}>Reservas</div><div style={{ font: "900 24px/1.1 Inter, system-ui, sans-serif", color: TINTA, fontVariantNumeric: "tabular-nums" }}>{totalReservas}</div></div>
          <div><div style={micro}>Pessoas</div><div style={{ font: "900 24px/1.1 Inter, system-ui, sans-serif", color: TINTA, fontVariantNumeric: "tabular-nums" }}>{totalPessoas}</div></div>
        </div>
      </div>
      {!horas.length ? (
        <Vazio icone={CalendarX2} titulo="Nenhum dia desta semana aceita reserva">Ligue os dias e os horários em Configurar.</Vazio>
      ) : (
        <div className="rsv-rolagem">
          <table className="rsv-semana" style={{ borderCollapse: "separate", borderSpacing: 5, minWidth: 720, width: "100%", tableLayout: "fixed" }}>
            <colgroup><col style={{ width: 62 }} />{semana.map((d) => <col key={d.data} />)}</colgroup>
            <thead>
              <tr>
                <th />
                {semana.map((d) => {
                  const hoje = d.data === dados.hoje;
                  return (
                    <th key={d.data}>
                      <button type="button" onClick={() => onDia(d.data)} className="rsv-celula"
                        style={{ width: "100%", padding: "8px 6px", borderRadius: 12, border: `1px solid ${hoje ? COR_BORDA : "transparent"}`, background: hoje ? COR_CLARA : "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
                        <div style={{ font: "800 11px/1.2 Inter, system-ui, sans-serif", letterSpacing: ".08em", textTransform: "uppercase", color: hoje ? COR : TINTA_3 }}>{DIAS_CURTOS[diaDaSemana(d.data)]}{hoje ? " · hoje" : ""}</div>
                        <div style={{ font: "900 18px/1.2 Inter, system-ui, sans-serif", color: hoje ? COR : TINTA, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{dm(d.data)}</div>
                        <div style={{ font: "500 12px/1.3 Inter, system-ui, sans-serif", color: TINTA_3, marginTop: 2 }}>{d.reservas} res. · {d.pessoas} pes.</div>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {horas.map((hora) => (
                <tr key={hora}>
                  <td style={{ font: "800 13px/1 Inter, system-ui, sans-serif", color: TINTA_2, fontVariantNumeric: "tabular-nums", textAlign: "right", paddingRight: 6 }}>{hora}</td>
                  {semana.map((d) => {
                    const h = d.horarios.find((x) => x.hora === hora);
                    if (!h) return <td key={d.data}><div className="rsv-semana__celula" style={{ background: LISTRADO, borderRadius: 10 }} title="Não aceita reserva neste horário" /></td>;
                    const c = corDaOcupacao(h.ocupadas / cap, h.semVaga);
                    const marcado = h.ocupadas || h.semVaga;
                    return (
                      <td key={d.data}>
                        <button type="button" className="rsv-celula rsv-semana__celula" onClick={() => onDia(d.data)} title={`${DIAS_CURTOS[diaDaSemana(d.data)]} ${dm(d.data)} ${hora}: ${h.ocupadas} de ${cap} reservas · ${h.pessoas} pessoas · ${c.rotulo}`}
                          style={{ position: "relative", width: "100%", borderRadius: 10, border: `1px solid ${marcado ? c.borda : BORDA}`, background: marcado ? c.fundo : h.livre ? "#fff" : CALHA, color: marcado ? c.cor : TINTA_3, font: "800 13px/1 Inter, system-ui, sans-serif", cursor: "pointer", fontVariantNumeric: "tabular-nums", overflow: "hidden" }}>
                          {h.ocupadas ? `${h.ocupadas}/${cap}` : "·"}
                          {h.ocupadas > 0 && <i aria-hidden style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${Math.min(1, h.ocupadas / cap) * 100}%`, background: c.barra }} />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {horas.length > 0 && <div style={{ marginTop: 14 }}><LegendaDaOcupacao /></div>}
    </section>
  );
}

export function VisaoDoMes({ dados, onDia }: { dados: Dados; onDia: (d: string) => void }) {
  const dias = dados.calendario || [];
  const cap = dados.config?.maxReservasSimultaneas || 1;
  if (!dias.length) return null;
  const vazios = diaDaSemana(dias[0].data);
  const total = dias.reduce((t, d) => t + d.reservas, 0);
  const pessoas = dias.reduce((t, d) => t + d.pessoas, 0);
  const comReserva = dias.filter((d) => d.reservas > 0).length;
  const lotados = dias.filter((d) => d.aceita && d.pico >= cap).length;
  const maisCheio = dias.reduce<(typeof dias)[number] | null>((m, d) => (d.reservas > (m?.reservas || 0) ? d : m), null);
  const porDiaDaSemana = DIAS_CURTOS.map((_, i) => dias.filter((d) => diaDaSemana(d.data) === i).reduce((t, d) => t + d.reservas, 0));
  const maxSemana = Math.max(1, ...porDiaDaSemana);
  return (
    <div className="rsv-duas rsv-entra">
      <style>{CSS}</style>
      <section style={cartao}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={h2}>{nomeDoMes(dias[0].data.slice(0, 7)).replace(/^./, (c) => c.toUpperCase())}</h2>
          <p style={{ ...texto, fontSize: 13, marginTop: 3 }}>A cor é o horário mais cheio do dia; a barrinha, o quanto ele encheu. Toque num dia para abrir.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 6 }}>
          {DIAS_CURTOS.map((d) => <div key={d} style={{ ...micro, textAlign: "center", paddingBottom: 4 }}>{d}</div>)}
          {Array.from({ length: vazios }, (_, i) => <div key={`v${i}`} />)}
          {dias.map((d) => {
            const c = corDaOcupacao(d.pico / cap, d.pico >= cap);
            const hoje = d.data === dados.hoje, escolhido = d.data === dados.data;
            return (
              <button key={d.data} type="button" className="rsv-celula rsv-mes__celula" onClick={() => onDia(d.data)}
                title={`${NOMES_DOS_DIAS[diaDaSemana(d.data)]} ${dm(d.data)}: ${d.reservas} reservas, ${d.pessoas} pessoas${d.aceita ? `, horário mais cheio ${d.pico}/${cap}` : " (não aceita reserva)"}`}
                style={{
                  borderRadius: 12, padding: "8px 10px", textAlign: "left", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 3, minWidth: 0, overflow: "hidden",
                  border: escolhido ? `2px solid ${COR}` : `1px solid ${d.reservas ? c.borda : BORDA}`,
                  background: !d.aceita ? LISTRADO : d.reservas ? c.fundo : "#fff",
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ font: "900 15px/1 Inter, system-ui, sans-serif", color: hoje ? "#fff" : TINTA, background: hoje ? COR : "transparent", borderRadius: 99, minWidth: hoje ? 24 : 0, height: 24, display: "inline-grid", placeItems: "center", padding: hoje ? "0 6px" : 0, fontVariantNumeric: "tabular-nums" }}>{Number(d.data.slice(8, 10))}</span>
                </span>
                {d.reservas > 0 ? (<>
                  <span style={{ font: "800 13px/1.2 Inter, system-ui, sans-serif", color: TINTA, marginTop: "auto" }}>{d.reservas} res.</span>
                  <span className="rsv-mes__pessoas" style={{ font: "500 12px/1.2 Inter, system-ui, sans-serif", color: TINTA_2 }}>{d.pessoas} pessoas</span>
                  <i aria-hidden style={{ height: 4, borderRadius: 2, background: "rgba(15,23,42,.08)", position: "relative", overflow: "hidden" }}>
                    <i style={{ position: "absolute", inset: 0, width: `${Math.max(10, Math.min(1, d.pico / cap) * 100)}%`, background: c.barra, borderRadius: 2 }} />
                  </i>
                </>) : (
                  <span style={{ font: "500 12px/1.2 Inter, system-ui, sans-serif", color: TINTA_3, marginTop: "auto" }}>{d.aceita ? "livre" : "fechado"}</span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 14 }}><LegendaDaOcupacao /></div>
      </section>

      <aside aria-label="Resumo do mês">
        <section style={cartao}>
          <h2 style={{ ...h2, fontSize: 16 }}>Resumo do mês</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
            {[["Reservas", total], ["Pessoas", pessoas], ["Dias com reserva", comReserva], ["Dias lotados", lotados]].map(([r, v]) => (
              <div key={r as string}>
                <div style={micro}>{r}</div>
                <div style={{ font: "900 26px/1.1 Inter, system-ui, sans-serif", letterSpacing: "-.02em", color: r === "Dias lotados" && Number(v) > 0 ? "#B71C1C" : TINTA, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
          {maisCheio && (
            <button type="button" onClick={() => onDia(maisCheio.data)} className="rsv-linha-btn"
              style={{ width: "100%", marginTop: 16, padding: 12, borderRadius: 12, border: `1px solid ${BORDA}`, background: CALHA, textAlign: "left", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1 }}>
                <span style={{ ...micro, display: "block" }}>Dia mais cheio</span>
                <span style={{ font: "800 15px/1.4 Inter, system-ui, sans-serif", color: TINTA }}>{NOMES_DOS_DIAS[diaDaSemana(maisCheio.data)]}, {dm(maisCheio.data)} · {maisCheio.reservas} reservas</span>
              </span>
              <MoveRight size={16} color={TINTA_3} aria-hidden />
            </button>
          )}
        </section>
        <section style={cartao}>
          <h2 style={{ ...h2, fontSize: 16 }}>Por dia da semana</h2>
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {porDiaDaSemana.map((q, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "34px minmax(0,1fr) 28px", gap: 10, alignItems: "center" }}>
                <span style={{ font: "800 12.5px/1 Inter, system-ui, sans-serif", color: TINTA_2 }}>{DIAS_CURTOS[i]}</span>
                <i aria-hidden style={{ height: 10, borderRadius: 99, background: "#EEF2F7", position: "relative", overflow: "hidden" }}>
                  <i style={{ position: "absolute", inset: 0, width: `${(q / maxSemana) * 100}%`, background: q === maxSemana && q > 0 ? COR : "#475569", borderRadius: 99 }} />
                </i>
                <b style={{ font: "800 13px/1 Inter, system-ui, sans-serif", color: TINTA, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{q}</b>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
