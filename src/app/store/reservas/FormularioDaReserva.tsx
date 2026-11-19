"use client";

/**
 * A janela de RESERVA MANUAL (cliente que ligou, que pediu no balcão) e de
 * MOVER o horário. O servidor confere a vaga; não coube, a janela mostra os
 * horários livres mais perto e o "Encaixar mesmo assim" (o dono decide).
 */
import { useMemo, useState } from "react";
import { dataPorExtenso, horariosDoDia, type Sugestao } from "@/lib/reservas/regras";
import { CalendarPlus, Clock, Minus, Plus, X } from "lucide-react";
import { BORDA, BORDA_FORTE, Botao, CALHA, COR, COR_BORDA, COR_CLARA, TINTA, TINTA_2, TINTA_3, corDaOcupacao, type Dados, type ReservaDaTela } from "./comum";

export type ModoDoFormulario = { tipo: "nova"; data: string; hora?: string | null } | { tipo: "mover"; reserva: ReservaDaTela };

const campo: React.CSSProperties = { width: "100%", boxSizing: "border-box", height: 46, padding: "0 12px", borderRadius: 10, border: "1px solid #7C8DA5", font: "500 16px/1.2 Inter, system-ui, sans-serif", color: TINTA, background: "#fff" };
const rotulo: React.CSSProperties = { display: "grid", gap: 6, font: "800 12px/1.2 Inter, system-ui, sans-serif", letterSpacing: ".04em", textTransform: "uppercase", color: "#475569" };

export function FormularioDaReserva({ modo, dados, onFechar, onSalvou }: {
  modo: ModoDoFormulario; dados: Dados; onFechar: () => void; onSalvou: (r: ReservaDaTela, mensagem: string) => void;
}) {
  const r0 = modo.tipo === "mover" ? modo.reserva : null;
  const [nome, setNome] = useState(r0?.nome || "");
  const [telefone, setTelefone] = useState(r0?.telefone || "");
  const [data, setData] = useState(r0?.data || (modo.tipo === "nova" ? modo.data : ""));
  const [hora, setHora] = useState(r0?.hora || (modo.tipo === "nova" ? modo.hora || "" : ""));
  const [pessoas, setPessoas] = useState(r0?.pessoas || 2);
  const [observacao, setObservacao] = useState(r0?.observacao || "");
  const [mesaId, setMesaId] = useState(r0?.mesaId || "");
  const [salvando, setSalvando] = useState(false);
  const [recusa, setRecusa] = useState<{ erro: string; sugestoes: Sugestao[]; podeEncaixar: boolean } | null>(null);
  const config = dados.config!;

  // A ocupação do dia escolhido, quando a tela já tem (o dia aberto ou a semana).
  const ocupacao = useMemo(() => {
    const m = new Map<string, { ocupadas: number; livre: boolean; semVaga: boolean }>();
    if (data === dados.data) dados.dia?.horarios.forEach((h) => m.set(h.hora, { ocupadas: h.ocupacao.reservas, livre: h.livre, semVaga: h.motivo === "lotado" || h.motivo === "lotado_pessoas" }));
    else dados.semana?.find((d) => d.data === data)?.horarios.forEach((h) => m.set(h.hora, { ocupadas: h.ocupadas, livre: h.livre, semVaga: h.semVaga }));
    return m;
  }, [data, dados]);
  const grade = data ? horariosDoDia(config, data) : [];

  async function salvar(encaixar = false, escolha?: Sugestao) {
    const d = escolha?.data || data, h = escolha?.hora || hora;
    if (escolha) { setData(d); setHora(h); }
    setSalvando(true);
    setRecusa(null);
    try {
      const corpo = modo.tipo === "mover"
        ? { id: modo.reserva.id, acao: "mover", data: d, hora: h, encaixar }
        : { nome, telefone, data: d, hora: h, pessoas, observacao, mesaId: mesaId || null, encaixar };
      const r = await fetch("/api/store/reservas/reserva", { method: modo.tipo === "mover" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (r.status === 409) {
        setRecusa({ erro: j.error, sugestoes: j.sugestoes || [], podeEncaixar: ["lotado", "lotado_pessoas", "fora_do_horario", "dia_sem_reserva", "antecedencia", "grupo_grande", "longe_demais"].includes(j.motivo) });
        return;
      }
      if (!r.ok) throw new Error(j.error || "Erro ao salvar");
      onSalvou(j.reserva, modo.tipo === "mover" ? `Reserva de ${j.reserva.nome} movida para ${dataPorExtenso(j.reserva.data)} às ${j.reserva.hora}.` : `Reserva de ${j.reserva.nome} criada: ${dataPorExtenso(j.reserva.data)} às ${j.reserva.hora}, ${j.reserva.pessoas} pessoas.`);
    } catch (e: any) {
      setRecusa({ erro: e.message, sugestoes: [], podeEncaixar: false });
    } finally {
      setSalvando(false);
    }
  }

  const pronto = modo.tipo === "mover" ? !!data && !!hora : !!nome.trim() && !!data && !!hora && pessoas >= 1;
  const botaoPassador: React.CSSProperties = { width: 46, height: 46, display: "grid", placeItems: "center", border: "none", background: "transparent", color: TINTA, cursor: "pointer", flex: "none" };

  // Folha lateral em tela larga (a agenda continua visível ao lado); no celular ocupa a tela.
  return (
    <div role="dialog" aria-modal="true" aria-label={modo.tipo === "mover" ? "Mover reserva" : "Nova reserva"}
      onClick={(ev) => { if (ev.target === ev.currentTarget && !salvando) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.45)", display: "flex", justifyContent: "flex-end" }}>
      <style>{`.rsv-folha-reserva{width:min(560px,100%);height:100%;display:flex;flex-direction:column;background:#fff;box-shadow:0 24px 64px -16px rgba(15,23,42,.32)}@media (min-width:700px){.rsv-folha-reserva{border-radius:20px 0 0 20px}}`}</style>
      <div className="rsv-folha rsv-folha-reserva">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: `1px solid ${BORDA}` }}>
          <span aria-hidden style={{ width: 44, height: 44, borderRadius: 12, background: COR_CLARA, border: `1px solid ${COR_BORDA}`, color: COR, display: "grid", placeItems: "center", flex: "none" }}>
            {modo.tipo === "mover" ? <Clock size={22} /> : <CalendarPlus size={22} />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ font: "800 18px/1.25 Inter, system-ui, sans-serif", color: TINTA }}>{modo.tipo === "mover" ? `Mover a reserva de ${modo.reserva.nome}` : "Nova reserva"}</strong>
            <div style={{ font: "500 13px/1.4 Inter, system-ui, sans-serif", color: TINTA_3 }}>{modo.tipo === "mover" ? `Hoje: ${dataPorExtenso(modo.reserva.data)} às ${modo.reserva.hora} · ${modo.reserva.pessoas} pessoas` : "O sistema confere se cabe no horário."}</div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="fh-btn fh-btn--fantasma fh-btn--icone" style={{ width: 44 }}><X size={20} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "grid", gap: 18, alignContent: "start" }}>
          {modo.tipo === "nova" && (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <label style={{ ...rotulo, gridColumn: "1 / -1" }}>Nome<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Quem reserva" style={campo} /></label>
              <label style={rotulo}>WhatsApp<input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(22) 99999-0000" inputMode="tel" style={campo} /></label>
              <div style={rotulo}>Pessoas
                <div style={{ display: "flex", alignItems: "center", border: "1px solid #7C8DA5", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                  <button type="button" aria-label="Menos uma pessoa" onClick={() => setPessoas((p) => Math.max(1, p - 1))} style={botaoPassador}><Minus size={18} /></button>
                  <input type="number" min={1} value={pessoas} aria-label="Pessoas" onChange={(e) => setPessoas(Math.max(1, Number(e.target.value) || 1))}
                    style={{ ...campo, border: "none", borderLeft: `1px solid ${BORDA}`, borderRight: `1px solid ${BORDA}`, borderRadius: 0, textAlign: "center", font: "900 18px/1 Inter, system-ui, sans-serif", fontVariantNumeric: "tabular-nums" }} />
                  <button type="button" aria-label="Mais uma pessoa" onClick={() => setPessoas((p) => p + 1)} style={botaoPassador}><Plus size={18} /></button>
                </div>
              </div>
            </div>
          )}

          <label style={rotulo}>Dia<input type="date" value={data} min={dados.hoje} onChange={(e) => { setData(e.target.value); setRecusa(null); }} style={campo} /></label>

          <div style={rotulo}>
            Horário de chegada
            {grade.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>
                {grade.map((h) => {
                  const o = ocupacao.get(h);
                  const c = o ? corDaOcupacao(o.ocupadas / config.maxReservasSimultaneas, o.semVaga) : null;
                  const escolhido = hora === h;
                  const marcado = !!c && (o!.ocupadas > 0 || o!.semVaga);
                  return (
                    <button key={h} type="button" onClick={() => { setHora(h); setRecusa(null); }} aria-pressed={escolhido} title={o ? `${o.ocupadas} de ${config.maxReservasSimultaneas} · ${c!.rotulo}` : undefined}
                      style={{ height: 52, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", display: "grid", placeItems: "center", alignContent: "center", gap: 3, textTransform: "none", letterSpacing: 0,
                        border: escolhido ? `2px solid ${TINTA}` : `1px solid ${marcado ? c!.borda : BORDA_FORTE}`, background: escolhido ? TINTA : marcado ? c!.fundo : "#fff", color: escolhido ? "#fff" : TINTA }}>
                      <span style={{ font: "800 15px/1 Inter, system-ui, sans-serif", fontVariantNumeric: "tabular-nums", textDecoration: o?.semVaga ? "line-through" : "none" }}>{h}</span>
                      <span style={{ font: "500 11px/1 Inter, system-ui, sans-serif", color: escolhido ? "#E2E8F0" : marcado ? c!.cor : TINTA_3, fontVariantNumeric: "tabular-nums" }}>
                        {o ? (o.semVaga ? "sem vaga" : `${o.ocupadas}/${config.maxReservasSimultaneas}`) : "livre"}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : data ? <span style={{ font: "500 14px/1.45 Inter, system-ui, sans-serif", color: TINTA_3, textTransform: "none", letterSpacing: 0 }}>Este dia não aceita reserva (dá para encaixar mesmo assim digitando o horário).</span> : null}
            <span style={{ display: "flex", alignItems: "center", gap: 10, font: "500 13px/1.3 Inter, system-ui, sans-serif", color: TINTA_3, textTransform: "none", letterSpacing: 0 }}>
              ou outro horário
              <input type="time" value={hora} step={300} onChange={(e) => { setHora(e.target.value); setRecusa(null); }} style={{ ...campo, width: 140 }} aria-label="Outro horário" />
            </span>
          </div>

          {modo.tipo === "nova" && (<>
            <label style={rotulo}>Observação<input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Aniversário, cadeirinha, área externa…" style={campo} /></label>
            {!!dados.mesas?.length && (
              <label style={rotulo}>Mesa (opcional)
                <select value={mesaId} onChange={(e) => setMesaId(e.target.value)} style={campo}>
                  <option value="">Escolher na hora</option>
                  {dados.mesas.map((m) => <option key={m.id} value={m.id}>{m.nome} ({m.capacidade} lugares)</option>)}
                </select>
              </label>
            )}
          </>)}

          {recusa && (
            <div role="status" className="fh-aviso fh-aviso--erro" style={{ borderLeftWidth: 1, flexDirection: "column", gap: 10 }}>
              <b>{recusa.erro}</b>
              {recusa.sugestoes.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ font: "800 13px/1 Inter, system-ui, sans-serif", color: TINTA_2 }}>Livres mais perto:</span>
                  {recusa.sugestoes.map((s) => (
                    <Botao key={`${s.data}${s.hora}`} pequeno tipo="secundario" disabled={salvando} onClick={() => salvar(false, s)}>
                      {s.data === data ? s.hora : `${s.data.slice(8, 10)}/${s.data.slice(5, 7)} ${s.hora}`}
                    </Botao>
                  ))}
                </div>
              )}
              {recusa.podeEncaixar && <div><Botao pequeno tipo="secundario" disabled={salvando} onClick={() => salvar(true)} style={{ color: "#B71C1C" }}>Encaixar mesmo assim</Botao></div>}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, padding: "14px 20px 18px", borderTop: `1px solid ${BORDA}`, background: CALHA }}>
          <Botao tipo="secundario" onClick={onFechar} disabled={salvando} style={{ flex: 1, height: 52 }}>Voltar</Botao>
          <Botao onClick={() => salvar(false)} disabled={!pronto || salvando} style={{ flex: 2 }}>
            {salvando ? "Conferindo a vaga…" : modo.tipo === "mover" ? "Mover reserva" : "Confirmar reserva"}
          </Botao>
        </div>
      </div>
    </div>
  );
}
