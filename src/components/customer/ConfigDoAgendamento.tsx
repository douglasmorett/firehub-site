"use client";

/**
 * Pedidos › Agendamentos: o que a loja aceita de pedido agendado no site.
 *
 * Liga/desliga, entrega e/ou retirada, dias, horário (o de funcionamento ou
 * um próprio), antecedência mínima, até quantos dias à frente, o intervalo dos
 * horários, "só encomenda" e quando o pedido vai para a cozinha. A regra que
 * usa tudo isto é uma só, em lib/agendamento.ts — a mesma do site e da rota.
 *
 * A prévia embaixo mostra os horários que o cliente vai ver AGORA, calculados
 * pela mesma função do checkout: a loja confere antes de salvar.
 */
import { useMemo, useState } from "react";
import {
  lerConfigDeAgendamento, horariosParaAgendar, textoDaAntecedencia, DIAS_DA_SEMANA,
  OPCOES_DE_ANTECEDENCIA, OPCOES_DE_DIAS_A_FRENTE, OPCOES_DE_INTERVALO, OPCOES_DE_LIBERACAO,
  type ConfigDeAgendamento,
} from "@/lib/agendamento";

const COR = { ok: "#0F766E", okFundo: "#F0FDFA", okBorda: "#99F6E4", off: "#B71C1C", offFundo: "#FEF2F2", offBorda: "#FECACA", tinta: "#334155", apagado: "#64748B", borda: "#E2E8F0", fundo: "#F8FAFC" };

function Chave({ ligado, onClick, rotulo }: { ligado: boolean; onClick: () => void; rotulo: string }) {
  return (
    <button type="button" role="switch" aria-checked={ligado} aria-label={rotulo} onClick={onClick}
      style={{ position: "relative", width: 52, height: 28, borderRadius: 20, background: ligado ? COR.ok : "#CBD5E1", border: "none", cursor: "pointer", flexShrink: 0, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.1)" }}>
      <span style={{ position: "absolute", top: 3, left: ligado ? 27 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 4px rgba(0,0,0,0.2)", transition: "left .2s ease" }} />
    </button>
  );
}

function Pilula({ ativo, onClick, children, titulo }: { ativo: boolean; onClick: () => void; children: React.ReactNode; titulo?: string }) {
  return (
    <button type="button" onClick={onClick} title={titulo} aria-pressed={ativo}
      style={{ padding: "6px 12px", borderRadius: 8, border: `2px solid ${ativo ? "#475569" : COR.borda}`, background: ativo ? "#F1F5F9" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem", color: ativo ? "#1E293B" : COR.apagado, fontFamily: "inherit" }}>
      {children}
    </button>
  );
}

function Bloco({ titulo, ajuda, children }: { titulo: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px 14px", background: COR.fundo, borderRadius: 12, border: `1px solid ${COR.borda}` }}>
      <div style={{ fontSize: "0.82rem", fontWeight: 800, color: COR.tinta, marginBottom: ajuda ? 2 : 8 }}>{titulo}</div>
      {ajuda && <div style={{ fontSize: "0.72rem", color: COR.apagado, marginBottom: 8 }}>{ajuda}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>{children}</div>
    </div>
  );
}

const textoDosDias = (n: number) => (n === 0 ? "Só hoje" : n === 1 ? "Até amanhã" : `${n} dias`);
const textoDaLiberacao = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)}h${min % 60}` : `${min / 60}h`);

export default function ConfigDoAgendamento({
  inicial, storeHours, storePause, timezone, onSalvo, onAviso,
}: {
  inicial: unknown;
  storeHours: unknown;
  storePause?: unknown;
  timezone?: string | null;
  onSalvo: (cfg: ConfigDeAgendamento) => void;
  onAviso: (texto: string, cor: string) => void;
}) {
  const [salvo, setSalvo] = useState<ConfigDeAgendamento>(() => lerConfigDeAgendamento(inicial));
  const [cfg, setCfg] = useState<ConfigDeAgendamento>(salvo);
  const [salvando, setSalvando] = useState(false);
  const mudou = JSON.stringify(cfg) !== JSON.stringify(salvo);
  const muda = (parte: Partial<ConfigDeAgendamento>) => setCfg((c) => ({ ...c, ...parte }));

  const previa = useMemo(
    () => horariosParaAgendar({ config: { ...cfg, ativo: true }, storeHours, storePause, timezone }),
    [cfg, storeHours, storePause, timezone],
  );

  const salvar = async (proximo: ConfigDeAgendamento) => {
    setSalvando(true);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agendamentoConfig: proximo }),
      });
      if (!res.ok) throw new Error();
      setSalvo(proximo);
      setCfg(proximo);
      onSalvo(proximo);
      onAviso(proximo.ativo ? "📅 Agendamento salvo: o site já oferece os horários." : "Agendamento desligado no site.", proximo.ativo ? COR.ok : "#475569");
    } catch {
      onAviso("❌ Não consegui salvar o agendamento. Confira a internet e tente de novo.", "#C92E09");
    } finally {
      setSalvando(false);
    }
  };

  const tiposErrados = !cfg.entrega && !cfg.retirada;
  const semDias = cfg.dias.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
      {/* Liga/desliga — salva na hora, como era. */}
      <div style={{ padding: "14px 16px", background: salvo.ativo ? COR.okFundo : COR.offFundo, borderRadius: 14, border: `1.5px solid ${salvo.ativo ? COR.okBorda : COR.offBorda}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", color: salvo.ativo ? COR.ok : COR.off }}>
            {salvo.ativo ? "🟢 Aceitando pedidos agendados no site" : "🔴 Agendamento desligado"}
          </div>
          <div style={{ fontSize: "0.76rem", color: salvo.ativo ? COR.ok : COR.off, marginTop: 2 }}>
            {salvo.ativo
              ? salvo.soAgendado
                ? "Só encomenda: o cliente escolhe dia e horário, não dá para pedir para agora."
                : "No checkout, o cliente escolhe “Agora” ou “Agendar” (dia e horário)."
              : "O site aceita só pedidos para agora."}
          </div>
        </div>
        <Chave ligado={salvo.ativo} rotulo="Aceitar pedidos agendados" onClick={() => !salvando && salvar({ ...cfg, ativo: !salvo.ativo })} />
      </div>

      {salvo.ativo && (
        <>
          <Bloco titulo="Aceita agendamento para">
            <Pilula ativo={cfg.entrega} onClick={() => muda({ entrega: !cfg.entrega })}>🛵 Entrega</Pilula>
            <Pilula ativo={cfg.retirada} onClick={() => muda({ retirada: !cfg.retirada })}>🛍️ Retirada</Pilula>
            {tiposErrados && <span style={{ fontSize: "0.72rem", color: COR.off }}>Marque pelo menos um.</span>}
          </Bloco>

          <Bloco titulo="Dias que aceita">
            {DIAS_DA_SEMANA.map((d, i) => (
              <Pilula key={d} ativo={cfg.dias.includes(i)} onClick={() => muda({ dias: cfg.dias.includes(i) ? cfg.dias.filter((x) => x !== i) : [...cfg.dias, i].sort() })}>{d}</Pilula>
            ))}
            {semDias && <span style={{ fontSize: "0.72rem", color: COR.off }}>Marque pelo menos um dia.</span>}
          </Bloco>

          <Bloco titulo="Horários" ajuda="O horário que o cliente escolhe é quando o pedido chega (entrega) ou fica pronto (retirada).">
            <Pilula ativo={cfg.horario === "LOJA"} onClick={() => muda({ horario: "LOJA" })}>Os do funcionamento da loja</Pilula>
            <Pilula ativo={cfg.horario === "PROPRIO"} onClick={() => muda({ horario: "PROPRIO" })}>Um horário só para agendamento</Pilula>
            {cfg.horario === "PROPRIO" && (
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: COR.tinta, width: "100%", marginTop: 4 }}>
                das <input type="time" value={cfg.de} onChange={(e) => e.target.value && muda({ de: e.target.value })} style={{ padding: "4px 6px", borderRadius: 6, border: `1px solid ${COR.borda}`, fontFamily: "inherit" }} />
                às <input type="time" value={cfg.ate} onChange={(e) => e.target.value && muda({ ate: e.target.value })} style={{ padding: "4px 6px", borderRadius: 6, border: `1px solid ${COR.borda}`, fontFamily: "inherit" }} />
              </span>
            )}
          </Bloco>

          <Bloco titulo="Antecedência mínima" ajuda="Quanto tempo antes o cliente precisa agendar.">
            {OPCOES_DE_ANTECEDENCIA.map((m) => (
              <Pilula key={m} ativo={cfg.antecedenciaMin === m} onClick={() => muda({ antecedenciaMin: m })}>{textoDaAntecedencia(m)}</Pilula>
            ))}
          </Bloco>

          <Bloco titulo="Pode agendar com até">
            {OPCOES_DE_DIAS_A_FRENTE.map((n) => (
              <Pilula key={n} ativo={cfg.diasAFrente === n} onClick={() => muda({ diasAFrente: n })}>{textoDosDias(n)}</Pilula>
            ))}
          </Bloco>

          <Bloco titulo="Horários de quanto em quanto tempo">
            {OPCOES_DE_INTERVALO.map((m) => (
              <Pilula key={m} ativo={cfg.intervaloMin === m} onClick={() => muda({ intervaloMin: m })}>{m} min</Pilula>
            ))}
          </Bloco>

          <Bloco titulo="Quando o pedido vai para a cozinha" ajuda="Até lá ele fica aqui em Agendamentos, fora de Novos e do KDS.">
            {OPCOES_DE_LIBERACAO.map((m) => (
              <Pilula key={m} ativo={cfg.liberarAntesMin === m} onClick={() => muda({ liberarAntesMin: m })}>{textoDaLiberacao(m)} antes</Pilula>
            ))}
          </Bloco>

          <div style={{ padding: "12px 14px", background: COR.fundo, borderRadius: 12, border: `1px solid ${COR.borda}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: "0.82rem", fontWeight: 800, color: COR.tinta }}>Só encomenda</div>
              <div style={{ fontSize: "0.72rem", color: COR.apagado }}>O site aceita só pedido agendado, nunca para agora (ex.: “retirada só no sábado”).</div>
            </div>
            <Chave ligado={cfg.soAgendado} rotulo="Só encomenda" onClick={() => muda({ soAgendado: !cfg.soAgendado })} />
          </div>

          {/* O que o cliente vai ver — a mesma função do checkout. */}
          <div style={{ padding: "12px 14px", borderRadius: 12, border: `1px dashed ${COR.okBorda}`, background: "#fff" }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 800, color: COR.ok, marginBottom: 6 }}>👀 O cliente vai ver agora</div>
            {previa.length === 0 ? (
              <div style={{ fontSize: "0.76rem", color: COR.off }}>Nenhum horário livre com essa configuração. Confira os dias, o horário e a antecedência.</div>
            ) : (
              previa.slice(0, 3).map((d) => (
                <div key={d.data} style={{ fontSize: "0.76rem", color: COR.tinta, marginBottom: 2 }}>
                  <strong>{d.rotulo}:</strong> {d.horarios.slice(0, 8).map((h) => h.hora).join(" · ")}{d.horarios.length > 8 ? ` … (${d.horarios.length} horários)` : ""}
                </div>
              ))
            )}
            {previa.length > 3 && <div style={{ fontSize: "0.72rem", color: COR.apagado }}>+ {previa.length - 3} dia(s)</div>}
          </div>

          <button type="button" disabled={!mudou || salvando || tiposErrados || semDias} onClick={() => salvar(cfg)}
            style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: mudou && !tiposErrados && !semDias ? COR.ok : "#CBD5E1", color: "#fff", fontWeight: 800, cursor: mudou ? "pointer" : "default", fontFamily: "inherit" }}>
            {salvando ? "Salvando…" : mudou ? "Salvar configuração do agendamento" : "✓ Configuração salva"}
          </button>
        </>
      )}
    </div>
  );
}
