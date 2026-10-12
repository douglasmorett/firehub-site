"use client";

/**
 * "Quando?" no checkout do cardápio: ⚡ Agora ou 📅 Agendar (dia e horário).
 *
 * Só aparece quando a loja aceita agendamento para o tipo escolhido
 * (lib/agendamento.ts). Os horários vêm de `horariosParaAgendar`, a mesma
 * função que o servidor usa para conferir — o que o cliente vê é o que passa.
 * Sem "Agora" quando a loja está fechada ou só trabalha por encomenda.
 */
import { useEffect, useState } from "react";
import type { DiaDeAgendamento } from "@/lib/agendamento";

export type Quando = "AGORA" | "AGENDAR";

export default function QuandoReceber({
  dias, podeAgora, quando, onQuando, escolhido, onEscolher, ehEntrega, motivoSemAgora,
}: {
  dias: DiaDeAgendamento[];
  podeAgora: boolean;
  quando: Quando;
  onQuando: (q: Quando) => void;
  escolhido: string | null;
  onEscolher: (iso: string | null) => void;
  ehEntrega: boolean;
  /** Por que não dá para agora ("A loja está fechada agora", "Só encomenda"). */
  motivoSemAgora?: string;
}) {
  const agendando = !podeAgora || quando === "AGENDAR";
  const diaDoEscolhido = escolhido ? dias.find((d) => d.horarios.some((h) => h.iso === escolhido))?.data : undefined;
  // O dia aberto: o que o cliente tocou, o do horário escolhido, ou o primeiro com horário livre.
  const [diaTocado, setDiaTocado] = useState<string | null>(null);
  const diaAberto = (diaTocado && dias.some((d) => d.data === diaTocado) ? diaTocado : null) || diaDoEscolhido || dias[0]?.data;
  const doDia = dias.find((d) => d.data === diaAberto);

  // Sem "Agora", a tela já nasce no Agendar.
  useEffect(() => {
    if (!podeAgora && quando !== "AGENDAR") onQuando("AGENDAR");
  }, [podeAgora, quando, onQuando]);

  const resumo = (() => {
    if (!escolhido) return null;
    const d = dias.find((x) => x.horarios.some((h) => h.iso === escolhido));
    const h = d?.horarios.find((x) => x.iso === escolhido);
    return d && h ? `${d.rotulo.toLowerCase()} às ${h.hora}` : null;
  })();

  return (
    <div>
      <label className="checkout-label">Quando? *</label>
      <div className="checkout-type-row">
        {podeAgora && (
          <button type="button" onClick={() => { onQuando("AGORA"); onEscolher(null); }} className={`checkout-type-btn ${!agendando ? "active" : ""}`}>
            ⚡ Agora
          </button>
        )}
        <button type="button" onClick={() => onQuando("AGENDAR")} className={`checkout-type-btn ${agendando ? "active" : ""}`}>
          📅 Agendar
        </button>
      </div>
      {!podeAgora && motivoSemAgora && (
        <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "6px 0 0" }}>{motivoSemAgora}</p>
      )}

      {agendando && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #E2E8F0", background: "#F8FAFC" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", marginBottom: 6 }}>
            {ehEntrega ? "Dia e horário da entrega" : "Dia e horário para retirar"}
          </div>
          <div role="radiogroup" aria-label="Dia" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {dias.map((d) => {
              const ativo = d.data === diaAberto;
              return (
                <button key={d.data} type="button" role="radio" aria-checked={ativo}
                  onClick={() => {
                    setDiaTocado(d.data);
                    // Trocou de dia: o horário de outro dia não vale mais.
                    if (d.data !== diaDoEscolhido) onEscolher(null);
                  }}
                  style={{ flexShrink: 0, padding: "7px 12px", borderRadius: 10, border: `2px solid ${ativo ? "#059669" : "#E2E8F0"}`, background: ativo ? "#ECFDF5" : "#fff", color: ativo ? "#065F46" : "#475569", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                  {d.rotulo}
                </button>
              );
            })}
          </div>
          {doDia && (
            <div role="radiogroup" aria-label="Horário" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(68px, 1fr))", gap: 6, marginTop: 8 }}>
              {doDia.horarios.map((h) => {
                const ativo = h.iso === escolhido;
                return (
                  <button key={h.iso} type="button" role="radio" aria-checked={ativo} onClick={() => onEscolher(h.iso)}
                    style={{ padding: "8px 0", borderRadius: 8, border: `2px solid ${ativo ? "#059669" : "#E2E8F0"}`, background: ativo ? "#059669" : "#fff", color: ativo ? "#fff" : "#334155", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
                    {h.hora}
                  </button>
                );
              })}
            </div>
          )}
          <p style={{ fontSize: "0.78rem", margin: "8px 0 0", color: resumo ? "#065F46" : "#B45309", fontWeight: 700 }}>
            {resumo ? `✓ Seu pedido fica agendado para ${resumo}.` : "Escolha o horário."}
          </p>
        </div>
      )}
    </div>
  );
}
