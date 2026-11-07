"use client";
/**
 * Diferenças de caixa do período — a tela. A soma dos caixas fechados por
 * operador, por dia e por forma, com a régua de lib/conferencia-do-caixa.ts
 * (a do Histórico de caixas). A conta mora em lib/relatorios/diferencas-de-caixa.ts.
 *
 * O operador que mais deixou faltar vem primeiro; cada linha abre as formas.
 * A tabela "Formas de pagamento por operador" é o esperado do turno de cada
 * um, forma a forma — o "Faturamento por tipo de pagamento por operador" do SWF.
 */
import React, { useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { DIAS_CURTOS, fmtDia, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import type { ResultadoDasDiferencas, SomaDasDiferencas } from "@/lib/relatorios/diferencas-de-caixa";

type Resposta = ResultadoDasDiferencas & { lojas: string[]; periodo: { de: string; ate: string }; hoje: string };

const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom", lineHeight: 1.25 };
const td: React.CSSProperties = { padding: "7px 0.6rem" };

/** "faltou R$ 20,00" / "sobrou R$ 5,00" / "confere" — as palavras do Histórico de caixas. */
function Diferenca({ v, forte }: { v: number | null; forte?: boolean }) {
  if (v == null) return <span style={{ color: PALETA.areiaTinta }}>sem conferência</span>;
  if (Math.abs(v) < 0.01) return <span style={{ color: PALETA.ok, fontWeight: forte ? 900 : 700 }}>confere</span>;
  return <span style={{ color: v < 0 ? PALETA.grave : PALETA.atencao, fontWeight: forte ? 900 : 700 }}>{v < 0 ? `faltou ${fmtReais(-v)}` : `sobrou ${fmtReais(v)}`}</span>;
}

const diaCurto = (dia: string) => `${DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export default function DiferencasDeCaixaClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "mes");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("diferencas-de-caixa", query);
  const [aberto, setAberto] = useState<string | null>(null);
  const t = dados?.total;

  return (
    <ModeloDoRelatorio
      titulo="Diferenças de caixa"
      descricao="Somando todos os caixas do período: quanto o sistema esperava, quanto foi contado e quanto faltou ou sobrou — por operador, por dia e por forma de pagamento."
      slug="diferencas-de-caixa" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ horario: false, tipos: false, canais: false, marcas: false }} />

      {dados && t && (
        <GradeDeCartoes>
          <Cartao rotulo="Diferença no período" tom={Math.abs(t.diferenca) < 0.01 ? "ok" : t.diferenca < 0 ? "grave" : "atencao"} valor={fmtReais(t.diferenca)}
            detalhe={<Diferenca v={t.conferidos ? t.diferenca : null} />} />
          <Cartao rotulo="Faltas" tom={t.faltas < 0 ? "grave" : "neutro"} valor={fmtReais(t.faltas)} detalhe="soma só dos caixas que faltaram" />
          <Cartao rotulo="Sobras" tom={t.sobras > 0 ? "atencao" : "neutro"} valor={fmtReais(t.sobras)} detalhe="sobra também é erro de troco ou de lançamento" />
          <Cartao rotulo="Caixas" valor={t.caixas.toLocaleString("pt-BR")} detalhe={`${t.conferidos} conferido${t.conferidos === 1 ? "" : "s"} · ${t.semConferencia} sem conferência`} />
        </GradeDeCartoes>
      )}

      {dados && t && t.caixas === 0 && <Bloco><Vazio texto="Nenhum caixa fechado no período. O caixa entra pelo dia em que foi aberto." /></Bloco>}

      {dados && t && t.caixas > 0 && (
        <>
          <Bloco titulo="Por operador" subtitulo="Quem abriu o caixa (no caixa antigo, quem fechou). Toque para ver forma a forma. Esperado e contado só das formas que foram contadas." semPadding>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: PALETA.areia, textAlign: "left", color: PALETA.carvao2 }}>
                    <th style={th}>Operador</th><th style={{ ...th, ...num }}>Caixas</th><th style={{ ...th, ...num }}>Esperado</th><th style={{ ...th, ...num }}>Contado</th>
                    <th style={{ ...th, ...num }}>Diferença</th><th style={{ ...th, ...num }}>Faltas</th><th style={{ ...th, ...num }}>Sobras</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porOperador.map((o) => (
                    <React.Fragment key={o.operador}>
                      <tr onClick={() => setAberto(aberto === o.operador ? null : o.operador)} style={{ borderTop: `1px solid ${PALETA.areiaBorda}`, cursor: "pointer" }}>
                        <td style={{ ...td, fontWeight: 800 }}>{aberto === o.operador ? "▾" : "▸"} {o.operador}</td>
                        <td style={{ ...td, ...num }}>{o.caixas}{o.semConferencia ? <span style={{ color: PALETA.areiaTinta }}> ({o.semConferencia} sem conf.)</span> : null}</td>
                        <td style={{ ...td, ...num }}>{fmtReais(o.esperado)}</td>
                        <td style={{ ...td, ...num }}>{fmtReais(o.contado)}</td>
                        <td style={{ ...td, ...num }}><Diferenca v={o.conferidos ? o.diferenca : null} forte /></td>
                        <td style={{ ...td, ...num, color: o.faltas < 0 ? PALETA.grave : PALETA.areiaTinta }}>{o.faltas ? fmtReais(o.faltas) : "—"}</td>
                        <td style={{ ...td, ...num, color: o.sobras > 0 ? PALETA.atencao : PALETA.areiaTinta }}>{o.sobras ? fmtReais(o.sobras) : "—"}</td>
                      </tr>
                      {aberto === o.operador && <LinhasDasFormas s={o} />}
                    </React.Fragment>
                  ))}
                  <tr style={{ borderTop: `2px solid ${PALETA.carvao2}`, background: PALETA.areia, fontWeight: 900 }}>
                    <td style={td}>Total</td><td style={{ ...td, ...num }}>{t.caixas}</td>
                    <td style={{ ...td, ...num }}>{fmtReais(t.esperado)}</td><td style={{ ...td, ...num }}>{fmtReais(t.contado)}</td>
                    <td style={{ ...td, ...num }}><Diferenca v={t.conferidos ? t.diferenca : null} forte /></td>
                    <td style={{ ...td, ...num }}>{fmtReais(t.faltas)}</td><td style={{ ...td, ...num }}>{fmtReais(t.sobras)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Bloco>

          <Bloco titulo="Formas de pagamento por operador" subtitulo="O que o sistema esperava no turno de cada um, em cada forma (conferido ou não). O pago online não passa pela gaveta: coluna à parte." semPadding>
            <TabelaDasFormas linhas={[...dados.porOperador.map((o) => ({ rotulo: o.operador, s: o as SomaDasDiferencas })), { rotulo: "Total", s: t }]} />
          </Bloco>

          <Bloco titulo="Por dia" subtitulo="Pelo dia em que o caixa foi aberto (o dia vira às 5h)." semPadding>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: PALETA.areia, textAlign: "left", color: PALETA.carvao2 }}>
                    <th style={th}>Dia</th><th style={{ ...th, ...num }}>Caixas</th><th style={{ ...th, ...num }}>Esperado</th><th style={{ ...th, ...num }}>Contado</th><th style={{ ...th, ...num }}>Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porDia.map((d) => (
                    <tr key={d.dia} style={{ borderTop: `1px solid ${PALETA.areiaBorda}` }}>
                      <td style={{ ...td, fontWeight: 700 }}>{diaCurto(d.dia)}</td>
                      <td style={{ ...td, ...num }}>{d.caixas}</td>
                      <td style={{ ...td, ...num }}>{fmtReais(d.esperado)}</td>
                      <td style={{ ...td, ...num }}>{fmtReais(d.contado)}</td>
                      <td style={{ ...td, ...num }}><Diferenca v={d.conferidos ? d.diferenca : null} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Bloco>

          <Bloco titulo="Caixa a caixa" subtitulo={<>O detalhe de cada um (sangrias, correções) está no <Link href="/store/caixa/historico?voltar=/store/relatorios/diferencas-de-caixa" style={{ color: PALETA.marca, fontWeight: 700 }}>Histórico de caixas</Link>.</>} semPadding>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                <thead>
                  <tr style={{ background: PALETA.areia, textAlign: "left", color: PALETA.carvao2 }}>
                    <th style={th}>Caixa de</th><th style={th}>Operador</th><th style={{ ...th, ...num }}>Esperado</th><th style={{ ...th, ...num }}>Contado</th><th style={{ ...th, ...num }}>Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.caixas.map((c) => (
                    <tr key={c.id} style={{ borderTop: `1px solid ${PALETA.areiaBorda}` }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDia(c.dia)}</td>
                      <td style={td}>{c.operador}{c.fechadoPor && c.fechadoPor !== c.operador && !c.fechadoPor.startsWith("sistema") ? <span style={{ color: PALETA.areiaTinta }}> · fechou: {c.fechadoPor}</span> : null}</td>
                      <td style={{ ...td, ...num }}>{c.situacao === "SEM_CONFERENCIA" ? "—" : fmtReais(c.esperado)}</td>
                      <td style={{ ...td, ...num }}>{c.situacao === "SEM_CONFERENCIA" ? "—" : fmtReais(c.contado)}</td>
                      <td style={{ ...td, ...num }}>
                        <Diferenca v={c.diferenca} />
                        {c.situacao === "PARCIAL" && <span style={{ display: "block", fontSize: "0.7rem", color: PALETA.areiaTinta }}>alguma forma ficou em branco</span>}
                      </td>
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
          A mesma conta do Histórico de caixas: forma deixada em branco no fechamento não é "contei zero" e fica fora da diferença;
          caixa encerrado sozinho ao abrir outro, ou fechado sem ninguém digitar a contagem, aparece como <strong>sem conferência</strong> — nunca como falta.
          A diferença é a gravada no fechamento (a do aviso ao dono), e a correção feita depois no Histórico já está nela. Caixa ainda aberto não entra.
        </p>
      )}
    </ModeloDoRelatorio>
  );
}

function LinhasDasFormas({ s }: { s: SomaDasDiferencas }) {
  const formas = s.formas.filter((f) => f.esperado || f.contado);
  return (
    <>
      {formas.map((f) => (
        <tr key={f.chave} style={{ background: PALETA.areia, fontSize: "0.8rem" }}>
          <td style={{ ...td, paddingLeft: "1.8rem" }}>{f.nome}{f.esperado !== f.esperadoConferido ? <span style={{ color: PALETA.areiaTinta }}> · {fmtReais(f.esperado - f.esperadoConferido)} não conferido</span> : null}</td>
          <td style={td} />
          <td style={{ ...td, ...num }}>{fmtReais(f.esperadoConferido)}</td>
          <td style={{ ...td, ...num }}>{fmtReais(f.contado)}</td>
          <td style={{ ...td, ...num }}>{f.esperadoConferido || f.contado ? <Diferenca v={f.diferenca} /> : <span style={{ color: PALETA.areiaTinta }}>não contado</span>}</td>
          <td style={td} /><td style={td} />
        </tr>
      ))}
    </>
  );
}

function TabelaDasFormas({ linhas }: { linhas: { rotulo: string; s: SomaDasDiferencas }[] }) {
  const nomes = linhas[0]?.s.formas.map((f) => ({ chave: f.chave, nome: f.nome })) || [];
  const usadas = nomes.filter((f) => linhas.some((l) => l.s.formas.find((x) => x.chave === f.chave)?.esperado));
  const comOnline = linhas.some((l) => l.s.online);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ background: PALETA.areia, textAlign: "left", color: PALETA.carvao2 }}>
            <th style={th}>Operador</th>
            {usadas.map((f) => <th key={f.chave} style={{ ...th, ...num }}>{f.nome}</th>)}
            {comOnline && <th style={{ ...th, ...num }}>Online</th>}
            <th style={{ ...th, ...num }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(({ rotulo, s }, i) => {
            const ultimo = i === linhas.length - 1;
            const total = s.formas.reduce((t, f) => t + f.esperado, 0) + s.online;
            return (
              <tr key={rotulo} style={{ borderTop: ultimo ? `2px solid ${PALETA.carvao2}` : `1px solid ${PALETA.areiaBorda}`, background: ultimo ? PALETA.areia : undefined, fontWeight: ultimo ? 900 : undefined }}>
                <td style={{ ...td, fontWeight: 800 }}>{rotulo}</td>
                {usadas.map((f) => <td key={f.chave} style={{ ...td, ...num }}>{fmtReais(s.formas.find((x) => x.chave === f.chave)?.esperado || 0)}</td>)}
                {comOnline && <td style={{ ...td, ...num, color: PALETA.areiaTinta }}>{fmtReais(s.online)}</td>}
                <td style={{ ...td, ...num, fontWeight: 900 }}>{fmtReais(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
