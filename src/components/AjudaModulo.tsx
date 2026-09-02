"use client";

/**
 * AjudaModulo — o cabeçalho explicativo que abre cada módulo do painel.
 *
 * Existe por um motivo de suporte: o lojista abria uma tela como "DRE" ou
 * "Notas de Compras" e ligava para perguntar o que fazer ali. Cada minuto
 * dessas ligações é custo nosso e atrito para ele. A regra desta caixa é que,
 * lendo só ela, a pessoa saiba TRÊS coisas — o que a tela é, para que serve no
 * dia a dia dela, e qual é o primeiro clique.
 *
 * Escreva `oQueE` em linguagem de dono de restaurante, não de sistema:
 * "quanto sobrou no fim do mês" vale mais que "demonstrativo de resultados".
 */

import { useState } from "react";

export type PassoAjuda = { titulo: string; texto: string };

export default function AjudaModulo({
  icone,
  titulo,
  oQueE,
  paraQueServe,
  passos = [],
  aviso,
  corDeFundo = "#F8FAFC",
  corDaBorda = "#E2E8F0",
}: {
  icone: string;
  titulo: string;
  /** Uma frase: o que esta tela é. */
  oQueE: string;
  /** Uma frase: o que o lojista ganha usando isso. */
  paraQueServe?: string;
  /** O passo a passo. Fica recolhido para não empurrar a tela para baixo. */
  passos?: PassoAjuda[];
  /** Alerta curto, quando existe uma pegadinha que gera chamado de suporte. */
  aviso?: string;
  corDeFundo?: string;
  corDaBorda?: string;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div style={{
      background: corDeFundo, border: `1px solid ${corDaBorda}`,
      borderRadius: 16, padding: "16px 18px", marginBottom: 20,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ fontSize: "1.5rem", lineHeight: 1, flexShrink: 0 }}>{icone}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 900, color: "#0F172A" }}>
            {titulo}
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: "0.86rem", color: "#475569", lineHeight: 1.6 }}>
            {oQueE}
            {paraQueServe && <> <strong style={{ color: "#334155" }}>{paraQueServe}</strong></>}
          </p>

          {aviso && (
            <div style={{
              marginTop: 10, background: "#FFFBEB", border: "1px solid #FDE68A",
              borderRadius: 10, padding: "9px 12px", fontSize: "0.79rem",
              color: "#92400E", lineHeight: 1.5,
            }}>
              ⚠️ {aviso}
            </div>
          )}

          {passos.length > 0 && (
            <>
              <button
                onClick={() => setAberto((v) => !v)}
                style={{
                  marginTop: 10, background: "none", border: "none", padding: 0,
                  color: "#2563EB", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer",
                }}
              >
                {aberto ? "Ocultar o passo a passo ▲" : "Como usar, passo a passo ▼"}
              </button>

              {aberto && (
                <ol style={{ margin: "12px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                  {passos.map((p, i) => (
                    <li key={i} style={{ fontSize: "0.83rem", color: "#475569", lineHeight: 1.55 }}>
                      <strong style={{ color: "#0F172A" }}>{p.titulo}</strong> — {p.texto}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
