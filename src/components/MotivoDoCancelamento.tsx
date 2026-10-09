"use client";

/**
 * O campo de MOTIVO de todo cancelamento feito na loja — pedido inteiro ou
 * item (lib/motivo-do-cancelamento.ts). Uma peça só para o quadro de pedidos,
 * a edição do pedido, a mesa no tablet, no celular e o garçom: a regra do
 * "pelo menos 3 letras" é a mesma do servidor, e o botão de confirmar de quem
 * usa isto acende com `motivoValido`.
 *
 * As sugestões só preenchem o campo; a pessoa pode completar ("Cliente
 * desistiu — esperou 50 min").
 */
import { MINIMO_DO_MOTIVO, MAXIMO_DO_MOTIVO, SUGESTOES_DE_MOTIVO, motivoValido } from "@/lib/motivo-do-cancelamento";

export default function MotivoDoCancelamento({
  valor,
  aoMudar,
  rotulo = "Motivo do cancelamento",
  autoFocus = false,
  compacto = false,
}: {
  valor: string;
  aoMudar: (texto: string) => void;
  rotulo?: string;
  autoFocus?: boolean;
  /** Celular: campo de uma linha e chips menores. */
  compacto?: boolean;
}) {
  const ok = motivoValido(valor);
  const tocou = valor.trim().length > 0;
  return (
    <div style={{ marginBottom: 12, textAlign: "left" }}>
      <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 6 }}>
        {rotulo} <span style={{ color: "#B71C1C" }}>*</span>
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {SUGESTOES_DE_MOTIVO.map((s) => {
          const marcada = valor.trim() === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => aoMudar(s)}
              style={{
                padding: compacto ? "5px 10px" : "6px 12px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: compacto ? "0.74rem" : "0.78rem",
                fontWeight: 700,
                border: `1px solid ${marcada ? "#1C1917" : "#CBD5E1"}`,
                background: marcada ? "#1C1917" : "#fff",
                color: marcada ? "#fff" : "#334155",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>
      <textarea
        value={valor}
        onChange={(e) => aoMudar(e.target.value.slice(0, MAXIMO_DO_MOTIVO))}
        placeholder="Explique o que aconteceu. Aparece no fechamento do caixa."
        autoFocus={autoFocus}
        rows={compacto ? 2 : 3}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: `1.5px solid ${tocou && !ok ? "#F59E0B" : ok ? "#0F766E" : "#CBD5E1"}`,
          fontSize: "0.88rem",
          fontFamily: "inherit",
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {!ok && (
        <div style={{ fontSize: "0.74rem", color: tocou ? "#B45309" : "#64748B", marginTop: 4 }}>
          Obrigatório: escolha uma sugestão ou escreva pelo menos {MINIMO_DO_MOTIVO} letras.
        </div>
      )}
    </div>
  );
}
