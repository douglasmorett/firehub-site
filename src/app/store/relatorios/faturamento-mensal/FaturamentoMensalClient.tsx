"use client";
/**
 * Faturamento mensal — a tela. A conta mora em
 * lib/relatorios/faturamento-mensal.ts (cada mês é o Faturamento por dia do
 * mês inteiro; o corrente compara com o ano passado até o mesmo dia e
 * horário); aqui são o ano, os filtros, os cartões, o gráfico e a tabela.
 *
 * O SWF mostra os 12 meses em colunas, só tabela. Aqui os meses são LINHAS
 * (cabe no celular, e o lojista lê de cima para baixo como um caderno), com o
 * mesmo mês do ano passado ao lado e a variação já calculada; o gráfico de
 * barras põe os dois anos lado a lado, e o mês corrente aparece "até hoje"
 * (listrado) com a projeção do fechamento em contorno tracejado.
 */
import React, { useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { filtrosParaQuery, fmtDia, fmtPct, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import { NOMES_DOS_MESES, type LinhaDoMes, type ResultadoMensal, type ResumoDoMes } from "@/lib/relatorios/faturamento-mensal";

type Resposta = ResultadoMensal & {
  lojas: string[];
  hoje: string;
  /** Os anos que a loja tem no FireHub, do 1º pedido até hoje. */
  anos: number[];
  primeiroDia: string | null;
  corte: { dia: string };
};

const rotulo: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom", lineHeight: 1.25 };
const td: React.CSSProperties = { padding: "7px 0.6rem", verticalAlign: "top" };

/** A cor do ano passado no gráfico: areia escura, para o ano escolhido (brasa) mandar. */
const COR_DO_ANTERIOR = "#C9BBAE";
const LISTRADO = `repeating-linear-gradient(135deg, ${PALETA.brasa} 0 4px, ${PALETA.brasaBorda} 4px 7px)`;

const temDado = (m: ResumoDoMes) => m.estado === "fechado" || m.estado === "corrente";
const reaisOuTraco = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtReais(v));
const curto = (indice: number) => NOMES_DOS_MESES[indice].slice(0, 3);

export default function FaturamentoMensalClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const anoDeHoje = inicio.hoje.slice(0, 4);
  const { filtros, mudar, extras, mudarExtra } = useFiltros(inicio, "hoje", { ano: anoDeHoje });
  // O período do filtro não vale aqui — o período é o ano. Fica fora da busca
  // (e do Excel), para ninguém achar que "Últimos 7 dias" mudou alguma coisa.
  const query = filtrosParaQuery({ ...filtros, de: "", ate: "" }, extras);
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("faturamento-mensal", query);

  const ano = dados?.ano ?? Number(extras.ano || anoDeHoje);
  const anos = dados?.anos?.length ? dados.anos : [ano];
  const temVenda = Boolean(dados && dados.meses.some((m) => m.atual.lancamentos > 0 || m.anterior.lancamentos > 0));
  const corrente = dados?.mesCorrente ? dados.meses.find((m) => m.mes === dados.mesCorrente) || null : null;

  return (
    <ModeloDoRelatorio
      titulo="Faturamento mensal"
      descricao="Os 12 meses do ano, cada um com faturamento, vendas e ticket médio, e o mesmo mês do ano anterior ao lado com a variação. O mês de agora aparece até hoje, com a projeção de fechamento."
      slug="faturamento-mensal" query={query} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <section className="fh-sem-impressao" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: "0.9rem" }}>
        <span style={{ ...rotulo, marginBottom: 0 }}>Ano</span>
        {anos.map((a) => (
          <button key={a} type="button" onClick={() => mudarExtra("ano", String(a))} aria-pressed={a === ano}
            style={{
              padding: "7px 16px", borderRadius: 999, fontSize: "0.9rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              border: `1.5px solid ${a === ano ? PALETA.carvao : PALETA.areiaBorda}`,
              background: a === ano ? PALETA.carvao : "#fff", color: a === ano ? "#fff" : PALETA.carvao2,
            }}>
            {a}
          </button>
        ))}
      </section>
      {/* Impresso, o ano tem de aparecer no papel. */}
      <p style={{ margin: "-0.4rem 0 0.9rem", fontSize: "0.82rem", fontWeight: 700, color: PALETA.carvao2 }}>
        {ano} contra {ano - 1}<span style={{ fontWeight: 500, color: PALETA.areiaTinta }}> · o dia vira às 5h</span>
      </p>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ periodo: false }} />

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo={`Faturamento em ${ano}${dados.mesCorrente ? " (até hoje)" : ""}`} valor={fmtReais(dados.total.valor)}
            detalhe={dados.comparacao.meses > 0
              ? <><VariacaoCurta v={dados.comparacao.variacao.valor} /> vs. {ano - 1} nos {dados.comparacao.meses} {dados.comparacao.meses === 1 ? "mês" : "meses"} com dado nos dois anos</>
              : `Sem ${ano - 1} no FireHub para comparar`} />
          <Cartao rotulo={`Vendas em ${ano}`} valor={dados.total.vendas.toLocaleString("pt-BR")}
            detalhe={`Ticket médio ${reaisOuTraco(dados.total.ticketMedio)}`} />
          <Cartao rotulo="▲ Melhor mês" tom={dados.melhorMes ? "ok" : "neutro"}
            valor={dados.melhorMes ? NOMES_DOS_MESES[Number(dados.melhorMes.mes.slice(5, 7)) - 1] : "—"}
            detalhe={dados.melhorMes ? fmtReais(dados.melhorMes.valor) : "Nenhuma venda no ano"} />
          {corrente && (
            <Cartao rotulo={`${NOMES_DOS_MESES[corrente.indice]} até hoje`} valor={fmtReais(corrente.atual.valor)}
              detalhe={<>
                {corrente.atual.projecao !== null ? <>Deve fechar em <strong>{fmtReais(corrente.atual.projecao)}</strong></> : "Projeção a partir de amanhã"}
                {temDado(corrente.anterior) ? <> · {curto(corrente.indice).toLowerCase()}/{ano - 1}: {fmtReais(corrente.anterior.valor)}</> : null}
              </>} />
          )}
        </GradeDeCartoes>
      )}

      {dados && !temVenda && (
        <Bloco><Vazio texto={`Nenhuma venda em ${ano} nem em ${ano - 1} com estes filtros.`} /></Bloco>
      )}

      {dados && temVenda && (
        <>
          <Bloco titulo={`${ano} × ${ano - 1}, mês a mês`} subtitulo="Toque numa barra para ver o mês.">
            <Grafico dados={dados} />
          </Bloco>

          <Bloco titulo="Mês a mês"
            subtitulo={corrente
              ? `${NOMES_DOS_MESES[corrente.indice]} compara com ${curto(corrente.indice).toLowerCase()}/${ano - 1} até o mesmo dia e horário (${fmtDia(dados.corte.dia)}) — o mês inteiro do ano passado fica ao lado.`
              : "Cada mês contra o mesmo mês do ano anterior."}
            semPadding>
            <TabelaDosMeses dados={dados} />
          </Bloco>
        </>
      )}

      {dados && (
        <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55, display: "grid", gap: 6 }}>
          {dados.valoresImpossiveis > 0 && (
            <p role="note" style={{ margin: 0, color: PALETA.grave, fontWeight: 700 }}>
              {dados.valoresImpossiveis} pedido{dados.valoresImpossiveis === 1 ? "" : "s"} com valor impossível (R$ 1 milhão ou mais) ficou fora das somas — confira no painel de pedidos.
            </p>
          )}
          {dados.primeiroDia && dados.primeiroDia > `${ano - 1}-01-01` && (
            <p style={{ margin: 0 }}>
              A loja tem pedidos no FireHub desde <strong style={{ color: PALETA.carvao2 }}>{fmtDia(dados.primeiroDia)}</strong>. Antes disso o mês aparece como &quot;sem dados&quot; (não é venda zero), e o mês em que a loja começou não tem variação — meio mês contra um mês inteiro não diz nada.
            </p>
          )}
          <p style={{ margin: 0 }}>
            Cada mês é o <Link href="/store/relatorios/faturamento-por-dia" style={{ color: PALETA.marca, fontWeight: 700 }}>Faturamento por dia</Link> do mês inteiro, com a mesma conta:
            o que o cliente pagou, com a entrega e sem o desconto; a mesa é <strong>uma</strong> venda; cancelados ficam fora. Ticket médio = faturamento ÷ vendas.
            A <strong style={{ color: PALETA.carvao2 }}>projeção</strong> segue o ritmo dos dias que já fecharam no mês (hoje ainda está vendendo e não entra no ritmo).
            O dia vira às 5h: a venda da 1h da manhã é do dia anterior.
          </p>
        </div>
      )}
    </ModeloDoRelatorio>
  );
}

// ── O GRÁFICO ───────────────────────────────────────────────────────────────

function Grafico({ dados }: { dados: Resposta }) {
  const [foco, setFoco] = useState<number | null>(null);
  const ALTURA = 200;
  const max = Math.max(1, ...dados.meses.flatMap((m) => [m.atual.valor, m.anterior.valor, m.atual.projecao || 0]));
  const altura = (v: number) => `${Math.max((v / max) * 100, v > 0 ? 1.5 : 0)}%`;
  const focado = foco === null ? null : dados.meses[foco];

  return (
    <div>
      <div aria-live="polite" style={{ minHeight: 22, fontSize: "0.84rem", marginBottom: 8, color: PALETA.carvao2 }}>
        {focado ? <ResumoDoFoco l={focado} ano={dados.ano} /> : <span style={{ color: PALETA.areiaTinta }}>Toque ou passe o mouse num mês.</span>}
      </div>

      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ minWidth: 520 }}>
          <div style={{ height: ALTURA, display: "flex", alignItems: "stretch", gap: 6, borderBottom: `1px solid ${PALETA.areiaBorda}` }} onMouseLeave={() => setFoco(null)}>
            {dados.meses.map((l) => {
              const a = l.atual, b = l.anterior;
              return (
                <button key={l.mes} type="button" onMouseEnter={() => setFoco(l.indice)} onFocus={() => setFoco(l.indice)} onClick={() => setFoco(l.indice)}
                  aria-label={`${NOMES_DOS_MESES[l.indice]}: ${temDado(a) ? fmtReais(a.valor) : "sem venda"}${temDado(b) ? `; em ${dados.ano - 1}, ${fmtReais(b.valor)}` : ""}`}
                  style={{
                    flex: "1 1 0", minWidth: 0, height: "100%", padding: "0 2px", border: "none", cursor: "pointer", borderRadius: 4,
                    background: foco === l.indice ? PALETA.areia : "transparent", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2,
                  }}>
                  {/* O ano passado à esquerda, o escolhido à direita. */}
                  <span style={{ display: "block", width: "42%", maxWidth: 22, height: temDado(b) ? altura(b.valor) : 0, background: COR_DO_ANTERIOR, borderRadius: "3px 3px 0 0" }} />
                  <span style={{ position: "relative", display: "block", width: "42%", maxWidth: 22, height: "100%" }}>
                    {a.projecao !== null && (
                      <span title="Projeção do fechamento" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: altura(a.projecao), border: `2px dashed ${PALETA.brasa}`, borderBottom: "none", borderRadius: "3px 3px 0 0", boxSizing: "border-box" }} />
                    )}
                    {temDado(a) && (
                      <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: altura(a.valor), background: a.estado === "corrente" ? LISTRADO : PALETA.brasa, borderRadius: "3px 3px 0 0" }} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }} aria-hidden>
            {dados.meses.map((l) => (
              <span key={l.mes} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center", fontSize: "0.7rem", fontWeight: l.atual.estado === "corrente" ? 800 : 600, color: l.atual.estado === "corrente" ? PALETA.carvao : PALETA.areiaTinta }}>
                {curto(l.indice)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1.1rem", marginTop: 10, fontSize: "0.74rem", color: PALETA.areiaTinta }}>
        <Legenda cor={PALETA.brasa} texto={String(dados.ano)} />
        <Legenda cor={COR_DO_ANTERIOR} texto={String(dados.ano - 1)} />
        {dados.mesCorrente && <Legenda cor={LISTRADO} texto="mês de agora, até hoje" />}
        {dados.mesCorrente && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, border: `2px dashed ${PALETA.brasa}`, boxSizing: "border-box" }} /> projeção do fechamento
          </span>
        )}
      </div>
    </div>
  );
}

function ResumoDoFoco({ l, ano }: { l: LinhaDoMes; ano: number }) {
  const a = l.atual, b = l.anterior;
  const nome = NOMES_DOS_MESES[l.indice];
  if (a.estado === "futuro") {
    return <span><strong>{nome}</strong> — ainda não chegou{temDado(b) ? ` · em ${ano - 1}: ${fmtReais(b.valor)} (${b.vendas.toLocaleString("pt-BR")} vendas)` : ""}</span>;
  }
  return (
    <span>
      <strong>{nome}{a.estado === "corrente" ? " (até hoje)" : ""}</strong>
      {temDado(a) ? ` — ${fmtReais(a.valor)} · ${a.vendas.toLocaleString("pt-BR")} vendas · ticket ${reaisOuTraco(a.ticketMedio)}` : " — sem dados no FireHub"}
      {a.projecao !== null ? ` · deve fechar em ${fmtReais(a.projecao)}` : ""}
      {temDado(b) ? ` · em ${ano - 1}: ${fmtReais(b.valor)}` : ""}
      {l.variacao.valor !== null && <> · <VariacaoCurta v={l.variacao.valor} /></>}
    </span>
  );
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: cor }} /> {texto}
    </span>
  );
}

// ── A TABELA ────────────────────────────────────────────────────────────────

function TabelaDosMeses({ dados }: { dados: Resposta }) {
  const ano = dados.ano;
  const fixa: React.CSSProperties = { position: "sticky", left: 0, zIndex: 1 };
  const cabecalho: Array<{ t: string; dica?: string; esquerda?: boolean; grupo?: "anterior" | "variacao" }> = [
    { t: "Mês", esquerda: true },
    { t: "Faturamento" }, { t: "Vendas", dica: "Atendimentos: cada pedido é uma venda, e a mesa é uma venda só." }, { t: "Ticket médio" },
    { t: "Média por dia", dica: "Faturamento dividido pelos dias que já fecharam no mês." },
    { t: "Faturamento", grupo: "anterior" }, { t: "Vendas", grupo: "anterior" }, { t: "Ticket médio", grupo: "anterior" },
    { t: "Faturamento", grupo: "variacao" }, { t: "Vendas", grupo: "variacao" }, { t: "Ticket", grupo: "variacao" },
  ];
  const separa = (i: number) => (i === 5 || i === 8 ? { borderLeft: `1px solid ${PALETA.areiaBorda}` } : {});

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: "0.83rem" }}>
        <thead>
          <tr style={{ color: PALETA.carvao2, fontSize: "0.72rem", fontWeight: 800 }}>
            <th style={{ ...th, ...fixa, background: "#fff" }} />
            <th colSpan={4} style={{ ...th, textAlign: "center", color: PALETA.brasaTinta }}>{ano}</th>
            <th colSpan={3} style={{ ...th, textAlign: "center", ...separa(5) }}>{ano - 1}</th>
            <th colSpan={3} style={{ ...th, textAlign: "center", ...separa(8) }}>Variação</th>
          </tr>
          <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
            {cabecalho.map((c, i) => (
              <th key={`${c.t}-${i}`} title={c.dica} style={{ ...th, textAlign: c.esquerda ? "left" : "right", ...separa(i), ...(i === 0 ? { ...fixa, background: "#fff" } : {}),
                ...(c.dica ? { textDecoration: "underline dotted", cursor: "help" } : {}) }}>
                {c.t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dados.meses.map((l) => {
            const a = l.atual, b = l.anterior, c = l.anteriorAteOMesmoDia;
            const ehMelhor = dados.melhorMes?.mes === l.mes;
            const fundo = a.estado === "corrente" ? PALETA.brasaClaro : ehMelhor ? PALETA.okClaro : "#fff";
            const apagado = !temDado(a) || a.lancamentos === 0;
            return (
              <tr key={l.mes} style={{ borderBottom: `1px solid ${PALETA.areia}`, background: fundo, color: apagado ? PALETA.areiaTinta : PALETA.carvao }}>
                <td style={{ ...td, ...fixa, background: fundo, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {NOMES_DOS_MESES[l.indice]}
                  {a.estado === "corrente" && <Etiqueta cor={PALETA.brasaTinta} texto={`até ${fmtDia(a.ateODia as string).slice(0, 5)}`} />}
                  {ehMelhor && a.estado !== "corrente" && <Etiqueta cor={PALETA.ok} texto="▲ melhor" />}
                  {a.comecouEm && <Etiqueta cor={PALETA.areiaTinta} texto={`desde ${fmtDia(a.comecouEm).slice(0, 5)}`} />}
                </td>
                {temDado(a) ? (
                  <>
                    <td style={{ ...td, ...num, fontWeight: 800 }}>
                      {fmtReais(a.valor)}
                      {a.projecao !== null && <Detalhe texto={`deve fechar em ${fmtReais(a.projecao)}`} />}
                    </td>
                    <td style={{ ...td, ...num }}>{a.vendas.toLocaleString("pt-BR")}</td>
                    <td style={{ ...td, ...num }}>{reaisOuTraco(a.ticketMedio)}</td>
                    <td style={{ ...td, ...num }}>{reaisOuTraco(a.mediaPorDia)}</td>
                  </>
                ) : (
                  <td colSpan={4} style={{ ...td, textAlign: "center", fontSize: "0.78rem" }}>{a.estado === "futuro" ? "ainda não chegou" : "sem dados no FireHub"}</td>
                )}
                {temDado(b) ? (
                  <>
                    <td style={{ ...td, ...num, ...separa(5) }}>
                      {fmtReais(b.valor)}
                      {c && <Detalhe texto={`até ${fmtDia(c.ateODia as string).slice(0, 5)}: ${fmtReais(c.valor)}`} />}
                      {b.comecouEm && <Detalhe texto={`desde ${fmtDia(b.comecouEm).slice(0, 5)}`} />}
                    </td>
                    <td style={{ ...td, ...num }}>{b.vendas.toLocaleString("pt-BR")}{c && <Detalhe texto={`até o dia: ${c.vendas.toLocaleString("pt-BR")}`} />}</td>
                    <td style={{ ...td, ...num }}>{reaisOuTraco(b.ticketMedio)}</td>
                  </>
                ) : (
                  <td colSpan={3} style={{ ...td, textAlign: "center", fontSize: "0.78rem", color: PALETA.areiaTinta, ...separa(5) }}>
                    {b.estado === "futuro" ? "—" : "sem dados no FireHub"}
                  </td>
                )}
                <td style={{ ...td, ...num, ...separa(8) }}><VariacaoCurta v={l.variacao.valor} /></td>
                <td style={{ ...td, ...num }}><VariacaoCurta v={l.variacao.vendas} /></td>
                <td style={{ ...td, ...num }}><VariacaoCurta v={l.variacao.ticketMedio} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: PALETA.areia, fontWeight: 800, borderTop: `2px solid ${PALETA.areiaBorda}` }}>
            <td style={{ ...td, ...fixa, background: PALETA.areia, whiteSpace: "nowrap" }}>Total{dados.mesCorrente ? " até hoje" : ""}</td>
            <td style={{ ...td, ...num }}>{fmtReais(dados.total.valor)}</td>
            <td style={{ ...td, ...num }}>{dados.total.vendas.toLocaleString("pt-BR")}</td>
            <td style={{ ...td, ...num }}>{reaisOuTraco(dados.total.ticketMedio)}</td>
            <td style={td} />
            <td style={{ ...td, ...num, ...separa(5) }} title={`${ano - 1} inteiro`}>{fmtReais(dados.totalAnterior.valor)}</td>
            <td style={{ ...td, ...num }}>{dados.totalAnterior.vendas.toLocaleString("pt-BR")}</td>
            <td style={{ ...td, ...num }}>{reaisOuTraco(dados.totalAnterior.ticketMedio)}</td>
            {/* A variação do total é só a dos meses comparáveis: o ano inteiro passado contra este ano pela metade não diz nada. */}
            <td style={{ ...td, ...num, ...separa(8) }} title={`Nos ${dados.comparacao.meses} meses com dado nos dois anos`}><VariacaoCurta v={dados.comparacao.variacao.valor} /></td>
            <td style={{ ...td, ...num }}><VariacaoCurta v={dados.comparacao.variacao.vendas} /></td>
            <td style={{ ...td, ...num }}><VariacaoCurta v={dados.comparacao.variacao.ticketMedio} /></td>
          </tr>
        </tfoot>
      </table>
      {dados.comparacao.meses > 0 && (
        <p style={{ margin: 0, padding: "0.6rem 1.1rem 0.8rem", fontSize: "0.76rem", color: PALETA.areiaTinta }}>
          A variação do total compara os {dados.comparacao.meses} {dados.comparacao.meses === 1 ? "mês" : "meses"} com dado nos dois anos:
          {" "}{fmtReais(dados.comparacao.atual.valor)} em {ano} contra {fmtReais(dados.comparacao.anterior.valor)} em {ano - 1}
          {dados.mesCorrente ? " (o mês de agora até o mesmo dia)" : ""}.
        </p>
      )}
    </div>
  );
}

function Detalhe({ texto }: { texto: string }) {
  return <div style={{ fontSize: "0.68rem", fontWeight: 600, color: PALETA.areiaTinta }}>{texto}</div>;
}

function Etiqueta({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 999, fontSize: "0.68rem", fontWeight: 800, color: cor, background: "#fff", border: `1px solid ${cor}33`, whiteSpace: "nowrap" }}>
      {texto}
    </span>
  );
}

/** "↑ 12,3%" a partir da fração (0,123). Sem base para comparar, um traço. */
function VariacaoCurta({ v }: { v: number | null }) {
  if (v === null) return <span style={{ color: PALETA.areiaTinta }}>—</span>;
  const pct = v * 100;
  const cor = Math.abs(pct) < 0.5 ? PALETA.areiaTinta : pct > 0 ? PALETA.ok : PALETA.grave;
  return <span style={{ color: cor, fontWeight: 800 }}>{pct > 0 ? "↑" : pct < 0 ? "↓" : "="} {fmtPct(Math.abs(pct))}</span>;
}
