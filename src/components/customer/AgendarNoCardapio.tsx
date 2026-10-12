"use client";

/**
 * "📅 Agendar pedido" no TOPO do cardápio (Douglas, 11/10/2026: "tem que ter
 * um botão de agendamento separado: ele escolhe o dia e a hora e depois o
 * produto, e aparece pra ele caso o produto esteja disponível naquele horário").
 *
 * O cliente escolhe entrega/retirada, o dia e o horário ANTES de montar a
 * sacola; a vitrine passa a mostrar o cardápio daquele instante (a marmita das
 * 10h–14h aparece para quem agenda amanhã ao meio-dia, mesmo olhando à noite).
 * O horário escolhido aqui é o mesmo do "Quando?" do checkout — um estado só,
 * em CustomerStorePage.
 */
import { useState } from "react";
import QuandoReceber from "./QuandoReceber";
import type { DiaDeAgendamento } from "@/lib/agendamento";

type Tipo = "DELIVERY" | "PICKUP";

export default function AgendarNoCardapio({
  dias, tiposAceitos, tipoAtual, horarioTexto, podeAgora, lojaFechada, onConfirmar, onAgora,
}: {
  dias: DiaDeAgendamento[];
  /** Os tipos que a loja agenda (e que o cardápio oferece). */
  tiposAceitos: Tipo[];
  tipoAtual: Tipo;
  /** "sáb 17/10 às 12:00" quando já há horário escolhido. */
  horarioTexto: string | null;
  podeAgora: boolean;
  lojaFechada: boolean;
  onConfirmar: (tipo: Tipo, iso: string) => void;
  onAgora: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<Tipo>(tiposAceitos.includes(tipoAtual) ? tipoAtual : tiposAceitos[0]);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  if (dias.length === 0 || tiposAceitos.length === 0) return null;

  const abrir = () => {
    setTipo(tiposAceitos.includes(tipoAtual) ? tipoAtual : tiposAceitos[0]);
    setEscolhido(null);
    setAberto(true);
  };

  return (
    <>
      {/* Mesma largura da busca (store-search-inner: 1200px, 20px nas laterais). */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "10px 20px 0", boxSizing: "border-box" }}>
      <div style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${horarioTexto ? "#A7F3D0" : "#E2E8F0"}`, background: horarioTexto ? "#ECFDF5" : "#F8FAFC", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", fontSize: "0.85rem", color: horarioTexto ? "#065F46" : "#334155", fontWeight: 700 }}>
          {horarioTexto
            ? <>📅 Pedido agendado para <strong>{horarioTexto}</strong><div style={{ fontSize: "0.74rem", fontWeight: 600, opacity: 0.85 }}>O cardápio abaixo é o desse horário.</div></>
            : lojaFechada
              ? "A loja está fechada agora, mas você pode agendar o seu pedido."
              : podeAgora ? "Quer para outro dia ou horário?" : "Esta loja trabalha com pedido agendado."}
        </div>
        <button type="button" onClick={abrir}
          style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#059669", color: "#fff", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>
          {horarioTexto ? "Trocar horário" : "📅 Agendar pedido"}
        </button>
        {horarioTexto && podeAgora && (
          <button type="button" onClick={onAgora}
            style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
            Pedir para agora
          </button>
        )}
      </div>
      </div>

      {aberto && (
        <div role="dialog" aria-modal="true" aria-label="Agendar pedido" onClick={() => setAberto(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 16px 20px", boxShadow: "0 -10px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 900, color: "#0F172A" }}>📅 Agendar pedido</h3>
              <button type="button" aria-label="Fechar" onClick={() => setAberto(false)} style={{ background: "none", border: "none", fontSize: "1.5rem", lineHeight: 1, color: "#94A3B8", cursor: "pointer" }}>×</button>
            </div>

            {tiposAceitos.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                <label className="checkout-label">Como deseja receber? *</label>
                <div className="checkout-type-row">
                  <button type="button" onClick={() => { setTipo("DELIVERY"); }} className={`checkout-type-btn ${tipo === "DELIVERY" ? "active" : ""}`}>🛵 Entrega</button>
                  <button type="button" onClick={() => { setTipo("PICKUP"); }} className={`checkout-type-btn ${tipo === "PICKUP" ? "active" : ""}`}>🛍️ Retirar no Balcão</button>
                </div>
              </div>
            )}

            <QuandoReceber
              dias={dias}
              podeAgora={false}
              quando="AGENDAR"
              onQuando={() => {}}
              escolhido={escolhido}
              onEscolher={setEscolhido}
              ehEntrega={tipo === "DELIVERY"}
              soCalendario
            />

            <button type="button" disabled={!escolhido}
              onClick={() => { if (escolhido) { onConfirmar(tipo, escolhido); setAberto(false); } }}
              style={{ marginTop: 14, width: "100%", padding: 13, borderRadius: 12, border: "none", background: escolhido ? "linear-gradient(135deg, #059669, #047857)" : "#E2E8F0", color: escolhido ? "#fff" : "#64748B", fontWeight: 900, fontSize: "0.95rem", cursor: escolhido ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
              Ver o cardápio desse horário
            </button>
          </div>
        </div>
      )}
    </>
  );
}
