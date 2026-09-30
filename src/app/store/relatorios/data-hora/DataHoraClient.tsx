"use client";
/**
 * Vendas por dia e hora — o mapa de calor da semana da Saipos, com as
 * respostas prontas em cima ("Melhor horário: 20h–21h"). A conta mora em
 * lib/relatorios/data-hora.ts; aqui são os filtros, a métrica e os desenhos.
 *
 * O que é diferente da Saipos, de propósito:
 * - Média por dia da semana, não soma: 3 sextas e 4 sábados não dão o
 *   "melhor dia" ao sábado só porque ele apareceu mais.
 * - A linha é o dia OPERACIONAL: o pedido da 1h de sábado fica na sexta.
 * - Trocar a métrica (vendas, valor, itens) ou média/total não refaz a
 *   busca: a rota devolve as três de uma vez.
 * - Sem biblioteca de gráfico: o mapa é uma tabela e as barras são divs — lê
 *   no celular, imprime e o leitor de tela entende.
 */
import React, { useMemo } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { NOMES_DOS_DIAS, filtrosParaQuery, fmtDia, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import {
  DIAS_DE_FIM_DE_SEMANA, DIAS_DE_SEMANA, METRICAS, ORDEM_DAS_HORAS, RAMPA_DO_MAPA, ROTULO_DA_METRICA,
  avisoAntesDasVendas, avisoDoDiaEmAndamento, corDoAnelDoPico, corDoTexto, faixaDe, frasesDasRespostas, nomeDoDia,
  numeroCurto, numeroDaMetrica, quantosDias, rotuloDaHora, tetoDaFaixa, textoDaMetrica,
  type Metrica, type ResultadoDataHora,
} from "@/lib/relatorios/data-hora";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = ResultadoDataHora & {
  lojas: string[];
  periodo: { de: string; ate: string; horaDe: string; horaAte: string };
  pedidosLidos: number;
};

// As faixas de cor, o texto e o anel do pico moram em lib/relatorios/data-hora.ts,
// onde o teste mede o contraste de cada combinação.
const RAMPA = RAMPA_DO_MAPA;
/**
 * O anel do pico fica DENTRO da casa (a 2px da borda): por fora, ele cobriria
 * o vão de 2px e encostaria nas casas vizinhas. É o mesmo desenho na legenda.
 */
const anelDoPico = (faixa: number): React.CSSProperties => ({ outline: `2px solid ${corDoAnelDoPico(faixa)}`, outlineOffset: -4 });

const rotulo: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em" };
/**
 * A coluna do dia fica parada ao rolar o mapa no celular. O padding do
 * contêiner de rolagem mora nela (senão as casas apareciam na faixa à
 * esquerda) e a sombra branca cobre o vão de 2px entre as casas.
 */
const colunaFixa: React.CSSProperties = { position: "sticky", left: 0, background: "#fff", zIndex: 1, boxShadow: "3px 0 0 #fff" };
const imprimirCor: React.CSSProperties = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as React.CSSProperties;

function Botoes<T extends string>({ valor, opcoes, mudar, nome }: { valor: T; opcoes: { chave: T; rotulo: string }[]; mudar: (v: T) => void; nome: string }) {
  return (
    <div role="group" aria-label={nome} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {opcoes.map((o) => (
        <button key={o.chave} type="button" onClick={() => mudar(o.chave)} aria-pressed={valor === o.chave}
          style={{
            padding: "6px 14px", borderRadius: 999, fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            border: `1.5px solid ${valor === o.chave ? PALETA.carvao : PALETA.areiaBorda}`,
            background: valor === o.chave ? PALETA.carvao : "#fff",
            color: valor === o.chave ? "#fff" : PALETA.carvao2,
          }}>
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Barra horizontal com a ponta arredondada e o número ao lado (em tinta, não na cor da barra). */
function LinhaDeBarra({ valor, max, destaque, texto, titulo, linhaDaMedia }: {
  valor: number; max: number; destaque?: boolean; texto: string; titulo?: string; linhaDaMedia?: number | null;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0;
  const media = linhaDaMedia !== null && linhaDaMedia !== undefined && max > 0 ? Math.min(100, (linhaDaMedia / max) * 100) : null;
  return (
    <div title={titulo} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <div style={{ position: "relative", flex: 1, height: 16, background: PALETA.areia, borderRadius: 4, minWidth: 40, ...imprimirCor }}>
        <div style={{ width: `${pct}%`, height: "100%", background: destaque ? PALETA.brasaTinta : PALETA.brasa, borderRadius: "0 4px 4px 0", ...imprimirCor }} />
        {media !== null && (
          <div aria-hidden style={{ position: "absolute", top: -3, bottom: -3, left: `${media}%`, borderLeft: `2px dashed ${PALETA.carvao}` }} />
        )}
      </div>
      <span style={{ fontSize: "0.78rem", fontWeight: destaque ? 900 : 700, color: destaque ? PALETA.carvao : PALETA.carvao2, fontVariantNumeric: "tabular-nums", minWidth: 58, textAlign: "right", whiteSpace: "nowrap" }}>
        {texto}
      </span>
    </div>
  );
}

export default function DataHoraClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  // 30 dias por padrão: um mapa de semana precisa de mais de uma semana — com
  // 7 dias cada dia aparece uma vez e o "melhor dia" é só o daquela semana.
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "30d", { metrica: "", ver: "", horas: "" });
  // A busca leva só os filtros: métrica, média/total e horas visíveis são da tela.
  const consulta = filtrosParaQuery(filtros);
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("data-hora", consulta);

  const metrica: Metrica = (METRICAS as string[]).includes(extras.metrica) ? (extras.metrica as Metrica) : "pedidos";
  const verTotal = extras.ver === "total";
  const todasAsHoras = extras.horas === "24";

  const serie = dados?.metricas[metrica];
  const frases = useMemo(() => (serie ? frasesDasRespostas(serie, metrica) : []), [serie, metrica]);

  // As colunas: as 24 horas, ou só o trecho em que a loja vendeu (da primeira à
  // última hora com venda, na ordem do expediente) — a pizzaria das 18h às 23h
  // não precisa de 13 colunas vazias de manhã, principalmente no celular.
  const horas = useMemo(() => {
    if (!dados || todasAsHoras) return ORDEM_DAS_HORAS;
    const idx = ORDEM_DAS_HORAS.map((h, i) => (dados.frequencia[h] > 0 ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return ORDEM_DAS_HORAS;
    return ORDEM_DAS_HORAS.slice(idx[0], idx[idx.length - 1] + 1);
  }, [dados, todasAsHoras]);

  const semVenda = !!dados && dados.metricas.pedidos.total === 0 && dados.metricas.valor.total === 0;
  const mapa = serie ? (verTotal ? serie.mapa.total : serie.mapa.media) : null;
  const maxDoMapa = useMemo(() => {
    if (!mapa || !dados) return 0;
    let m = 0;
    for (const w of dados.ordemDosDias) for (const h of horas) m = Math.max(m, mapa[w][h] || 0);
    return m;
  }, [mapa, dados, horas]);
  const pico = serie?.respostas.pico;
  // A faixa da casa do pico (é a maior do mapa, então a mais escura) — a legenda desenha igual.
  const faixaDoPico = !verTotal && pico && mapa ? faixaDe(mapa[pico.dia][pico.hora], maxDoMapa) : -1;
  const temCasaQueNaoHouve = !!serie && !!dados && dados.ordemDosDias.some((w) => horas.some((h) => serie.mapa.media[w][h] === null));

  // ── Barras por hora: seg–qui × sex–dom ──
  const porHora = useMemo(() => {
    if (!serie || !dados) return null;
    const somaDoGrupo = (grupo: number[], h: number) => grupo.reduce((s, w) => s + (serie.mapa.total[w][h] || 0), 0);
    const semana = horas.map((h) => (verTotal ? somaDoGrupo(DIAS_DE_SEMANA, h) : serie.porHora.semana[h] || 0));
    const fds = horas.map((h) => (verTotal ? somaDoGrupo(DIAS_DE_FIM_DE_SEMANA, h) : serie.porHora.fimDeSemana[h] || 0));
    const max = Math.max(0, ...semana, ...fds);
    const topo = (lista: number[]) => (Math.max(0, ...lista) > 0 ? horas[lista.indexOf(Math.max(...lista))] : null);
    return { semana, fds, max, picoSemana: topo(semana), picoFds: topo(fds) };
  }, [serie, dados, horas, verTotal]);

  // ── Barras por dia da semana, com a linha da média ──
  const porDia = useMemo(() => {
    if (!serie || !dados) return null;
    // O dia sem média (hoje é a única vez dele, ainda em andamento) vale 0
    // aqui só para a conta do tamanho; na tela ele não vira barra.
    const valores = dados.ordemDosDias.map((w) => (verTotal ? serie.porDia.total[w] : serie.porDia.media[w] ?? 0));
    const houve = dados.ordemDosDias.filter((w) => dados.diasPorSemana[w] > 0).length;
    const media: number | null = verTotal ? (houve > 0 ? serie.total / houve : 0) : serie.mediaPorDia;
    const max = Math.max(0, media ?? 0, ...valores);
    // O destaque é a barra mais longa do que está na tela (no modo total pode
    // não ser o "melhor dia" da média, e a barra escura tem de ser a maior).
    const maior = Math.max(0, ...valores);
    const melhor = maior > 0 ? dados.ordemDosDias[valores.indexOf(maior)] : null;
    return { valores, media, max, melhor };
  }, [serie, dados, verTotal]);

  const umaVezSo = !!dados && dados.dias > 0 && Math.max(...dados.diasPorSemana) <= 1;
  const ticket = dados && dados.metricas.pedidos.total > 0 ? dados.metricas.valor.total / dados.metricas.pedidos.total : null;
  const modo = verTotal ? "total no período" : "média por dia";
  /** "13,1 num dia médio" — ou, com o período sendo só hoje, que ainda não há dia médio. */
  const noDiaMedio = (m: Metrica) => {
    const v = dados?.metricas[m].mediaPorDia ?? null;
    return v === null ? "Hoje ainda em andamento" : `${numeroDaMetrica(m, v)} num dia médio`;
  };
  // Período sem nenhum dia: diz por quê, em vez do vazio genérico.
  const textoDoVazio = !dados ? undefined
    : dados.vendasComecaramDepois ? avisoAntesDasVendas(dados.vendasComecaramDepois)
    : dados.dias === 0 ? "O período escolhido ainda não começou."
    : undefined;

  return (
    <ModeloDoRelatorio
      titulo="Vendas por dia e hora"
      descricao="Em que dia e em que hora a loja vende: o mapa de calor da semana, o melhor horário, o melhor dia e a hora mais parada do expediente."
      slug="data-hora" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} />

      <div className="fh-sem-impressao" style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem 1.6rem", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={rotulo}>Medir por</span>
          <Botoes nome="Métrica" valor={metrica} mudar={(v) => mudarExtra("metrica", v === "pedidos" ? "" : v)}
            opcoes={METRICAS.map((m) => ({ chave: m, rotulo: ROTULO_DA_METRICA[m] }))} />
        </span>
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={rotulo}>Mostrar</span>
          <Botoes nome="Média ou total" valor={verTotal ? "total" : "media"} mudar={(v) => mudarExtra("ver", v === "total" ? "total" : "")}
            opcoes={[{ chave: "media", rotulo: "Média por dia" }, { chave: "total", rotulo: "Total no período" }]} />
        </span>
      </div>

      {dados && semVenda && <Bloco><Vazio texto={textoDoVazio} /></Bloco>}

      {dados && serie && !semVenda && (
        <>
          {/* ── As respostas prontas, em letra grande ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
            {frases.map((f) => (
              <div key={f.chave} className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, padding: "1rem 1.1rem", minWidth: 0 }}>
                <div style={rotulo}>{f.pergunta}</div>
                <div style={{ fontSize: "clamp(1.6rem, 4.5vw, 2.1rem)", fontWeight: 900, lineHeight: 1.1, marginTop: 6, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" }}>{f.resposta}</div>
                <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: 6, lineHeight: 1.4 }}>{f.detalhe}</div>
              </div>
            ))}
          </div>

          {(dados.inicioDasVendas || dados.hojeEmAndamento || umaVezSo) && (
            <div style={{ background: PALETA.areia, border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 12, padding: "0.7rem 0.95rem", marginBottom: "1rem", fontSize: "0.8rem", color: PALETA.carvao2, lineHeight: 1.5 }}>
              {umaVezSo && <div><strong>Cada dia da semana apareceu uma vez só neste período</strong>: o “melhor dia” é o daquela semana, não um padrão. Para ver o padrão, escolha 30 dias ou mais.</div>}
              {dados.inicioDasVendas && <div>A loja começou a vender pelo FireHub em <strong>{fmtDia(dados.inicioDasVendas)}</strong>: os dias antes disso não entram na média.</div>}
              {dados.diaEmAndamento !== null
                ? <div>{avisoDoDiaEmAndamento(dados.diaEmAndamento)}</div>
                : dados.hojeEmAndamento && <div>Hoje ainda está em andamento: as horas que ainda não chegaram não entram na média.</div>}
            </div>
          )}

          <GradeDeCartoes>
            {/* "Vendas" = atendimentos (a mesa uma vez) — o mesmo número do Vendas por período e do Faturamento por dia. */}
            <Cartao rotulo="Vendas" valor={dados.metricas.pedidos.total.toLocaleString("pt-BR")}
              detalhe={dados.lancamentos !== dados.metricas.pedidos.total ? `${noDiaMedio("pedidos")} · ${dados.lancamentos.toLocaleString("pt-BR")} lançamentos` : noDiaMedio("pedidos")} />
            <Cartao rotulo="Valor" valor={fmtReais(dados.metricas.valor.total)} detalhe={noDiaMedio("valor")} />
            <Cartao rotulo="Itens" valor={fmtQtd(dados.metricas.itens.total)} detalhe={noDiaMedio("itens")} />
            <Cartao rotulo="Ticket médio" valor={ticket === null ? "—" : fmtReais(ticket)} detalhe="Cancelados não entram" />
            <Cartao rotulo="Dias no período" valor={dados.dias.toLocaleString("pt-BR")}
              detalhe={dados.mesas.sessoes > 0
                ? `${dados.mesas.sessoes} mesa${dados.mesas.sessoes === 1 ? "" : "s"} (${dados.mesas.lancamentos} lançamentos) = ${dados.mesas.sessoes} venda${dados.mesas.sessoes === 1 ? "" : "s"}`
                : "O dia vira às 5h"} />
          </GradeDeCartoes>

          {/* ── O mapa de calor ── */}
          <Bloco
            titulo={`Mapa de calor — ${ROTULO_DA_METRICA[metrica].toLowerCase()}, ${modo}`}
            subtitulo="Linha = dia operacional (o pedido da 1h de sábado é da sexta). Coluna = hora no relógio da loja, começando às 5h."
            acoes={
              <label className="fh-sem-impressao" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.82rem", fontWeight: 600, cursor: "pointer" }}>
                <input type="checkbox" checked={todasAsHoras} onChange={(e) => mudarExtra("horas", e.target.checked ? "24" : "")} style={{ accentColor: PALETA.carvao }} />
                Mostrar as 24 horas
              </label>
            }
            semPadding>
            <div style={{ overflowX: "auto", padding: "0.8rem 0.9rem 0.4rem 0" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 2, fontVariantNumeric: "tabular-nums", minWidth: "100%" }}>
                <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  {`${ROTULO_DA_METRICA[metrica]} por dia da semana e hora, ${modo}`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...colunaFixa, textAlign: "left", ...rotulo, padding: "0 8px 4px 0.9rem" }}>Dia</th>
                    {horas.map((h) => (
                      <th key={h} scope="col" style={{ ...rotulo, fontSize: "0.68rem", textAlign: "center", padding: "0 0 4px", minWidth: metrica === "valor" ? 50 : 40 }}>{h}h</th>
                    ))}
                    <th scope="col" style={{ ...rotulo, fontSize: "0.68rem", textAlign: "right", padding: "0 0 4px 10px", whiteSpace: "nowrap" }}>{verTotal ? "Total" : "Dia todo"}</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.ordemDosDias.map((w) => {
                    const naoHouve = dados.diasPorSemana[w] === 0;
                    const doDia = verTotal ? serie.porDia.total[w] : serie.porDia.media[w];
                    return (
                      <tr key={w}>
                        <th scope="row" style={{ ...colunaFixa, textAlign: "left", fontSize: "0.8rem", fontWeight: 800, padding: "0 10px 0 0.9rem", whiteSpace: "nowrap" }}>
                          {NOMES_DOS_DIAS[w]}
                          <span style={{ fontWeight: 500, color: PALETA.areiaTinta, fontSize: "0.7rem", marginLeft: 4 }}>{dados.diasPorSemana[w]}×</span>
                        </th>
                        {horas.map((h) => {
                          const v = mapa![w][h];
                          const f = faixaDe(v, maxDoMapa);
                          // A hora que não aconteceu (é hoje e ela ainda não chegou) fica em
                          // areia como o dia que não houve — não é "sem venda", é "ainda não".
                          const naoChegou = !naoHouve && serie.mapa.media[w][h] === null;
                          const ehPico = !verTotal && pico?.dia === w && pico?.hora === h;
                          const titulo = naoHouve
                            ? `Não houve ${nomeDoDia(w)} no período`
                            : naoChegou ? `${NOMES_DOS_DIAS[w]}, ${rotuloDaHora(h)}: hoje, essa hora ainda não chegou`
                            : `${NOMES_DOS_DIAS[w]}, ${rotuloDaHora(h)}: ${verTotal ? `${textoDaMetrica(metrica, serie.mapa.total[w][h])} no período` : `${textoDaMetrica(metrica, serie.mapa.media[w][h] ?? 0)} por ${nomeDoDia(w)} (total ${textoDaMetrica(metrica, serie.mapa.total[w][h])})`}${ehPico ? " — pico da semana" : ""}`;
                          return (
                            <td key={h} title={titulo}
                              style={{
                                height: 34, textAlign: "center", borderRadius: 4, fontSize: "0.7rem", fontWeight: 700, padding: "0 2px",
                                background: naoHouve || naoChegou ? PALETA.areia : f < 0 ? "#fff" : RAMPA[f],
                                border: f < 0 ? `1px solid ${PALETA.areia}` : "1px solid transparent",
                                color: corDoTexto(f),
                                ...(ehPico ? anelDoPico(f) : {}),
                                ...imprimirCor,
                              }}>
                              {naoHouve || naoChegou ? "" : numeroCurto(metrica, v)}
                            </td>
                          );
                        })}
                        <td title={!naoHouve && doDia === null ? avisoDoDiaEmAndamento(w) : undefined}
                          style={{ textAlign: "right", fontSize: "0.8rem", fontWeight: 900, padding: "0 0 0 10px", whiteSpace: "nowrap" }}>
                          {naoHouve ? "—" : numeroDaMetrica(metrica, doDia)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <th scope="row" style={{ ...colunaFixa, textAlign: "left", fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, padding: "6px 10px 0 0.9rem", whiteSpace: "nowrap" }}>
                      {verTotal ? "Total" : "Dia médio"}
                    </th>
                    {horas.map((h) => (
                      <td key={h} style={{ textAlign: "center", fontSize: "0.68rem", fontWeight: 800, color: PALETA.carvao2, paddingTop: 6 }}>
                        {numeroCurto(metrica, verTotal ? serie.porHora.total[h] : serie.porHora.todos[h])}
                      </td>
                    ))}
                    <td style={{ textAlign: "right", fontSize: "0.8rem", fontWeight: 900, padding: "6px 0 0 10px", whiteSpace: "nowrap" }}>
                      {numeroDaMetrica(metrica, verTotal ? serie.total : serie.mediaPorDia)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Legenda: as seis faixas, com o teto de cada uma. */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 10px", padding: "0.4rem 0.9rem 0.9rem", fontSize: "0.72rem", color: PALETA.areiaTinta }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 16, height: 12, borderRadius: 3, background: "#fff", border: `1px solid ${PALETA.areiaBorda}` }} /> sem venda
              </span>
              {temCasaQueNaoHouve && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 16, height: 12, borderRadius: 3, background: PALETA.areia, border: `1px solid ${PALETA.areiaBorda}`, ...imprimirCor }} /> não houve (ou ainda não chegou)
                </span>
              )}
              {RAMPA.map((cor, i) => (
                <span key={cor} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 16, height: 12, borderRadius: 3, background: cor, ...imprimirCor }} />
                  até {tetoDaFaixa(metrica, (maxDoMapa * (i + 1)) / RAMPA.length)}
                </span>
              ))}
              {/* A amostra do pico é a casa do pico: a mesma cor e o mesmo anel. */}
              {faixaDoPico >= 0 && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 22, height: 16, borderRadius: 4, background: RAMPA[faixaDoPico], ...anelDoPico(faixaDoPico), ...imprimirCor }} /> pico da semana
                </span>
              )}
            </div>
          </Bloco>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "0 1rem", alignItems: "start" }}>
            {/* ── Por hora: dias de semana × fim de semana ── */}
            {porHora && (
              <Bloco titulo={`Por hora — ${modo}`}
                subtitulo={[
                  porHora.picoSemana !== null ? `Seg a qui: pico às ${porHora.picoSemana}h` : "",
                  porHora.picoFds !== null ? `sex a dom: pico às ${porHora.picoFds}h` : "",
                ].filter(Boolean).join(" · ") || "Sem venda nas horas mostradas"}>
                <div role="table" aria-label={`${ROTULO_DA_METRICA[metrica]} por hora, segunda a quinta e sexta a domingo`} style={{ display: "grid", gridTemplateColumns: "42px minmax(0, 1fr) minmax(0, 1fr)", gap: "6px 12px", alignItems: "center" }}>
                  <div role="row" style={{ display: "contents" }}>
                    <span role="columnheader" style={rotulo}>Hora</span>
                    <span role="columnheader" style={rotulo}>Seg a qui</span>
                    <span role="columnheader" style={rotulo}>Sex a dom</span>
                  </div>
                  {horas.map((h, i) => (
                    <div role="row" key={h} style={{ display: "contents" }}>
                      <span role="rowheader" style={{ fontSize: "0.78rem", fontWeight: 800, color: PALETA.carvao2 }}>{h}h</span>
                      <span role="cell"><LinhaDeBarra valor={porHora.semana[i]} max={porHora.max} destaque={porHora.picoSemana === h}
                        texto={numeroDaMetrica(metrica, porHora.semana[i])} titulo={`Seg a qui, ${rotuloDaHora(h)}: ${textoDaMetrica(metrica, porHora.semana[i])}${verTotal ? " no período" : " por dia"}`} /></span>
                      <span role="cell"><LinhaDeBarra valor={porHora.fds[i]} max={porHora.max} destaque={porHora.picoFds === h}
                        texto={numeroDaMetrica(metrica, porHora.fds[i])} titulo={`Sex a dom, ${rotuloDaHora(h)}: ${textoDaMetrica(metrica, porHora.fds[i])}${verTotal ? " no período" : " por dia"}`} /></span>
                    </div>
                  ))}
                </div>
              </Bloco>
            )}

            {/* ── Por dia da semana, com a linha da média ── */}
            {porDia && (
              <Bloco titulo={`Por dia da semana — ${modo}`}
                subtitulo={verTotal ? "Linha tracejada = média entre os dias da semana"
                  : porDia.media === null ? "Ainda não há um dia completo no período"
                  : `Linha tracejada = um dia médio (${numeroDaMetrica(metrica, porDia.media)})`}>
                <div role="table" aria-label={`${ROTULO_DA_METRICA[metrica]} por dia da semana`} style={{ display: "grid", gridTemplateColumns: "minmax(64px, auto) minmax(0, 1fr)", gap: "8px 12px", alignItems: "center" }}>
                  {dados.ordemDosDias.map((w, i) => {
                    const n = dados.diasPorSemana[w];
                    return (
                      <div role="row" key={w} style={{ display: "contents" }}>
                        <span role="rowheader" style={{ fontSize: "0.8rem", fontWeight: 800, whiteSpace: "nowrap" }}>
                          {NOMES_DOS_DIAS[w]} <span style={{ fontWeight: 500, color: PALETA.areiaTinta, fontSize: "0.7rem" }}>{n}×</span>
                        </span>
                        <span role="cell">
                          {n === 0 && !porDia.valores[i]
                            ? <span style={{ fontSize: "0.76rem", color: PALETA.areiaTinta }}>não houve {nomeDoDia(w)} no período</span>
                            : !verTotal && w === dados.diaEmAndamento
                            ? <span title={avisoDoDiaEmAndamento(w)} style={{ fontSize: "0.76rem", color: PALETA.areiaTinta }}>só hoje, ainda em andamento: a média sai quando o dia fechar</span>
                            : <LinhaDeBarra valor={porDia.valores[i]} max={porDia.max} destaque={porDia.melhor === w} linhaDaMedia={porDia.media}
                                texto={numeroDaMetrica(metrica, porDia.valores[i])}
                                titulo={`${NOMES_DOS_DIAS[w]}: ${verTotal ? `${textoDaMetrica(metrica, porDia.valores[i])} em ${quantosDias(w, n)}` : `${textoDaMetrica(metrica, porDia.valores[i])} por ${nomeDoDia(w)} (total ${textoDaMetrica(metrica, serie.porDia.total[w])} em ${quantosDias(w, n)})`}`} />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Bloco>
            )}
          </div>
        </>
      )}

      <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55 }}>
        <strong>Média por dia</strong> = o que a loja fez naquela hora dividido por quantas vezes aquele dia da semana apareceu no período
        (o “3×” ao lado do nome) — assim 3 sextas e 4 sábados não dão a vitória ao sábado só por ele aparecer mais.
        Valor = total do pedido (com a taxa de entrega), na hora em que foi feito. Cancelados não entram. <strong>Vendas</strong> são atendimentos:
        a <strong>mesa</strong> é uma venda, na hora do primeiro lançamento; o valor de cada rodada fica na hora dela (o lançado, sem a taxa de serviço e a gorjeta;
        o desconto dado no fechamento não sai do valor). São os mesmos números — vendas, valor e ticket — do
        {" "}<Link href={`/store/relatorios/vendas?${consulta}`} style={{ color: PALETA.marca, fontWeight: 700 }}>Vendas por período</Link>, onde a lista mostra cada lançamento.
        “Horário mais parado” procura só entre as horas em que a loja costuma vender: hora de loja fechada não é hora parada.
      </p>
    </ModeloDoRelatorio>
  );
}
