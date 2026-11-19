"use client";

/**
 * CONFIGURAR as reservas: os dias e as faixas de horário de chegada, a duração
 * média, quantas reservas (e pessoas) cabem ao mesmo tempo, antecedência,
 * tamanho do grupo e o texto da confirmação — com a prévia de como o robô
 * confirma e quantos horários isso dá por dia.
 *
 * Em tela larga: a configuração à esquerda e, à direita (fixa na rolagem), a
 * prévia do WhatsApp, o resumo e o interruptor do módulo (`lado`).
 */
import { useState, type ReactNode } from "react";
import { Copy, Minus, Plus, X } from "lucide-react";
import { Balao } from "@/components/ilustracoes/aparelhos";
import { NOMES_DOS_DIAS, horariosDoDia, textoDeMinutos, type ConfigDasReservas } from "@/lib/reservas/regras";
import { confirmacaoParaOCliente } from "@/lib/reservas/robo";
import { BORDA, Botao, CALHA, CARVAO, TINTA, TINTA_2, TINTA_3, cartao, h2, texto } from "./comum";

const campo: React.CSSProperties = { height: 44, padding: "0 12px", borderRadius: 10, border: "1px solid #7C8DA5", fontSize: 16, fontFamily: "inherit", fontWeight: 500, color: TINTA, background: "#fff", boxSizing: "border-box" };

function Passador({ valor, onMudar, min = 1, max = 500, passo = 1, sufixo, rotulo }: { valor: number; onMudar: (v: number) => void; min?: number; max?: number; passo?: number; sufixo?: string; rotulo: string }) {
  const b: React.CSSProperties = { width: 44, height: 44, display: "grid", placeItems: "center", border: "none", background: "transparent", color: TINTA, cursor: "pointer" };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid #7C8DA5", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
        <button type="button" style={b} aria-label={`Diminuir ${rotulo}`} onClick={() => onMudar(Math.max(min, valor - passo))}><Minus size={18} /></button>
        <input type="number" value={valor} min={min} max={max} aria-label={rotulo} onChange={(e) => onMudar(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
          style={{ width: 64, height: 44, border: "none", borderLeft: `1px solid ${BORDA}`, borderRight: `1px solid ${BORDA}`, borderRadius: 0, textAlign: "center", font: "900 18px/1 Inter, system-ui, sans-serif", color: TINTA, fontVariantNumeric: "tabular-nums", outlineOffset: -2 }} />
        <button type="button" style={b} aria-label={`Aumentar ${rotulo}`} onClick={() => onMudar(Math.min(max, valor + passo))}><Plus size={18} /></button>
      </div>
      {sufixo && <span style={{ font: "800 14px/1 Inter, system-ui, sans-serif", color: TINTA_2 }}>{sufixo}</span>}
    </div>
  );
}

function Item({ titulo, ajuda, children, destaque }: { titulo: string; ajuda: string; children: ReactNode; destaque?: boolean }) {
  return (
    <div style={{ display: "grid", gap: 8, alignContent: "start", padding: 16, borderRadius: 14, border: `1px solid ${destaque ? "#FFD3C2" : BORDA}`, background: destaque ? "#FFF4EF" : "#fff" }}>
      <b style={{ font: "800 15px/1.3 Inter, system-ui, sans-serif", color: TINTA }}>{titulo}</b>
      {children}
      <span style={{ font: "500 13px/1.45 Inter, system-ui, sans-serif", color: TINTA_3 }}>{ajuda}</span>
    </div>
  );
}

export function Configuracao({ inicial, configurado, salvando, onSalvar, lado, rodape }: {
  inicial: ConfigDasReservas; configurado: boolean; salvando: boolean; onSalvar: (c: ConfigDasReservas) => void; lado?: ReactNode; rodape?: ReactNode;
}) {
  const [c, setC] = useState<ConfigDasReservas>(inicial);
  const mudou = JSON.stringify(c) !== JSON.stringify(inicial);
  const mudar = <K extends keyof ConfigDasReservas>(k: K, v: ConfigDasReservas[K]) => setC((x) => ({ ...x, [k]: v }));
  const mudarDia = (i: number, d: ConfigDasReservas["dias"][number]) => setC((x) => ({ ...x, dias: x.dias.map((y, j) => (j === i ? d : y)) }));
  // Um sábado qualquer para a prévia (21/11/2026 é sábado).
  const SABADO = "2026-11-21";
  const horariosNoSabado = horariosDoDia(c, SABADO).length;
  const diasAbertos = c.dias.filter((d) => d.ativo).length;

  return (
    <div style={{ display: "grid", gap: 20 }} className="rsv-entra">
      <div className="rsv-duas">
        <div style={{ display: "grid", gap: 20, minWidth: 0 }}>
          {!configurado && (
            <div className="fh-aviso fh-aviso--atencao" style={{ borderLeftWidth: 1 }}>
              Confira os horários abaixo e salve: é o que o robô usa para aceitar ou recusar reserva. Já deixamos um começo (jantar de quinta a domingo).
            </div>
          )}

          <section style={cartao}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <div style={{ flex: "1 1 260px" }}>
                <h2 style={h2}>Quando a loja aceita reserva</h2>
                <p style={{ ...texto, fontSize: 13, marginTop: 3 }}>Os horários de <b style={{ color: TINTA_2 }}>chegada</b> aceitos em cada dia. Pode ter duas faixas (almoço e jantar). {diasAbertos} de 7 dias abertos.</p>
              </div>
              <Botao pequeno tipo="secundario" onClick={() => setC((x) => ({ ...x, dias: x.dias.map(() => ({ ...x.dias.find((d) => d.ativo) || { ativo: true, faixas: [{ de: "19:00", ate: "22:00" }] }, ativo: true })) }))}>
                <Copy size={15} aria-hidden /> Copiar para todos os dias
              </Botao>
            </div>
            <div style={{ display: "grid", border: `1px solid ${BORDA}`, borderRadius: 14, overflow: "hidden" }}>
              {c.dias.map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", minHeight: 64, padding: "10px 14px", borderTop: i ? `1px solid ${BORDA}` : "none", background: d.ativo ? "#fff" : CALHA }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 12, width: 150, cursor: "pointer" }}>
                    <span className="fh-sw-caixa">
                      <input type="checkbox" checked={d.ativo} aria-label={`Aceitar reserva ${NOMES_DOS_DIAS[i]}`}
                        onChange={(e) => mudarDia(i, { ativo: e.target.checked, faixas: d.faixas.length ? d.faixas : [{ de: "19:00", ate: "22:00" }] })} />
                      <span className="fh-sw" data-on={d.ativo ? "true" : "false"}><i /></span>
                    </span>
                    <span style={{ font: "800 15px/1 Inter, system-ui, sans-serif", color: d.ativo ? TINTA : TINTA_3 }}>{NOMES_DOS_DIAS[i]}</span>
                  </label>
                  {d.ativo ? (<>
                    {d.faixas.map((f, k) => (
                      <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: CALHA, border: `1px solid ${BORDA}`, borderRadius: 12, padding: 4 }}>
                        <input type="time" value={f.de} step={300} aria-label="Primeiro horário" style={{ ...campo, height: 38, padding: "0 8px", fontVariantNumeric: "tabular-nums" }}
                          onChange={(e) => mudarDia(i, { ...d, faixas: d.faixas.map((x, j) => (j === k ? { ...x, de: e.target.value } : x)) })} />
                        <span style={{ color: TINTA_3, font: "800 13px/1 Inter, system-ui, sans-serif" }}>até</span>
                        <input type="time" value={f.ate} step={300} aria-label="Último horário" style={{ ...campo, height: 38, padding: "0 8px", fontVariantNumeric: "tabular-nums" }}
                          onChange={(e) => mudarDia(i, { ...d, faixas: d.faixas.map((x, j) => (j === k ? { ...x, ate: e.target.value } : x)) })} />
                        {d.faixas.length > 1 && (
                          <button type="button" aria-label="Tirar faixa" onClick={() => mudarDia(i, { ...d, faixas: d.faixas.filter((_, j) => j !== k) })}
                            style={{ width: 32, height: 32, display: "grid", placeItems: "center", border: "none", borderRadius: 8, background: "none", color: "#B71C1C", cursor: "pointer" }}><X size={16} /></button>
                        )}
                      </span>
                    ))}
                    {d.faixas.length < 3 && (
                      <Botao pequeno tipo="fantasma" onClick={() => mudarDia(i, { ...d, faixas: [...d.faixas, { de: "11:30", ate: "14:00" }] })}><Plus size={15} aria-hidden /> faixa</Botao>
                    )}
                  </>) : <span style={{ color: TINTA_3, font: "500 14px/1 Inter, system-ui, sans-serif" }}>não aceita reserva</span>}
                </div>
              ))}
            </div>
          </section>

          <section style={cartao}>
            <h2 style={h2}>Capacidade e regras</h2>
            <p style={{ ...texto, fontSize: 13, marginTop: 3, marginBottom: 16 }}>O que o robô confere antes de confirmar uma reserva.</p>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}>
              <Item destaque titulo="Quantas reservas ao mesmo tempo" ajuda="É o coração do módulo: com 10, a 11ª reserva que pegaria a mesma hora o robô recusa e oferece outro horário.">
                <Passador rotulo="reservas ao mesmo tempo" valor={c.maxReservasSimultaneas} onMudar={(v) => mudar("maxReservasSimultaneas", v)} sufixo="reservas" />
              </Item>
              <Item titulo="Quanto tempo dura uma reserva" ajuda="A mesa fica ocupada por esse tempo a partir da chegada. Reserva das 19:00 com 2h ainda conta às 20:30.">
                <select value={c.duracaoMin} onChange={(e) => mudar("duracaoMin", Number(e.target.value))} style={campo}>
                  {[60, 90, 120, 150, 180, 240].map((m) => <option key={m} value={m}>{textoDeMinutos(m)}</option>)}
                </select>
              </Item>
              <Item titulo="Limite de pessoas ao mesmo tempo (opcional)" ajuda="Para o salão não passar de tantas pessoas de reserva. Vazio = só conta reservas.">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="number" min={0} value={c.maxPessoasSimultaneas ?? ""} placeholder="sem limite"
                    onChange={(e) => mudar("maxPessoasSimultaneas", Number(e.target.value) > 0 ? Number(e.target.value) : null)} style={{ ...campo, width: 140 }} />
                  <span style={{ font: "800 14px/1 Inter, system-ui, sans-serif", color: TINTA_2 }}>pessoas</span>
                </div>
              </Item>
              <Item titulo="Horários oferecidos de quanto em quanto" ajuda="18:00, 18:30, 19:00… é o que o robô oferece quando o cliente pergunta.">
                <select value={c.intervaloMin} onChange={(e) => mudar("intervaloMin", Number(e.target.value))} style={campo}>
                  {[15, 20, 30, 60].map((m) => <option key={m} value={m}>a cada {m} min</option>)}
                </select>
              </Item>
              <Item titulo="Até quantas pessoas por reserva" ajuda="Grupo maior o robô passa para a equipe combinar (festa, evento).">
                <Passador rotulo="pessoas por reserva" valor={c.maxPessoasPorReserva} onMudar={(v) => mudar("maxPessoasPorReserva", v)} sufixo="pessoas" />
              </Item>
              <Item titulo="Antecedência mínima" ajuda="Quanto tempo antes o cliente precisa reservar.">
                <select value={c.antecedenciaMinimaMin} onChange={(e) => mudar("antecedenciaMinimaMin", Number(e.target.value))} style={campo}>
                  {[0, 30, 60, 120, 180, 360, 1440].map((m) => <option key={m} value={m}>{m ? textoDeMinutos(m) : "sem antecedência"}</option>)}
                </select>
              </Item>
              <Item titulo="Até quantos dias à frente" ajuda="Reserva para depois disso o robô não aceita.">
                <Passador rotulo="dias à frente" valor={c.diasNoFuturo} onMudar={(v) => mudar("diasNoFuturo", v)} min={0} max={365} sufixo="dias" />
              </Item>
              <Item titulo="Tolerância de atraso" ajuda="Vai na confirmação: “a mesa fica segurada até 15 minutos depois do horário”.">
                <select value={c.toleranciaMin} onChange={(e) => mudar("toleranciaMin", Number(e.target.value))} style={campo}>
                  {[0, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m ? `${m} minutos` : "não falar"}</option>)}
                </select>
              </Item>
            </div>
          </section>

          <section style={cartao}>
            <h2 style={h2}>Mensagem da confirmação</h2>
            <p style={{ ...texto, fontSize: 13, marginTop: 3, marginBottom: 12 }}>Vai no fim da confirmação que o robô manda. Use para as regras da casa (ex.: “Pode trazer bolo. Área kids grátis.”).</p>
            <textarea value={c.mensagemDeConfirmacao} maxLength={600} rows={4} onChange={(e) => mudar("mensagemDeConfirmacao", e.target.value)}
              placeholder="Ex.: Pode trazer o bolo! Área kids gratuita com monitora." style={{ ...campo, height: "auto", width: "100%", padding: "10px 12px", lineHeight: 1.5, resize: "vertical" }} />
            <div style={{ font: "500 12.5px/1 Inter, system-ui, sans-serif", color: TINTA_3, textAlign: "right", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{c.mensagemDeConfirmacao.length}/600</div>
          </section>

          {(mudou || !configurado) && (
            <div style={{ position: "sticky", bottom: 12, zIndex: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "space-between", background: CARVAO, color: "#fff", borderRadius: 16, padding: "12px 12px 12px 18px", boxShadow: "0 24px 64px -16px rgba(15,23,42,.45)" }}>
              <span style={{ font: "800 14.5px/1.3 Inter, system-ui, sans-serif" }}>{mudou ? "Você mudou a configuração." : "Ainda não salva."} <span style={{ fontWeight: 500, color: "#D6D3D1" }}>O robô só usa depois de salvar.</span></span>
              <div style={{ display: "flex", gap: 8 }}>
                {mudou && <button type="button" onClick={() => setC(inicial)} disabled={salvando} className="fh-btn" style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.3)" }}>Desfazer</button>}
                <Botao onClick={() => onSalvar(c)} disabled={salvando}>{salvando ? "Salvando…" : "Salvar configuração"}</Botao>
              </div>
            </div>
          )}
        </div>

        <aside aria-label="Prévia e módulo">
          <section style={{ ...cartao, display: "grid", gap: 14, justifyItems: "center" }}>
            <h2 style={{ ...h2, fontSize: 16, justifySelf: "start" }}>Como o cliente recebe</h2>
            {/* O celular de ilustracoes/aparelhos tem altura fixa: aqui a conversa cresce com o texto da loja. */}
            <div style={{ width: "100%", maxWidth: 300, borderRadius: 28, border: "8px solid #111827", overflow: "hidden", boxShadow: "0 16px 32px -12px rgba(15,23,42,.35)", background: "#ECE5DD" }}>
              <div style={{ background: "#075E54", color: "#fff", padding: "9px 12px", font: "800 13px/1.2 Inter, system-ui, sans-serif" }}>Sua loja<small style={{ display: "block", fontWeight: 500, opacity: 0.8 }}>online</small></div>
              <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, lineHeight: 1.4, color: "#111" }}>
                <Balao eu>Quero reservar sábado 20h, 4 pessoas, João</Balao>
                <Balao><span style={{ whiteSpace: "pre-line" }}>{confirmacaoParaOCliente({ nome: "João", data: SABADO, hora: "20:00", pessoas: 4 }, c)}</span></Balao>
              </div>
            </div>
            <div style={{ width: "100%", background: CALHA, border: `1px solid ${BORDA}`, borderRadius: 12, padding: 12, font: "500 13.5px/1.55 Inter, system-ui, sans-serif", color: TINTA_2 }}>
              Num sábado com estes horários: <b style={{ color: TINTA }}>{horariosNoSabado} horários de chegada</b>, até <b style={{ color: TINTA }}>{c.maxReservasSimultaneas} reservas na mesa ao mesmo tempo</b>,
              cada uma por <b style={{ color: TINTA }}>{textoDeMinutos(c.duracaoMin)}</b>.
            </div>
          </section>
          {lado}
        </aside>
      </div>
      {rodape}
    </div>
  );
}

