"use client";

/**
 * A SEMANA (dias × horários, cada célula com a ocupação) e o MÊS (calendário:
 * reservas e pessoas por dia, a cor pelo horário mais cheio). Clicar abre o dia.
 */
import { NOMES_DOS_DIAS, diaDaSemana } from "@/lib/reservas/regras";
import { BORDA, COR, TINTA, TINTA_2, TINTA_3, cartao, corDaOcupacao, h2, nomeDoMes, texto, type Dados } from "./comum";

const DIAS_CURTOS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function VisaoDaSemana({ dados, onDia }: { dados: Dados; onDia: (d: string) => void }) {
  const semana = dados.semana || [];
  const cap = dados.config?.maxReservasSimultaneas || 1;
  const horas = [...new Set(semana.flatMap((d) => d.horarios.map((h) => h.hora)))].sort();
  return (
    <section style={cartao} className="rsv-entra">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={h2}>Semana de {semana[0] && dm(semana[0].data)} a {semana[6] && dm(semana[6].data)}</h2>
        <span style={{ ...texto, fontSize: 13 }}>Cada quadrado: reservas na mesa naquele horário, de {cap}.</span>
      </div>
      {!horas.length ? (
        <p style={texto}>Nenhum dia desta semana aceita reserva. Ligue os dias em Configurar.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 4, minWidth: 620, width: "100%" }}>
            <thead>
              <tr>
                <th />
                {semana.map((d) => {
                  const hoje = d.data === dados.hoje;
                  return (
                    <th key={d.data} style={{ fontSize: 12.5, color: hoje ? COR : TINTA, fontWeight: 900, padding: 4 }}>
                      <button type="button" onClick={() => onDia(d.data)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: "inherit", fontWeight: 900 }}>
                        {DIAS_CURTOS[diaDaSemana(d.data)]} {dm(d.data)}{hoje ? " · hoje" : ""}
                        <div style={{ fontSize: 11, fontWeight: 700, color: TINTA_3 }}>{d.reservas} reservas · {d.pessoas} pessoas</div>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {horas.map((hora) => (
                <tr key={hora}>
                  <td style={{ fontSize: 12, fontWeight: 800, color: TINTA_2, paddingRight: 6, fontVariantNumeric: "tabular-nums" }}>{hora}</td>
                  {semana.map((d) => {
                    const h = d.horarios.find((x) => x.hora === hora);
                    if (!h) return <td key={d.data} style={{ background: "repeating-linear-gradient(135deg,#F8FAFC 0 6px,#F1F5F9 6px 12px)", borderRadius: 8, height: 34 }} title="Não aceita reserva neste horário" />;
                    const c = corDaOcupacao(h.ocupadas / cap, h.semVaga);
                    return (
                      <td key={d.data} style={{ padding: 0 }}>
                        <button type="button" className="rsv-celula" onClick={() => onDia(d.data)} title={`${DIAS_CURTOS[diaDaSemana(d.data)]} ${dm(d.data)} ${hora}: ${h.ocupadas} de ${cap} reservas · ${h.pessoas} pessoas · ${c.rotulo}`}
                          style={{ width: "100%", height: 34, borderRadius: 8, border: `1px solid ${h.ocupadas || h.semVaga ? c.cor : BORDA}`, background: h.ocupadas || h.semVaga ? c.fundo : h.livre ? "#fff" : "#F8FAFC", color: h.livre || h.ocupadas ? TINTA : TINTA_3, fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontVariantNumeric: "tabular-nums" }}>
                          {h.ocupadas ? `${h.ocupadas}/${cap}` : "·"}
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
    </section>
  );
}

export function VisaoDoMes({ dados, onDia }: { dados: Dados; onDia: (d: string) => void }) {
  const dias = dados.calendario || [];
  const cap = dados.config?.maxReservasSimultaneas || 1;
  if (!dias.length) return null;
  const vazios = diaDaSemana(dias[0].data);
  const maxReservas = Math.max(1, ...dias.map((d) => d.reservas));
  return (
    <section style={cartao} className="rsv-entra">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h2 style={h2}>{nomeDoMes(dias[0].data.slice(0, 7)).replace(/^./, (c) => c.toUpperCase())}</h2>
        <span style={{ ...texto, fontSize: 13 }}>A cor é o horário mais cheio do dia; a barrinha, quantas reservas.</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 6 }}>
        {DIAS_CURTOS.map((d) => <div key={d} style={{ fontSize: 11.5, fontWeight: 800, color: TINTA_3, textAlign: "center" }}>{d}</div>)}
        {Array.from({ length: vazios }, (_, i) => <div key={`v${i}`} />)}
        {dias.map((d) => {
          const c = corDaOcupacao(d.pico / cap, d.pico >= cap);
          const hoje = d.data === dados.hoje, escolhido = d.data === dados.data;
          return (
            <button key={d.data} type="button" className="rsv-celula" onClick={() => onDia(d.data)}
              title={`${NOMES_DOS_DIAS[diaDaSemana(d.data)]} ${dm(d.data)}: ${d.reservas} reservas, ${d.pessoas} pessoas${d.aceita ? `, horário mais cheio ${d.pico}/${cap}` : " (não aceita reserva)"}`}
              style={{
                minHeight: 74, borderRadius: 12, padding: "7px 8px", textAlign: "left", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 3,
                border: escolhido ? `2px solid ${COR}` : `1px solid ${d.reservas ? c.cor : BORDA}`,
                background: !d.aceita ? "repeating-linear-gradient(135deg,#F8FAFC 0 6px,#F1F5F9 6px 12px)" : d.reservas ? c.fundo : "#fff",
              }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: hoje ? COR : TINTA }}>{Number(d.data.slice(8, 10))}{hoje ? " · hoje" : ""}</span>
              {d.reservas > 0 ? (<>
                <span style={{ fontSize: 12, fontWeight: 800, color: TINTA }}>{d.reservas} res.</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: TINTA_2 }}>{d.pessoas} pessoas</span>
                <i style={{ marginTop: "auto", height: 4, borderRadius: 2, background: c.cor, width: `${Math.max(12, (d.reservas / maxReservas) * 100)}%` }} />
              </>) : (
                <span style={{ fontSize: 11, color: TINTA_3, fontWeight: 600 }}>{d.aceita ? "livre" : "sem reserva"}</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
