"use client";
/**
 * Tempo por status e produção — a tela. A conta mora em lib/relatorios/tempos.ts;
 * aqui são os filtros, as tabelas e o "Mostrar apenas atrasados".
 *
 * O que a Saipos não mostra e esta tela mostra:
 * - QUANTOS pedidos cada tempo mediu e por que os outros ficaram de fora
 *   (sem carimbo, fora da curva, carimbo reescrito). Um "tempo médio de
 *   entrega: 4h20" sem essa linha é o lojista tomando a conclusão do iFood por
 *   entrega — era o que o número cru dizia na NIK;
 * - a MEDIANA e o "9 em cada 10 em até", que um pedido esquecido não arrasta;
 * - o prazo com as faixas de alerta que o próprio lojista configurou no painel,
 *   e a lista dos que estouraram com quanto passaram;
 * - o tempo de preparo por PRODUTO, que sai do pronto por item do KDS.
 */
import React, { useMemo, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";
import { DIAS_CURTOS, fmtDia, fmtPct, fmtQtd, ROTULO_DO_TIPO, type TipoDeVenda } from "@/lib/relatorios/base";
import {
  ETAPAS, fmtMin, ROTULO_DA_FAIXA,
  type ChaveDaEtapa, type FaixaDoPrazo, type LinhaDoDia, type LinhaDoPedido, type LinhaDoTipo, type NoDaProducao,
  type ResumoDaEtapa, type ResumoDaProducao, type ResumoDoPrazo,
} from "@/lib/relatorios/tempos";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = {
  lojas: string[];
  periodo: { de: string; ate: string };
  tz: string;
  pedidos: number;
  agendados: number;
  etapas: ResumoDaEtapa[];
  prazo: ResumoDoPrazo;
  prazoDosAgendados: ResumoDoPrazo;
  porDia: LinhaDoDia[];
  porTipo: LinhaDoTipo[];
  lista: LinhaDoPedido[];
  totalDaLista: number;
  listaCortada: boolean;
  producao: ResumoDaProducao;
  avisos: {
    carimbosDesde: string;
    prontoPorItemDesde: string;
    periodoAntesDosCarimbos: boolean;
    periodoAntesDoProntoPorItem: boolean;
    tetoDaRua: number;
  };
};

const th: React.CSSProperties = { textAlign: "left", padding: "8px 0.8rem", fontWeight: 800, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 0.8rem", verticalAlign: "top" };
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const cabecaDaTabela: React.CSSProperties = { color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` };
const suave: React.CSSProperties = { fontSize: "0.72rem", color: PALETA.areiaTinta, fontWeight: 500 };
const caixa: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.86rem", fontWeight: 700, cursor: "pointer", color: PALETA.carvao };

const nomeDoCanal = new Map<string, string>(canaisConhecidos().map((c) => [c.chave, `${c.emoji} ${c.nome}`]));

/** Estado em fundo claro — a regra do painel: cor cheia só na ação principal. */
const COR_DA_FAIXA: Record<FaixaDoPrazo, { cor: string; fundo: string }> = {
  noPrazo: { cor: PALETA.ok, fundo: PALETA.okClaro },
  amarelo: { cor: PALETA.atencao, fundo: PALETA.atencaoClaro },
  vermelho: { cor: PALETA.marca, fundo: PALETA.brasaClaro },
  estourado: { cor: PALETA.grave, fundo: PALETA.graveClaro },
  semPrazo: { cor: PALETA.areiaTinta, fundo: PALETA.areia },
  semCarimbo: { cor: PALETA.areiaTinta, fundo: PALETA.areia },
  foraDaCurva: { cor: PALETA.areiaTinta, fundo: PALETA.areia },
};

function Selo({ faixa }: { faixa: FaixaDoPrazo }) {
  const c = COR_DA_FAIXA[faixa];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 800, color: c.cor, background: c.fundo, whiteSpace: "nowrap" }}>
      {ROTULO_DA_FAIXA[faixa]}
    </span>
  );
}

/** Barrinha de minutos, na escala da tabela (o maior "90% em até" = cheio). */
function BarraDeMinutos({ valor, escala, cor = PALETA.brasa }: { valor: number | null; escala: number; cor?: string }) {
  const pct = valor !== null && escala > 0 ? Math.min(100, (valor / escala) * 100) : 0;
  return (
    <div style={{ height: 6, background: PALETA.areia, borderRadius: 999, overflow: "hidden", minWidth: 60 }} aria-hidden>
      <div style={{ height: "100%", width: `${pct}%`, background: cor, borderRadius: 999 }} />
    </div>
  );
}

/** "125 de 168 · 43 com carimbo reescrito" — por que o resto não entrou. */
function Cobertura({ e }: { e: ResumoDaEtapa }) {
  // "0 de 0 medidos" parecia falha de carimbo; é a etapa que não vale para
  // nenhum pedido do filtro (só Wabiz com aceite automático, só balcão…).
  if (e.elegiveis === 0) return <span style={suave}>Não vale para nenhum pedido do período e filtros escolhidos</span>;
  const motivos = [
    e.semCarimbo ? `${e.semCarimbo} sem carimbo` : "",
    e.foraDaCurva ? `${e.foraDaCurva} fora da curva` : "",
    e.reescritos ? `${e.reescritos} com carimbo reescrito` : "",
  ].filter(Boolean);
  return (
    <span style={suave}>
      {e.medidos.toLocaleString("pt-BR")} de {e.elegiveis.toLocaleString("pt-BR")} medidos{motivos.length ? ` · ${motivos.join(" · ")}` : ""}
    </span>
  );
}

export default function TemposClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "7d", { apenasAtrasados: "" });
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("tempos", query);
  const apenasAtrasados = extras.apenasAtrasados !== "0";

  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const alternar = (k: string) => setAbertos((a) => { const n = new Set(a); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const relogio = useMemo(() => {
    if (!dados) return null;
    return new Intl.DateTimeFormat("pt-BR", { timeZone: dados.tz || "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  }, [dados]);
  /** "20:45", ou "24/09 20:45" quando cai em outro dia que o do pedido. */
  const hora = (iso: string | null, criadoEm: string) => {
    if (!iso || !relogio) return "—";
    const [dm, hm] = relogio.format(new Date(iso)).split(/,?\s+/);
    const [dmCriado] = relogio.format(new Date(criadoEm)).split(/,?\s+/);
    return dm === dmCriado ? hm : `${dm} ${hm}`;
  };

  const categorias = useMemo(() => {
    const lista = dados?.producao.categorias || [];
    const t = busca.trim().toLowerCase();
    if (!t) return lista;
    return lista.flatMap((c) => {
      if (c.nome.toLowerCase().includes(t)) return [c];
      const filhos = (c.filhos || []).filter((f) => f.nome.toLowerCase().includes(t));
      return filhos.length ? [{ ...c, filhos }] : [];
    });
  }, [dados, busca]);

  const escalaDasEtapas = Math.max(1, ...(dados?.etapas || []).map((e) => e.p90 || 0));
  // A escala da produção é a maior mediana DE CATEGORIA: um produto medido uma
  // vez só tem aquela medição como mediana, e o p90 de uma categoria pequena é
  // o pior caso dela — na NIK, antes de a conta tirar o pronto da tela largada,
  // as Bebidas tinham p90 de 2h03 e as barras das esfihas, de 3 min, sumiam.
  // O produto acima da escala enche a barra.
  const escalaDaProducao = Math.max(1, ...categorias.map((c) => c.mediana || 0));
  const totalEntrega = dados?.etapas.find((e) => e.chave === "totalEntrega");
  const cozinha = dados?.etapas.find((e) => e.chave === "cozinha");
  const p = dados?.prazo;
  const noPrazoOuAlerta = p ? p.noPrazo + p.amarelo + p.vermelho : 0;

  return (
    <ModeloDoRelatorio
      titulo="Tempo por status e produção"
      descricao="Quanto o pedido fica em cada etapa, quais saíram depois do prazo e quanto a cozinha leva em cada produto. Cada tempo conta só os pedidos com os dois carimbos da etapa — falta de carimbo não vira zero."
      slug="tempos" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <style>{`
        .fh-tempos-abrivel:hover { background: ${PALETA.areia} !important; }
        .fh-tempos-abrivel:focus-visible { outline: 2px solid ${PALETA.carvao}; outline-offset: -2px; }
      `}</style>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ categorias: true, produtos: true }}>
        {(filtros.categorias.length > 0 || filtros.produtos.length > 0) && (
          <p style={{ margin: 0, fontSize: "0.78rem", color: PALETA.areiaTinta }}>
            Com categoria ou produto marcado, as etapas contam os pedidos que <strong>têm</strong> esse item, e a produção mostra só ele.
          </p>
        )}
      </BarraDeFiltros>

      {dados?.avisos.periodoAntesDosCarimbos && (
        <p role="note" style={{ background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, color: PALETA.carvao2, borderRadius: 12, padding: "0.7rem 1rem", fontSize: "0.84rem", margin: "0 0 1rem" }}>
          Os carimbos de etapa existem desde <strong>{fmtDia(dados.avisos.carimbosDesde)}</strong>: pedidos anteriores ficam sem medição (não entram como zero).
        </p>
      )}

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Na cozinha (mediana)" valor={fmtMin(cozinha?.mediana)}
            detalhe={cozinha && cozinha.medidos ? `9 em cada 10 em até ${fmtMin(cozinha.p90)} · ${cozinha.medidos} pedidos` : "Nenhum pedido com pronto no período"} />
          {totalEntrega && totalEntrega.elegiveis > 0 && (
            <Cartao rotulo="Entrega: do pedido ao cliente" valor={fmtMin(totalEntrega.mediana)}
              detalhe={totalEntrega.medidos ? `mediana de ${totalEntrega.medidos} entregas com hora de entregue confiável` : "Nenhuma entrega com hora de entregue confiável"} />
          )}
          <Cartao rotulo="Saíram no prazo" tom={p && p.medidos ? "ok" : "neutro"}
            valor={p && p.medidos ? fmtPct((noPrazoOuAlerta / p.medidos) * 100, 0) : "—"}
            detalhe={p ? `${noPrazoOuAlerta} de ${p.medidos} pedidos com prazo medido` : undefined} />
          <Cartao rotulo="Estouraram o prazo" tom={p && p.estourados ? "grave" : "neutro"} valor={p ? p.estourados.toLocaleString("pt-BR") : "—"}
            detalhe={p && p.estourados ? `passaram ${fmtMin(p.atrasoMediano)} (mediana) · o pior, ${fmtMin(p.maiorAtraso)}` : "Nenhum pedido saiu depois do prazo"} />
        </GradeDeCartoes>
      )}

      {/* ── PARTE 1: TEMPO POR ETAPA ── */}
      {dados && (
        <Bloco titulo="Tempo por etapa" subtitulo={`${dados.pedidos.toLocaleString("pt-BR")} pedidos no período (cancelados não entram)${dados.agendados ? ` · ${dados.agendados} agendado${dados.agendados > 1 ? "s" : ""} à parte` : ""}`} semPadding>
          {dados.pedidos === 0 ? <Vazio /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 720 }}>
                <thead>
                  <tr style={cabecaDaTabela}>
                    <th style={th}>Etapa</th>
                    <th style={{ ...th, ...num }}>Mín.</th>
                    <th style={{ ...th, ...num }}>Mediana</th>
                    <th style={{ ...th, width: 110 }} aria-label="Mediana em barra" />
                    <th style={{ ...th, ...num }}>Média</th>
                    <th style={{ ...th, ...num }} title="9 em cada 10 pedidos ficaram até este tempo">90% em até</th>
                    <th style={{ ...th, ...num }}>Máx.</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.etapas.map((e) => (
                    <tr key={e.chave} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                      <td style={{ ...td, minWidth: 260 }}>
                        <div style={{ fontWeight: 800 }} title={e.aplicaA}>{e.titulo}</div>
                        <div style={suave}>{e.legenda}</div>
                        <Cobertura e={e} />
                      </td>
                      <td style={{ ...td, ...num }}>{fmtMin(e.minimo)}</td>
                      <td style={{ ...td, ...num, fontWeight: 900 }}>{fmtMin(e.mediana)}</td>
                      <td style={{ ...td, paddingTop: 14 }}><BarraDeMinutos valor={e.mediana} escala={escalaDasEtapas} /></td>
                      <td style={{ ...td, ...num }}>{fmtMin(e.media)}</td>
                      <td style={{ ...td, ...num }}>{fmtMin(e.p90)}</td>
                      <td style={{ ...td, ...num }}>{fmtMin(e.maximo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ ...suave, fontSize: "0.76rem", padding: "0.8rem 1rem", margin: 0, lineHeight: 1.5 }}>
            <strong>Carimbo reescrito:</strong> o sistema guarda a última vez que o pedido passou por “aceito”, e a baixa da cozinha e o “pronto” do iFood regravam essa hora — nesses pedidos a espera pelo aceite não é conhecida.
            {" "}O pedido que a loja aceita sozinha (aceite automático ligado: site, Wabiz, 99Food, totem) não esperou aceite e não entra nessa etapa.
            {" "}<strong>Fora da curva:</strong> carimbos fora de ordem, mais de 4 h na etapa, ou mais de {dados.avisos.tetoDaRua} min na rua (é o pedido encerrado depois — pela conclusão automática do iFood ou pelo fechamento do caixa —, não a entrega).
            {" "}<strong>Dois totais:</strong> o da entrega vai até o cliente receber em casa; o “na loja” (balcão, retirada, totem e mesa), até ficar pronto — juntos, a mediana mudaria só com a mistura do dia.
            {" "}As etapas não somam o total: cada uma tem os seus pedidos medidos.
          </p>
        </Bloco>
      )}

      {dados && dados.porTipo.length > 0 && (
        <Bloco titulo="Por tipo de venda" subtitulo="Mediana de cada etapa em cada tipo de venda. “—”: a etapa não vale para o tipo, ou nenhum pedido foi medido nela." semPadding>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 760 }}>
              <thead>
                <tr style={cabecaDaTabela}>
                  <th style={th}>Tipo</th><th style={{ ...th, ...num }}>Pedidos</th>
                  {ETAPAS.map((e) => <th key={e.chave} style={{ ...th, ...num }}>{e.titulo}</th>)}
                  <th style={{ ...th, ...num }}>Estouraram</th>
                </tr>
              </thead>
              <tbody>
                {dados.porTipo.map((t) => (
                  <tr key={t.tipo} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                    <td style={{ ...td, fontWeight: 800 }}>{ROTULO_DO_TIPO[t.tipo as TipoDeVenda]}</td>
                    <td style={{ ...td, ...num }}>{t.pedidos.toLocaleString("pt-BR")}</td>
                    {ETAPAS.map((e) => {
                      const x = t.etapas[e.chave as ChaveDaEtapa];
                      const ehTotal = e.chave === "totalEntrega" || e.chave === "totalNaLoja";
                      return <td key={e.chave} style={{ ...td, ...num, fontWeight: ehTotal ? 800 : 500 }} title={x.medidos ? `${x.medidos} medidos` : "não se aplica ou nenhum medido"}>{fmtMin(x.mediana)}</td>;
                    })}
                    <td style={{ ...td, ...num, color: t.estourados ? PALETA.grave : PALETA.areiaTinta, fontWeight: t.estourados ? 800 : 500 }}>
                      {t.tipo === "MESA" ? "—" : `${t.estourados} de ${t.medidosNoPrazo}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Bloco>
      )}

      {/* ── O PRAZO ── */}
      {dados && p && (
        <Bloco titulo="Como os pedidos saíram" subtitulo={
          `Folga até o prazo na hora da saída. Alertas: ${p.limites.amareloAtivo ? `amarelo com até ${p.limites.amareloMin} min` : "amarelo desligado"}, ${p.limites.vermelhoAtivo ? `vermelho com até ${p.limites.vermelhoMin} min` : "vermelho desligado"} — os Alertas de Produção do painel.`
        }>
          <FaixasDoPrazo p={p} />
          <p style={{ ...suave, fontSize: "0.76rem", margin: "0.8rem 0 0", lineHeight: 1.5 }}>
            O prazo é o do cartão do painel: a hora que a plataforma prometeu; sem ela, 40 min (retirada, balcão, totem) ou 45 min (entrega e o pedido do site para retirar, que o cartão não reconhece como retirada).
            A saída é a do motoboy na entrega e o pronto nos outros. Mesa não tem prazo.
            {p.semCarimbo + p.foraDaCurva > 0 && ` Sem medição: ${p.semCarimbo} sem hora de saída, ${p.foraDaCurva} fora da curva.`}
          </p>
          {dados.agendados > 0 && (
            <div style={{ marginTop: "1rem", borderTop: `1px dashed ${PALETA.areiaBorda}`, paddingTop: "0.8rem" }}>
              <div style={{ fontWeight: 900, fontSize: "0.9rem", marginBottom: 6 }}>Agendados ({dados.agendados}) — o prazo é a hora marcada</div>
              <FaixasDoPrazo p={dados.prazoDosAgendados} />
            </div>
          )}
        </Bloco>
      )}

      {dados && (
        <Bloco titulo={apenasAtrasados ? "Pedidos que estouraram o prazo" : "Todos os pedidos"}
          subtitulo={apenasAtrasados ? "O pior primeiro" : "Na ordem em que chegaram"}
          acoes={
            <label style={caixa}>
              <input type="checkbox" checked={apenasAtrasados} onChange={(e) => mudarExtra("apenasAtrasados", e.target.checked ? "" : "0")} style={{ accentColor: PALETA.carvao }} />
              Mostrar apenas atrasados
            </label>
          } semPadding>
          {dados.lista.length === 0 ? (
            <Vazio texto={apenasAtrasados ? "Nenhum pedido saiu depois do prazo no período." : "Nenhum pedido no período e filtros escolhidos."} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 860 }}>
                <thead>
                  <tr style={cabecaDaTabela}>
                    <th style={th}>Pedido</th><th style={th}>Canal</th><th style={th}>Dia</th>
                    <th style={{ ...th, ...num }}>Prazo</th><th style={{ ...th, ...num }}>Saída</th>
                    <th style={{ ...th, ...num }}>Até sair</th><th style={th}>Situação</th><th style={{ ...th, ...num }}>Passou</th>
                    <th style={{ ...th, ...num }}>Cozinha</th><th style={{ ...th, ...num }}>Na rua</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.lista.map((l) => (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                      <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>
                        {l.numero !== null ? `#${l.numero}` : "—"}
                        {l.referencia && <div style={suave}>parceiro {l.referencia}</div>}
                        {l.agendado && <div style={{ ...suave, color: PALETA.brasaTinta, fontWeight: 800 }}>agendado</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {nomeDoCanal.get(l.canal) || l.canal}
                        <div style={suave}>{ROTULO_DO_TIPO[l.tipo]}</div>
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDia(l.dia).slice(0, 5)} <span style={suave}>{l.hora}</span></td>
                      <td style={{ ...td, ...num }}>{hora(l.prazo, l.criadoEm)}</td>
                      <td style={{ ...td, ...num }}>{hora(l.saida, l.criadoEm)}</td>
                      <td style={{ ...td, ...num }}>{fmtMin(l.tempoAteSaida)}</td>
                      <td style={td}><Selo faixa={l.faixa} /></td>
                      <td style={{ ...td, ...num, fontWeight: 800, color: l.faixa === "estourado" ? PALETA.grave : PALETA.areiaTinta }}>
                        {l.faixa !== "estourado" ? "—" : (l.excedeu ?? 0) < 0.1 ? "+segundos" : `+${fmtMin(l.excedeu)}`}
                      </td>
                      <td style={{ ...td, ...num }}>{fmtMin(l.etapas.cozinha)}</td>
                      <td style={{ ...td, ...num }}>{fmtMin(l.etapas.rua)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {dados.listaCortada && (
            <p style={{ ...suave, padding: "0.7rem 1rem", margin: 0 }}>
              Mostrando {dados.lista.length.toLocaleString("pt-BR")} de {dados.totalDaLista.toLocaleString("pt-BR")} pedidos. A planilha do Excel traz todos.
            </p>
          )}
        </Bloco>
      )}

      {dados && dados.porDia.length > 0 && (
        <Bloco titulo="Por dia" subtitulo="Mediana de cada etapa no dia operacional (o dia vira às 5h)" semPadding>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 820 }}>
              <thead>
                <tr style={cabecaDaTabela}>
                  <th style={th}>Dia</th><th style={{ ...th, ...num }}>Pedidos</th>
                  {ETAPAS.map((e) => <th key={e.chave} style={{ ...th, ...num }}>{e.titulo}</th>)}
                  <th style={{ ...th, ...num }}>Estouraram</th>
                </tr>
              </thead>
              <tbody>
                {dados.porDia.map((d) => (
                  <tr key={d.dia} style={{ borderBottom: `1px solid ${PALETA.areia}`, color: d.pedidos ? PALETA.carvao : PALETA.areiaTinta }}>
                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700 }}>{fmtDia(d.dia).slice(0, 5)} <span style={suave}>{DIAS_CURTOS[d.diaSemana]}</span></td>
                    <td style={{ ...td, ...num }}>{d.pedidos || "—"}</td>
                    {ETAPAS.map((e) => {
                      const x = d.etapas[e.chave as ChaveDaEtapa];
                      return <td key={e.chave} style={{ ...td, ...num }} title={x.medidos ? `${x.medidos} medidos` : undefined}>{fmtMin(x.mediana)}</td>;
                    })}
                    <td style={{ ...td, ...num, color: d.estourados ? PALETA.grave : PALETA.areiaTinta, fontWeight: d.estourados ? 800 : 500 }}>
                      {d.medidosNoPrazo ? `${d.estourados} de ${d.medidosNoPrazo}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Bloco>
      )}

      {/* ── PARTE 2: PRODUÇÃO POR PRODUTO ── */}
      {dados && (
        <>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 900, margin: "2rem 0 0.4rem" }}>Tempo de produção por produto</h2>
          <p style={{ margin: "0 0 1rem", fontSize: "0.84rem", color: PALETA.areiaTinta, maxWidth: 820 }}>
            Da entrada do pedido na cozinha (a tela do KDS; balcão e mesa, a hora do lançamento) até o cozinheiro dar o item por pronto no KDS.
          </p>
          {dados.avisos.periodoAntesDoProntoPorItem && (
            <p role="note" style={{ background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, color: PALETA.carvao2, borderRadius: 12, padding: "0.7rem 1rem", fontSize: "0.84rem", margin: "0 0 1rem" }}>
              O pronto por item existe desde <strong>{fmtDia(dados.avisos.prontoPorItemDesde)}</strong>: antes disso não há medição por produto.
            </p>
          )}
          <GradeDeCartoes>
            <Cartao rotulo="Mediana por item" valor={fmtMin(dados.producao.mediana)} detalhe={dados.producao.medidos ? `9 em cada 10 em até ${fmtMin(dados.producao.p90)}` : "Nenhum item com pronto no período"} />
            <Cartao rotulo="Itens medidos" valor={fmtQtd(dados.producao.quantidade)} detalhe={`${dados.producao.medidos.toLocaleString("pt-BR")} linhas de pedido`} />
            <Cartao rotulo="O mais demorado" valor={fmtMin(dados.producao.maximo)} detalhe={dados.producao.semPronto ? `${dados.producao.semPronto} itens sem pronto (não passam pela produção) ficaram de fora` : undefined} />
          </GradeDeCartoes>

          <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: "0.8rem" }}>
            <input name="busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou categoria…" aria-label="Buscar produto ou categoria"
              style={{ padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.85rem", fontFamily: "inherit", minWidth: 0, flex: "1 1 220px", maxWidth: 360 }} />
            <button type="button" className="btn btn-outline" style={{ padding: "7px 12px" }} onClick={() => setAbertos(new Set(categorias.map((c) => c.chave)))}>Abrir tudo</button>
            <button type="button" className="btn btn-outline" style={{ padding: "7px 12px" }} onClick={() => setAbertos(new Set())}>Fechar tudo</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "0 1.25rem", alignItems: "start" }}>
            <Bloco titulo="Por categoria e produto" subtitulo="Toque na categoria para ver os produtos" semPadding>
              {categorias.length === 0 ? <Vazio texto={busca ? `Nada com “${busca}”.` : "Nenhum item com pronto do KDS no período e filtros escolhidos."} /> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 520 }}>
                    <thead>
                      <tr style={cabecaDaTabela}>
                        <th style={th}>Nome</th><th style={{ ...th, ...num }}>Qtd.</th><th style={{ ...th, ...num }}>Mediana</th>
                        <th style={{ ...th, width: 80 }} aria-label="Mediana em barra" /><th style={{ ...th, ...num }}>90% em até</th><th style={{ ...th, ...num }}>Máx.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categorias.map((c) => (
                        <LinhasDaCategoria key={c.chave} c={c} aberto={abertos.has(c.chave) || Boolean(busca.trim())} alternar={() => alternar(c.chave)} escala={escalaDaProducao} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bloco>

            <Bloco titulo="Por hora do dia" subtitulo="Hora em que o pedido entrou na cozinha" semPadding>
              {dados.producao.porHora.length === 0 ? <Vazio texto="Nenhum item com pronto no período." /> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 360 }}>
                    <thead>
                      <tr style={cabecaDaTabela}>
                        <th style={th}>Hora</th><th style={{ ...th, ...num }}>Itens</th><th style={{ ...th, ...num }}>Mediana</th>
                        <th style={{ ...th, width: 90 }} aria-label="Mediana em barra" /><th style={{ ...th, ...num }}>Máx.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.producao.porHora.map((x) => (
                        <tr key={x.hora} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                          <td style={{ ...td, fontWeight: 700 }}>{String(x.hora).padStart(2, "0")}h</td>
                          <td style={{ ...td, ...num }}>{fmtQtd(x.quantidade)}</td>
                          <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtMin(x.mediana)}</td>
                          <td style={{ ...td, paddingTop: 14 }}><BarraDeMinutos valor={x.mediana} escala={Math.max(1, ...dados.producao.porHora.map((y) => y.mediana || 0))} cor={PALETA.carvao2} /></td>
                          <td style={{ ...td, ...num }}>{fmtMin(x.maximo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bloco>
          </div>

          <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.2rem", lineHeight: 1.5 }}>
            O pronto é da <strong>tela</strong> do KDS: quando o cozinheiro dá baixa, todos os itens daquela tela ganham a mesma hora — um produto que sai junto com outro mais demorado herda o tempo dele.
            Qtd. são unidades; a mediana é por linha de pedido (“10 esfihas” é uma medição). Agendados não entram.
          </p>
        </>
      )}
    </ModeloDoRelatorio>
  );
}

/** As quatro faixas da saída, com a parte de cada uma. */
function FaixasDoPrazo({ p }: { p: ResumoDoPrazo }) {
  if (!p.medidos) return <Vazio texto="Nenhum pedido com prazo e hora de saída no período." />;
  const faixas: { faixa: FaixaDoPrazo; n: number; detalhe: string }[] = [
    { faixa: "noPrazo", n: p.noPrazo, detalhe: p.limites.amareloAtivo ? `mais de ${p.limites.amareloMin} min de folga` : "antes do prazo" },
    { faixa: "amarelo", n: p.amarelo, detalhe: `até ${p.limites.amareloMin} min de folga` },
    { faixa: "vermelho", n: p.vermelho, detalhe: `em cima da hora (até ${p.limites.vermelhoMin} min)` },
    { faixa: "estourado", n: p.estourados, detalhe: "saiu depois do prazo" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem" }}>
      {faixas.filter((f) => f.faixa === "noPrazo" || f.faixa === "estourado" || f.n > 0 || (f.faixa === "amarelo" ? p.limites.amareloAtivo : p.limites.vermelhoAtivo)).map((f) => {
        const c = COR_DA_FAIXA[f.faixa];
        const pct = (f.n / p.medidos) * 100;
        return (
          <div key={f.faixa} style={{ background: c.fundo, borderRadius: 12, padding: "0.7rem 0.8rem", minWidth: 0 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, color: c.cor, textTransform: "uppercase", letterSpacing: "0.03em" }}>{ROTULO_DA_FAIXA[f.faixa]}</div>
            <div style={{ fontSize: "1.3rem", fontWeight: 900, color: c.cor, fontVariantNumeric: "tabular-nums" }}>
              {f.n.toLocaleString("pt-BR")} <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{fmtPct(pct, 0)}</span>
            </div>
            <div style={{ fontSize: "0.72rem", color: PALETA.carvao2 }}>{f.detalhe}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A linha da categoria e, aberta, as dos produtos. */
function LinhasDaCategoria({ c, aberto, alternar, escala }: { c: NoDaProducao; aberto: boolean; alternar: () => void; escala: number }) {
  const temFilhos = Boolean(c.filhos && c.filhos.length);
  return (
    <>
      <tr className={temFilhos ? "fh-tempos-abrivel" : undefined}
        onClick={temFilhos ? alternar : undefined}
        // Pelo teclado também: Tab chega na categoria, Enter ou Espaço abre —
        // o mesmo da linha de Formas de pagamento.
        onKeyDown={temFilhos ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(); } } : undefined}
        tabIndex={temFilhos ? 0 : undefined}
        aria-expanded={temFilhos ? aberto : undefined}
        style={{ borderBottom: `1px solid ${PALETA.areia}`, cursor: temFilhos ? "pointer" : "default", background: "#fff" }}>
        <td style={{ ...td, fontWeight: 800 }}>
          <span style={{ display: "inline-block", width: 14, transition: "transform 0.15s", transform: aberto ? "rotate(90deg)" : "none" }} aria-hidden>{temFilhos ? "›" : ""}</span>
          {c.nome}
        </td>
        <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtQtd(c.quantidade)}</td>
        <td style={{ ...td, ...num, fontWeight: 900 }}>{fmtMin(c.mediana)}</td>
        <td style={{ ...td, paddingTop: 14 }}><BarraDeMinutos valor={c.mediana} escala={escala} /></td>
        <td style={{ ...td, ...num }}>{fmtMin(c.p90)}</td>
        <td style={{ ...td, ...num }}>{fmtMin(c.maximo)}</td>
      </tr>
      {aberto && (c.filhos || []).map((f) => (
        <tr key={f.chave} style={{ borderBottom: `1px solid ${PALETA.areia}`, background: "#FDFBF9" }}>
          <td style={{ ...td, paddingLeft: "2.2rem", color: PALETA.carvao2 }}>{f.nome}</td>
          <td style={{ ...td, ...num }}>{fmtQtd(f.quantidade)}</td>
          <td style={{ ...td, ...num, fontWeight: 700 }}>{fmtMin(f.mediana)}</td>
          <td style={{ ...td, paddingTop: 14 }}><BarraDeMinutos valor={f.mediana} escala={escala} cor={PALETA.brasaBorda} /></td>
          <td style={{ ...td, ...num }}>{fmtMin(f.p90)}</td>
          <td style={{ ...td, ...num }}>{fmtMin(f.maximo)}</td>
        </tr>
      ))}
    </>
  );
}
