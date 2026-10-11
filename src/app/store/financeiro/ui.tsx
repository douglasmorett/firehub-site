"use client";
/**
 * Pedaços visuais das abas do Financeiro (cartão de número, linha do DRE) e
 * os formatadores de dinheiro e percentual.
 */
import type { ReactNode } from "react";

// `minimumFractionDigits: 2` sozinho deixa o MÁXIMO em 3 (padrão do Intl), e aí
// 286.0005 vira "R$ 286,001" e 51.2314 vira "R$ 51,231" — foi o que fez um saldo
// de R$ 286,00 parecer R$ 286 mil na tela. Contas percentuais (comissão,
// cashback, desconto) produzem essas dízimas o tempo todo.
export function fmtR(v: number) {
  return `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(v: number, casas = 1) {
  return `${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

export function fmtNum(v: number) {
  return (Number(v) || 0).toLocaleString("pt-BR");
}

export function KPICard({ icon, label, value, sub, color, alerta }: {
  icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; color: string;
  /** O número não é para ser lido como verdade (resultado incompleto). */
  alerta?: boolean;
}) {
  return (
    <div style={{
      background: alerta ? "#FFF7E6" : "#fff", borderRadius: "16px", padding: "20px 22px",
      boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: alerta ? "1.5px solid #F59E0B" : "1px solid #F1F5F9",
      display: "flex", flexDirection: "column", gap: "8px",
    }}>
      <div style={{ width: 40, height: 40, borderRadius: "10px", background: color + "15", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </div>
      <div>
        <p style={{ fontSize: "0.78rem", color: "#64748B", margin: 0 }}>{label}</p>
        <div style={{ fontSize: "1.35rem", fontWeight: 800, color: alerta ? "#92400E" : "#0F172A", margin: 0 }}>{value}</div>
        {sub && <div style={{ fontSize: "0.72rem", color: alerta ? "#92400E" : "#94A3B8", margin: 0, lineHeight: 1.45 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function DRERow({ label, value, indent = 0, bold = false, color = "#0F172A", border = false, detalhe }: {
  label: ReactNode; value: number | ReactNode; indent?: number; bold?: boolean; color?: string; border?: boolean;
  /** Linha pequena embaixo, explicando de onde saiu o número. */
  detalhe?: ReactNode;
}) {
  return (
    <div style={{
      padding: `${border ? "12px" : "8px"} 16px ${border ? "12px" : "8px"} ${16 + indent * 16}px`,
      borderTop: border ? "2px solid #E2E8F0" : "1px solid #F1F5F9",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        fontWeight: bold ? 800 : 400, fontSize: bold ? "0.95rem" : "0.87rem",
      }}>
        <span style={{ color: "#475569" }}>{label}</span>
        <span style={{ color, fontWeight: bold ? 800 : 600, whiteSpace: "nowrap" }}>{typeof value === "number" ? fmtR(value) : value}</span>
      </div>
      {detalhe && <div style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 2, lineHeight: 1.45 }}>{detalhe}</div>}
    </div>
  );
}

export function TituloDaSecao({ children, cor, fundo }: { children: ReactNode; cor: string; fundo: string }) {
  return (
    <div style={{ padding: "12px 24px 4px", background: fundo }}>
      <span style={{ fontSize: "0.72rem", fontWeight: 800, color: cor, letterSpacing: 1 }}>{children}</span>
    </div>
  );
}
