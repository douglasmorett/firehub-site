"use client";
/**
 * Cupons e descontos — quanto de desconto foi dado, QUEM pagou e de onde veio.
 * A conta mora em lib/relatorios/descontos.ts; aqui são os filtros, os blocos
 * e a lista de pedidos.
 *
 * O que muda em relação à Saipos, de propósito:
 * - O desconto é separado por quem pagou. "Do bolso da loja" é o número que
 *   importa para o dono; o que o iFood/99 pagou volta no repasse. Somar os dois
 *   (como lá) faz o dono cortar a promoção errada.
 * - Clicar num cupom ou numa campanha filtra a lista de pedidos por ela.
 * - A lista vem paginada do servidor (50 por vez) numa busca à parte: trocar
 *   de página não refaz o relatório inteiro nem o período anterior.
 */
import React, { useMemo, useRef, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";
import { filtrosParaQuery, fmtDia, fmtPct, fmtReais, type FiltrosDoRelatorio } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio, Variacao } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import { detalheDosPedidosComDesconto, type LinhaDaLista, type LinhaDeOrigem, type ResultadoDosDescontos } from "@/lib/relatorios/descontos";

type Pagina<T> = { itens: T[]; total: number; pagina: number; paginas: number; porPagina: number };

type Resposta = Omit<ResultadoDosDescontos, "lista"> & {
  lojas: string[];
  periodo: { de: string; ate: string };
  anterior: {
    periodo: { de: string; ate: string };
    ateEsteHorario?: boolean;
    desconto: number; loja: number; plataforma: number; pctSobreVendas: number; pedidosComDesconto: number; descontoMedio: number;
  };
  lista: Pagina<LinhaDaLista>;
};

type RespostaDaLista = { lista: Pagina<LinhaDaLista> };

// Cores dos três donos do desconto. Carvão para a loja (é o número que pesa),
// areia para a plataforma (dinheiro que volta no repasse) e âmbar claro para o
// que não se sabe — estado de atenção, em fundo claro, como pede a paleta.
const COR = { loja: PALETA.carvao2, plataforma: "#C9B8A6", nao: PALETA.atencaoBorda };

const th: React.CSSProperties = { textAlign: "left", padding: "8px 0.8rem", fontWeight: 800, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", color: PALETA.areiaTinta, borderBottom: `1px solid ${PALETA.areiaBorda}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 0.8rem", borderBottom: `1px solid ${PALETA.areia}`, verticalAlign: "top" };
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const link: React.CSSProperties = { border: "none", background: "none", padding: 0, font: "inherit", color: PALETA.carvao, fontWeight: 800, cursor: "pointer", textAlign: "left", textDecoration: "underline", textDecorationColor: PALETA.areiaBorda, textUnderlineOffset: 3 };
const campo: React.CSSProperties = { padding: "7px 10px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.82rem", fontFamily: "inherit", background: "#fff", color: PALETA.carvao };

function Etiqueta({ children, tom = "neutro" }: { children: React.ReactNode; tom?: "neutro" | "ok" | "atencao" }) {
  const c = tom === "ok" ? { fundo: PALETA.okClaro, borda: PALETA.okBorda, texto: PALETA.ok }
    : tom === "atencao" ? { fundo: PALETA.atencaoClaro, borda: PALETA.atencaoBorda, texto: PALETA.atencao }
    : { fundo: PALETA.areia, borda: PALETA.areiaBorda, texto: PALETA.areiaTinta };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: c.fundo, border: `1px solid ${c.borda}`, color: c.texto, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** A barra única loja | plataforma | não identificado, com a legenda embaixo. */
function BarraDeQuem({ dados }: { dados: Resposta }) {
  const total = dados.resumo.desconto;
  const corDe = { LOJA: COR.loja, PLATAFORMA: COR.plataforma, NAO_IDENTIFICADO: COR.nao } as const;
  const partes = dados.quemBancou.map((q) => ({ ...q, cor: corDe[q.chave] }));
  return (
    <div>
      <div role="img" aria-label={partes.map((p) => `${p.rotulo}: ${fmtReais(p.valor)}`).join(", ")}
        style={{ display: "flex", height: 18, borderRadius: 999, overflow: "hidden", background: PALETA.areia }}>
        {total > 0 && partes.filter((p) => p.valor > 0).map((p) => (
          <div key={p.chave} title={`${p.rotulo}: ${fmtReais(p.valor)} (${fmtPct(p.pct)})`} style={{ width: `${p.pct}%`, background: p.cor }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0.6rem 1rem", marginTop: 12 }}>
        {partes.map((p) => (
          <div key={p.chave} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: p.cor, marginTop: 4, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "0.78rem", fontWeight: 800, color: PALETA.areiaTinta }}>{p.rotulo}</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{fmtReais(p.valor)}</div>
              <div style={{ fontSize: "0.74rem", color: PALETA.areiaTinta }}>{fmtPct(p.pct)} do desconto · {p.pedidos} pedido{p.pedidos === 1 ? "" : "s"}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Colunas por dia, empilhadas por dono. Sem biblioteca: altura em %.
 *
 * Os números de cada dia estão na tabela "Ver os valores de cada dia" logo
 * abaixo: o `title` da barra não abre no toque nem no teclado, e o leitor de
 * tela lia o bloco sem número nenhum. O gráfico em si é uma imagem com resumo.
 */
function GraficoPorDia({ dias }: { dias: Resposta["porDia"] }) {
  const maior = Math.max(0, ...dias.map((d) => d.desconto));
  if (maior <= 0) return <Vazio texto="Nenhum desconto no período." />;
  // Com muitos dias o rótulo de cada coluna não cabe: mostra um a cada N.
  const passo = dias.length <= 10 ? 1 : dias.length <= 31 ? Math.ceil(dias.length / 10) : Math.ceil(dias.length / 8);
  const temNao = dias.some((d) => d.naoIdentificado > 0);
  const pico = dias.reduce((a, d) => (d.desconto > a.desconto ? d : a), dias[0]);
  const total = dias.reduce((s, d) => s + d.desconto, 0);
  const resumo = `Desconto por dia, de ${fmtDia(dias[0].dia)} a ${fmtDia(dias[dias.length - 1].dia)}: ${fmtReais(total)} no total. `
    + `Maior dia: ${fmtDia(pico.dia)}, com ${fmtReais(pico.desconto)}. Os valores de cada dia estão na tabela logo abaixo.`;
  // A tabela dos dias é estreita: menos respiro que as outras, para caber no celular.
  const thDia: React.CSSProperties = { ...th, padding: "6px 0.45rem" };
  const tdDia: React.CSSProperties = { ...td, padding: "6px 0.45rem" };
  const legenda = [
    { cor: COR.loja, rotulo: "loja" },
    { cor: COR.plataforma, rotulo: "plataforma" },
    ...(temNao ? [{ cor: COR.nao, rotulo: "não identificado" }] : []),
  ];
  return (
    <div>
      <div role="img" aria-label={resumo}
        style={{ display: "flex", alignItems: "flex-end", gap: dias.length > 40 ? 1 : 4, height: 150, borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
        {dias.map((d) => (
          <div key={d.dia} title={`${fmtDia(d.dia)}: ${fmtReais(d.desconto)} em ${d.pedidos} pedido(s) — loja ${fmtReais(d.loja)}, plataforma ${fmtReais(d.plataforma)}${d.naoIdentificado > 0 ? `, não identificado ${fmtReais(d.naoIdentificado)}` : ""}`}
            style={{ flex: 1, minWidth: 0, height: `${(d.desconto / maior) * 100}%`, display: "flex", flexDirection: "column-reverse", borderRadius: "4px 4px 0 0", overflow: "hidden" }}>
            <div style={{ height: `${d.desconto ? (d.loja / d.desconto) * 100 : 0}%`, background: COR.loja }} />
            <div style={{ height: `${d.desconto ? (d.plataforma / d.desconto) * 100 : 0}%`, background: COR.plataforma }} />
            <div style={{ height: `${d.desconto ? (d.naoIdentificado / d.desconto) * 100 : 0}%`, background: COR.nao }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ display: "flex", gap: dias.length > 40 ? 1 : 4, marginTop: 4 }}>
        {dias.map((d, i) => (
          <div key={d.dia} style={{ flex: 1, minWidth: 0, fontSize: "0.66rem", color: PALETA.areiaTinta, textAlign: "center", whiteSpace: "nowrap", overflow: "visible" }}>
            {i % passo === 0 ? `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}` : ""}
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", marginTop: 10, fontSize: "0.74rem", color: PALETA.areiaTinta }}>
        {legenda.map((l) => (
          <span key={l.rotulo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: l.cor }} />{l.rotulo}
          </span>
        ))}
      </div>
      <details className="fh-sem-impressao" style={{ marginTop: 10, fontSize: "0.8rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, color: PALETA.carvao2, padding: "4px 0" }}>Ver os valores de cada dia</summary>
        <div style={{ overflowX: "auto", marginTop: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>Desconto por dia e quem pagou</caption>
            <thead>
              <tr>
                <th scope="col" style={thDia}>Dia</th><th scope="col" style={{ ...thDia, ...num }}>Pedidos</th><th scope="col" style={{ ...thDia, ...num }}>Desconto</th>
                <th scope="col" style={{ ...thDia, ...num }}>Loja</th><th scope="col" style={{ ...thDia, ...num }}>Plataforma</th>
                {temNao && <th scope="col" style={{ ...thDia, ...num }}>Não ident.</th>}
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => (
                <tr key={d.dia}>
                  <th scope="row" style={{ ...tdDia, fontWeight: 700, textAlign: "left", whiteSpace: "nowrap" }}>{d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}</th>
                  <td style={{ ...tdDia, ...num }}>{d.pedidos}</td>
                  <td style={{ ...tdDia, ...num, fontWeight: 800 }}>{d.desconto > 0 ? fmtReais(d.desconto) : "—"}</td>
                  <td style={{ ...tdDia, ...num }}>{d.loja > 0 ? fmtReais(d.loja) : "—"}</td>
                  <td style={{ ...tdDia, ...num }}>{d.plataforma > 0 ? fmtReais(d.plataforma) : "—"}</td>
                  {temNao && <td style={{ ...tdDia, ...num }}>{d.naoIdentificado > 0 ? fmtReais(d.naoIdentificado) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** A tabela das origens (campanhas, motivos) — cada linha filtra a lista. */
function TabelaDeOrigens({ linhas, verPedidos, comPlataforma }: { linhas: LinhaDeOrigem[]; verPedidos: (chave: string) => void; comPlataforma: boolean }) {
  const [todas, setTodas] = useState(false);
  const LIMITE = 12;
  const visiveis = todas ? linhas : linhas.slice(0, LIMITE);
  const temNao = linhas.some((l) => l.naoIdentificado > 0);
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem", minWidth: comPlataforma ? 720 : 560 }}>
          <thead>
            <tr>
              <th style={th}>Canal</th><th style={th}>Nome</th><th style={th}>Onde caiu</th>
              <th style={{ ...th, ...num }}>Pedidos</th><th style={{ ...th, ...num }}>Desconto</th>
              {comPlataforma && <><th style={{ ...th, ...num }}>Loja</th><th style={{ ...th, ...num }}>Plataforma</th></>}
              {temNao && <th style={{ ...th, ...num }}>Não ident.</th>}
              <th style={{ ...th, ...num }}>% do total</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((o) => (
              <tr key={o.chave}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{o.canalNome}</td>
                <td style={{ ...td, wordBreak: "break-word" }}>
                  <button type="button" style={link} onClick={() => verPedidos(o.chave)} title="Ver os pedidos com este desconto">{o.nome}</button>
                </td>
                <td style={{ ...td, color: PALETA.areiaTinta, whiteSpace: "nowrap" }}>{o.alvo}</td>
                <td style={{ ...td, ...num }}>{o.usos}</td>
                <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(o.valor)}</td>
                {comPlataforma && <><td style={{ ...td, ...num }}>{fmtReais(o.loja)}</td><td style={{ ...td, ...num }}>{fmtReais(o.plataforma)}</td></>}
                {temNao && <td style={{ ...td, ...num }}>{o.naoIdentificado > 0 ? fmtReais(o.naoIdentificado) : "—"}</td>}
                <td style={{ ...td, ...num, color: PALETA.areiaTinta }}>{fmtPct(o.pctDoDesconto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linhas.length > LIMITE && (
        <div style={{ padding: "0.7rem 0.8rem" }} className="fh-sem-impressao">
          <button type="button" className="btn btn-outline" style={{ padding: "6px 12px", fontSize: "0.8rem" }} onClick={() => setTodas((t) => !t)}>
            {todas ? "Mostrar só as maiores" : `Ver todas (${linhas.length})`}
          </button>
        </div>
      )}
    </>
  );
}

export default function DescontosClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "7d", { pagina: "", origem: "", quem: "", ordem: "" });
  // Duas buscas: o relatório (só os filtros) e a lista (filtros + página,
  // origem, quem bancou, ordem). O Excel leva a query inteira: sai o que se vê.
  const queryDoRelatorio = filtrosParaQuery(filtros);
  const queryDaLista = filtrosParaQuery(filtros, { ...extras, parte: "lista" });
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("descontos", queryDoRelatorio);
  const lista = useRelatorio<RespostaDaLista>("descontos", queryDaLista);
  const refDaLista = useRef<HTMLDivElement | null>(null);

  const mudarFiltros = (p: Partial<FiltrosDoRelatorio>) => { mudar(p); mudarExtra("pagina", ""); };
  const irParaPagina = (n: number) => mudarExtra("pagina", n > 1 ? String(n) : "");
  const verPedidos = (chave: string) => {
    mudarExtra("origem", chave);
    mudarExtra("pagina", "");
    refDaLista.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const nomeDaOrigem = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of dados?.origens || []) m.set(o.chave, o.tipo === "cupom" ? `Cupom ${o.nome}` : `${o.nome} (${o.canalNome})`);
    return m;
  }, [dados]);
  const campanhas = useMemo(() => (dados?.origens || []).filter((o) => o.tipo === "campanha"), [dados]);
  const daLoja = useMemo(() => (dados?.origens || []).filter((o) => o.tipo !== "campanha" && o.tipo !== "cupom"), [dados]);

  const r = dados?.resumo;
  // Só a busca da lista: a página 1 que vem junto do relatório não conhece o
  // filtro "quem bancou" nem a ordem da URL, e piscaria a lista errada.
  // Com erro, a lista some e fica só a mensagem: sem página anterior ela ficava
  // em "Carregando…" para sempre embaixo do erro (período acima de 400 dias), e
  // com página anterior mostrava pedidos de OUTROS filtros como se fossem estes.
  const pagina = lista.erro ? undefined : lista.dados?.lista;

  return (
    <ModeloDoRelatorio
      titulo="Cupons e descontos"
      descricao="Quanto de desconto foi dado, quem pagou (a loja ou a plataforma) e de onde veio: cupom, campanha do iFood/99, desconto manual ou conta da mesa."
      slug="descontos" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro}
      onRecarregar={() => { recarregar(); lista.recarregar(); }}>

      <BarraDeFiltros filtros={filtros} mudar={mudarFiltros} opcoes={opcoes} hoje={inicio.hoje} />

      {dados && r && (
        <>
          <GradeDeCartoes>
            <Cartao rotulo="Total de desconto" valor={fmtReais(r.desconto)}
              detalhe={<><Variacao atual={r.desconto} anterior={dados.anterior.desconto} menorEhMelhor />{dados.anterior.ateEsteHorario ? " (até este mesmo horário)" : ""}</>} />
            {/* Sem venda no recorte, "das vendas" some aqui também: o cartão do
                lado mostra "—" e este não pode dizer "0,00%" com desconto na tela
                (Pastel, 13/09/2026, Mesa, 18h43–18h44: só o fechamento da Mesa 55). */}
            <Cartao rotulo="Do bolso da loja" valor={fmtReais(r.loja)}
              detalhe={<>{r.vendas > 0 ? <>{fmtPct(r.pctLojaSobreVendas)} das vendas · </> : null}<Variacao atual={r.loja} anterior={dados.anterior.loja} menorEhMelhor /></>} />
            <Cartao rotulo="Pago pelas plataformas" valor={fmtReais(r.plataforma)} detalhe="iFood/99 pagam e repassam à loja" />
            {/* A base é o valor vendido da régua única — o MESMO número do Vendas
                por período. Sem venda no recorte (só uma mesa que fechou nele),
                não há percentual: "—", não "0%". O valor vendido já vem sem o
                desconto (inclusive o que o app pagou): o detalhe diz isso, para
                quem compara com "desconto ÷ preço cheio" de outro sistema. */}
            <Cartao rotulo="% sobre as vendas" valor={r.vendas > 0 ? fmtPct(r.pctSobreVendas) : "—"}
              detalhe={`sobre ${fmtReais(r.vendas)} de valor vendido (o do Vendas por período, já sem o desconto)`} />
            {/* O percentual é de PEDIDOS (lançamentos): a conta de mesa não é
                lançamento e vai à parte — antes ela entrava no numerador e dava
                "33,33% dos 3 pedidos" com nenhum dos três descontado. */}
            <Cartao rotulo="Pedidos com desconto" valor={r.pedidosComDesconto.toLocaleString("pt-BR")}
              detalhe={detalheDosPedidosComDesconto(r)} />
            <Cartao rotulo="Desconto médio" valor={fmtReais(r.descontoMedio)} detalhe={r.mesasComDesconto ? "por pedido ou conta de mesa com desconto" : "por pedido com desconto"} />
            {r.naoIdentificado > 0 && (
              <Cartao rotulo="Não identificado" valor={fmtReais(r.naoIdentificado)} tom="atencao"
                detalhe="O pedido não diz quem pagou — o relatório não chuta" />
            )}
          </GradeDeCartoes>

          {r.desconto <= 0 ? (
            <Bloco><Vazio texto="Nenhum desconto no período e filtros escolhidos." /></Bloco>
          ) : (
            <>
              <Bloco titulo="Quem pagou o desconto" subtitulo="O que a plataforma pagou volta para a loja no repasse; o da loja sai do seu bolso.">
                <BarraDeQuem dados={dados} />
              </Bloco>

              <Bloco titulo="Por canal" subtitulo="% sobre o valor vendido do próprio canal." semPadding>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={th}>Canal</th><th style={{ ...th, ...num }}>Pedidos</th><th style={{ ...th, ...num }}>Com desconto</th>
                        <th style={{ ...th, ...num }}>Desconto</th><th style={{ ...th, ...num }}>% s/ vendas</th>
                        <th style={{ ...th, ...num }}>Loja</th><th style={{ ...th, ...num }}>Plataforma</th><th style={{ ...th, ...num }}>Não ident.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.porCanal.map((c) => (
                        <tr key={c.canal}>
                          <td style={{ ...td, fontWeight: 800 }}>{c.canalNome}</td>
                          <td style={{ ...td, ...num }}>{c.pedidos.toLocaleString("pt-BR")}</td>
                          <td style={{ ...td, ...num }}>{c.pedidosComDesconto.toLocaleString("pt-BR")}</td>
                          <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(c.desconto)}</td>
                          <td style={{ ...td, ...num }}>{c.vendas > 0 ? fmtPct(c.pctSobreVendas) : "—"}</td>
                          <td style={{ ...td, ...num }}>{fmtReais(c.loja)}</td>
                          <td style={{ ...td, ...num }}>{c.plataforma > 0 ? fmtReais(c.plataforma) : "—"}</td>
                          <td style={{ ...td, ...num, color: c.naoIdentificado > 0 ? PALETA.atencao : PALETA.areiaTinta }}>{c.naoIdentificado > 0 ? fmtReais(c.naoIdentificado) : "—"}</td>
                        </tr>
                      ))}
                      <tr style={{ background: PALETA.areia }}>
                        <td style={{ ...td, fontWeight: 900 }}>Total</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{r.pedidos.toLocaleString("pt-BR")}</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{r.pedidosComDesconto.toLocaleString("pt-BR")}</td>
                        <td style={{ ...td, ...num, fontWeight: 900 }}>{fmtReais(r.desconto)}</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{r.vendas > 0 ? fmtPct(r.pctSobreVendas) : "—"}</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(r.loja)}</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(r.plataforma)}</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{r.naoIdentificado > 0 ? fmtReais(r.naoIdentificado) : "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Bloco>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "0 1.25rem" }}>
                <Bloco titulo="Desconto por dia" subtitulo="Cada barra é um dia, dividida por quem pagou.">
                  <GraficoPorDia dias={dados.porDia} />
                </Bloco>
                <Bloco titulo="Onde o desconto caiu" subtitulo="Nos itens, na taxa de entrega ou no pedido todo.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {dados.porAlvo.map((a) => (
                      <div key={a.chave}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.84rem" }}>
                          <span style={{ fontWeight: 700 }}>{a.rotulo}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}><strong>{fmtReais(a.valor)}</strong> <span style={{ color: PALETA.areiaTinta }}>· {fmtPct(a.pct)}</span></span>
                        </div>
                        <div style={{ height: 8, background: PALETA.areia, borderRadius: 999, overflow: "hidden", marginTop: 4 }}>
                          <div style={{ height: "100%", width: `${Math.min(100, a.pct)}%`, background: a.chave === "NAO_INFORMADO" ? PALETA.areiaBorda : PALETA.brasa, borderRadius: 999 }} />
                        </div>
                      </div>
                    ))}
                    {dados.porAlvo.some((a) => a.chave === "NAO_INFORMADO") && (
                      <p style={{ margin: 0, fontSize: "0.74rem", color: PALETA.areiaTinta }}>“Não informado”: o 99Food separa o desconto por promoção, não por item ou entrega.</p>
                    )}
                  </div>
                </Bloco>
              </div>
            </>
          )}

          <Bloco titulo="Cupons" semPadding
            subtitulo="O cupom do seu site (cruzado com o cadastro), da Wabiz, da Brendi e da Jotajá — “(sem código)” quando o app não manda o código. Faturamento = o que os clientes pagaram nos pedidos com o cupom.">
            {dados.cupons.length === 0 ? (
              <Vazio texto="Nenhum cupom usado no período. Os cupons do site aparecem aqui assim que alguém usar." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 820 }}>
                  <thead>
                    <tr>
                      <th style={th}>Cupom</th><th style={{ ...th, ...num }}>Usos</th><th style={{ ...th, ...num }}>Desconto</th>
                      <th style={{ ...th, ...num }}>Faturamento</th><th style={{ ...th, ...num }}>Ticket médio</th>
                      <th style={th}>Benefício</th><th style={th}>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.cupons.map((c) => (
                      <tr key={c.chave} style={{ opacity: c.usos === 0 ? 0.7 : 1 }}>
                        <td style={td}>
                          {c.usos > 0
                            ? <button type="button" style={link} onClick={() => verPedidos(c.chave)} title="Ver os pedidos com este cupom">{c.codigo}</button>
                            : <strong>{c.codigo}</strong>}
                          <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 2 }}>{c.canalNome}</div>
                        </td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{c.usos}</td>
                        <td style={{ ...td, ...num }}>{c.usos ? fmtReais(c.desconto) : "—"}</td>
                        <td style={{ ...td, ...num }}>{c.usos ? fmtReais(c.faturamento) : "—"}</td>
                        <td style={{ ...td, ...num }}>{c.usos ? fmtReais(c.ticketMedio) : "—"}</td>
                        <td style={td}>
                          {c.cadastro ? c.cadastro.beneficio : c.canal !== "SITE" ? <span style={{ color: PALETA.areiaTinta }}>cadastrado na {c.canalNome}</span> : "—"}
                          {c.cadastro && c.cadastro.regras.length > 0 && (
                            <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 2 }}>{c.cadastro.regras.join(" · ")}</div>
                          )}
                        </td>
                        <td style={td}>
                          {c.cadastro
                            ? <Etiqueta tom={c.cadastro.ativo ? "ok" : c.cadastro.situacao.startsWith("Não está") ? "atencao" : "neutro"}>{c.cadastro.situacao}</Etiqueta>
                            : <span style={{ color: PALETA.areiaTinta }}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Bloco>

          {campanhas.length > 0 && (
            <Bloco titulo="Campanhas das plataformas" semPadding
              subtitulo="Cada benefício do iFood (o nome é o da campanha no iFood) e promoção do 99Food. Clique para ver os pedidos.">
              <TabelaDeOrigens linhas={campanhas} verPedidos={verPedidos} comPlataforma />
            </Bloco>
          )}

          {daLoja.length > 0 && (
            <Bloco titulo="Descontos manuais, mesa e fidelidade" semPadding
              subtitulo="O desconto dado no PDV (com o motivo), na conta da mesa e em troca de fidelidade — todos da loja.">
              <TabelaDeOrigens linhas={daLoja} verPedidos={verPedidos} comPlataforma={false} />
            </Bloco>
          )}

          <Bloco titulo="À parte (fora do total de desconto)">
            <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "flex", flexDirection: "column", gap: 6, fontSize: "0.84rem", lineHeight: 1.5 }}>
              <li>
                <strong>Cashback:</strong>{" "}
                {dados.cashback.usado > 0 || dados.cashback.gerado > 0
                  ? <>clientes usaram {fmtReais(dados.cashback.usado)} em {dados.cashback.pedidosQueUsaram} pedido(s); foram gerados {fmtReais(dados.cashback.gerado)} em {dados.cashback.pedidosQueGeraram} pedido(s).</>
                  : <span style={{ color: PALETA.areiaTinta }}>nenhum cashback registrado nos pedidos do período.</span>}
              </li>
              <li>
                <strong>Entrega grátis por regra da loja</strong> (pedido acima do mínimo, área):{" "}
                {dados.entregaGratisForaDoDesconto.pedidos > 0
                  ? <>{fmtReais(dados.entregaGratisForaDoDesconto.valor)} em {dados.entregaGratisForaDoDesconto.pedidos} pedido(s) — a taxa que deixou de ser cobrada.</>
                  : <span style={{ color: PALETA.areiaTinta }}>nenhuma no período.</span>}
              </li>
            </ul>
          </Bloco>
        </>
      )}

      <div ref={refDaLista} style={{ scrollMarginTop: 16 }}>
        <Bloco titulo="Pedidos com desconto" semPadding
          subtitulo={pagina ? `${pagina.total.toLocaleString("pt-BR")} ${pagina.total === 1 ? "linha" : "linhas"}${pagina.paginas > 1 ? ` · página ${pagina.pagina} de ${pagina.paginas}` : ""} · a conta da mesa é uma linha só` : undefined}
          acoes={
            <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select name="quem" aria-label="Quem bancou" value={extras.quem} style={campo}
                onChange={(e) => { mudarExtra("quem", e.target.value); mudarExtra("pagina", ""); }}>
                <option value="">Quem bancou: todos</option>
                <option value="LOJA">Com parte da loja</option>
                <option value="PLATAFORMA">Com parte da plataforma</option>
                <option value="NAO_IDENTIFICADO">Não identificado</option>
              </select>
              <select name="ordem" aria-label="Ordem da lista" value={extras.ordem} style={campo}
                onChange={(e) => { mudarExtra("ordem", e.target.value); mudarExtra("pagina", ""); }}>
                <option value="">Mais recentes</option>
                <option value="maior">Maior desconto</option>
              </select>
            </div>
          }>
          {extras.origem && (
            <div style={{ padding: "0.7rem 0.8rem 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: "0.82rem" }}>
              <span style={{ color: PALETA.areiaTinta, fontWeight: 700 }}>Só:</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 6px 3px 10px", borderRadius: 999, border: `1.5px solid ${PALETA.carvao2}`, fontWeight: 700 }}>
                {nomeDaOrigem.get(extras.origem) || extras.origem}
                <button type="button" aria-label="Tirar o filtro" onClick={() => { mudarExtra("origem", ""); mudarExtra("pagina", ""); }}
                  style={{ border: "none", background: PALETA.areia, borderRadius: 999, width: 22, height: 22, cursor: "pointer", fontWeight: 900, color: PALETA.carvao2 }}>×</button>
              </span>
            </div>
          )}
          <div style={{ opacity: lista.carregando ? 0.55 : 1, transition: "opacity 0.15s" }} aria-busy={lista.carregando || undefined}>
            {lista.erro ? (
              <div role="alert" style={{ padding: "0.8rem", color: PALETA.grave, fontWeight: 700, fontSize: "0.85rem" }}>{lista.erro}</div>
            ) : !pagina || pagina.itens.length === 0 ? (
              <Vazio texto={pagina ? "Nenhum pedido com desconto nestes filtros." : "Carregando…"} />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th style={th}>Data</th><th style={th}>Nº</th><th style={th}>Canal</th><th style={th}>Tipo</th>
                      <th style={th}>Cupom / campanha / motivo</th><th style={th}>Quem bancou</th>
                      <th style={{ ...th, ...num }}>Desconto</th><th style={{ ...th, ...num }}>Total pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagina.itens.map((l) => (
                      <tr key={l.id}>
                        <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{l.dia.slice(8, 10)}/{l.dia.slice(5, 7)} <span style={{ color: PALETA.areiaTinta }}>{l.hora}</span></td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          <strong>{l.numero}</strong>
                          {l.referencia && <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>{l.referencia}</div>}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{l.canalNome}</td>
                        <td style={{ ...td, whiteSpace: "nowrap", color: PALETA.carvao2 }}>{l.tipo}</td>
                        <td style={{ ...td, wordBreak: "break-word", maxWidth: 340 }}>{l.origem}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {l.naoIdentificado > 0 ? <Etiqueta tom="atencao">{l.quem}</Etiqueta> : l.quem}
                          {l.loja > 0 && l.plataforma > 0 && (
                            <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>loja {fmtReais(l.loja)} · plat. {fmtReais(l.plataforma)}</div>
                          )}
                        </td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(l.desconto)}</td>
                        <td style={{ ...td, ...num }}>{fmtReais(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {pagina && pagina.paginas > 1 && (
            <nav aria-label="Páginas da lista" className="fh-sem-impressao"
              style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap", padding: "0.9rem" }}>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} disabled={pagina.pagina <= 1} onClick={() => irParaPagina(1)}>« Primeira</button>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} disabled={pagina.pagina <= 1} onClick={() => irParaPagina(pagina.pagina - 1)}>‹ Anterior</button>
              <span style={{ fontSize: "0.82rem", fontWeight: 700, color: PALETA.carvao2, fontVariantNumeric: "tabular-nums" }}>Página {pagina.pagina} de {pagina.paginas}</span>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} disabled={pagina.pagina >= pagina.paginas} onClick={() => irParaPagina(pagina.pagina + 1)}>Próxima ›</button>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} disabled={pagina.pagina >= pagina.paginas} onClick={() => irParaPagina(pagina.paginas)}>Última »</button>
            </nav>
          )}
        </Bloco>
      </div>

      <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.55 }}>
        Pedidos cancelados não entram: o cliente não levou o desconto. O percentual é sobre o <strong>valor vendido</strong> — o mesmo número do relatório Vendas por período —, que já vem <strong>sem</strong> o desconto, inclusive o que o iFood ou o 99 pagou.
        Por isso ele sai maior que a conta “desconto ÷ preço cheio” de outros sistemas, e mais ainda na loja com muita promoção de aplicativo.
        O “% dos pedidos” é só de pedidos lançados; a conta de mesa com desconto entra no número de linhas, somada à parte.
        Na <strong>mesa</strong>, o desconto dado na conta não fica gravado como desconto: ele sai da própria conta (a taxa de serviço negativa das contas antigas, ou consumo − o que foi pago sem taxa de serviço e gorjeta)
        e entra no dia e na hora em que a mesa <strong>fechou</strong>, como no Vendas por período; ele não sai do valor vendido, que é a soma do que foi lançado. Por isso, num recorte em que a mesa fecha mas foi lançada antes (outro dia, outra faixa de horário), aparece o desconto sem a venda.
        Se o cliente deixou troco, o desconto da mesa pode aparecer menor. Pedido do 99Food anterior a 18/09/2026 tem a divisão loja × 99 calculada pelas promoções que o 99 mandou.
      </p>
    </ModeloDoRelatorio>
  );
}
