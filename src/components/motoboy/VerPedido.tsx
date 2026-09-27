"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ClipboardList } from "lucide-react";
import { pedidoParaOMotoboy, resumoDoPedido } from "@/lib/pedido-do-motoboy";

/**
 * "Ver pedido" no cartão da entrega: abre a lista do que vai na sacola, com a
 * bebida destacada em azul (lib/pedido-do-motoboy.ts). Fechado por padrão — o
 * cartão na moto tem que continuar curto; abre quando ele precisa conferir.
 */
export default function VerPedido({
  order,
  palavrasDeBebida,
  abertoDeInicio = false,
}: {
  order: unknown;
  palavrasDeBebida?: string | string[];
  /** Só para a prévia e o teste: no app ele nasce fechado. */
  abertoDeInicio?: boolean;
}) {
  const [aberto, setAberto] = useState(abertoDeInicio);
  const pedido = pedidoParaOMotoboy(order, palavrasDeBebida);
  if (pedido.linhas.length === 0) return null;

  return (
    <div style={{ marginBottom: "0.85rem" }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          padding: "10px 12px", borderRadius: "10px", cursor: "pointer",
          background: aberto ? "#0F172A" : "#F8FAFC", color: aberto ? "#FFFFFF" : "#0F172A",
          border: `1.5px solid ${aberto ? "#0F172A" : "#CBD5E1"}`, fontSize: "0.86rem", fontWeight: 900,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ClipboardList size={16} /> Ver pedido
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem", fontWeight: 700, opacity: 0.9 }}>
          {pedido.bebidas > 0 ? "🥤 " : ""}{resumoDoPedido(pedido)}
          {aberto ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {aberto && (
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {pedido.linhas.map((linha, i) => (
            <li
              key={i}
              style={{
                background: linha.bebida ? "#EFF6FF" : "#FFFFFF",
                border: `1px solid ${linha.bebida ? "#BFDBFE" : "#E2E8F0"}`,
                borderRadius: "10px", padding: "8px 10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontWeight: 900, fontSize: "0.92rem", color: "#0F172A" }}>
                <span style={{ color: "#2563EB", minWidth: 30 }}>{linha.quantidade}x</span>
                <span style={{ flex: 1 }}>{linha.bebida ? "🥤 " : ""}{linha.nome}</span>
              </div>
              {linha.escolhas.length > 0 && (
                <div style={{ marginTop: 3, paddingLeft: 36, fontSize: "0.8rem", color: "#475569", fontWeight: 600, lineHeight: 1.45 }}>
                  {/* Em 2x Combo as escolhas são de CADA um: sem o "cada", o
                      motoboy procurava 1 lata onde vão 2. */}
                  {linha.quantidade > 1 && <b>cada: </b>}
                  {linha.escolhas.map((e, j) => (
                    <span key={j} style={e.bebida ? { color: "#1D4ED8", fontWeight: 800 } : undefined}>
                      {j > 0 ? " · " : ""}
                      {e.bebida ? "🥤 " : ""}
                      {e.quantidade > 1 ? `${e.quantidade}x ` : ""}
                      {e.nome}
                    </span>
                  ))}
                </div>
              )}
              {linha.obs && (
                <div style={{ marginTop: 3, paddingLeft: 36, fontSize: "0.78rem", color: "#92400E", fontWeight: 700 }}>
                  ✏️ {linha.obs}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
