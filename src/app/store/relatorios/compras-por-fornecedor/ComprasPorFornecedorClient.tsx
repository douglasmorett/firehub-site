"use client";
/**
 * Compras por fornecedor — quanto foi comprado de cada fornecedor e de cada
 * insumo no período, o preço médio, e o ALERTA do insumo que subiu de preço
 * na última compra. A conta mora em lib/relatorios/compras-por-fornecedor.ts.
 */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtPct, fmtReais } from "@/lib/relatorios/base";
import { quantidadeLegivel } from "@/lib/relatorios/consumo-pela-ficha";
import type { ResultadoDasCompras } from "@/lib/relatorios/compras-por-fornecedor";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = ResultadoDasCompras & { lojas: string[]; periodo: { de: string; ate: string } };
const th: React.CSSProperties = { padding: "8px 0.8rem", fontWeight: 800, whiteSpace: "nowrap", textAlign: "right" };
const td: React.CSSProperties = { padding: "8px 0.8rem", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };

/** Custo por grama é R$ 0,0450: com duas casas viraria "R$ 0,05". */
function fmtPreco(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1) return fmtReais(n);
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export default function ComprasPorFornecedorClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "30d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("compras-por-fornecedor", query);
  const [fornecedor, setFornecedor] = useState<string | null>(null);
  // O mesmo fornecedor com letra diferente é um só (a lib junta pela mesma chave).
  const chave = (f: string) => f.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const insumos = useMemo(() => (dados?.insumos || []).filter((i) => !fornecedor || i.fornecedores.some((f) => chave(f) === chave(fornecedor))), [dados, fornecedor]);

  return (
    <ModeloDoRelatorio titulo="Compras por fornecedor"
      descricao="Quanto você comprou de cada fornecedor e de cada insumo, o preço médio — e o aviso do insumo que ficou mais caro na última compra."
      slug="compras-por-fornecedor" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>
      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ horario: false, tipos: false, canais: false, marcas: false }} />

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Comprado no período" valor={fmtReais(dados.totais.total)} detalhe={`${dados.totais.compras} compra${dados.totais.compras === 1 ? "" : "s"} · ${dados.totais.insumos} insumo${dados.totais.insumos === 1 ? "" : "s"}`} />
          <Cartao rotulo="Fornecedores" valor={String(dados.fornecedores.length)} detalhe={dados.fornecedores[0] ? `O maior: ${dados.fornecedores[0].fornecedor} (${fmtPct(dados.fornecedores[0].pct, 0)})` : "Nenhuma compra"} />
          <Cartao rotulo="Subiram de preço" valor={String(dados.alertas.length)} tom={dados.alertas.length ? "grave" : "ok"} detalhe="5% ou mais contra a compra anterior" />
        </GradeDeCartoes>
      )}

      {dados && dados.alertas.length > 0 && (
        <Bloco titulo="⚠️ Ficaram mais caros" subtitulo="A última compra do período contra a compra anterior do mesmo insumo. Vale cotar com outro fornecedor ou rever o preço do cardápio.">
          <div style={{ display: "grid", gap: 8 }}>
            {dados.alertas.map((a) => (
              <div key={a.stockItemId} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, borderRadius: 10, padding: "0.6rem 0.8rem", fontSize: "0.85rem" }}>
                <span><strong>{a.nome}</strong>: {fmtPreco(a.precoAnterior)} ({a.diaAnterior ? fmtDia(a.diaAnterior) : "—"}{a.fornecedorAnterior ? `, ${a.fornecedorAnterior}` : ""}) → <strong>{fmtPreco(a.ultimoPreco)}</strong> ({fmtDia(a.ultimoDia)}, {a.ultimoFornecedor}) por {a.unidade}</span>
                <strong style={{ color: PALETA.grave }}>+{fmtPct(a.variacaoPct ?? 0)}</strong>
              </div>
            ))}
          </div>
        </Bloco>
      )}

      {dados && (
        <Bloco titulo="Por fornecedor" subtitulo="Toque num fornecedor para ver só os insumos dele."
          acoes={<Link href="/store/estoque/compras" className="fh-sem-impressao" style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.marca, textDecoration: "none" }}>Lançar compra →</Link>}>
          {dados.fornecedores.length === 0 ? <Vazio texto="Nenhuma compra lançada no período." /> : (
            <div style={{ display: "grid", gap: 8 }}>
              {dados.fornecedores.map((f) => (
                <button key={f.fornecedor} type="button" onClick={() => setFornecedor(fornecedor === f.fornecedor ? null : f.fornecedor)} aria-pressed={fornecedor === f.fornecedor}
                  style={{ display: "grid", gridTemplateColumns: "minmax(140px, 240px) 1fr 120px", gap: 10, alignItems: "center", padding: "6px 8px", borderRadius: 10, border: `1.5px solid ${fornecedor === f.fornecedor ? PALETA.marca : "transparent"}`, background: fornecedor === f.fornecedor ? PALETA.brasaClaro : "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: PALETA.carvao }}>
                  <span style={{ fontWeight: 800, fontSize: "0.86rem" }}>{f.fornecedor}<span style={{ display: "block", fontWeight: 500, color: PALETA.areiaTinta, fontSize: "0.74rem" }}>{f.compras} compra{f.compras === 1 ? "" : "s"} · {f.insumos} insumo{f.insumos === 1 ? "" : "s"} · última {fmtDia(f.ultima)}</span></span>
                  <BarraDePct pct={f.pct} />
                  <span style={{ textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtReais(f.total)}</span>
                </button>
              ))}
            </div>
          )}
        </Bloco>
      )}

      {dados && insumos.length > 0 && (
        <Bloco semPadding titulo={fornecedor ? `Insumos de ${fornecedor}` : "Por insumo"} subtitulo="Preço por unidade do estoque (o grama, o litro, a unidade).">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 760 }}>
              <thead><tr style={{ color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                <th style={{ ...th, textAlign: "left" }}>Insumo</th><th style={th}>Comprado</th><th style={th}>Total</th><th style={th}>Preço médio</th><th style={th}>Último preço</th><th style={th}>Antes</th><th style={th}>Variação</th>
              </tr></thead>
              <tbody>{insumos.map((i) => (
                <tr key={i.stockItemId} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                  <td style={{ ...td, textAlign: "left", whiteSpace: "normal", minWidth: 160 }}>
                    <div style={{ fontWeight: 700 }}>{i.nome}</div>
                    <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>{i.compras} compra{i.compras === 1 ? "" : "s"} · {i.fornecedores.join(", ")}</div>
                  </td>
                  <td style={td}>{quantidadeLegivel(i.quantidade, i.unidade)}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{fmtReais(i.valor)}</td>
                  <td style={td}>{fmtPreco(i.precoMedio)}</td>
                  <td style={td}>{fmtPreco(i.ultimoPreco)}</td>
                  <td style={{ ...td, color: PALETA.areiaTinta }}>{fmtPreco(i.precoAnterior)}</td>
                  <td style={{ ...td, fontWeight: 800, color: i.variacaoPct == null ? PALETA.areiaTinta : i.variacaoPct > 0 ? PALETA.grave : i.variacaoPct < 0 ? PALETA.ok : PALETA.carvao2 }}>
                    {i.variacaoPct == null ? "—" : `${i.variacaoPct > 0 ? "+" : ""}${fmtPct(i.variacaoPct)}`}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Bloco>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.6 }}>
          Entram as compras lançadas em Estoque › Compras (nota lida pela IA ou compra sem nota), pelo dia em que a mercadoria entrou. Compra desfeita não entra.
          O valor é o que entrou no estoque (quantidade × custo de cada item), não o total da nota. A variação compara a última compra do período com a compra anterior do mesmo insumo, mesmo que antes do período (até 6 meses).
          O fornecedor é o escrito na compra; o mesmo nome com letra diferente vira um só.
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
