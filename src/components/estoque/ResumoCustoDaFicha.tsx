"use client";

type Resumo = { custo: number | null; margem: number | null; cmvPct: number | null; margemBaixa: boolean; falta: string | null };
const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export default function ResumoCustoDaFicha({ resumo, teto, carregando, erro }: { resumo?: Resumo | null; teto: number; carregando?: boolean; erro?: string }) {
  const cor = resumo?.custo == null ? "#92400e" : resumo.margemBaixa ? "#b91c1c" : "#047857";
  return <div style={{ padding: "10px 12px", borderRadius: 10, background: "#f8fafc", margin: "10px 0", fontSize: 13 }} aria-live="polite">
    {carregando ? "Atualizando custos…" : erro ? <span role="alert">{erro}</span> : !resumo ? "Custos indisponíveis" : <>
      <div style={{ display: "flex", gap: "6px 18px", flexWrap: "wrap" }}>
        <strong>Custo da ficha: {resumo.custo == null ? "—" : moeda(resumo.custo)}</strong>
        <span>CMV teórico: {resumo.cmvPct == null ? "—" : `${resumo.cmvPct.toLocaleString("pt-BR")}%`}</span>
        <span>Margem: {resumo.margem == null ? "—" : moeda(resumo.margem)}</span>
      </div>
      <div style={{ marginTop: 5, color: cor, fontWeight: 700 }}>{resumo.falta || (resumo.cmvPct == null ? "Informe o preço de venda para calcular o CMV" : resumo.margemBaixa ? "CMV acima da meta ou margem negativa" : "CMV dentro da meta")}</div>
      <small style={{ color: "#64748b" }}>Meta de CMV: {teto.toLocaleString("pt-BR")}% · Margem antes das demais despesas.</small>
    </>}
  </div>;
}
