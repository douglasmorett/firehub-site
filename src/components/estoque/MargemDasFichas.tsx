"use client";
/**
 * "Custo e margem das fichas" no topo da aba Fichas Técnicas: custo da ficha
 * HOJE × preço de venda de cada produto → margem em R$ e %, CMV teórico,
 * vendidos em 30 dias. Destaca margem baixa (CMV teórico acima da meta de CMV
 * da loja, 40% sem meta, ou margem negativa) e produto vendido sem ficha. Só para dados sensíveis.
 *
 * Dados de /api/store/estoque/margens (lib/estoque/analise-no-banco.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Settings } from "lucide-react";
import type { MargemDoProduto } from "@/lib/estoque/analise-no-banco";

type Coluna = "nome" | "preco" | "custo" | "margem" | "margemPct" | "cmvPct" | "vendidos30";
type Filtro = "todos" | "baixa" | "semFicha";

const fmtR = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const fmtP = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

export default function MargemDasFichas({ onAbrirFicha }: { onAbrirFicha: (produtoId: string) => void }) {
  const [produtos, setProdutos] = useState<MargemDoProduto[] | null>(null);
  const [teto, setTeto] = useState(40);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: "vendidos30", desc: true });

  useEffect(() => {
    let vivo = true;
    fetch("/api/store/estoque/margens")
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d?.error || "Não deu para carregar."); return d; })
      .then((d) => { if (vivo) { setProdutos(d.produtos); setTeto(d.teto); } })
      .catch((e) => vivo && setErro(e?.message));
    return () => { vivo = false; };
  }, []);

  const resumo = useMemo(() => {
    const l = produtos || [];
    const comCusto = l.filter((p) => p.cmvPct != null && p.vendidos30 > 0);
    const receita = comCusto.reduce((s, p) => s + p.preco * p.vendidos30, 0);
    const custo = comCusto.reduce((s, p) => s + (p.custo || 0) * p.vendidos30, 0);
    return {
      baixa: l.filter((p) => p.margemBaixa).length,
      semFicha: l.filter((p) => !p.temFicha && p.vendidos30 > 0).length,
      cmvMedio: receita > 0 ? Math.round((custo / receita) * 1000) / 10 : null,
    };
  }, [produtos]);

  const visiveis = useMemo(() => {
    const l = (produtos || []).filter((p) => filtro === "baixa" ? p.margemBaixa : filtro === "semFicha" ? !p.temFicha && p.vendidos30 > 0 : true);
    return [...l].sort((a, b) => {
      const va = a[ordem.col], vb = b[ordem.col];
      const r = typeof va === "string" ? va.localeCompare(String(vb), "pt-BR") : (Number(va ?? -Infinity) - Number(vb ?? -Infinity));
      return ordem.desc ? -r : r;
    });
  }, [produtos, filtro, ordem]);

  const th = (col: Coluna, rotulo: string, direita = true) => (
    <th style={{ textAlign: direita ? "right" : "left", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}
      onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : col !== "nome" }))}>
      {rotulo}{ordem.col === col ? (ordem.desc ? " ↓" : " ↑") : ""}
    </th>
  );

  return (
    <section style={{ background: "#fff", border: "1px solid #E7DDD3", borderRadius: 14, marginBottom: "1rem" }}>
      <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        {aberto ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <span style={{ fontWeight: 900, fontSize: "1rem", flex: 1 }}>💰 Custo e margem das fichas</span>
        {produtos && (
          <span style={{ fontSize: "0.8rem", color: "#475569", fontWeight: 700 }}>
            CMV teórico das vendas de 30 dias: <strong style={{ color: "#1C1917" }}>{fmtP(resumo.cmvMedio)}</strong>
            {resumo.baixa > 0 && <span style={{ color: "#B91C1C" }}> · {resumo.baixa} com margem baixa</span>}
            {resumo.semFicha > 0 && <span style={{ color: "#B45309" }}> · {resumo.semFicha} vendido(s) sem ficha</span>}
          </span>
        )}
      </button>
      {aberto && (
        <div style={{ padding: "0 14px 14px" }}>
          {erro && <p style={{ color: "#B91C1C", fontSize: "0.85rem" }}>{erro}</p>}
          {!produtos && !erro && <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Calculando o custo das fichas...</p>}
          {produtos && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {([["todos", `Todos · ${produtos.length}`], ["baixa", `Margem baixa · ${resumo.baixa}`], ["semFicha", `Vendido sem ficha · ${resumo.semFicha}`]] as [Filtro, string][]).map(([id, rotulo]) => (
                  <button key={id} type="button" onClick={() => setFiltro(id)}
                    style={{ fontSize: "0.78rem", fontWeight: 700, padding: "6px 11px", borderRadius: 999, border: "1px solid #E7DDD3", cursor: "pointer", background: filtro === id ? "#1C1917" : "#FAF6F2", color: filtro === id ? "#fff" : "#1C1917" }}>
                    {rotulo}
                  </button>
                ))}
              </div>
              <div className="items-table-wrapper" style={{ maxHeight: 460, overflowY: "auto" }}>
                <table className="items-table" style={{ fontSize: "0.85rem" }}>
                  <thead>
                    <tr>
                      {th("nome", "Produto", false)}
                      {th("preco", "Preço")}
                      {th("custo", "Custo da ficha")}
                      {th("margem", "Margem")}
                      {th("margemPct", "Margem %")}
                      {th("cmvPct", "CMV teórico")}
                      {th("vendidos30", "Vendidos 30 d")}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((p) => {
                      const semFichaVendido = !p.temFicha && p.vendidos30 > 0;
                      return (
                        <tr key={p.id} style={{ background: p.margemBaixa ? "#FEF2F2" : semFichaVendido ? "#FFFBEB" : undefined }}>
                          <td className="name-col">
                            {p.nome}
                            <span style={{ display: "block", fontSize: "0.72rem", color: "#94A3B8", fontWeight: 600 }}>{p.categoria}</span>
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtR(p.preco)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{p.custo != null ? fmtR(p.custo) : <span style={{ color: "#B45309", fontWeight: 700 }}>{p.falta}</span>}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 800, color: p.margem != null && p.margem < 0 ? "#B91C1C" : undefined }}>{fmtR(p.margem)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtP(p.margemPct)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 800, color: p.margemBaixa ? "#B91C1C" : "#334155" }}>{fmtP(p.cmvPct)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{p.vendidos30.toLocaleString("pt-BR")}</td>
                          <td style={{ textAlign: "right" }}>
                            <button type="button" className="btn-action btn-move" onClick={() => onAbrirFicha(p.id)}><Settings size={12} /> Ficha</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p style={{ fontSize: "0.74rem", color: "#94A3B8", margin: "6px 0 0" }}>
                Custo da ficha pelo custo de hoje de cada insumo (última compra). Vermelho: CMV teórico acima de {teto.toLocaleString("pt-BR")}% (a meta de CMV da loja; sem meta, 40%) ou margem negativa.
                Amarelo: vendido nos últimos 30 dias sem ficha técnica (o estoque não baixa).
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
