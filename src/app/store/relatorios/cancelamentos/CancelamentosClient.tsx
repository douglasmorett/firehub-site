"use client";
/**
 * Cancelamentos e cortesias — o controle anti-fraude do caixa: o que a loja
 * tirou de venda e o que deu de graça, por operador, motivo e produto, com os
 * alertas (depois da conta impressa, depois de pronto, operador fora da
 * curva). A conta mora em lib/relatorios/cancelamentos.ts; aqui são os
 * filtros, os blocos e a lista. Clicar num operador, num motivo ou num alerta
 * filtra a lista.
 */
import React, { useMemo, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";
import { filtrosParaQuery, fmtDia, fmtPct, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import { ROTULO_DO_ALERTA, type AlertaDoCancelamento, type ResultadoDosCancelamentos } from "@/lib/relatorios/cancelamentos";

type Resposta = ResultadoDosCancelamentos & { lojas: string[]; periodo: { de: string; ate: string } };

type Filtro = { tipo: "operador" | "motivo" | "alerta"; valor: string; rotulo: string } | null;

const th: React.CSSProperties = { textAlign: "left", padding: "8px 0.8rem", fontWeight: 800, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", color: PALETA.areiaTinta, borderBottom: `1px solid ${PALETA.areiaBorda}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 0.8rem", borderBottom: `1px solid ${PALETA.areia}`, verticalAlign: "top" };
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const link: React.CSSProperties = { border: "none", background: "none", padding: 0, font: "inherit", color: PALETA.carvao, fontWeight: 800, cursor: "pointer", textAlign: "left", textDecoration: "underline", textDecorationColor: PALETA.areiaBorda, textUnderlineOffset: 3 };
const suave: React.CSSProperties = { fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 2 };

const vezes = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

function Etiqueta({ children, tom = "neutro" }: { children: React.ReactNode; tom?: "neutro" | "atencao" | "grave" | "ok" }) {
  const c = tom === "grave" ? { fundo: PALETA.graveClaro, borda: PALETA.graveBorda, texto: PALETA.grave }
    : tom === "atencao" ? { fundo: PALETA.atencaoClaro, borda: PALETA.atencaoBorda, texto: PALETA.atencao }
    : tom === "ok" ? { fundo: PALETA.okClaro, borda: PALETA.okBorda, texto: PALETA.ok }
    : { fundo: PALETA.areia, borda: PALETA.areiaBorda, texto: PALETA.areiaTinta };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: c.fundo, border: `1px solid ${c.borda}`, color: c.texto, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

const TOM_DO_ALERTA: Record<AlertaDoCancelamento, "grave" | "atencao"> = {
  DEPOIS_DA_CONTA: "grave",
  DEPOIS_DE_PRONTO: "atencao",
  DEPOIS_DA_COZINHA: "atencao",
};

export default function CancelamentosClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "7d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("cancelamentos", filtrosParaQuery(filtros));

  return (
    <ModeloDoRelatorio
      titulo="Cancelamentos e cortesias"
      descricao="O que a loja cancelou (pedido, rodada da mesa, item) e deu de graça: quem fez, quando, por quê e quanto. Com os alertas do que merece conferência."
      slug="cancelamentos" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>
      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} />
      {dados && <Corpo dados={dados} />}
    </ModeloDoRelatorio>
  );
}

function Corpo({ dados }: { dados: Resposta }) {
  const r = dados.resumo;
  const [filtro, setFiltro] = useState<Filtro>(null);
  const [limite, setLimite] = useState(100);
  const [todosOsProdutos, setTodosOsProdutos] = useState(false);

  const lista = useMemo(() => {
    if (!filtro) return dados.lista;
    if (filtro.tipo === "operador") return dados.lista.filter((l) => l.operador === filtro.valor);
    if (filtro.tipo === "motivo") return dados.lista.filter((l) => (l.motivo || "Sem motivo (registro antigo)").toLowerCase() === filtro.valor);
    return dados.lista.filter((l) => l.alertas.includes(filtro.valor as AlertaDoCancelamento));
  }, [dados.lista, filtro]);
  const filtrar = (f: Filtro) => {
    setFiltro(f);
    setLimite(100);
    if (typeof document !== "undefined") document.getElementById("lista-de-cancelamentos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const produtos = todosOsProdutos ? dados.porProduto : dados.porProduto.slice(0, 10);
  const nada = r.cancelamentos === 0 && r.cortesias === 0 && r.foraDaLoja === 0;

  return (
    <>
      <GradeDeCartoes>
        <Cartao rotulo="Cancelado pela loja" valor={fmtReais(r.valor)} tom={r.valor > 0 ? "grave" : "neutro"}
          detalhe={r.pctDoValorVendido == null ? vezes(r.cancelamentos, "cancelamento", "cancelamentos") : `${vezes(r.cancelamentos, "cancelamento", "cancelamentos")} · ${fmtPct(r.pctDoValorVendido, 2)} do valor vendido`} />
        <Cartao rotulo="Pedidos cancelados" valor={r.pedidos.toLocaleString("pt-BR")} detalhe={`${fmtReais(r.valorPedidos)} · pedidos e rodadas de mesa inteiros`} />
        <Cartao rotulo="Itens tirados" valor={r.itens.toLocaleString("pt-BR")} detalhe={`${fmtReais(r.valorItens)} · ${vezes(r.unidades, "unidade", "unidades")} de pedidos que continuaram`} />
        <Cartao rotulo="Para conferir" valor={r.comAlerta.toLocaleString("pt-BR")} tom={r.comAlerta > 0 ? "atencao" : "ok"}
          detalhe={r.comAlerta > 0 ? `${fmtReais(r.valorComAlerta)} cancelados depois da conta, de pronto ou da cozinha` : "nenhum cancelamento fora do comum"} />
        <Cartao rotulo="Cortesias" valor={fmtReais(r.valorCortesias)}
          detalhe={`${vezes(r.cortesias, "cortesia", "cortesias")}${r.pctCortesias != null && r.cortesias > 0 ? ` · ${fmtPct(r.pctCortesias, 2)} do valor vendido` : ""} · fora da venda, no custo`} />
        <Cartao rotulo="Cancelados por fora" valor={r.foraDaLoja.toLocaleString("pt-BR")}
          detalhe={`${fmtReais(r.valorForaDaLoja)} · cliente, plataforma ou sistema (não é a loja)`} />
      </GradeDeCartoes>

      {nada ? (
        <Bloco><Vazio texto="Nenhum cancelamento nem cortesia no período e filtros escolhidos." /></Bloco>
      ) : (
        <>
          {(r.comAlerta > 0 || dados.foraDaCurva.length > 0) && (
            <Bloco titulo="⚠️ Para conferir" subtitulo="Não quer dizer fraude: é o que vale olhar com a pessoa que fez. Clique para ver na lista.">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {dados.foraDaCurva.length > 0 && (
                  <div style={{ background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, borderRadius: 12, padding: "0.7rem 0.9rem", fontSize: "0.84rem", lineHeight: 1.5 }}>
                    <strong style={{ color: PALETA.grave }}>Operador fora da curva: {dados.foraDaCurva.join(", ")}.</strong>{" "}
                    Cancelou o dobro (em R$), ou mais, da média dos outros, com 3 cancelamentos ou mais. Como o sistema não guarda quem lançou cada venda, a comparação é entre quem cancelou — confira se essa pessoa também trabalhou mais no período.
                  </div>
                )}
                {dados.alertas.filter((a) => a.cancelamentos > 0).map((a) => (
                  <div key={a.alerta} style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", fontSize: "0.84rem", lineHeight: 1.5 }}>
                    <Etiqueta tom={TOM_DO_ALERTA[a.alerta]}>{a.rotulo}</Etiqueta>
                    <button type="button" style={link} onClick={() => filtrar({ tipo: "alerta", valor: a.alerta, rotulo: a.rotulo })}>
                      {vezes(a.cancelamentos, "cancelamento", "cancelamentos")} · {fmtReais(a.valor)}
                    </button>
                    <span style={{ color: PALETA.areiaTinta, flex: "1 1 260px" }}>{a.explicacao}</span>
                  </div>
                ))}
              </div>
            </Bloco>
          )}

          {dados.porOperador.length > 0 && (
            <Bloco titulo="Por operador" semPadding
              subtitulo="Quem cancelou e quem deu cortesia. Clique no nome para ver os cancelamentos da pessoa.">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={th}>Operador</th><th style={{ ...th, ...num }}>Cancelamentos</th><th style={{ ...th, ...num }}>Pedidos</th><th style={{ ...th, ...num }}>Itens</th>
                      <th style={{ ...th, ...num }}>Valor</th><th style={th}>% do cancelado</th><th style={{ ...th, ...num }}>Para conferir</th><th style={{ ...th, ...num }}>Cortesias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.porOperador.map((o) => (
                      <tr key={o.chave} style={o.foraDaCurva ? { background: PALETA.graveClaro } : undefined}>
                        <td style={td}>
                          {o.cancelamentos > 0 ? (
                            <button type="button" style={{ ...link, color: o.registrado ? PALETA.carvao : PALETA.areiaTinta }} onClick={() => filtrar({ tipo: "operador", valor: o.chave, rotulo: o.nome })}>{o.nome}</button>
                          ) : <strong>{o.nome}</strong>}
                          {o.foraDaCurva && <div style={{ marginTop: 3 }}><Etiqueta tom="grave">fora da curva</Etiqueta></div>}
                          {!o.registrado && <div style={suave}>cancelamento antigo, sem o nome de quem fez</div>}
                        </td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{o.cancelamentos}</td>
                        <td style={{ ...td, ...num }}>{o.pedidos}</td>
                        <td style={{ ...td, ...num }}>{o.itens}</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(o.valor)}</td>
                        <td style={{ ...td, minWidth: 120 }}>
                          <div style={{ fontSize: "0.76rem", marginBottom: 3 }}>{fmtPct(o.pct)}</div>
                          <BarraDePct pct={o.pct} cor={o.foraDaCurva ? PALETA.grave : PALETA.brasa} />
                        </td>
                        <td style={{ ...td, ...num }}>{o.comAlerta > 0 ? <Etiqueta tom="atencao">{o.comAlerta}</Etiqueta> : <span style={{ color: PALETA.areiaTinta }}>—</span>}</td>
                        <td style={{ ...td, ...num }}>{o.cortesias > 0 ? <>{o.cortesias}<div style={suave}>{fmtReais(o.valorCortesias)}</div></> : <span style={{ color: PALETA.areiaTinta }}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Bloco>
          )}

          {dados.porMotivo.length > 0 && (
            <Bloco titulo="Por motivo" semPadding subtitulo="O motivo que a pessoa escreveu ao cancelar. Clique para ver os cancelamentos.">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 520 }}>
                  <thead>
                    <tr><th style={th}>Motivo</th><th style={{ ...th, ...num }}>Cancelamentos</th><th style={{ ...th, ...num }}>Valor</th><th style={th}>% do cancelado</th></tr>
                  </thead>
                  <tbody>
                    {dados.porMotivo.map((m) => (
                      <tr key={m.motivo}>
                        <td style={{ ...td, wordBreak: "break-word" }}>
                          <button type="button" style={link} onClick={() => filtrar({ tipo: "motivo", valor: m.motivo.toLowerCase(), rotulo: m.motivo })}>{m.motivo}</button>
                        </td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{m.cancelamentos}</td>
                        <td style={{ ...td, ...num }}>{fmtReais(m.valor)}</td>
                        <td style={{ ...td, minWidth: 120 }}>
                          <div style={{ fontSize: "0.76rem", marginBottom: 3 }}>{fmtPct(m.pct)}</div>
                          <BarraDePct pct={m.pct} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Bloco>
          )}

          {dados.porProduto.length > 0 && (
            <Bloco titulo="Produtos mais cancelados" semPadding subtitulo="Em quantos cancelamentos o produto apareceu, quantas unidades e o valor delas.">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 480 }}>
                  <thead>
                    <tr><th style={th}>Produto</th><th style={{ ...th, ...num }}>Vezes</th><th style={{ ...th, ...num }}>Unidades</th><th style={{ ...th, ...num }}>Valor</th></tr>
                  </thead>
                  <tbody>
                    {produtos.map((p) => (
                      <tr key={p.nome}>
                        <td style={{ ...td, fontWeight: 700, wordBreak: "break-word" }}>{p.nome}</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{p.vezes}</td>
                        <td style={{ ...td, ...num }}>{p.quantidade}</td>
                        <td style={{ ...td, ...num }}>{fmtReais(p.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {dados.porProduto.length > 10 && (
                <div style={{ padding: "0.7rem 0.8rem" }} className="fh-sem-impressao">
                  <button type="button" className="btn btn-outline" style={{ padding: "6px 12px", fontSize: "0.8rem" }} onClick={() => setTodosOsProdutos((t) => !t)}>
                    {todosOsProdutos ? "Mostrar só os 10 primeiros" : `Ver todos (${dados.porProduto.length})`}
                  </button>
                </div>
              )}
            </Bloco>
          )}

          {dados.lista.length > 0 && (
            <div id="lista-de-cancelamentos">
              <Bloco titulo="Os cancelamentos" semPadding
                subtitulo={filtro ? `${vezes(lista.length, "cancelamento", "cancelamentos")} — ${filtro.rotulo}` : `${vezes(lista.length, "cancelamento", "cancelamentos")}, do mais recente para o mais antigo`}
                acoes={filtro ? (
                  <button type="button" className="btn btn-outline fh-sem-impressao" style={{ padding: "5px 12px", fontSize: "0.78rem" }} onClick={() => setFiltro(null)}>
                    Mostrar todos
                  </button>
                ) : undefined}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 980 }}>
                    <thead>
                      <tr>
                        <th style={th}>Quando</th><th style={th}>Pedido</th><th style={th}>O quê</th><th style={th}>Itens</th>
                        <th style={th}>Operador</th><th style={th}>Motivo</th><th style={{ ...th, ...num }}>Valor</th><th style={th}>Alerta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.slice(0, limite).map((l) => (
                        <tr key={l.id}>
                          <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtDia(l.dia).slice(0, 5)} <span style={{ color: PALETA.areiaTinta }}>{l.hora}</span></td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            <strong>{l.numero || "—"}</strong>
                            <div style={suave}>{[l.onde, l.canalNome].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ")}</div>
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>{l.tipo === "PEDIDO" ? <Etiqueta tom="grave">pedido inteiro</Etiqueta> : <Etiqueta>item</Etiqueta>}</td>
                          <td style={{ ...td, wordBreak: "break-word", maxWidth: 280 }}>{l.itens || "—"}</td>
                          <td style={{ ...td, color: l.registrado ? PALETA.carvao : PALETA.areiaTinta, fontWeight: l.registrado ? 700 : 500 }}>{l.quem}</td>
                          <td style={{ ...td, wordBreak: "break-word", maxWidth: 240, color: l.motivo ? PALETA.carvao : PALETA.areiaTinta }}>{l.motivo || "sem motivo (antigo)"}</td>
                          <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(l.valor)}</td>
                          <td style={td}>
                            {l.alertas.length === 0 ? <span style={{ color: PALETA.areiaTinta }}>—</span>
                              : l.alertas.map((a) => <div key={a} style={{ marginBottom: 2 }}><Etiqueta tom={TOM_DO_ALERTA[a]}>{ROTULO_DO_ALERTA[a]}</Etiqueta></div>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {lista.length > limite && (
                  <div style={{ padding: "0.7rem 0.8rem" }} className="fh-sem-impressao">
                    <button type="button" className="btn btn-outline" style={{ padding: "6px 12px", fontSize: "0.8rem" }} onClick={() => setLimite((n) => n + 200)}>
                      Mostrar mais ({lista.length - limite} restantes) — a lista inteira sai no Excel
                    </button>
                  </div>
                )}
              </Bloco>
            </div>
          )}

          <Bloco titulo="🎁 Cortesias" semPadding
            subtitulo="O que a loja deu de graça (“Dar como cortesia” na edição do pedido ou da rodada): sai da venda e entra no custo.">
            {dados.cortesias.length === 0 ? (
              <Vazio texto="Nenhuma cortesia no período. Para dar uma, abra o pedido › Editar itens › 🎁 Dar como cortesia, no item." />
            ) : (
              <>
                {dados.cortesiasPorMotivo.length > 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0.8rem" }}>
                    {dados.cortesiasPorMotivo.map((m) => (
                      <Etiqueta key={m.motivo}>{m.motivo}: {m.vezes}× · {fmtReais(m.valor)}</Etiqueta>
                    ))}
                  </div>
                )}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 820 }}>
                    <thead>
                      <tr><th style={th}>Quando</th><th style={th}>Pedido</th><th style={th}>Cliente</th><th style={th}>Itens</th><th style={th}>Quem deu</th><th style={th}>Motivo</th><th style={{ ...th, ...num }}>Valor</th></tr>
                    </thead>
                    <tbody>
                      {dados.cortesias.map((c) => (
                        <tr key={c.id}>
                          <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtDia(c.dia).slice(0, 5)} <span style={{ color: PALETA.areiaTinta }}>{c.hora}</span></td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}><strong>{c.numero || "—"}</strong><div style={suave}>{c.onde}</div></td>
                          <td style={{ ...td, wordBreak: "break-word", maxWidth: 160 }}>{c.cliente || "—"}</td>
                          <td style={{ ...td, wordBreak: "break-word", maxWidth: 260 }}>{c.itens}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{c.quem}</td>
                          <td style={{ ...td, wordBreak: "break-word", maxWidth: 220 }}>{c.motivo || "—"}</td>
                          <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(c.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Bloco>

          {dados.porFora.length > 0 && (
            <Bloco titulo="Cancelados por fora" semPadding subtitulo="Não é a mão do caixa: o cliente cancelou no site, a plataforma cancelou, o Pix venceu, o robô encerrou. Não entram nos números acima.">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 420 }}>
                  <thead><tr><th style={th}>Quem cancelou</th><th style={{ ...th, ...num }}>Pedidos</th><th style={{ ...th, ...num }}>Valor</th></tr></thead>
                  <tbody>
                    {dados.porFora.map((x) => (
                      <tr key={x.quem}>
                        <td style={td}>Cancelado {x.quem}</td>
                        <td style={{ ...td, ...num, fontWeight: 800 }}>{x.pedidos}</td>
                        <td style={{ ...td, ...num }}>{fmtReais(x.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Bloco>
          )}
        </>
      )}

      <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.55 }}>
        Entra o que a <strong>loja</strong> cancelou: o pedido ou a rodada da mesa cancelados inteiros e o item tirado (ou a quantidade diminuída) de um pedido que continuou — pelo painel, pelo quadro, pela tela de Mesas ou pelo garçom.
        Cada um conta no dia e na hora em que foi cancelado; os filtros de tipo, canal, marca e horário olham o pedido.
        O <strong>valor</strong> do pedido inteiro é o que ele valia na hora; o do item é o preço × as unidades tiradas.
        <strong> Operador</strong> é quem estava logado (o garçom, pelo link); “Operador não registrado” é cancelamento antigo, de antes de o sistema guardar quem fez.
        <strong> Depois da conta impressa</strong>: a conta da mesa já tinha saído para o cliente. <strong>Depois de pronto</strong>: a cozinha já tinha dado o pedido por pronto (ou ele já tinha saído). <strong>Depois de ir para a cozinha</strong>: a comanda já tinha saído (impressa ou no KDS).
        A <strong>cortesia</strong> deixa o item a R$ 0,00 no pedido: não entra no valor vendido e entra no custo (o estoque não volta). O valor mostrado é o que o item teria custado.
        O % é sobre o valor vendido do período, o mesmo do Vendas por período. Itens tirados antes de 09/10/2026 não entram (o sistema ainda não guardava o valor).
      </p>
    </>
  );
}
