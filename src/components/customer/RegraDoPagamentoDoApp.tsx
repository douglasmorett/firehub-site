"use client";

/**
 * Em pedido de iFood/99Food, o entregador recebe o que veio do app ou o que a
 * loja combinou com ele?
 *
 * ── Por que isto vive na aba de Motoboys ────────────────────────────────────
 *
 * Nasceu na tela de Entrega, junto das faixas de taxa — e ali estava errado:
 * é uma decisão sobre PAGAMENTO DO ENTREGADOR, não sobre quanto o cliente
 * paga. Quem procura "quanto pago ao motoboy" abre Motoboys, não Entrega.
 *
 * A escolha é da loja inteira, não de um entregador: o mesmo pedido de app não
 * pode valer um número para um e outro para outro.
 */

import { useState } from "react";
import { explicarRegraDoApp, lerRegraDeRepasse, type OrigemDoRepasseNoApp } from "@/lib/repasse-do-entregador";

export default function RegraDoPagamentoDoApp({ deliveryConfig }: { deliveryConfig?: unknown }) {
  // O valor vem do servidor junto da página — /api/store-settings só tem PUT,
  // e inventar um GET só para ler uma chave seria rota nova para nada.
  const [valor, setValor] = useState<OrigemDoRepasseNoApp>(() => lerRegraDeRepasse(deliveryConfig).marketplace);
  const carregando = false;
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  const escolher = async (novo: OrigemDoRepasseNoApp) => {
    const anterior = valor;
    setValor(novo);
    setSalvando(true);
    setAviso("");
    try {
      const r = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Campo próprio: a rota mescla dentro do deliveryConfig sem apagar o
        // frete grátis, o pedido mínimo nem as áreas de risco.
        body: JSON.stringify({ repasseDoEntregador: { separado: true, marketplace: novo } }),
      });
      if (!r.ok) throw new Error("salvar");
      setAviso("Salvo.");
      setTimeout(() => setAviso(""), 2200);
    } catch {
      setValor(anterior);
      setAviso("Não consegui salvar agora. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  const OPCOES: { v: OrigemDoRepasseNoApp; t: string; d: string }[] = [
    {
      v: "TABELA",
      t: "O valor que eu combinei com ele",
      d: "O acerto do entregador — faixa de km, valor por entrega ou diária, cadastrado aqui embaixo.",
    },
    {
      v: "APP",
      t: "O valor que veio do app",
      d: "A taxa de entrega que o iFood/99 pagou naquele pedido vai inteira para o entregador.",
    },
  ];

  return (
    <div style={{ border: "1.5px solid #FED7AA", background: "#FFFBF5", borderRadius: 14, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <b style={{ fontSize: "0.95rem", color: "#9A3412" }}>🔴 Pedido de iFood, 99Food e outros apps</b>
        {salvando && <span style={{ fontSize: "0.74rem", color: "#94A3B8" }}>salvando…</span>}
        {aviso && <span style={{ fontSize: "0.74rem", fontWeight: 700, color: aviso === "Salvo." ? "#16A34A" : "#B91C1C" }}>{aviso}</span>}
      </div>
      <p style={{ margin: "0 0 11px", fontSize: "0.8rem", color: "#64748B", lineHeight: 1.5 }}>
        Nesses pedidos, o que o entregador recebe é:
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 9 }}>
        {OPCOES.map((op) => (
          <button
            key={op.v}
            type="button"
            disabled={carregando}
            onClick={() => escolher(op.v)}
            style={{
              textAlign: "left", padding: "11px 13px", borderRadius: 11, cursor: carregando ? "wait" : "pointer",
              border: `2px solid ${valor === op.v ? "#C2410C" : "#E2E8F0"}`,
              background: valor === op.v ? "#FFF7ED" : "#fff", fontFamily: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.85rem", fontWeight: 800, color: valor === op.v ? "#9A3412" : "#334155" }}>
              <span>{valor === op.v ? "●" : "○"}</span>{op.t}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 3, lineHeight: 1.45 }}>{op.d}</div>
          </button>
        ))}
      </div>

      <p style={{
        margin: "10px 0 0", fontSize: "0.76rem", lineHeight: 1.5,
        color: valor === "APP" ? "#334155" : "#92400E",
        background: valor === "APP" ? "#F8FAFC" : "#FFFBEB",
        border: `1px solid ${valor === "APP" ? "#E2E8F0" : "#FDE68A"}`,
        borderRadius: 9, padding: "8px 11px",
      }}>
        {explicarRegraDoApp({ separado: true, marketplace: valor })}
      </p>
    </div>
  );
}
