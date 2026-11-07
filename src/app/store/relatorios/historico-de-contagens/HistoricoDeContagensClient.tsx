"use client";
/**
 * Histórico das contagens — em cada contagem fechada, quanto faltou e quanto
 * sobrou em R$ (contado × o que o sistema dizia), e os insumos que mais somem
 * no período. A conta mora em lib/relatorios/historico-de-contagens.ts.
 */
import React, { useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtReais } from "@/lib/relatorios/base";
import { quantidadeLegivel } from "@/lib/relatorios/consumo-pela-ficha";
import type { ResultadoDoHistorico } from "@/lib/relatorios/historico-de-contagens";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = ResultadoDoHistorico & { lojas: string[]; periodo: { de: string; ate: string } };
const th: React.CSSProperties = { padding: "8px 0.8rem", fontWeight: 800, whiteSpace: "nowrap", textAlign: "right" };
const td: React.CSSProperties = { padding: "8px 0.8rem", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };
const corDoValor = (v: number | null) => (v == null ? PALETA.areiaTinta : v < 0 ? PALETA.grave : v > 0 ? PALETA.ok : PALETA.carvao2);
const sinal = (v: number | null) => (v == null ? "sem custo" : `${v > 0 ? "+" : ""}${fmtReais(v)}`);

export default function HistoricoDeContagensClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "30d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("historico-de-contagens", query);
  const [aberta, setAberta] = useState<string | null>(null);
  const t = dados?.totais;

  return (
    <ModeloDoRelatorio titulo="Histórico das contagens"
      descricao="Em cada contagem fechada: o que o sistema dizia, o que foi contado e a diferença em R$. E os insumos que mais somem — onde está o furo do estoque."
      slug="historico-de-contagens" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>
      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ horario: false, tipos: false, canais: false, marcas: false }} />

      {dados && t && (
        <GradeDeCartoes>
          <Cartao rotulo="Faltou nas contagens" valor={fmtReais(t.faltou)} tom={t.faltou < 0 ? "grave" : "ok"} detalhe="Contado abaixo do sistema" />
          <Cartao rotulo="Sobrou" valor={fmtReais(t.sobrou)} detalhe="Contado acima do sistema" />
          <Cartao rotulo="Diferença no período" valor={sinal(t.liquido)} tom={t.liquido < 0 ? "grave" : "neutro"} detalhe={`${t.contagens} contage${t.contagens === 1 ? "m" : "ns"} fechada${t.contagens === 1 ? "" : "s"}`} />
        </GradeDeCartoes>
      )}

      {dados && dados.queSomem.length > 0 && (
        <Bloco semPadding titulo="Os insumos que mais somem" subtitulo="Somando todas as contagens do período. Falta que se repete é perda sem lançar, porção maior que a ficha ou desvio.">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 520 }}>
              <thead><tr style={{ color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                <th style={{ ...th, textAlign: "left" }}>Insumo</th><th style={th}>Em quantas contagens</th><th style={th}>Faltou</th><th style={th}>Em R$</th>
              </tr></thead>
              <tbody>{dados.queSomem.slice(0, 15).map((q) => (
                <tr key={q.stockItemId} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                  <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{q.nome}</td>
                  <td style={td}>{q.contagens}</td>
                  <td style={{ ...td, color: PALETA.grave }}>{quantidadeLegivel(q.diferenca, q.unidade)}</td>
                  <td style={{ ...td, fontWeight: 800, color: corDoValor(q.valor) }}>{sinal(q.valor)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Bloco>
      )}

      {dados && (
        <Bloco semPadding titulo="Contagens fechadas" subtitulo="Toque numa contagem para ver item por item."
          acoes={<Link href="/store/estoque/contagem" className="fh-sem-impressao" style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.marca, textDecoration: "none" }}>Fazer uma contagem →</Link>}>
          {dados.contagens.length === 0 ? <Vazio texto="Nenhuma contagem fechada no período." /> : dados.contagens.map((c) => (
            <div key={c.id} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
              <button type="button" onClick={() => setAberta(aberta === c.id ? null : c.id)} aria-expanded={aberta === c.id}
                style={{ width: "100%", display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "0.75rem 1rem", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: PALETA.carvao }}>
                <span>
                  <strong>{fmtDia(c.dia)}</strong> <span style={{ fontSize: "0.78rem", color: PALETA.areiaTinta }}>· {c.tipo === "RAPIDA" ? "rápida" : "completa"} · {c.contados} contados · {c.comDiferenca} com diferença{c.valorTotal != null ? ` · estoque ${fmtReais(c.valorTotal)}` : ""}</span>
                </span>
                <span style={{ fontWeight: 900, color: corDoValor(c.liquido), fontVariantNumeric: "tabular-nums" }}>{sinal(c.liquido)}</span>
              </button>
              {aberta === c.id && (
                <div style={{ overflowX: "auto", padding: "0 0 0.6rem" }}>
                  {c.diferencas.length === 0 ? <Vazio texto="Tudo bateu: nenhum item contado com diferença." /> : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem", minWidth: 560 }}>
                      <thead><tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase" }}>
                        <th style={{ ...th, textAlign: "left" }}>Insumo</th><th style={th}>Sistema dizia</th><th style={th}>Contado</th><th style={th}>Diferença</th><th style={th}>R$</th>
                      </tr></thead>
                      <tbody>{c.diferencas.map((d) => (
                        <tr key={d.stockItemId} style={{ borderTop: `1px solid ${PALETA.areia}` }}>
                          <td style={{ ...td, textAlign: "left", fontWeight: 700 }}>{d.nome}</td>
                          <td style={td}>{quantidadeLegivel(d.sistema, d.unidade)}</td>
                          <td style={td}>{quantidadeLegivel(d.contado, d.unidade)}</td>
                          <td style={{ ...td, color: d.diferenca < 0 ? PALETA.grave : PALETA.ok }}>{d.diferenca > 0 ? "+" : ""}{quantidadeLegivel(d.diferenca, d.unidade)}</td>
                          <td style={{ ...td, fontWeight: 800, color: corDoValor(d.valor) }}>{sinal(d.valor)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </Bloco>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.6 }}>
          Diferença = o contado menos o que o sistema dizia na hora de fechar, × o custo do insumo naquele dia. Só o item contado entra (o carregado da contagem anterior não foi conferido).
          Negativo = faltou na prateleira; positivo = sobrou (entrada sem lançar, ou a ficha técnica gasta mais do que a porção real). Item sem custo aparece com a quantidade e fica fora do R$.
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
