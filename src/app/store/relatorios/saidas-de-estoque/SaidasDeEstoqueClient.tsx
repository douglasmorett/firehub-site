"use client";
/**
 * Saídas de estoque — tudo o que saiu sem ser venda, por motivo (vencido,
 * quebra, consumo interno, cancelado já feito…), com o custo. A conta mora em
 * lib/relatorios/saidas-de-estoque.ts.
 */
import React, { useMemo, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtReais } from "@/lib/relatorios/base";
import { quantidadeLegivel } from "@/lib/relatorios/consumo-pela-ficha";
import { MOTIVOS_DE_SAIDA, type MotivoDaSaida, type ResultadoDasSaidas } from "@/lib/relatorios/saidas-de-estoque";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = ResultadoDasSaidas & { lojas: string[]; periodo: { de: string; ate: string }; tz: string };
const ROTULO = new Map(MOTIVOS_DE_SAIDA.map((m) => [m.chave, m.rotulo]));
const th: React.CSSProperties = { padding: "8px 0.8rem", fontWeight: 800, whiteSpace: "nowrap", textAlign: "left" };
const td: React.CSSProperties = { padding: "8px 0.8rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

export default function SaidasDeEstoqueClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "30d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("saidas-de-estoque", query);
  const [motivo, setMotivo] = useState<MotivoDaSaida | null>(null);
  const linhas = useMemo(() => (dados?.linhas || []).filter((l) => !motivo || l.motivo === motivo), [dados, motivo]);
  const maior = Math.max(0, ...(dados?.porMotivo || []).map((m) => m.valor));
  const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: dados?.tz || "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <ModeloDoRelatorio titulo="Saídas de estoque"
      descricao="Tudo o que saiu do estoque sem ser venda — perda, vencido, quebra, consumo interno, pedido cancelado já feito — e quanto isso custou."
      slug="saidas-de-estoque" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>
      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ horario: false, tipos: false, canais: false, marcas: false }} />

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Custo das saídas" valor={fmtReais(dados.totais.valor)} tom={dados.totais.valor > 0 ? "atencao" : "ok"}
            detalhe={`${dados.totais.lancamentos} lançamento${dados.totais.lancamentos === 1 ? "" : "s"}${dados.totais.semValor ? ` · ${dados.totais.semValor} sem valor` : ""}`} />
          {dados.porMotivo[0] && <Cartao rotulo="Maior motivo" valor={dados.porMotivo[0].rotulo} detalhe={fmtReais(dados.porMotivo[0].valor)} />}
          {dados.itens[0] && <Cartao rotulo="O que mais se perde" valor={dados.itens[0].item} detalhe={`${fmtReais(dados.itens[0].valor)} em ${dados.itens[0].lancamentos} lançamento${dados.itens[0].lancamentos === 1 ? "" : "s"}`} />}
        </GradeDeCartoes>
      )}

      {dados && dados.porMotivo.length > 0 && (
        <Bloco titulo="Por motivo" subtitulo="Toque num motivo para ver só os lançamentos dele.">
          <div style={{ display: "grid", gap: 8 }}>
            {dados.porMotivo.map((m) => (
              <button key={m.motivo} type="button" onClick={() => setMotivo(motivo === m.motivo ? null : m.motivo)} aria-pressed={motivo === m.motivo}
                style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr 110px", gap: 10, alignItems: "center", padding: "6px 8px", borderRadius: 10, border: `1.5px solid ${motivo === m.motivo ? PALETA.marca : "transparent"}`, background: motivo === m.motivo ? PALETA.brasaClaro : "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: PALETA.carvao }}>
                <span style={{ fontWeight: 800, fontSize: "0.86rem" }}>{m.rotulo} <span style={{ fontWeight: 500, color: PALETA.areiaTinta, fontSize: "0.76rem" }}>({m.lancamentos})</span></span>
                <BarraDePct pct={maior > 0 ? (m.valor / maior) * 100 : 0} />
                <span style={{ textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{fmtReais(m.valor)}</span>
              </button>
            ))}
          </div>
        </Bloco>
      )}

      {dados && (
        <Bloco semPadding titulo={motivo ? `Lançamentos: ${ROTULO.get(motivo)}` : "Lançamentos"}
          subtitulo="Lance a saída em Estoque › Movimentar (Saída ou Perda) ou em Perdas e descarte; escolha o motivo nos botões.">
          {linhas.length === 0 ? <Vazio texto="Nenhuma saída no período." /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 760 }}>
                <thead><tr style={{ color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                  <th style={th}>Quando</th><th style={th}>Item</th><th style={{ ...th, textAlign: "right" }}>Qtde</th><th style={th}>Motivo</th><th style={th}>Onde / quem</th><th style={{ ...th, textAlign: "right" }}>Custo</th>
                </tr></thead>
                <tbody>{linhas.slice(0, 300).map((l, k) => (
                  <tr key={k} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                    <td style={{ ...td, color: PALETA.areiaTinta }}>{quando(l.quando)}</td>
                    <td style={{ ...td, fontWeight: 700, whiteSpace: "normal", minWidth: 150 }}>{l.item}</td>
                    <td style={{ ...td, textAlign: "right" }}>{l.quantidade == null ? "—" : l.unidade ? quantidadeLegivel(l.quantidade, l.unidade) : `${l.quantidade}×`}</td>
                    <td style={{ ...td, whiteSpace: "normal", minWidth: 180 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.8rem" }}>{ROTULO.get(l.motivo)}</div>
                      {l.motivoTexto && <div style={{ fontSize: "0.74rem", color: PALETA.areiaTinta }}>{l.motivoTexto}</div>}
                    </td>
                    <td style={{ ...td, fontSize: "0.78rem", color: PALETA.carvao2 }}>{l.origem}{l.quem ? ` · ${l.quem}` : ""}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800, color: l.valor == null ? PALETA.atencao : PALETA.carvao }}>{l.valor == null ? "sem valor" : fmtReais(l.valor)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Bloco>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.6 }}>
          Entram as perdas de produto e de insumo (Perdas e descarte, Movimentar › Perda, descarte pela etiqueta, FireCheck), o pedido cancelado que a cozinha já tinha feito e a saída manual.
          O motivo sai do que foi escrito (e dos botões de motivo do Movimentar); o que não se encaixa vai para “Outro motivo”. Custo = o do insumo na hora da saída; sem custo cadastrado, “sem valor”.
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
