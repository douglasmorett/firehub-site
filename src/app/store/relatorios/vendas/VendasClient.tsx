"use client";
/**
 * Vendas por período — a tela do relatório principal da Saipos: o resumo do
 * período, a conta que fecha, tipo de venda, canal e a lista de todos os
 * pedidos com busca e detalhe. A conta mora em lib/relatorios/vendas.ts; a
 * lista vem paginada do servidor (50 por página), nunca o período inteiro.
 *
 * Diferenças de propósito para a Saipos:
 * - a conta aparece COMO CONTA (itens + taxas − descontos = total), com a
 *   linha "outras taxas e ajustes" que explica o que sobra — lá os números
 *   ficam lado a lado e o lojista que soma não chega no total;
 * - cada número principal diz quanto mudou contra o período anterior;
 * - o total dos itens é o mesmo do Itens vendidos no mesmo filtro, com o link;
 * - "Vendas" é atendimento (a mesa de três rodadas é uma venda) e o ticket é
 *   valor ÷ vendas — a régua única de lib/relatorios/regua-da-venda.ts, a do
 *   Faturamento por dia e do Dia e hora; a lista continua de pedidos;
 * - status e busca mexem só na LISTA: o resumo continua sendo o do período.
 */
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { filtrosParaQuery, fmtDia, fmtPct, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import type { ItemDetalhado, LinhaDePedido, ResumoDeVendas, SomaDasLinhas } from "@/lib/relatorios/vendas";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio, Variacao } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type LinhaComDetalhe = LinhaDePedido & {
  detalhe: { itens: ItemDetalhado[]; endereco: string | null; motivoCancelamento: string | null; canceladoPor: string | null };
};

type Resposta = {
  lojas: string[];
  periodo: { de: string; ate: string };
  resumo: ResumoDeVendas;
  anterior: {
    de: string; ate: string; ateEsteHorario: boolean; atendimentos: number; pedidos: number; totalPedidos: number; ticketMedio: number;
    cancelados: { pedidos: number; valor: number }; descontos: number; taxaEntrega: number; servico: number;
  };
  lista: {
    status: string; busca: string; pagina: number; paginas: number; porPagina: number; total: number;
    soma: SomaDasLinhas;
    linhas: LinhaComDetalhe[];
  };
};

const STATUS: { valor: string; rotulo: string }[] = [
  { valor: "", rotulo: "Todas" },
  { valor: "vendas", rotulo: "Não canceladas" },
  { valor: "canceladas", rotulo: "Só canceladas" },
];

const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.7rem", fontWeight: 800, textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 0.7rem", verticalAlign: "top" };

/** Etiqueta de status: verde e vermelho só como estado, em fundo claro (regra da paleta). */
function EtiquetaDeStatus({ linha }: { linha: LinhaDePedido }) {
  const cancelado = linha.situacao === "cancelado";
  const concluido = ["Entregue", "Retirado", "Conta fechada", "Encerrado", "Concluído"].includes(linha.statusRotulo);
  const [fundo, cor, borda] = cancelado
    ? [PALETA.graveClaro, PALETA.grave, PALETA.graveBorda]
    : concluido ? [PALETA.okClaro, PALETA.ok, PALETA.okBorda] : [PALETA.areia, PALETA.carvao2, PALETA.areiaBorda];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 800, background: fundo, color: cor, border: `1px solid ${borda}`, whiteSpace: "nowrap" }}>
      {linha.statusRotulo}
    </span>
  );
}

/** Uma linha da conta: "+ Taxas de entrega ........ R$ 1.444,48". */
function LinhaDaConta({ rotulo, valor, detalhe, total, negativo }: { rotulo: string; valor: number; detalhe?: string; total?: boolean; negativo?: boolean }) {
  return (
    <tr style={{ borderTop: total ? `1.5px solid ${PALETA.carvao2}` : `1px solid ${PALETA.areia}` }}>
      <td style={{ padding: "7px 0", fontWeight: total ? 900 : 600, fontSize: total ? "0.92rem" : "0.85rem" }}>
        {rotulo}
        {detalhe && <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, fontWeight: 500 }}>{detalhe}</div>}
      </td>
      <td style={{ ...num, padding: "7px 0", fontWeight: total ? 900 : 700, fontSize: total ? "0.95rem" : "0.86rem", color: negativo && valor > 0 ? PALETA.grave : PALETA.carvao }}>
        {negativo && valor > 0 ? `− ${fmtReais(valor)}` : fmtReais(valor)}
      </td>
    </tr>
  );
}

/** O detalhe do pedido: itens com opções à esquerda, a conta e o cliente à direita. */
function DetalheDoPedido({ l }: { l: LinhaComDetalhe }) {
  const d = l.detalhe;
  const diaDiferente = fmtDia(l.diaOperacional) !== l.data;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "1rem 1.5rem", padding: "0.9rem 1rem 1.1rem", background: "#FDFBF9" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Itens</div>
        {d.itens.length === 0 && <div style={{ fontSize: "0.82rem", color: PALETA.areiaTinta }}>O pedido não tem itens gravados.</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {d.itens.map((it, i) => (
            <li key={i} style={{ fontSize: "0.84rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontWeight: 700 }}>{fmtQtd(it.quantidade)}× {it.nome}</span>
                <span style={{ ...num, fontWeight: 700 }}>{fmtReais(it.total)}</span>
              </div>
              {it.opcoes.length > 0 && (
                <div style={{ fontSize: "0.76rem", color: PALETA.carvao2, marginTop: 2, lineHeight: 1.45 }}>
                  {it.opcoes.map((o, j) => (
                    <span key={j}>
                      {j > 0 && " · "}
                      {o.quantidade !== 1 ? `${fmtQtd(o.quantidade)}× ` : ""}{o.nome}
                      {o.preco !== null && <span style={{ color: PALETA.areiaTinta }}> (+{fmtReais(o.preco)})</span>}
                    </span>
                  ))}
                </div>
              )}
              {it.observacao && <div style={{ fontSize: "0.76rem", color: PALETA.brasaTinta, fontStyle: "italic", marginTop: 2 }}>Obs.: {it.observacao}</div>}
            </li>
          ))}
        </ul>
      </div>
      <div style={{ minWidth: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <LinhaDaConta rotulo="Total dos itens" valor={l.totalItens} />
            {l.taxaEntrega > 0 && <LinhaDaConta rotulo="+ Taxa de entrega" valor={l.taxaEntrega} />}
            {l.outrasTaxas !== 0 && <LinhaDaConta rotulo="+ Outras taxas e ajustes" valor={l.outrasTaxas} detalhe="Taxa de serviço que o app cobra do cliente, ou diferença que o pedido não detalha" />}
            {l.descontoLoja > 0 && <LinhaDaConta rotulo="− Desconto da loja" valor={l.descontoLoja} negativo />}
            {l.descontoPlataforma > 0 && <LinhaDaConta rotulo="− Desconto da plataforma" valor={l.descontoPlataforma} negativo detalhe="Bancado pelo app, que repassa à loja" />}
            {l.descontoSemDono > 0 && <LinhaDaConta rotulo="− Desconto sem dono identificado" valor={l.descontoSemDono} negativo detalhe="O pedido não diz se foi a loja ou o app" />}
            <LinhaDaConta rotulo={l.valorImpossivel ? "Total (valor impossível, fora da soma)" : l.situacao === "cancelado" ? "Total (cancelado, fora da soma)" : "Total"} valor={l.total} total />
          </tbody>
        </table>
        {l.valorImpossivel && (
          <p role="note" style={{ margin: "0.6rem 0 0", padding: "6px 10px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, background: PALETA.graveClaro, color: PALETA.grave, border: `1px solid ${PALETA.graveBorda}` }}>
            Valor impossível (R$ 1 milhão ou mais): erro de cadastro ou teste. Fica fora de todas as somas deste relatório — confira o produto e o pedido.
          </p>
        )}
        <dl style={{ margin: "0.8rem 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", fontSize: "0.8rem" }}>
          <dt style={{ color: PALETA.areiaTinta, fontWeight: 700 }}>Pagamento</dt><dd style={{ margin: 0 }}>{l.pagamento}</dd>
          {l.telefone && (<><dt style={{ color: PALETA.areiaTinta, fontWeight: 700 }}>Telefone</dt><dd style={{ margin: 0 }}>{l.telefone}</dd></>)}
          {l.tipo === "DELIVERY" && d.endereco && (<><dt style={{ color: PALETA.areiaTinta, fontWeight: 700 }}>Endereço</dt><dd style={{ margin: 0 }}>{d.endereco}</dd></>)}
          {l.noApp && (<><dt style={{ color: PALETA.areiaTinta, fontWeight: 700 }}>Nº no app</dt><dd style={{ margin: 0 }}>{l.canalNome} #{l.noApp}</dd></>)}
          {diaDiferente && (<><dt style={{ color: PALETA.areiaTinta, fontWeight: 700 }}>Expediente</dt><dd style={{ margin: 0 }}>{fmtDia(l.diaOperacional)} — feito de madrugada, conta no dia anterior (o dia vira às 5h)</dd></>)}
          {l.situacao === "cancelado" && (d.motivoCancelamento || d.canceladoPor) && (
            <><dt style={{ color: PALETA.grave, fontWeight: 700 }}>Cancelado</dt><dd style={{ margin: 0, color: PALETA.grave }}>{[d.canceladoPor, d.motivoCancelamento].filter(Boolean).join(" — ")}</dd></>
          )}
        </dl>
      </div>
    </div>
  );
}

export default function VendasClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "7d", { status: "", busca: "", pagina: "" });
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("vendas", query);

  const [aberto, setAberto] = useState<string | null>(null);

  // Trocar filtro ou busca volta para a página 1 — ficar na página 6 de uma
  // lista que agora tem 2 páginas mostraria a última sem dizer por quê.
  const mudarFiltros = (p: Parameters<typeof mudar>[0]) => { mudar(p); mudarExtra("pagina", ""); };
  const irParaPagina = (n: number) => { mudarExtra("pagina", n > 1 ? String(n) : ""); setAberto(null); };

  const [textoDaBusca, setTextoDaBusca] = useState(extras.busca || "");
  useEffect(() => {
    const t = setTimeout(() => {
      if (textoDaBusca.trim() !== (extras.busca || "")) { mudarExtra("busca", textoDaBusca.trim()); mudarExtra("pagina", ""); }
    }, 350);
    return () => clearTimeout(t);
  }, [textoDaBusca, extras.busca, mudarExtra]);

  const r = dados?.resumo;
  const a = dados?.anterior;
  const lista = dados?.lista;
  const mesa = r?.porTipo.find((t) => t.tipo === "MESA");
  /** "12 lançamentos" embaixo da venda quando a mesa junta rodadas — é o número da lista. */
  const lancamentos = (vendas: number, pedidos: number) =>
    pedidos !== vendas ? <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, fontWeight: 500 }}>{pedidos.toLocaleString("pt-BR")} lançamentos</div> : null;
  // Sem categoria e produto: este relatório não os aplica (lib/relatorios/vendas.ts,
  // semFiltrosDeItem) — levá-los adiante fazia o "confere" abrir outro total.
  const linkItens = `/store/relatorios/itens-vendidos?${filtrosParaQuery({ ...filtros, categorias: [], produtos: [] })}`;

  return (
    <ModeloDoRelatorio
      titulo="Vendas por período"
      descricao="Todos os pedidos do período: quanto entrou, de onde veio, o ticket médio por tipo de venda, taxas, descontos e cancelamentos — e cada pedido aberto até o item."
      slug="vendas" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <style>{`.fh-vendas-so-celular { display: none; } @media (max-width: 640px) { .fh-vendas-so-celular { display: block; } }
        .fh-vendas-linha:hover { background: ${PALETA.areia} !important; }
        .fh-vendas-linha:focus-visible { outline: 2px solid ${PALETA.carvao}; outline-offset: -2px; }`}</style>
      <BarraDeFiltros filtros={filtros} mudar={mudarFiltros} opcoes={opcoes} hoje={inicio.hoje} />

      {r && a && (
        <>
          <GradeDeCartoes>
            {/* Vendas = atendimentos: a mesa de três rodadas é uma venda (lib/relatorios/regua-da-venda.ts),
                o mesmo número do Faturamento por dia e do Dia e hora. Os lançamentos são as linhas da lista. */}
            <Cartao rotulo="Vendas" valor={r.atendimentos.toLocaleString("pt-BR")}
              detalhe={<>{r.pedidos !== r.atendimentos && <>{r.pedidos.toLocaleString("pt-BR")} lançamentos · </>}<Variacao atual={r.atendimentos} anterior={a.atendimentos} /></>} />
            <Cartao rotulo="Valor vendido" valor={fmtReais(r.totalPedidos)} detalhe={<Variacao atual={r.totalPedidos} anterior={a.totalPedidos} />} />
            <Cartao rotulo="Ticket médio" valor={fmtReais(r.ticketMedio)} detalhe={<>Valor ÷ vendas · <Variacao atual={r.ticketMedio} anterior={a.ticketMedio} /></>} />
            <Cartao rotulo="Cancelados" valor={r.cancelados.pedidos.toLocaleString("pt-BR")}
              detalhe={<>{fmtReais(r.cancelados.valor)} · <Variacao atual={r.cancelados.pedidos} anterior={a.cancelados.pedidos} menorEhMelhor /></>} />
            <Cartao rotulo="Total dos itens" valor={fmtReais(r.totalItens)}
              detalhe={<>Produtos + opções · <Link href={linkItens} style={{ color: PALETA.marca, fontWeight: 700 }}>confere com Itens vendidos</Link></>} />
            <Cartao rotulo="Serviço e gorjeta" valor={fmtReais(r.servico.taxa + r.servico.gorjeta)}
              detalhe={r.servico.mesas ? `${r.servico.mesas} mesa${r.servico.mesas > 1 ? "s" : ""} fechada${r.servico.mesas > 1 ? "s" : ""} · gorjeta ${fmtReais(r.servico.gorjeta)}` : "Nenhuma mesa fechada no período"} />
          </GradeDeCartoes>
          <p style={{ margin: "-0.6rem 0 1.1rem", fontSize: "0.76rem", color: PALETA.areiaTinta }}>
            {/* Com hoje no período, o anterior vai só até este mesmo horário — a régua do Faturamento por dia
                (regua-da-venda.ts, anteriorAteEsteHorario). Sem isso, o "Hoje" do meio-dia saía "↓ 100%". */}
            Comparado com {fmtDia(a.de)} a {fmtDia(a.ate)}{a.ateEsteHorario ? " até este mesmo horário" : ""} — o mesmo número de dias logo antes, com os mesmos filtros.
            {r.naoConcluidos.pedidos > 0 && <> {r.naoConcluidos.pedidos} pedido{r.naoConcluidos.pedidos > 1 ? "s" : ""} não concluído{r.naoConcluidos.pedidos > 1 ? "s" : ""} (rascunho do robô, totem sem pagamento) ficou de fora: não é venda nem cancelamento.</>}
          </p>
          {r.valoresImpossiveis > 0 && (
            <p role="note" style={{ margin: "-0.6rem 0 1.1rem", fontSize: "0.8rem", color: PALETA.grave, fontWeight: 700 }}>
              {r.valoresImpossiveis} pedido{r.valoresImpossiveis === 1 ? "" : "s"} com valor impossível (R$ 1 milhão ou mais) ficou fora de todas as somas — está na lista, marcado. Confira o cadastro.
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: "0 1.25rem", alignItems: "start" }}>
            <Bloco titulo="A conta do período" subtitulo="Do total dos itens ao total dos pedidos">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  <LinhaDaConta rotulo="Total dos itens" valor={r.totalItens} detalhe={`${fmtQtd(r.quantidadeDeItens)} itens, preço × quantidade`} />
                  <LinhaDaConta rotulo="+ Taxas de entrega" valor={r.taxaEntrega.valor} detalhe={`${r.taxaEntrega.pedidos} pedido${r.taxaEntrega.pedidos === 1 ? "" : "s"} com taxa`} />
                  <LinhaDaConta rotulo="+ Outras taxas e ajustes" valor={r.outrasTaxas.valor}
                    detalhe={r.outrasTaxas.pedidos ? `${r.outrasTaxas.pedidos} pedidos — a taxa de serviço que o app cobra do cliente (muda de pedido para pedido) e diferenças que o pedido não detalha` : "Nenhuma"} />
                  <LinhaDaConta rotulo="− Descontos da loja" valor={r.descontos.loja} negativo />
                  <LinhaDaConta rotulo="− Descontos da plataforma" valor={r.descontos.plataforma} negativo detalhe="Cupom bancado pelo iFood/99, que repassa o valor à loja" />
                  {r.descontos.naoIdentificado > 0 && (
                    <LinhaDaConta rotulo="− Descontos sem dono identificado" valor={r.descontos.naoIdentificado} negativo detalhe="O pedido não diz se foi a loja ou o app" />
                  )}
                  <LinhaDaConta rotulo="= Total dos pedidos" valor={r.totalPedidos} total detalhe="O valor vendido — o mesmo de todo relatório" />
                  {(r.servico.taxa > 0 || r.servico.gorjeta > 0 || r.servico.descontoNaMesa > 0) && (
                    <>
                      <LinhaDaConta rotulo="+ Taxa de serviço" valor={r.servico.taxa} detalhe={`${r.servico.mesas} mesas fechadas no período`} />
                      <LinhaDaConta rotulo="+ Gorjeta" valor={r.servico.gorjeta} />
                      {r.servico.descontoNaMesa > 0 && (
                        <LinhaDaConta rotulo="− Desconto no fechamento da mesa" valor={r.servico.descontoNaMesa} negativo
                          detalhe={`${r.servico.mesasComDesconto} mesa${r.servico.mesasComDesconto === 1 ? "" : "s"} — consumo lançado − (pago − serviço − gorjeta); não sai do valor vendido, só do que entrou`} />
                      )}
                      <LinhaDaConta rotulo="= Total com serviço e gorjeta" valor={r.totalComServico} total />
                    </>
                  )}
                </tbody>
              </table>
            </Bloco>

            <Bloco titulo="Por tipo de venda" subtitulo="Ticket médio de cada um" semPadding>
              {r.porTipo.length === 0 ? <Vazio /> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                    <thead>
                      <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                        <th style={th}>Tipo</th><th style={{ ...th, ...num }}>Vendas</th><th style={{ ...th, ...num }}>Valor</th><th style={{ ...th, ...num }}>Ticket</th><th style={{ ...th, width: 90 }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.porTipo.map((t) => (
                        <tr key={t.tipo} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                          <td style={{ ...td, fontWeight: 700 }}>
                            {t.rotulo}
                            {lancamentos(t.vendas, t.pedidos)}
                          </td>
                          <td style={{ ...td, ...num }}>{t.vendas.toLocaleString("pt-BR")}</td>
                          <td style={{ ...td, ...num, fontWeight: 700 }}>{fmtReais(t.valor)}</td>
                          <td style={{ ...td, ...num }}>{fmtReais(t.ticketMedio)}</td>
                          <td style={td}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><BarraDePct pct={t.pct} /><span style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, ...num }}>{fmtPct(t.pct, 0)}</span></div></td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 900 }}>
                        <td style={td}>Geral{lancamentos(r.atendimentos, r.pedidos)}</td>
                        <td style={{ ...td, ...num }}>{r.atendimentos.toLocaleString("pt-BR")}</td>
                        <td style={{ ...td, ...num }}>{fmtReais(r.totalPedidos)}</td>
                        <td style={{ ...td, ...num }}>{fmtReais(r.ticketMedio)}</td>
                        <td style={td} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Bloco>

            <Bloco titulo="Por canal" subtitulo="De onde vieram os pedidos" semPadding>
              {r.porCanal.length === 0 ? <Vazio /> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
                    <thead>
                      <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                        <th style={th}>Canal</th><th style={{ ...th, ...num }}>Vendas</th><th style={{ ...th, ...num }}>Valor</th><th style={{ ...th, width: 90 }}>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.porCanal.map((c) => (
                        <tr key={c.canal} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                          <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>
                            {c.nome}
                            <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, fontWeight: 500 }}>
                              ticket {fmtReais(c.ticketMedio)}{c.pedidos !== c.vendas ? ` · ${c.pedidos.toLocaleString("pt-BR")} lançamentos` : ""}
                            </div>
                          </td>
                          <td style={{ ...td, ...num }}>{c.vendas.toLocaleString("pt-BR")}</td>
                          <td style={{ ...td, ...num, fontWeight: 700 }}>{fmtReais(c.valor)}</td>
                          <td style={td}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><BarraDePct pct={c.pct} cor={PALETA.carvao2} /><span style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, ...num }}>{fmtPct(c.pct, 0)}</span></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Bloco>
          </div>
        </>
      )}

      {lista && (
        <Bloco semPadding
          titulo="Pedidos"
          subtitulo={`${lista.total.toLocaleString("pt-BR")} pedido${lista.total === 1 ? "" : "s"}${lista.paginas > 1 ? ` · página ${lista.pagina} de ${lista.paginas}` : ""}${lista.total ? " · clique para ver os itens" : ""}`}
          acoes={
            <div className="fh-sem-impressao" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <div role="group" aria-label="Status dos pedidos" style={{ display: "inline-flex", gap: 4 }}>
                {STATUS.map((s) => {
                  const ativo = (extras.status || "") === s.valor;
                  return (
                    <button key={s.valor || "todas"} type="button" aria-pressed={ativo}
                      onClick={() => { mudarExtra("status", s.valor); mudarExtra("pagina", ""); setAberto(null); }}
                      style={{
                        padding: "5px 10px", borderRadius: 999, fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                        border: `1.5px solid ${ativo ? PALETA.carvao : PALETA.areiaBorda}`, background: ativo ? PALETA.carvao : "#fff", color: ativo ? "#fff" : PALETA.carvao2,
                      }}>
                      {s.rotulo}
                    </button>
                  );
                })}
              </div>
              <label style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <Search size={14} style={{ position: "absolute", left: 10, color: PALETA.areiaTinta }} aria-hidden />
                <input type="search" name="busca" value={textoDaBusca} onChange={(e) => setTextoDaBusca(e.target.value)}
                  placeholder="Nº do pedido, nome ou telefone" aria-label="Buscar pedido por número, nome ou telefone"
                  style={{ padding: "7px 10px 7px 30px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.82rem", fontFamily: "inherit", width: 240, maxWidth: "100%" }} />
              </label>
            </div>
          }>
          {lista.linhas.length === 0 ? (
            <Vazio texto={lista.busca ? `Nenhum pedido com “${lista.busca}” neste período e filtros.` : lista.status === "canceladas" ? "Nenhum pedido cancelado no período." : undefined} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 980 }}>
                <thead>
                  <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}`, background: "#fff" }}>
                    <th style={th}>Data</th><th style={th}>Nº</th><th style={th}>Cliente</th><th style={th}>Canal</th><th style={th}>Tipo</th>
                    <th style={th}>Pagamento</th><th style={th}>Status</th><th style={{ ...th, ...num }}>Itens</th>
                    <th style={{ ...th, ...num }}>Desconto</th><th style={{ ...th, ...num }}>Taxa</th><th style={{ ...th, ...num }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.linhas.map((l) => {
                    const cancelado = l.situacao === "cancelado";
                    const estaAberto = aberto === l.id;
                    return (
                      <React.Fragment key={l.id}>
                        <tr className="fh-vendas-linha" tabIndex={0} aria-expanded={estaAberto}
                          onClick={() => setAberto(estaAberto ? null : l.id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAberto(estaAberto ? null : l.id); } }}
                          style={{ borderBottom: estaAberto ? "none" : `1px solid ${PALETA.areia}`, cursor: "pointer", color: cancelado ? PALETA.areiaTinta : PALETA.carvao, background: estaAberto ? "#FDFBF9" : "#fff" }}>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                              <ChevronRight size={13} style={{ flexShrink: 0, transition: "transform 0.15s", transform: estaAberto ? "rotate(90deg)" : "none", color: PALETA.areiaTinta }} />
                              <span>{l.data.slice(0, 5)} <strong>{l.hora}</strong></span>
                            </span>
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 800 }}>
                            {l.numero}
                            {l.noApp && <div style={{ fontSize: "0.7rem", color: PALETA.areiaTinta, fontWeight: 600 }}>app #{l.noApp}</div>}
                            {/* No celular a tabela rola de lado e o total fica fora da vista: repete aqui. */}
                            <div className="fh-vendas-so-celular" style={{ fontSize: "0.74rem", fontWeight: 800, textDecoration: cancelado || l.valorImpossivel ? "line-through" : undefined }}>{fmtReais(l.total)}</div>
                          </td>
                          <td style={{ ...td, maxWidth: 200 }}>
                            <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.cliente}</div>
                            {l.telefone && <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, whiteSpace: "nowrap" }}>{l.telefone}</div>}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{l.canalNome}</td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{l.tipoRotulo}{l.mesa && <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>{l.mesa}</div>}</td>
                          <td style={{ ...td, maxWidth: 210, fontSize: "0.78rem" }}>{l.pagamento}</td>
                          <td style={td}><EtiquetaDeStatus linha={l} /></td>
                          <td style={{ ...td, ...num }}>{fmtQtd(l.itens)}</td>
                          <td style={{ ...td, ...num, color: l.desconto > 0 && !cancelado ? PALETA.grave : undefined }}>{l.desconto > 0 ? `− ${fmtReais(l.desconto)}` : "—"}</td>
                          <td style={{ ...td, ...num }}>{l.taxaEntrega > 0 ? fmtReais(l.taxaEntrega) : "—"}</td>
                          <td style={{ ...td, ...num, fontWeight: 800 }}>
                            <span style={{ textDecoration: cancelado || l.valorImpossivel ? "line-through" : undefined }}>{fmtReais(l.total)}</span>
                            {l.valorImpossivel && <div style={{ fontSize: "0.7rem", color: PALETA.grave, fontWeight: 800 }}>valor impossível</div>}
                          </td>
                        </tr>
                        {estaAberto && (
                          <tr style={{ borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                            <td colSpan={11} style={{ padding: 0 }}>
                              {/* Grudado à esquerda: no celular a tabela rola de lado e o detalhe fica na tela. */}
                              <div style={{ position: "sticky", left: 0, width: "min(100%, calc(100vw - 2.5rem))" }}>
                                <DetalheDoPedido l={l} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  {lista.status === "canceladas" ? (
                    <tr style={{ borderTop: `1.5px solid ${PALETA.carvao2}`, fontWeight: 900, background: PALETA.areia }}>
                      <td colSpan={10} style={{ ...td, fontSize: "0.8rem" }}>
                        Cancelados {lista.busca ? "desta lista" : "do período"}: {lista.soma.cancelados.toLocaleString("pt-BR")} pedido{lista.soma.cancelados === 1 ? "" : "s"}
                        <span style={{ fontWeight: 600, color: PALETA.areiaTinta }}> · fora de todas as vendas{lista.paginas > 1 ? " · todas as páginas" : ""}</span>
                        {lista.soma.valoresImpossiveis > 0 && <span style={{ fontWeight: 600, color: PALETA.grave }}> · {lista.soma.valoresImpossiveis} com valor impossível fora da soma</span>}
                      </td>
                      <td style={{ ...td, ...num, color: PALETA.grave }}>{fmtReais(lista.soma.valorCancelado)}</td>
                    </tr>
                  ) : (
                  <tr style={{ borderTop: `1.5px solid ${PALETA.carvao2}`, fontWeight: 900, background: PALETA.areia }}>
                    <td colSpan={8} style={{ ...td, fontSize: "0.8rem" }}>
                      {/* A lista é de pedidos (lançamentos); "Vendas" no cartão é atendimento — a mesa conta uma vez lá. */}
                      Total {lista.busca || lista.status ? "desta lista" : "do período"}: {lista.soma.pedidos.toLocaleString("pt-BR")} pedido{lista.soma.pedidos === 1 ? "" : "s"}
                      {!lista.busca && !lista.status && r && r.atendimentos !== lista.soma.pedidos && (
                        <span style={{ fontWeight: 600, color: PALETA.areiaTinta }}> · {r.atendimentos.toLocaleString("pt-BR")} vendas (a mesa conta uma vez)</span>
                      )}
                      {lista.soma.cancelados > 0 && <span style={{ fontWeight: 600, color: PALETA.areiaTinta }}> · {lista.soma.cancelados} cancelado{lista.soma.cancelados > 1 ? "s" : ""} fora da soma</span>}
                      {lista.soma.valoresImpossiveis > 0 && <span style={{ fontWeight: 600, color: PALETA.grave }}> · {lista.soma.valoresImpossiveis} com valor impossível fora da soma</span>}
                      {lista.paginas > 1 && <span style={{ fontWeight: 600, color: PALETA.areiaTinta }}> · todas as páginas</span>}
                    </td>
                    <td style={{ ...td, ...num }}>{lista.soma.desconto > 0 ? `− ${fmtReais(lista.soma.desconto)}` : "—"}</td>
                    <td style={{ ...td, ...num }}>{fmtReais(lista.soma.taxaEntrega)}</td>
                    <td style={{ ...td, ...num }}>{fmtReais(lista.soma.total)}</td>
                  </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}

          {lista.paginas > 1 && (
            <nav aria-label="Páginas da lista" className="fh-sem-impressao"
              style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, padding: "0.8rem", borderTop: `1px solid ${PALETA.areia}`, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} disabled={lista.pagina <= 1} onClick={() => irParaPagina(1)}>« Primeira</button>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} disabled={lista.pagina <= 1} onClick={() => irParaPagina(lista.pagina - 1)}>‹ Anterior</button>
              <span style={{ fontSize: "0.82rem", fontWeight: 700, color: PALETA.carvao2, fontVariantNumeric: "tabular-nums" }}>Página {lista.pagina} de {lista.paginas}</span>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} disabled={lista.pagina >= lista.paginas} onClick={() => irParaPagina(lista.pagina + 1)}>Próxima ›</button>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} disabled={lista.pagina >= lista.paginas} onClick={() => irParaPagina(lista.paginas)}>Última »</button>
            </nav>
          )}
        </Bloco>
      )}

      {r && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55 }}>
          Cancelados não entram em nenhum total; o rascunho do robô e o pedido do totem que não foi pago não são venda nem cancelamento.
          <strong> Vendas</strong> são atendimentos: cada pedido é uma venda, e a mesa é <strong>uma</strong> venda, no primeiro lançamento — as rodadas dela são lançamentos, e a lista mostra cada um.
          O ticket médio é o valor vendido ÷ vendas, o mesmo do Faturamento por dia e do Dia e hora.
          A taxa de serviço e a gorjeta são das mesas <strong>fechadas</strong> no período e ficam fora do total dos pedidos (são do garçom).
          {mesa && <> O pedido de mesa entra pelo consumo lançado, aberta ou fechada a mesa. O desconto dado ao fechar a mesa não fica gravado: sai de consumo − (pago − serviço − gorjeta), nas mesas fechadas desde 13/09/2026, e fica à parte — não sai do valor vendido. É um piso, porque troco deixado na mesa esconde parte dele.</>}
          {/* Desde 24/09/2026 o Cupons e descontos segue a régua (regua-da-venda.ts, regra 4): o desconto
              da mesa entra lá também no dia em que ela FECHOU, e o total de desconto dos dois é o mesmo número
              (scripts/conferir-relatorios-batem.mjs, colunas "Desconto total" e "Desconto (anterior)"). Até ali
              este texto avisava que os dois diferiam — e continuou dizendo isso depois de deixar de ser verdade. */}
          {" "}Quem pagou o desconto de cada pedido (loja ou app) é a mesma conta do relatório Cupons e descontos.
          {mesa && <> O desconto no fechamento da mesa entra no dia em que a mesa fechou, aqui e no Cupons e descontos: o total de desconto (dos pedidos mais o da mesa) é o mesmo nos dois.</>}
          {" "}O Excel traz o resumo e <strong>todas</strong> as linhas da lista, sem página, com o telefone só pelo final.
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
