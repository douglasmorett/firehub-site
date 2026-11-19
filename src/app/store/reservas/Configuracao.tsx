"use client";

/**
 * CONFIGURAR as reservas: os dias e as faixas de horário de chegada, a duração
 * média, quantas reservas (e pessoas) cabem ao mesmo tempo, antecedência,
 * tamanho do grupo e o texto da confirmação — com a prévia de como o robô
 * confirma e quantos horários isso dá por dia.
 */
import { useState } from "react";
import { Balao } from "@/components/ilustracoes/aparelhos";
import { NOMES_DOS_DIAS, horariosDoDia, textoDeMinutos, type ConfigDasReservas } from "@/lib/reservas/regras";
import { confirmacaoParaOCliente } from "@/lib/reservas/robo";
import { BORDA, Botao, COR, COR_CLARA, TINTA, TINTA_2, TINTA_3, cartao, h2, texto } from "./comum";

const campo: React.CSSProperties = { padding: "9px 11px", borderRadius: 10, border: `1.5px solid #CBD5E1`, fontSize: 14, fontFamily: "inherit", color: TINTA, background: "#fff" };

function Passador({ valor, onMudar, min = 1, max = 500, passo = 1, sufixo }: { valor: number; onMudar: (v: number) => void; min?: number; max?: number; passo?: number; sufixo?: string }) {
  const b: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, border: `1px solid ${BORDA}`, background: "#fff", fontSize: 20, fontWeight: 900, color: COR, cursor: "pointer", fontFamily: "inherit" };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" style={b} aria-label="Diminuir" onClick={() => onMudar(Math.max(min, valor - passo))}>−</button>
      <input type="number" value={valor} min={min} max={max} onChange={(e) => onMudar(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        style={{ ...campo, width: 74, textAlign: "center", fontWeight: 900, fontSize: 18 }} />
      <button type="button" style={b} aria-label="Aumentar" onClick={() => onMudar(Math.min(max, valor + passo))}>+</button>
      {sufixo && <span style={{ fontWeight: 700, color: TINTA_2 }}>{sufixo}</span>}
    </div>
  );
}

function Item({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <b style={{ fontSize: 14, color: TINTA }}>{titulo}</b>
      {children}
      <span style={{ fontSize: 12.5, color: TINTA_3, lineHeight: 1.45 }}>{ajuda}</span>
    </div>
  );
}

export function Configuracao({ inicial, configurado, salvando, onSalvar }: {
  inicial: ConfigDasReservas; configurado: boolean; salvando: boolean; onSalvar: (c: ConfigDasReservas) => void;
}) {
  const [c, setC] = useState<ConfigDasReservas>(inicial);
  const mudou = JSON.stringify(c) !== JSON.stringify(inicial);
  const mudar = <K extends keyof ConfigDasReservas>(k: K, v: ConfigDasReservas[K]) => setC((x) => ({ ...x, [k]: v }));
  const mudarDia = (i: number, d: ConfigDasReservas["dias"][number]) => setC((x) => ({ ...x, dias: x.dias.map((y, j) => (j === i ? d : y)) }));
  // Um sábado qualquer para a prévia (21/11/2026 é sábado).
  const SABADO = "2026-11-21";
  const horariosNoSabado = horariosDoDia(c, SABADO).length;

  return (
    <div style={{ display: "grid", gap: 16 }} className="rsv-entra">
      {!configurado && (
        <div style={{ ...cartao, background: COR_CLARA, borderColor: "#C4B5FD", color: "#4C1D95", fontWeight: 700, fontSize: 14 }}>
          👋 Confira os horários abaixo e salve: é o que o robô usa para aceitar ou recusar reserva. Já deixamos um começo (jantar de quinta a domingo).
        </div>
      )}

      <section style={cartao}>
        <h2 style={h2}>Quando a loja aceita reserva</h2>
        <p style={{ ...texto, fontSize: 13, marginTop: 4 }}>Os horários de <b>chegada</b> aceitos em cada dia. Pode ter duas faixas (almoço e jantar).</p>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {c.dias.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", borderRadius: 12, border: `1px solid ${d.ativo ? "#C4B5FD" : BORDA}`, background: d.ativo ? "#FAF5FF" : "#fff" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, width: 120, fontWeight: 800, color: d.ativo ? TINTA : TINTA_3, cursor: "pointer" }}>
                <input type="checkbox" checked={d.ativo} style={{ width: 18, height: 18, accentColor: COR }}
                  onChange={(e) => mudarDia(i, { ativo: e.target.checked, faixas: d.faixas.length ? d.faixas : [{ de: "19:00", ate: "22:00" }] })} />
                {NOMES_DOS_DIAS[i]}
              </label>
              {d.ativo ? (<>
                {d.faixas.map((f, k) => (
                  <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: `1px solid ${BORDA}`, borderRadius: 10, padding: "4px 6px" }}>
                    <input type="time" value={f.de} step={300} aria-label="Primeiro horário" style={{ ...campo, padding: "5px 6px" }}
                      onChange={(e) => mudarDia(i, { ...d, faixas: d.faixas.map((x, j) => (j === k ? { ...x, de: e.target.value } : x)) })} />
                    <span style={{ color: TINTA_3, fontWeight: 700 }}>até</span>
                    <input type="time" value={f.ate} step={300} aria-label="Último horário" style={{ ...campo, padding: "5px 6px" }}
                      onChange={(e) => mudarDia(i, { ...d, faixas: d.faixas.map((x, j) => (j === k ? { ...x, ate: e.target.value } : x)) })} />
                    {d.faixas.length > 1 && (
                      <button type="button" aria-label="Tirar faixa" onClick={() => mudarDia(i, { ...d, faixas: d.faixas.filter((_, j) => j !== k) })}
                        style={{ border: "none", background: "none", color: "#B91C1C", fontWeight: 900, cursor: "pointer", fontSize: 16 }}>×</button>
                    )}
                  </span>
                ))}
                {d.faixas.length < 3 && (
                  <Botao tipo="fantasma" style={{ padding: "6px 8px", color: COR }} onClick={() => mudarDia(i, { ...d, faixas: [...d.faixas, { de: "11:30", ate: "14:00" }] })}>+ faixa</Botao>
                )}
              </>) : <span style={{ color: TINTA_3, fontSize: 13, fontWeight: 600 }}>não aceita reserva</span>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Botao tipo="secundario" onClick={() => setC((x) => ({ ...x, dias: x.dias.map(() => ({ ...x.dias.find((d) => d.ativo) || { ativo: true, faixas: [{ de: "19:00", ate: "22:00" }] }, ativo: true })) }))}>Copiar para todos os dias</Botao>
        </div>
      </section>

      <section style={{ ...cartao, display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <Item titulo="Quantas reservas ao mesmo tempo" ajuda="É o coração do módulo: com 10, a 11ª reserva que pegaria a mesma hora o robô recusa e oferece outro horário.">
          <Passador valor={c.maxReservasSimultaneas} onMudar={(v) => mudar("maxReservasSimultaneas", v)} sufixo="reservas" />
        </Item>
        <Item titulo="Quanto tempo dura uma reserva" ajuda="A mesa fica ocupada por esse tempo a partir da chegada. Reserva das 19:00 com 2h ainda conta às 20:30.">
          <select value={c.duracaoMin} onChange={(e) => mudar("duracaoMin", Number(e.target.value))} style={campo}>
            {[60, 90, 120, 150, 180, 240].map((m) => <option key={m} value={m}>{textoDeMinutos(m)}</option>)}
          </select>
        </Item>
        <Item titulo="Limite de pessoas ao mesmo tempo (opcional)" ajuda="Para o salão não passar de tantas pessoas de reserva. Vazio = só conta reservas.">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={0} value={c.maxPessoasSimultaneas ?? ""} placeholder="sem limite"
              onChange={(e) => mudar("maxPessoasSimultaneas", Number(e.target.value) > 0 ? Number(e.target.value) : null)} style={{ ...campo, width: 130 }} />
            <span style={{ fontWeight: 700, color: TINTA_2 }}>pessoas</span>
          </div>
        </Item>
        <Item titulo="Horários oferecidos de quanto em quanto" ajuda="18:00, 18:30, 19:00… é o que o robô oferece quando o cliente pergunta.">
          <select value={c.intervaloMin} onChange={(e) => mudar("intervaloMin", Number(e.target.value))} style={campo}>
            {[15, 20, 30, 60].map((m) => <option key={m} value={m}>a cada {m} min</option>)}
          </select>
        </Item>
        <Item titulo="Até quantas pessoas por reserva" ajuda="Grupo maior o robô passa para a equipe combinar (festa, evento).">
          <Passador valor={c.maxPessoasPorReserva} onMudar={(v) => mudar("maxPessoasPorReserva", v)} sufixo="pessoas" />
        </Item>
        <Item titulo="Antecedência mínima" ajuda="Quanto tempo antes o cliente precisa reservar.">
          <select value={c.antecedenciaMinimaMin} onChange={(e) => mudar("antecedenciaMinimaMin", Number(e.target.value))} style={campo}>
            {[0, 30, 60, 120, 180, 360, 1440].map((m) => <option key={m} value={m}>{m ? textoDeMinutos(m) : "sem antecedência"}</option>)}
          </select>
        </Item>
        <Item titulo="Até quantos dias à frente" ajuda="Reserva para depois disso o robô não aceita.">
          <Passador valor={c.diasNoFuturo} onMudar={(v) => mudar("diasNoFuturo", v)} min={0} max={365} sufixo="dias" />
        </Item>
        <Item titulo="Tolerância de atraso" ajuda="Vai na confirmação: “a mesa fica segurada até 15 minutos depois do horário”.">
          <select value={c.toleranciaMin} onChange={(e) => mudar("toleranciaMin", Number(e.target.value))} style={campo}>
            {[0, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m ? `${m} minutos` : "não falar"}</option>)}
          </select>
        </Item>
      </section>

      <section style={{ ...cartao, display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", alignItems: "start" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <h2 style={h2}>Mensagem da confirmação</h2>
          <p style={{ ...texto, fontSize: 13 }}>Vai no fim da confirmação que o robô manda. Use para as regras da casa (ex.: “Pode trazer bolo. Área kids grátis.”).</p>
          <textarea value={c.mensagemDeConfirmacao} maxLength={600} rows={5} onChange={(e) => mudar("mensagemDeConfirmacao", e.target.value)}
            placeholder="Ex.: Pode trazer o bolo! Área kids gratuita com monitora." style={{ ...campo, resize: "vertical" }} />
          <div style={{ background: "#F8FAFC", borderRadius: 12, padding: 12, fontSize: 13.5, color: TINTA_2, lineHeight: 1.55 }}>
            Num sábado com estes horários: <b>{horariosNoSabado} horários de chegada</b>, até <b>{c.maxReservasSimultaneas} reservas na mesa ao mesmo tempo</b>,
            cada uma por <b>{textoDeMinutos(c.duracaoMin)}</b>.
          </div>
        </div>
        <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
          <b style={{ fontSize: 13, color: TINTA_2 }}>Como o cliente recebe</b>
          {/* O celular de ilustracoes/aparelhos tem altura fixa: aqui a conversa cresce com o texto da loja. */}
          <div style={{ width: 260, borderRadius: 26, border: "7px solid #111827", overflow: "hidden", boxShadow: "0 14px 30px rgba(15,23,42,.22)", background: "#ECE5DD" }}>
            <div style={{ background: "#075E54", color: "#fff", padding: "8px 10px", fontWeight: 700, fontSize: 12.5 }}>Sua loja<small style={{ display: "block", fontWeight: 500, opacity: 0.8 }}>online</small></div>
            <div style={{ padding: 9, display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, lineHeight: 1.4, color: "#111" }}>
              <Balao eu>Quero reservar sábado 20h, 4 pessoas, João</Balao>
              <Balao><span style={{ whiteSpace: "pre-line" }}>{confirmacaoParaOCliente({ nome: "João", data: SABADO, hora: "20:00", pessoas: 4 }, c)}</span></Balao>
            </div>
          </div>
        </div>
      </section>

      {(mudou || !configurado) && (
        <div style={{ position: "sticky", bottom: 12, zIndex: 10, display: "flex", justifyContent: "flex-end" }}>
          <Botao onClick={() => onSalvar(c)} disabled={salvando} style={{ padding: "14px 26px", fontSize: 15, boxShadow: "0 10px 24px rgba(91,33,182,.35)" }}>
            {salvando ? "Salvando…" : "Salvar configuração"}
          </Botao>
        </div>
      )}
    </div>
  );
}
