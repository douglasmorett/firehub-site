"use client";
/**
 * Margem por produto — quanto sobra de cada produto vendido (preço − custo da
 * ficha técnica), o markup, e a engenharia de cardápio em linguagem simples:
 * estrela, vaca leiteira, quebra-cabeça e abacaxi, cada um com o que fazer.
 * A conta mora em lib/relatorios/margem-por-produto.ts.
 *
 * Regra da casa: produto sem custo aparece "sem custo", nunca com margem de
 * 100% — e fica fora da matriz.
 */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtPct, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import type { LinhaDeProduto, Quadrante, ResultadoDaMargem } from "@/lib/relatorios/margem-por-produto";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type InfoDoQuadrante = { rotulo: string; emoji: string; oQueE: string; oQueFazer: string };
type Resposta = ResultadoDaMargem & { lojas: string[]; periodo: { de: string; ate: string }; usaFicha: boolean; quadrantes: Record<Quadrante, InfoDoQuadrante> };
type Ordem = "margemTotal" | "quantidade" | "margemPct" | "valor" | "nome";

const ORDEM_DOS_QUADRANTES: Quadrante[] = ["estrela", "vaca", "quebraCabeca", "abacaxi"];
const COR_DO_QUADRANTE: Record<Quadrante, { cor: string; fundo: string; borda: string }> = {
  estrela: { cor: PALETA.ok, fundo: PALETA.okClaro, borda: PALETA.okBorda },
  vaca: { cor: PALETA.atencao, fundo: PALETA.atencaoClaro, borda: PALETA.atencaoBorda },
  quebraCabeca: { cor: PALETA.brasaTinta, fundo: PALETA.brasaClaro, borda: PALETA.brasaBorda },
  abacaxi: { cor: PALETA.grave, fundo: PALETA.graveClaro, borda: PALETA.graveBorda },
};

const th: React.CSSProperties = { padding: "8px 0.8rem", fontWeight: 800, whiteSpace: "nowrap", textAlign: "right" };
const td: React.CSSProperties = { padding: "8px 0.8rem", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };

export default function MargemPorProdutoClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "30d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("margem-por-produto", query);
  const [ordem, setOrdem] = useState<Ordem>("margemTotal");
  const [busca, setBusca] = useState("");
  const [quadrante, setQuadrante] = useState<Quadrante | "semCusto" | null>(null);

  const produtos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const lista = (dados?.produtos || []).filter((p) =>
      (!t || p.nome.toLowerCase().includes(t))
      && (!quadrante || (quadrante === "semCusto" ? p.custoTotal === null : p.quadrante === quadrante)));
    const n = (v: number | null) => (v === null ? -Infinity : v);
    const copia = [...lista];
    if (ordem === "nome") copia.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    else if (ordem === "quantidade") copia.sort((a, b) => b.quantidade - a.quantidade);
    else if (ordem === "valor") copia.sort((a, b) => b.valor - a.valor);
    else if (ordem === "margemPct") copia.sort((a, b) => n(b.margemPct) - n(a.margemPct));
    return copia;
  }, [dados, busca, ordem, quadrante]);

  const t = dados?.totais;
  const botaoOrdem = (o: Ordem, rotulo: string, alinhar: "left" | "right" = "right") => (
    <th style={{ ...th, textAlign: alinhar }} aria-sort={ordem === o ? (o === "nome" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => setOrdem(o)}
        style={{ border: "none", background: "none", padding: 0, font: "inherit", color: ordem === o ? PALETA.carvao : "inherit", textTransform: "inherit", letterSpacing: "inherit", fontWeight: 800, cursor: "pointer" }}>
        {rotulo}{ordem === o ? (o === "nome" ? " ▴" : " ▾") : ""}
      </button>
    </th>
  );

  return (
    <ModeloDoRelatorio
      titulo="Margem por produto"
      descricao="Quanto sobra de cada produto vendido depois do custo dos insumos (ficha técnica), o markup, e quais produtos puxam o seu lucro — em linguagem simples."
      slug="margem-por-produto" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} />

      {dados && !dados.usaFicha && (
        <Bloco titulo="Comece pela ficha técnica" subtitulo="Sem custo, não há margem para mostrar.">
          <p style={{ margin: "0 0 0.8rem", fontSize: "0.88rem", lineHeight: 1.6, color: PALETA.carvao2 }}>
            Cadastre a ficha técnica dos produtos (ou o custo de cada um) e a margem aparece aqui na hora, inclusive das vendas que já passaram.
          </p>
          <Link href="/store/estoque" className="btn btn-outline" style={{ textDecoration: "none" }}>Abrir Estoque → Fichas técnicas</Link>
        </Bloco>
      )}

      {dados && t && (
        <GradeDeCartoes>
          <Cartao rotulo="Vendido em produtos" valor={fmtReais(t.valor)} detalhe={`${fmtQtd(t.quantidade)} itens · sem taxa de entrega`} />
          <Cartao rotulo="Sobra depois dos insumos" valor={t.margemPct === null ? "—" : fmtReais(t.margem)} tom={t.margemPct === null ? "neutro" : "ok"}
            detalhe={t.margemPct === null ? "Nenhum produto com custo" : `${fmtPct(t.margemPct)} das vendas com custo (${fmtReais(t.valorComCusto)})`} />
          <Cartao rotulo="Vendas com custo" valor={t.coberturaPct === null ? "—" : fmtPct(t.coberturaPct, 0)}
            tom={t.coberturaPct === null ? "neutro" : t.coberturaPct >= 95 ? "ok" : t.coberturaPct >= 60 ? "atencao" : "grave"}
            detalhe="Quanto do vendido tem ficha ou custo cadastrado" />
          <Cartao rotulo="Produtos sem custo" valor={String(t.produtosSemCusto)} tom={t.produtosSemCusto ? "atencao" : "ok"}
            detalhe={t.produtosSemCusto ? "Aparecem como “sem custo”, fora da margem" : "Todos com custo"} />
        </GradeDeCartoes>
      )}

      {dados && dados.matriz.margemMedia !== null && (dados.matriz.contagem.estrela + dados.matriz.contagem.vaca + dados.matriz.contagem.quebraCabeca + dados.matriz.contagem.abacaxi) > 0 && (
        <Bloco titulo="Seu cardápio em 4 grupos"
          subtitulo={`Pelo quanto vende (popular = ${fmtPct(dados.matriz.corteDePopularidadePct ?? 0)} ou mais das unidades vendidas) e pelo quanto sobra em cada venda (a média é ${fmtReais(dados.matriz.margemMedia)} por item). Toque num grupo para ver os produtos.`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "0.75rem" }}>
            {ORDEM_DOS_QUADRANTES.map((q) => {
              const info = dados.quadrantes[q];
              const c = COR_DO_QUADRANTE[q];
              const ativo = quadrante === q;
              const exemplos = dados.produtos.filter((p) => p.quadrante === q).sort((a, b) => b.quantidade - a.quantidade).slice(0, 3);
              return (
                <button key={q} type="button" onClick={() => setQuadrante(ativo ? null : q)} aria-pressed={ativo}
                  style={{ textAlign: "left", background: c.fundo, border: `${ativo ? 2.5 : 1}px solid ${ativo ? c.cor : c.borda}`, borderRadius: 14, padding: "0.85rem 0.95rem", cursor: "pointer", fontFamily: "inherit", color: PALETA.carvao }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontWeight: 900, fontSize: "1rem", color: c.cor }}>{info.emoji} {info.rotulo}</span>
                    <span style={{ fontWeight: 900, fontSize: "1.3rem", color: c.cor }}>{dados.matriz.contagem[q]}</span>
                  </div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 700, marginTop: 4 }}>{info.oQueE}</div>
                  <div style={{ fontSize: "0.78rem", color: PALETA.carvao2, marginTop: 4, lineHeight: 1.45 }}>{info.oQueFazer}</div>
                  {exemplos.length > 0 && <div style={{ fontSize: "0.74rem", color: PALETA.areiaTinta, marginTop: 6 }}>Ex.: {exemplos.map((p) => p.nome).join(", ")}</div>}
                </button>
              );
            })}
          </div>
        </Bloco>
      )}

      {dados && (
        <Bloco semPadding
          titulo={quadrante === "semCusto" ? "Produtos sem custo" : quadrante ? `${dados.quadrantes[quadrante].emoji} ${dados.quadrantes[quadrante].rotulo}` : "Todos os produtos vendidos"}
          subtitulo="Margem = preço − custo dos insumos. Markup = quantas vezes o preço cobre o custo (3 = vende pelo triplo do que custa)."
          acoes={
            <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {quadrante && <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} onClick={() => setQuadrante(null)}>Ver todos</button>}
              {!quadrante && (t?.produtosSemCusto || 0) > 0 && <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} onClick={() => setQuadrante("semCusto")}>Só os sem custo ({t?.produtosSemCusto})</button>}
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…" aria-label="Buscar produto"
                style={{ padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.85rem", fontFamily: "inherit", width: 200 }} />
            </div>
          }>
          {produtos.length === 0 ? <Vazio texto={busca ? `Nenhum produto com “${busca}”.` : "Nenhum produto vendido no período e filtros escolhidos."} /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 900 }}>
                <thead>
                  <tr style={{ color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                    {botaoOrdem("nome", "Produto", "left")}
                    {botaoOrdem("quantidade", "Qtde")}
                    <th style={th}>Preço médio</th>
                    <th style={th}>Custo un.</th>
                    <th style={th}>Sobra un.</th>
                    {botaoOrdem("margemTotal", "Sobra total")}
                    {botaoOrdem("margemPct", "Margem %")}
                    <th style={th}>Markup</th>
                    {botaoOrdem("valor", "% das vendas")}
                  </tr>
                </thead>
                <tbody>
                  {produtos.map((p: LinhaDeProduto) => {
                    const sem = p.custoTotal === null;
                    const parcial = !sem && p.quantidadeComCusto < p.quantidade;
                    const q = p.quadrante ? dados.quadrantes[p.quadrante] : null;
                    return (
                      <tr key={p.chave} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                        <td style={{ ...td, textAlign: "left", whiteSpace: "normal", minWidth: 180 }}>
                          <div style={{ fontWeight: 700 }}>{p.nome}</div>
                          {q && p.quadrante && <span style={{ fontSize: "0.7rem", fontWeight: 800, color: COR_DO_QUADRANTE[p.quadrante].cor }}>{q.emoji} {q.rotulo}</span>}
                          {sem && <div style={{ fontSize: "0.72rem", color: PALETA.atencao, fontWeight: 700 }}>{p.faltas.join("; ") || "sem custo"}</div>}
                          {parcial && <div style={{ fontSize: "0.72rem", color: PALETA.atencao }}>Margem de {fmtQtd(p.quantidadeComCusto)} de {fmtQtd(p.quantidade)} vendidos (o resto sem custo: {p.faltas.join("; ")})</div>}
                        </td>
                        <td style={{ ...td, fontWeight: 700 }}>{fmtQtd(p.quantidade)}</td>
                        <td style={td}>{fmtReais(p.precoMedio)}</td>
                        <td style={{ ...td, color: sem ? PALETA.atencao : PALETA.carvao2, fontWeight: sem ? 700 : 500 }}>{sem ? "sem custo" : fmtReais(p.custoUnitario)}</td>
                        <td style={{ ...td, color: p.margemUnitaria !== null && p.margemUnitaria < 0 ? PALETA.grave : PALETA.carvao }}>{sem ? "—" : fmtReais(p.margemUnitaria)}</td>
                        <td style={{ ...td, fontWeight: 900, color: p.margemTotal !== null && p.margemTotal < 0 ? PALETA.grave : PALETA.carvao }}>{sem ? "—" : fmtReais(p.margemTotal)}</td>
                        <td style={td}>{p.margemPct === null ? "—" : fmtPct(p.margemPct)}</td>
                        <td style={td}>{p.markup === null ? "—" : `${p.markup.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`}</td>
                        <td style={{ ...td, minWidth: 120 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                            <div style={{ flex: 1, maxWidth: 70 }}><BarraDePct pct={p.pctDoFaturamento} /></div>
                            <span style={{ color: PALETA.areiaTinta, minWidth: 44 }}>{fmtPct(p.pctDoFaturamento)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.6 }}>
          Valor = preço × quantidade dos itens (sem taxa de entrega; na mesa, sem os 10%). Custo = a ficha técnica × o custo de cada insumo no dia da venda (a última compra até aquele dia),
          ou o custo digitado no produto. Combo: a ficha dele mais a das opções escolhidas. Produto sem ficha nem custo aparece como “sem custo” e fica fora da sobra e dos 4 grupos — sem custo, não há lucro para mostrar.
          Os 4 grupos só comparam produtos com custo: popular é quem vende ao menos 70% da fatia média; sobra alta é a sobra por item igual ou acima da média do cardápio.
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
