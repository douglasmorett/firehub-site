"use client";

/**
 * "⚙️ Escolher o que sai no papel" — na pergunta "Deseja imprimir o fechamento
 * desse caixa?" (StoreTopNav). A loja liga e desliga as seções do papel do
 * fechamento; vale para este e para os próximos, e para a 2ª via do Histórico.
 *
 * Grava em `printerConfig.fechamentoNoPapel` pelo PUT de /api/store/printer-config,
 * que mescla por chave: não mexe nas impressoras nem no modelo da comanda.
 * Regra e lista em lib/secoes-do-fechamento.ts.
 */
import { useEffect, useState } from "react";
import {
  FECHAMENTO_RESUMIDO,
  SECOES_DO_FECHAMENTO,
  secoesDoFechamento,
  type ChaveDaSecao,
  type SecoesDoFechamento,
} from "@/lib/secoes-do-fechamento";

export default function SecoesDoFechamentoNoPapel() {
  const [aberto, setAberto] = useState(false);
  const [secoes, setSecoes] = useState<SecoesDoFechamento | null>(null);
  const [estado, setEstado] = useState<"" | "salvando" | "salvo" | "erro">("");

  useEffect(() => {
    if (!aberto || secoes) return;
    fetch("/api/store/printer-config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => setSecoes(secoesDoFechamento(cfg)))
      .catch(() => setSecoes(secoesDoFechamento(null)));
  }, [aberto, secoes]);

  const gravar = async (novas: SecoesDoFechamento) => {
    setSecoes(novas);
    setEstado("salvando");
    try {
      const r = await fetch("/api/store/printer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fechamentoNoPapel: novas }),
      });
      setEstado(r.ok ? "salvo" : "erro");
    } catch {
      setEstado("erro");
    }
  };

  const ligadas = secoes ? SECOES_DO_FECHAMENTO.filter((s) => secoes[s.chave]).length : 0;
  const botao = {
    flex: 1, padding: "7px 8px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff",
    color: "#334155", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
  } as const;

  return (
    <div style={{ margin: "0 0 14px", textAlign: "left" }}>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        style={{ background: "none", border: "none", color: "#2563EB", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
      >
        ⚙️ Escolher o que sai no papel {aberto ? "▲" : "▼"}
      </button>
      {aberto && (
        <div style={{ marginTop: 8, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px" }}>
          {!secoes ? (
            <div style={{ fontSize: "0.8rem", color: "#64748B" }}>Carregando…</div>
          ) : (
            <>
              <p style={{ margin: "0 0 8px", fontSize: "0.76rem", color: "#64748B", lineHeight: 1.45 }}>
                A conferência da gaveta, a diferença e o total faturado saem sempre. Vale para este
                fechamento, os próximos e a 2ª via.
              </p>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button type="button" style={botao} onClick={() => gravar({ ...FECHAMENTO_RESUMIDO })}>📄 Resumido</button>
                <button
                  type="button"
                  style={botao}
                  onClick={() => gravar(Object.fromEntries(SECOES_DO_FECHAMENTO.map((s) => [s.chave, true])) as SecoesDoFechamento)}
                >
                  📜 Completo
                </button>
              </div>
              {SECOES_DO_FECHAMENTO.map((s) => (
                <label key={s.chave} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={secoes[s.chave]}
                    onChange={(e) => gravar({ ...secoes, [s.chave as ChaveDaSecao]: e.target.checked })}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ fontSize: "0.82rem", color: "#0F172A", lineHeight: 1.35 }}>
                    <strong>{s.nome}</strong>
                    <span style={{ display: "block", fontSize: "0.72rem", color: "#64748B" }}>{s.ajuda}</span>
                  </span>
                </label>
              ))}
              <div style={{ marginTop: 6, fontSize: "0.72rem", fontWeight: 700, color: estado === "erro" ? "#C92E09" : "#0F766E", minHeight: 16 }}>
                {estado === "salvando" ? "Salvando…" : estado === "salvo" ? `✓ Salvo — ${ligadas} de ${SECOES_DO_FECHAMENTO.length} seções no papel` : estado === "erro" ? "Não consegui salvar. Tente de novo." : ""}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
