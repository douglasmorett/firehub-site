"use client";
/**
 * Vendas por área de entrega — a tela. A conta mora em
 * lib/relatorios/areas-de-entrega.ts; aqui são os filtros, os cartões e as
 * tabelas.
 *
 * O que esta tela faz que a da Saipos não faz:
 * - A área é a MESMA que cobrou a taxa (raio, bairro ou área desenhada), e a
 *   linha diz quando não é área cadastrada: "fora das áreas", "sem ponto no
 *   mapa", "área de risco".
 * - Taxa média cobrada ao lado da taxa da tabela de hoje: a área que cobra
 *   R$ 6,39 com a tabela em R$ 8,00 está dando desconto sem ninguém ter
 *   decidido (Frangoso, 17 a 23/09/2026).
 * - Entrega do parceiro (iFood/99 com entregador deles) numa tabela à parte:
 *   ali a área e a taxa são da plataforma.
 * - Comparação com o período anterior, cancelados por área e as áreas
 *   cadastradas que não venderam nada.
 *
 * Não importa lib/relatorios/areas-de-entrega.ts por VALOR (só tipos): ela lê
 * lib/area-de-entrega.ts, que puxa o geocodificador do servidor.
 */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio, Variacao } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import type { LinhaDaArea, LojaDoResultado, NumerosDaArea, ResultadoDasAreas } from "@/lib/relatorios/areas-de-entrega";

type Resposta = ResultadoDasAreas & {
  lojas: string[];
  periodo: { de: string; ate: string };
  periodoAnterior: { de: string; ate: string } | null;
};

type Coluna = "nome" | "pedidos" | "valor" | "pct" | "ticketMedio" | "taxaMedia" | "distanciaMedia" | "variacao";
type Ordem = { coluna: Coluna | null; desc: boolean };

const caixa: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.86rem", fontWeight: 600, cursor: "pointer", color: PALETA.carvao };
const th: React.CSSProperties = { padding: "9px 0.8rem", fontSize: "0.7rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", textAlign: "right", borderBottom: `1px solid ${PALETA.areiaBorda}`, background: "#fff" };
const td: React.CSSProperties = { padding: "9px 0.8rem", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", verticalAlign: "top" };

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

/** O selo da linha: só quando a linha NÃO é uma área cadastrada comum. */
function Selo({ linha }: { linha: LinhaDaArea }) {
  const selo = (texto: string, fundo: string, cor: string, borda: string, titulo: string) => (
    <span title={titulo} style={{ fontSize: "0.66rem", fontWeight: 800, padding: "2px 7px", borderRadius: 999, background: fundo, color: cor, border: `1px solid ${borda}`, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: "0.03em" }}>
      {texto}
    </span>
  );
  switch (linha.situacao) {
    case "RISCO": return selo("área de risco", PALETA.graveClaro, PALETA.grave, PALETA.graveBorda, "O ponto do cliente caiu numa área que a loja marcou como de risco — a taxa recusaria esse endereço hoje.");
    case "FORA": return selo("fora das áreas", PALETA.atencaoClaro, PALETA.atencao, PALETA.atencaoBorda, "A loja entregou onde não tem área cadastrada. Agrupado pelo bairro escrito no endereço.");
    case "SEM_PONTO": return selo("sem ponto no mapa", PALETA.areia, PALETA.areiaTinta, PALETA.areiaBorda, "A loja decide a área pelo mapa e o pedido não tem o ponto do cliente nem a distância. Agrupado pelo bairro escrito no endereço.");
    case "PARCEIRO": return selo(`entrega ${linha.parceiro || "do parceiro"}`, PALETA.brasaClaro, PALETA.brasaTinta, PALETA.brasaBorda, "O parceiro mandou o entregador dele: a área e a taxa são da plataforma.");
    default: return null;
  }
}

/** "↑ 12%" do período anterior para este, na métrica do percentual. */
function VsAnterior({ atual, anterior, rotulo }: { atual: number; anterior: number; rotulo: string }) {
  if (!anterior && !atual) return <span style={{ color: PALETA.areiaTinta }}>—</span>;
  if (!anterior) return <span style={{ color: PALETA.ok, fontWeight: 800 }} title={`Nenhum ${rotulo} no período anterior`}>novo</span>;
  const v = ((atual - anterior) / anterior) * 100;
  const cor = Math.abs(v) < 0.5 ? PALETA.areiaTinta : v > 0 ? PALETA.ok : PALETA.grave;
  return (
    <span style={{ color: cor, fontWeight: 800 }}>
      {v > 0 ? "↑" : v < 0 ? "↓" : "="} {Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
    </span>
  );
}

function valorDaColuna(l: LinhaDaArea, c: Coluna, pctPor: "valor" | "pedidos"): number | string {
  if (c === "nome") return semAcento(l.nome);
  if (c === "variacao") {
    const atual = pctPor === "valor" ? l.valor : l.pedidos;
    const antes = l.anterior ? (pctPor === "valor" ? l.anterior.valor : l.anterior.pedidos) : 0;
    return antes ? (atual - antes) / antes : atual ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER;
  }
  const v = l[c];
  return v === null || v === undefined ? -1 : v;
}

function TabelaDeAreas({
  titulo, subtitulo, linhas, total, totalAnterior, pctPor, variasLojas, textoVazio, rodape,
}: {
  titulo: string;
  subtitulo?: React.ReactNode;
  linhas: LinhaDaArea[];
  /** O bloco inteiro, com o % dele sobre o total de entregas (vem da conta). */
  total: NumerosDaArea;
  /** O total do período anterior deste bloco — null sem comparação. */
  totalAnterior: { pedidos: number; valor: number } | null;
  pctPor: "valor" | "pedidos";
  variasLojas: boolean;
  textoVazio: string;
  rodape?: React.ReactNode;
}) {
  const [ordem, setOrdem] = useState<Ordem>({ coluna: null, desc: true });
  const ordenadas = useMemo(() => {
    if (!ordem.coluna) return linhas;
    const c = ordem.coluna;
    return [...linhas].sort((a, b) => {
      const x = valorDaColuna(a, c, pctPor);
      const y = valorDaColuna(b, c, pctPor);
      const r = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "pt-BR") : Number(x) - Number(y);
      return ordem.desc ? -r : r;
    });
  }, [linhas, ordem, pctPor]);

  const cabeca = (coluna: Coluna, rotulo: string, extra: React.CSSProperties = {}, dica?: string) => {
    const ativa = ordem.coluna === coluna;
    return (
      <th style={{ ...th, ...extra }} title={dica} aria-sort={ativa ? (ordem.desc ? "descending" : "ascending") : "none"}>
        {/* Reset propriedade a propriedade, e não `all: unset`: estilo inline
            vence o :focus-visible do navegador, e o `all` zerava o outline —
            quem ordena pelo teclado (Tab até "Pedidos") não via onde estava. */}
        <button type="button" className="fh-ae-ordenar"
          onClick={() => setOrdem((o) => (o.coluna === coluna ? (o.desc ? { coluna, desc: false } : { coluna: null, desc: true }) : { coluna, desc: coluna !== "nome" }))}
          style={{
            border: "none", background: "none", padding: 0, margin: 0, borderRadius: 4, cursor: "pointer",
            font: "inherit", lineHeight: "inherit", textTransform: "inherit", letterSpacing: "inherit", textAlign: "inherit",
            display: "inline-flex", alignItems: "center", gap: 4, color: ativa ? PALETA.carvao : "inherit",
          }}>
          {rotulo}
          {ativa && (ordem.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
        </button>
      </th>
    );
  };

  const rotuloVs = pctPor === "valor" ? "valor" : "pedido";
  const comparar = totalAnterior !== null;

  return (
    <Bloco titulo={titulo} subtitulo={subtitulo} semPadding>
      {linhas.length === 0 ? <Vazio texto={textoVazio} /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: comparar ? 860 : 780, borderCollapse: "collapse", fontSize: "0.86rem" }}>
            <thead>
              <tr>
                {cabeca("nome", "Área", { textAlign: "left", minWidth: 220 })}
                {cabeca("pedidos", "Pedidos")}
                {cabeca("valor", "Valor", {}, "Total do pedido, com a taxa de entrega")}
                {cabeca("pct", pctPor === "valor" ? "% valor" : "% pedidos", { minWidth: 120 }, "Participação no total de entregas (loja + parceiro)")}
                {cabeca("ticketMedio", "Ticket médio")}
                {cabeca("taxaMedia", "Taxa média", {}, "Taxa de entrega cobrada, em média, por entrega (as sem taxa contam como zero)")}
                {cabeca("distanciaMedia", "Distância", {}, "Distância média dos pedidos que têm distância")}
                {comparar && cabeca("variacao", "vs. anterior", {}, `Variação ${pctPor === "valor" ? "do valor" : "dos pedidos"} contra o período anterior de mesmo tamanho`)}
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((l) => {
                const detalhes = [
                  l.canais.map((c) => `${c.nome} ${c.pedidos}`).join(" · "),
                  l.aproximados ? plural(l.aproximados, "deduzido", "deduzidos") : "",
                  l.cancelados ? `${plural(l.cancelados, "cancelado", "cancelados")} (${fmtReais(l.valorCancelado)})` : "",
                  // O acréscimo cancelado de um pedido entregue: não é entrega
                  // cancelada, mas o valor foi cancelado ali.
                  !l.cancelados && l.valorCancelado ? `${fmtReais(l.valorCancelado)} cancelado em acréscimo` : "",
                  l.semTaxa && l.pedidos ? `${plural(l.semTaxa, "sem taxa", "sem taxa")}` : "",
                ].filter(Boolean);
                const diferencaDaTabela = l.taxaDaArea != null && l.taxaMedia != null ? l.taxaMedia - l.taxaDaArea : 0;
                return (
                  <tr key={l.chave} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                    <td style={{ ...td, textAlign: "left", whiteSpace: "normal", minWidth: 220 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                        <span style={{ fontWeight: 800, color: PALETA.carvao }}>{l.nome}</span>
                        <Selo linha={l} />
                        {variasLojas && <span style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, fontWeight: 700 }}>{l.loja}</span>}
                      </div>
                      {detalhes.length > 0 && (
                        <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 3 }}
                          title={l.aproximados ? "Deduzido: sem o ponto no mapa, pela distância gravada no pedido ou pelo nome do bairro achado no texto" : undefined}>
                          {detalhes.join(" · ")}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 800 }}>{l.pedidos.toLocaleString("pt-BR")}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmtReais(l.valor)}</td>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                        <div style={{ flex: 1, maxWidth: 90 }}><BarraDePct pct={l.pct} cor={l.situacao === "PARCEIRO" ? PALETA.brasa : PALETA.ok} /></div>
                        <span style={{ minWidth: 44 }}>{l.pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
                      </div>
                    </td>
                    <td style={td}>{l.ticketMedio === null ? "—" : fmtReais(l.ticketMedio)}</td>
                    <td style={td}>
                      <div>{l.taxaMedia === null ? "—" : fmtReais(l.taxaMedia)}</div>
                      {l.taxaDaArea != null && (
                        <div style={{ marginTop: 3 }}>
                          <span title="A taxa desta área na configuração de hoje"
                            style={{
                              fontSize: "0.68rem", fontWeight: 700, padding: "1px 6px", borderRadius: 999,
                              background: Math.abs(diferencaDaTabela) >= 0.5 && l.pedidos ? PALETA.atencaoClaro : PALETA.areia,
                              color: Math.abs(diferencaDaTabela) >= 0.5 && l.pedidos ? PALETA.atencao : PALETA.areiaTinta,
                            }}>
                            tabela {fmtReais(l.taxaDaArea)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td style={td} title={l.pedidos ? `${l.comDistancia} de ${l.pedidos} pedidos com distância` : undefined}>
                      {l.distanciaMedia === null ? "—" : `${fmtQtd(l.distanciaMedia)} km`}
                    </td>
                    {comparar && (
                      <td style={td} title={l.anterior ? `Período anterior: ${plural(l.anterior.pedidos, "pedido", "pedidos")}, ${fmtReais(l.anterior.valor)}` : undefined}>
                        <VsAnterior atual={pctPor === "valor" ? l.valor : l.pedidos} anterior={l.anterior ? (pctPor === "valor" ? l.anterior.valor : l.anterior.pedidos) : 0} rotulo={rotuloVs} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: PALETA.areia, borderTop: `1.5px solid ${PALETA.areiaBorda}` }}>
                <td style={{ ...td, textAlign: "left", fontWeight: 900 }}>Total</td>
                <td style={{ ...td, fontWeight: 900 }}>{total.pedidos.toLocaleString("pt-BR")}</td>
                <td style={{ ...td, fontWeight: 900 }}>{fmtReais(total.valor)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{total.pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
                <td style={{ ...td, fontWeight: 800 }}>{total.ticketMedio === null ? "—" : fmtReais(total.ticketMedio)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{total.taxaMedia === null ? "—" : fmtReais(total.taxaMedia)}</td>
                <td style={{ ...td, fontWeight: 800 }}>{total.distanciaMedia === null ? "—" : `${fmtQtd(total.distanciaMedia)} km`}</td>
                {comparar && (
                  <td style={td}>
                    {totalAnterior && <VsAnterior atual={pctPor === "valor" ? total.valor : total.pedidos} anterior={pctPor === "valor" ? totalAnterior.valor : totalAnterior.pedidos} rotulo={rotuloVs} />}
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {rodape}
    </Bloco>
  );
}

/** Uma linha de total fora das tabelas (total geral, retirada). Quebra em duas no celular. */
function LinhaDeResumo({ titulo, explicacao, pedidos, valor, ticket, forte }: {
  titulo: React.ReactNode; explicacao?: string; pedidos: number; valor: number; ticket: number | null; forte?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.3rem 1.2rem", padding: "0.75rem 1rem", borderBottom: `1px solid ${PALETA.areia}`, fontSize: "0.86rem" }}>
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <strong style={{ fontWeight: forte ? 900 : 800 }}>{titulo}</strong>
        {explicacao && <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 2 }}>{explicacao}</div>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem 1.2rem", fontVariantNumeric: "tabular-nums" }}>
        <span style={{ fontWeight: forte ? 900 : 800 }}>{plural(pedidos, "pedido", "pedidos")}</span>
        <span style={{ fontWeight: forte ? 900 : 800 }}>{fmtReais(valor)}</span>
        <span style={{ color: PALETA.areiaTinta }}>ticket {ticket === null ? "—" : fmtReais(ticket)}</span>
      </div>
    </div>
  );
}

/** Como cada loja decide a área, dito para o lojista. */
function ComoDecide({ lojas, variasLojas }: { lojas: LojaDoResultado[]; variasLojas: boolean }) {
  const semArea = lojas.filter((l) => l.modo === "SEM_AREA");
  const frase = (l: LojaDoResultado) => {
    const n = l.areasCadastradas;
    switch (l.modo) {
      case "KM": return `pelo raio: ${plural(n, "faixa", "faixas")} de km, medidas do ponto da loja até o ponto do cliente`;
      case "BAIRRO": return `pelos ${plural(n, "bairro cadastrado", "bairros cadastrados")}, casados com o bairro escrito no endereço`;
      case "POLIGONO": return `pelas ${plural(n, "área desenhada", "áreas desenhadas")} no mapa, com o ponto do cliente`;
      default: return "pelo bairro escrito no endereço — a loja não tem área de entrega cadastrada";
    }
  };
  return (
    <div className="fh-relatorio-bloco" style={{
      background: semArea.length ? PALETA.atencaoClaro : PALETA.areia,
      border: `1px solid ${semArea.length ? PALETA.atencaoBorda : PALETA.areiaBorda}`,
      borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1.1rem", fontSize: "0.82rem", color: PALETA.carvao2, lineHeight: 1.55,
    }}>
      {lojas.map((l) => (
        <div key={l.id}>
          <strong>{variasLojas ? `${l.nome}: ` : "Áreas "}</strong>{frase(l)}.
          {!l.temPontoDaLoja && (l.modo === "KM" || l.modo === "POLIGONO") && (
            <span style={{ color: PALETA.atencao, fontWeight: 700 }}> A loja não tem o ponto no mapa: sem ele não dá para medir a distância.</span>
          )}
        </div>
      ))}
      {semArea.length > 0 && (
        <div style={{ marginTop: 4 }}>
          Cadastre as áreas em <Link href="/store/minha-loja" style={{ color: PALETA.marca, fontWeight: 800 }}>Minha loja</Link> para ver as vendas por
          faixa de km, bairro ou área desenhada — e para a taxa sair certa no site e no robô.
        </div>
      )}
      <div style={{ marginTop: 4, color: PALETA.areiaTinta }}>
        As áreas são as cadastradas <strong>hoje</strong>: se você mudar as áreas, o histórico é reclassificado pela configuração nova.
      </div>
    </div>
  );
}

export default function AreasDeEntregaClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "7d", { pctPor: "", comparar: "" });
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("areas-de-entrega", query);

  const pctPor = extras.pctPor === "pedidos" ? "pedidos" : "valor";
  const comparar = extras.comparar !== "0";
  const [busca, setBusca] = useState("");
  const [verZeradas, setVerZeradas] = useState(false);

  const variasLojas = (dados?.cadastroDasLojas?.length || 0) > 1;
  const temComparacao = comparar && Boolean(dados?.anterior);
  const casa = (l: LinhaDaArea) => !busca || semAcento(`${l.nome} ${l.loja}`).includes(semAcento(busca.trim()));
  // Zerada = nada neste período NEM no anterior. A área que vendeu antes e
  // parou fica na tabela: o "↓ 100%" é a notícia.
  const zerada = (l: LinhaDaArea) => !l.pedidos && !l.valor && !l.cancelados && !l.anterior?.pedidos;

  const { linhas, zeradas } = useMemo(() => {
    const todas = (dados?.linhas || []).filter(casa);
    return { linhas: verZeradas ? todas : todas.filter((l) => !zerada(l)), zeradas: todas.filter(zerada) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, busca, verZeradas]);
  const doParceiro = useMemo(() => (dados?.parceiro || []).filter(casa), [dados, busca]); // eslint-disable-line react-hooks/exhaustive-deps
  // O bairro que parou de pedir (só os da loja: o do parceiro não é decisão dela).
  const pararam = temComparacao ? (dados?.anterior?.pararam || []).filter((a) => a.situacao !== "PARCEIRO") : [];

  const maior = dados?.linhas.find((l) => l.pedidos > 0 && l.nome !== "Sem endereço identificado");

  return (
    <ModeloDoRelatorio
      titulo="Vendas por área de entrega"
      descricao="Qual bairro ou área pede mais — em pedidos, valor e ticket — pela mesma regra que cobra a taxa de entrega. Só entregas: mesa, balcão e totem não têm endereço."
      slug="areas-de-entrega" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <style>{`.fh-ae-ordenar:focus-visible { outline: 2px solid ${PALETA.carvao}; outline-offset: 2px; }`}</style>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem 1.6rem", alignItems: "center", borderTop: `1px dashed ${PALETA.areiaBorda}`, paddingTop: "0.8rem" }}>
          <span style={{ display: "inline-flex", gap: 12, alignItems: "center", fontSize: "0.86rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase" }}>% pelo</span>
            <label style={caixa}><input type="radio" name="pctPor" checked={pctPor === "valor"} onChange={() => mudarExtra("pctPor", "")} style={{ accentColor: PALETA.carvao }} /> valor</label>
            <label style={caixa}><input type="radio" name="pctPor" checked={pctPor === "pedidos"} onChange={() => mudarExtra("pctPor", "pedidos")} style={{ accentColor: PALETA.carvao }} /> número de pedidos</label>
          </span>
          <label style={caixa}>
            <input type="checkbox" checked={comparar} onChange={(e) => mudarExtra("comparar", e.target.checked ? "" : "0")} style={{ accentColor: PALETA.carvao }} />
            Comparar com o período anterior
            {comparar && dados?.periodoAnterior && (
              <span style={{ fontWeight: 500, color: PALETA.areiaTinta }}>({fmtDia(dados.periodoAnterior.de)} a {fmtDia(dados.periodoAnterior.ate)})</span>
            )}
          </label>
        </div>
      </BarraDeFiltros>

      {dados && <ComoDecide lojas={dados.cadastroDasLojas} variasLojas={variasLojas} />}

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Entregas" valor={dados.total.pedidos.toLocaleString("pt-BR")}
            detalhe={temComparacao ? <Variacao atual={dados.total.pedidos} anterior={dados.anterior!.pedidos} /> : dados.total.cancelados ? `${plural(dados.total.cancelados, "cancelada", "canceladas")} fora da conta` : "Cancelados não entram"} />
          <Cartao rotulo="Valor das entregas" valor={fmtReais(dados.total.valor)}
            detalhe={temComparacao ? <Variacao atual={dados.total.valor} anterior={dados.anterior!.valor} /> : "Com a taxa de entrega"} />
          <Cartao rotulo="Ticket médio" valor={dados.total.ticketMedio === null ? "—" : fmtReais(dados.total.ticketMedio)} detalhe="Por entrega, com a taxa" />
          <Cartao rotulo="Taxa média cobrada" valor={dados.total.taxaMedia === null ? "—" : fmtReais(dados.total.taxaMedia)}
            detalhe={dados.total.semTaxa ? `${plural(dados.total.semTaxa, "entrega", "entregas")} sem taxa` : "Todas com taxa"} />
          <Cartao rotulo="Distância média" valor={dados.total.distanciaMedia === null ? "—" : `${fmtQtd(dados.total.distanciaMedia)} km`}
            detalhe={dados.total.comDistancia ? `Em ${dados.total.comDistancia} de ${dados.total.pedidos} entregas` : "Os pedidos não trazem distância nem o ponto do cliente"} />
          {maior && (
            <Cartao rotulo="Área que mais vende" valor={<span style={{ fontSize: "1.1rem" }}>{maior.nome}</span>}
              detalhe={`${plural(maior.pedidos, "pedido", "pedidos")} · ${maior.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${pctPor === "valor" ? "do valor" : "dos pedidos"}`} />
          )}
        </GradeDeCartoes>
      )}

      <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: "0.8rem" }}>
        <input name="busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar área ou bairro…" aria-label="Buscar área ou bairro"
          style={{ padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.85rem", fontFamily: "inherit", width: "100%", maxWidth: 300 }} />
      </div>

      {dados && (
        <TabelaDeAreas
          titulo="Entregas da loja"
          subtitulo="O motoboy da loja entregou. Clique no título da coluna para ordenar."
          linhas={linhas} total={dados.propria}
          totalAnterior={temComparacao ? dados.anterior!.propria : null} pctPor={pctPor} variasLojas={variasLojas}
          textoVazio={busca ? `Nenhuma área com “${busca}”.` : "Nenhuma entrega da loja no período e filtros escolhidos."}
          rodape={zeradas.length > 0 || pararam.length > 0 ? (
            <div style={{ padding: "0.7rem 1rem", fontSize: "0.8rem", color: PALETA.areiaTinta, borderTop: `1px solid ${PALETA.areia}`, lineHeight: 1.5 }}>
              {pararam.length > 0 && (
                <div style={{ marginBottom: zeradas.length ? 6 : 0 }}>
                  <strong style={{ color: PALETA.carvao2 }}>Venderam no período anterior e nada neste:</strong>{" "}
                  {pararam.slice(0, 12).map((a) => `${a.nome}${variasLojas ? ` (${a.loja})` : ""} — ${plural(a.pedidos, "pedido", "pedidos")}, ${fmtReais(a.valor)}`).join(" · ")}
                  {pararam.length > 12 ? ` · e mais ${pararam.length - 12}` : ""}
                </div>
              )}
              {zeradas.length > 0 && <>
              <strong style={{ color: PALETA.carvao2 }}>{plural(zeradas.length, "área cadastrada", "áreas cadastradas")} sem pedido no período</strong>
              {!verZeradas && <>: {zeradas.slice(0, 12).map((l) => l.nome).join(", ")}{zeradas.length > 12 ? "…" : ""}</>}
              {" "}
              <button type="button" className="fh-sem-impressao" onClick={() => setVerZeradas((v) => !v)}
                style={{ border: "none", background: "none", padding: 0, color: PALETA.marca, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>
                {verZeradas ? "esconder da tabela" : "mostrar na tabela"}
              </button>
              </>}
            </div>
          ) : null}
        />
      )}

      {dados && dados.parceiro.length > 0 && (
        <TabelaDeAreas
          titulo="Entregas do parceiro"
          subtitulo="O iFood ou a 99 mandaram o entregador deles: a área e a taxa são da plataforma. Agrupado pelo bairro do endereço."
          linhas={doParceiro} total={dados.doParceiro}
          totalAnterior={temComparacao ? dados.anterior!.doParceiro : null} pctPor={pctPor} variasLojas={variasLojas}
          textoVazio={`Nenhuma entrega do parceiro com “${busca}”.`}
        />
      )}

      {dados && (dados.parceiro.length > 0 || dados.retirada) && (
        <Bloco semPadding>
          {dados.parceiro.length > 0 && (
            <LinhaDeResumo
              titulo={<>Total de entregas <span style={{ fontWeight: 500, color: PALETA.areiaTinta }}>(loja + parceiro)</span></>}
              pedidos={dados.total.pedidos} valor={dados.total.valor} ticket={dados.total.ticketMedio} forte />
          )}
          {dados.retirada && (
            <LinhaDeResumo
              titulo="Retirada (sem entrega)"
              explicacao="O cliente veio buscar — fora do 100% das áreas. Balcão não entra aqui."
              pedidos={dados.retirada.pedidos} valor={dados.retirada.valor} ticket={dados.retirada.ticketMedio} />
          )}
        </Bloco>
      )}

      <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.55 }}>
        <strong>Como a área é decidida:</strong> com o ponto do cliente no mapa (o iFood, a 99 e a Brendi mandam), pela regra que cobra a taxa — faixa de km,
        área desenhada, área de risco. Sem o ponto, pelo bairro escrito no endereço, casado com os bairros cadastrados.{" "}
        <strong>Deduzido</strong> é o pedido que não tinha o ponto e foi colocado pela distância gravada nele ou pelo nome do bairro achado no meio do endereço.
        {" "}O valor é o total do pedido, com a taxa de entrega. Cancelados não somam (aparecem na linha da área). O item acrescentado depois, no mesmo
        endereço, soma o valor na área do pedido original e não conta como outra entrega.
      </p>
    </ModeloDoRelatorio>
  );
}
