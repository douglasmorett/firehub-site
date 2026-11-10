"use client";

import { Copy, Plus } from "lucide-react";

export default function EscolhaDePergunta({ onUsarExistente, onCriarNova }: {
  onUsarExistente: () => void;
  onCriarNova: () => void;
}) {
  const botao: React.CSSProperties = {
    flex: "1 1 220px", display: "flex", alignItems: "flex-start", gap: 10,
    textAlign: "left", padding: "13px 14px", borderRadius: 12,
    cursor: "pointer", fontFamily: "inherit", minWidth: 0,
  };
  return (
    <section aria-label="Adicionar pergunta" style={{ marginBottom: "1rem" }}>
      <p style={{ margin: "0 0 8px", fontSize: "0.84rem", fontWeight: 800, color: "#0F172A" }}>
        Como você quer adicionar a pergunta?
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={onUsarExistente}
          style={{ ...botao, border: "2px solid #0F766E", background: "#F0FDFA", color: "#115E59" }}>
          <Copy size={19} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong style={{ display: "block", fontSize: "0.87rem" }}>Usar pergunta existente</strong>
            <span style={{ display: "block", fontSize: "0.74rem", lineHeight: 1.5, marginTop: 3 }}>
              Buscar uma pergunta pronta e aproveitar as opções já cadastradas.
            </span>
          </span>
        </button>
        <button type="button" onClick={onCriarNova}
          style={{ ...botao, border: "1.5px solid #CBD5E1", background: "#FFF", color: "#334155" }}>
          <Plus size={19} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong style={{ display: "block", fontSize: "0.87rem" }}>Criar nova pergunta</strong>
            <span style={{ display: "block", fontSize: "0.74rem", lineHeight: 1.5, marginTop: 3 }}>
              Começar do zero quando a pergunta ainda não existe no cardápio.
            </span>
          </span>
        </button>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: "0.73rem", lineHeight: 1.5, color: "#64748B" }}>
        Ao reutilizar, você confere as opções, regras e valores antes de salvar.
      </p>
    </section>
  );
}
