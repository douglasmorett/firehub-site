"use client";
/**
 * Sangrias, retiradas e suprimentos do período — a tela. Cada dinheiro que
 * saiu ou entrou na gaveta no meio do turno, com o total por tipo, por motivo
 * e por quem lançou. A conta mora em lib/relatorios/sangrias-e-suprimentos.ts.
 */
import React, { useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import type { ResultadoDasSangrias } from "@/lib/relatorios/sangrias-e-suprimentos";

type Resposta = ResultadoDasSangrias & { lojas: string[]; periodo: { de: string; ate: string }; hoje: string };

const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom" };
const td: React.CSSProperties = { padding: "7px 0.6rem" };

type Filtro = "TODOS" | "SAIDA" | "ENTRADA";

export default function SangriasESuprimentosClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "mes");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("sangrias-e-suprimentos", query);
  const [tipo, setTipo] = useState<Filtro>("TODOS");
  const lista = dados ? dados.lista.filter((m) => tipo === "TODOS" || m.tipo === tipo) : [];

  return (
    <ModeloDoRelatorio
      titulo="Sangrias e suprimentos"
      descricao="Todo dinheiro que saiu da gaveta (sangria para o cofre, pagamento pelo caixa) e que entrou (troco, reforço) no período — com quem lançou e o motivo."
      slug="sangrias-e-suprimentos" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ horario: false, tipos: false, canais: false, marcas: false }} />

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Sangrias e retiradas" tom="atencao" valor={fmtReais(dados.total.retiradas.valor)} detalhe={`${dados.total.retiradas.quantidade} lançamento${dados.total.retiradas.quantidade === 1 ? "" : "s"}`} />
          <Cartao rotulo="Suprimentos" tom="ok" valor={fmtReais(dados.total.suprimentos.valor)} detalhe={`${dados.total.suprimentos.quantidade} lançamento${dados.total.suprimentos.quantidade === 1 ? "" : "s"}`} />
          <Cartao rotulo="Saldo na gaveta" valor={fmtReais(dados.total.saldo)} detalhe="suprimentos − retiradas" />
        </GradeDeCartoes>
      )}

      {dados && dados.lista.length === 0 && <Bloco><Vazio texto="Nenhuma sangria, retirada ou suprimento no período." /></Bloco>}

      {dados && dados.lista.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
            <Bloco titulo="Por motivo" subtitulo="O texto que o operador digitou, juntando maiúscula e espaço." semPadding>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <tbody>
                  {dados.porMotivo.map((m) => (
                    <tr key={`${m.tipo}|${m.motivo}`} style={{ borderTop: `1px solid ${PALETA.areiaBorda}` }}>
                      <td style={{ ...td, fontWeight: 700 }}>{m.motivo}<span style={{ display: "block", fontWeight: 500, fontSize: "0.72rem", color: PALETA.areiaTinta }}>{m.tipo === "ENTRADA" ? "suprimento" : "sangria / retirada"} · {m.quantidade}×</span></td>
                      <td style={{ ...td, ...num, fontWeight: 800, color: m.tipo === "ENTRADA" ? PALETA.ok : PALETA.grave }}>{m.tipo === "ENTRADA" ? "" : "− "}{fmtReais(m.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Bloco>
            <Bloco titulo="Por quem lançou" semPadding>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: PALETA.areia, textAlign: "left", color: PALETA.carvao2 }}>
                    <th style={th}>Quem</th><th style={{ ...th, ...num }}>Retiradas</th><th style={{ ...th, ...num }}>Suprimentos</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porQuem.map((q) => (
                    <tr key={q.quem} style={{ borderTop: `1px solid ${PALETA.areiaBorda}` }}>
                      <td style={{ ...td, fontWeight: 700 }}>{q.quem}</td>
                      <td style={{ ...td, ...num, color: PALETA.grave }}>{q.retiradas.valor ? `− ${fmtReais(q.retiradas.valor)}` : "—"} <span style={{ color: PALETA.areiaTinta, fontSize: "0.72rem" }}>{q.retiradas.quantidade ? `(${q.retiradas.quantidade})` : ""}</span></td>
                      <td style={{ ...td, ...num, color: PALETA.ok }}>{q.suprimentos.valor ? fmtReais(q.suprimentos.valor) : "—"} <span style={{ color: PALETA.areiaTinta, fontSize: "0.72rem" }}>{q.suprimentos.quantidade ? `(${q.suprimentos.quantidade})` : ""}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Bloco>
          </div>

          <Bloco titulo="Lançamentos" subtitulo="Do mais recente para o mais antigo."
            acoes={
              <div className="fh-sem-impressao" style={{ display: "inline-flex", border: `1.5px solid ${PALETA.areiaBorda}`, borderRadius: 10, overflow: "hidden" }}>
                {(["TODOS", "SAIDA", "ENTRADA"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setTipo(k)} aria-pressed={tipo === k}
                    style={{ padding: "5px 12px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 700, background: tipo === k ? "#fff" : PALETA.areia, color: tipo === k ? PALETA.carvao : PALETA.areiaTinta }}>
                    {k === "TODOS" ? "Todos" : k === "SAIDA" ? "Sangrias / retiradas" : "Suprimentos"}
                  </button>
                ))}
              </div>
            }
            semPadding>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead>
                  <tr style={{ background: PALETA.areia, textAlign: "left", color: PALETA.carvao2 }}>
                    <th style={th}>Quando</th><th style={th}>Tipo</th><th style={th}>Motivo</th><th style={th}>Lançado por</th><th style={th}>Caixa de</th><th style={{ ...th, ...num }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((m) => (
                    <tr key={m.id} style={{ borderTop: `1px solid ${PALETA.areiaBorda}` }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDia(m.dia)} <span style={{ color: PALETA.areiaTinta }}>{m.hora}</span></td>
                      <td style={td}>{m.tipo === "ENTRADA" ? "Suprimento" : "Sangria / retirada"}</td>
                      <td style={td}>
                        {m.descricao || <span style={{ color: PALETA.areiaTinta }}>(sem motivo)</span>}
                        {m.depoisDoFechamento && <span style={{ display: "block", fontSize: "0.7rem", color: PALETA.atencao, fontWeight: 700 }}>lançado depois de o caixa fechar</span>}
                      </td>
                      <td style={td}>{m.quem || "—"}</td>
                      <td style={td}>{m.operadorDoCaixa}</td>
                      <td style={{ ...td, ...num, fontWeight: 800, color: m.tipo === "ENTRADA" ? PALETA.ok : PALETA.grave }}>{m.tipo === "ENTRADA" ? "" : "− "}{fmtReais(m.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Bloco>
        </>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55 }}>
          As mesmas sangrias e suprimentos do <Link href="/store/caixa/historico?voltar=/store/relatorios/sangrias-e-suprimentos" style={{ color: PALETA.marca, fontWeight: 700 }}>Histórico de caixas</Link>, que já entram no dinheiro esperado do fechamento.
          O dia é o do lançamento (vira às 5h). O que foi lançado no Histórico depois de o caixa fechar vem marcado: a hora é a do lançamento, não a do dinheiro.
          Veja também as <Link href="/store/relatorios/diferencas-de-caixa" style={{ color: PALETA.marca, fontWeight: 700 }}>Diferenças de caixa</Link> do período.
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
