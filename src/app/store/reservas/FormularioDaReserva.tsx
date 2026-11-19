"use client";

/**
 * A janela de RESERVA MANUAL (cliente que ligou, que pediu no balcão) e de
 * MOVER o horário. O servidor confere a vaga; não coube, a janela mostra os
 * horários livres mais perto e o "Encaixar mesmo assim" (o dono decide).
 */
import { useMemo, useState } from "react";
import { dataPorExtenso, horariosDoDia, type Sugestao } from "@/lib/reservas/regras";
import { BORDA, Botao, COR, COR_CLARA, TINTA, TINTA_2, TINTA_3, corDaOcupacao, type Dados, type ReservaDaTela } from "./comum";

export type ModoDoFormulario = { tipo: "nova"; data: string; hora?: string | null } | { tipo: "mover"; reserva: ReservaDaTela };

const campo: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 15, fontFamily: "inherit", color: TINTA };
const rotulo: React.CSSProperties = { display: "grid", gap: 5, fontSize: 13, fontWeight: 800, color: TINTA_2 };

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

  return (
    <div role="dialog" aria-modal="true" aria-label={modo.tipo === "mover" ? "Mover reserva" : "Nova reserva"}
      onClick={(ev) => { if (ev.target === ev.currentTarget && !salvando) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="rsv-entra" style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", padding: "20px 20px 18px", display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, background: COR_CLARA, display: "grid", placeItems: "center", fontSize: 20 }}>{modo.tipo === "mover" ? "🕒" : "📅"}</span>
          <div style={{ flex: 1 }}>
            <strong style={{ fontSize: 18, color: TINTA }}>{modo.tipo === "mover" ? `Mover a reserva de ${modo.reserva.nome}` : "Nova reserva"}</strong>
            <div style={{ fontSize: 13, color: TINTA_3 }}>{modo.tipo === "mover" ? `Hoje: ${dataPorExtenso(modo.reserva.data)} às ${modo.reserva.hora} · ${modo.reserva.pessoas} pessoas` : "O sistema confere se cabe no horário."}</div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ border: "none", background: "none", fontSize: 22, color: TINTA_3, cursor: "pointer" }}>×</button>
        </div>

        {modo.tipo === "nova" && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ ...rotulo, gridColumn: "1 / -1" }}>Nome<input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Quem reserva" style={campo} /></label>
            <label style={rotulo}>WhatsApp<input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(22) 99999-0000" inputMode="tel" style={campo} /></label>
            <label style={rotulo}>Pessoas
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => setPessoas((p) => Math.max(1, p - 1))} style={{ ...campo, width: 44, padding: 0, fontWeight: 900, color: COR, cursor: "pointer", background: "#fff" }}>−</button>
                <input type="number" min={1} value={pessoas} onChange={(e) => setPessoas(Math.max(1, Number(e.target.value) || 1))} style={{ ...campo, textAlign: "center", fontWeight: 900 }} />
                <button type="button" onClick={() => setPessoas((p) => p + 1)} style={{ ...campo, width: 44, padding: 0, fontWeight: 900, color: COR, cursor: "pointer", background: "#fff" }}>+</button>
              </div>
            </label>
          </div>
        )}

        <label style={rotulo}>Dia<input type="date" value={data} min={dados.hoje} onChange={(e) => { setData(e.target.value); setRecusa(null); }} style={campo} /></label>

        <div style={rotulo}>
          Horário de chegada
          {grade.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {grade.map((h) => {
                const o = ocupacao.get(h);
                const c = o ? corDaOcupacao(o.ocupadas / config.maxReservasSimultaneas, o.semVaga) : null;
                const escolhido = hora === h;
                return (
                  <button key={h} type="button" onClick={() => { setHora(h); setRecusa(null); }} title={o ? `${o.ocupadas} de ${config.maxReservasSimultaneas} · ${c!.rotulo}` : undefined}
                    style={{ padding: "7px 10px", borderRadius: 10, fontWeight: 800, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
                      border: escolhido ? `2px solid ${COR}` : `1px solid ${c && (o!.ocupadas || o!.semVaga) ? c.cor : BORDA}`, background: escolhido ? COR : c && (o!.ocupadas || o!.semVaga) ? c.fundo : "#fff", color: escolhido ? "#fff" : TINTA,
                      textDecoration: o?.semVaga ? "line-through" : "none" }}>
                    {h}{o && o.ocupadas ? <small style={{ fontWeight: 700, opacity: 0.8 }}> {o.ocupadas}/{config.maxReservasSimultaneas}</small> : null}
                  </button>
                );
              })}
            </div>
          ) : data ? <span style={{ fontWeight: 600, color: TINTA_3 }}>Este dia não aceita reserva (dá para encaixar mesmo assim digitando o horário).</span> : null}
          <input type="time" value={hora} step={300} onChange={(e) => { setHora(e.target.value); setRecusa(null); }} style={{ ...campo, width: 140 }} aria-label="Outro horário" />
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
          <div role="status" style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: 12, display: "grid", gap: 8 }}>
            <b style={{ color: "#991B1B" }}>{recusa.erro}</b>
            {recusa.sugestoes.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: TINTA_2 }}>Livres mais perto:</span>
                {recusa.sugestoes.map((s) => (
                  <Botao key={`${s.data}${s.hora}`} tipo="secundario" disabled={salvando} onClick={() => salvar(false, s)} style={{ padding: "6px 10px" }}>
                    {s.data === data ? s.hora : `${s.data.slice(8, 10)}/${s.data.slice(5, 7)} ${s.hora}`}
                  </Botao>
                ))}
              </div>
            )}
            {recusa.podeEncaixar && <div><Botao tipo="perigo" disabled={salvando} onClick={() => salvar(true)}>Encaixar mesmo assim</Botao></div>}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <Botao tipo="secundario" onClick={onFechar} disabled={salvando} style={{ flex: 1, padding: 13 }}>Voltar</Botao>
          <Botao onClick={() => salvar(false)} disabled={!pronto || salvando} style={{ flex: 2, padding: 13, fontSize: 15 }}>
            {salvando ? "Conferindo a vaga…" : modo.tipo === "mover" ? "Mover reserva" : "Confirmar reserva"}
          </Botao>
        </div>
      </div>
    </div>
  );
}
