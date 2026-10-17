"use client";
/**
 * O corpo da tela de Reposições — cartões, blocos e lista — a partir da
 * resposta pronta da rota (api/store/relatorios/reposicoes). Separado do
 * ReposicoesClient (filtros e busca) para a tela poder ser desenhada com
 * números de exemplo.
 */
import React, { useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtPct, fmtReais, ROTULO_DO_TIPO, type TipoDeVenda } from "@/lib/relatorios/base";
import { Bloco, Cartao, GradeDeCartoes, Vazio, Variacao } from "@/components/relatorios/ModeloDoRelatorio";
import type { ResultadoDasReposicoes } from "@/lib/relatorios/reposicoes";

export type RespostaDasReposicoes = ResultadoDasReposicoes & {
  lojas: string[];
  periodo: { de: string; ate: string };
  anterior: {
    periodo: { de: string; ate: string };
    ateEsteHorario?: boolean;
    reposicoes: number;
    custoTotal: number;
    custoRefazer: number;
    custoEntrega: number;
    pctDasVendas: number | null;
  };
};

const th: React.CSSProperties = { textAlign: "left", padding: "8px 0.8rem", fontWeight: 800, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em", color: PALETA.areiaTinta, borderBottom: `1px solid ${PALETA.areiaBorda}`, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 0.8rem", borderBottom: `1px solid ${PALETA.areia}`, verticalAlign: "top" };
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const suave: React.CSSProperties = { fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 2 };

const un = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "unidade" : "unidades"}`;
const vezes = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

function Etiqueta({ children, tom = "neutro" }: { children: React.ReactNode; tom?: "neutro" | "atencao" | "troca" }) {
  const c = tom === "atencao" ? { fundo: PALETA.atencaoClaro, borda: PALETA.atencaoBorda, texto: PALETA.atencao }
    : tom === "troca" ? { fundo: PALETA.brasaClaro, borda: PALETA.brasaBorda, texto: PALETA.brasaTinta }
    : { fundo: PALETA.areia, borda: PALETA.areiaBorda, texto: PALETA.areiaTinta };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: c.fundo, border: `1px solid ${c.borda}`, color: c.texto, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** Faltou item: não há custo de refazer — o item já estava na venda original. */
function JaNaVenda() {
  return (
    <>
      <span style={{ color: PALETA.areiaTinta }}>R$ 0,00</span>
      <div style={suave}>já estava na venda</div>
    </>
  );
}

/** O custo que pode faltar: "sem custo cadastrado" no lugar de um R$ 0,00 que não é verdade. */
function Custo({ valor, semCusto }: { valor: number | null; semCusto?: number }) {
  if (valor == null) return <span style={{ color: PALETA.atencao, fontWeight: 700, fontSize: "0.78rem" }}>sem custo cadastrado</span>;
  return (
    <>
      <strong>{fmtReais(valor)}</strong>
      {semCusto ? <div style={{ ...suave, color: PALETA.atencao }}>+ {un(semCusto)} sem custo</div> : null}
    </>
  );
}

export default function CorpoDasReposicoes({ dados }: { dados: RespostaDasReposicoes }) {
  const r = dados.resumo;
  const [todosOsItens, setTodosOsItens] = useState(false);
  const LIMITE = 10;
  const itens = todosOsItens ? dados.porProduto : dados.porProduto.slice(0, LIMITE);
  const faltou = dados.porMotivo.find((m) => m.motivo === "FALTOU");
  const troca = dados.porMotivo.find((m) => m.motivo === "TROCA");
  const ateAgora = dados.anterior.ateEsteHorario ? " (até este mesmo horário)" : "";

  return (
    <>
      <GradeDeCartoes>
        <Cartao rotulo="Reposições" valor={r.reposicoes.toLocaleString("pt-BR")}
          detalhe={<>{faltou?.reposicoes ?? 0} faltou item · {troca?.reposicoes ?? 0} veio errado<br /><Variacao atual={r.reposicoes} anterior={dados.anterior.reposicoes} menorEhMelhor />{ateAgora}</>} />
        <Cartao rotulo="% das vendas" valor={r.pctDasVendas == null ? "—" : fmtPct(r.pctDasVendas, 2)}
          detalhe={r.vendas > 0
            ? `${vezes(r.pedidosAfetados, "pedido precisou", "pedidos precisaram")} de reposição, de ${r.vendas.toLocaleString("pt-BR")} vendas`
            : "sem vendas no período para comparar"} />
        <Cartao rotulo="Custo de refazer (trocas)" valor={fmtReais(r.custoRefazer)} tom={r.itensSemCusto > 0 ? "atencao" : "neutro"}
          detalhe={`${un(troca?.itens ?? 0)} ${(troca?.itens ?? 0) === 1 ? "refeita" : "refeitas"} em troca${r.itensSemCusto > 0 ? `; ${un(r.itensSemCusto)} sem custo cadastrado (fora da soma)` : ", pelo custo dos insumos"}${(faltou?.itens ?? 0) > 0 ? ` · faltou item não soma: já estava na venda` : ""}`} />
        <Cartao rotulo="Custo de entrega" valor={fmtReais(r.custoEntrega)}
          detalhe={r.entregas > 0
            ? `${vezes(r.entregas, "corrida", "corridas")} a mais do motoboy${r.entregasEstimadas ? ` · ${r.entregasEstimadas} estimada${r.entregasEstimadas === 1 ? "" : "s"}` : ""}`
            : "nenhuma reposição foi de entrega"} />
        <Cartao rotulo="Custo total" valor={fmtReais(r.custoTotal)} tom={r.custoTotal > 0 ? "grave" : "neutro"}
          detalhe={<>{r.pctDoFaturamento != null ? <>{fmtPct(r.pctDoFaturamento, 2)} do faturamento ({fmtReais(r.valorVendido)}) · </> : null}<Variacao atual={r.custoTotal} anterior={dados.anterior.custoTotal} menorEhMelhor /></>} />
        <Cartao rotulo="Valor do que foi reposto" valor={fmtReais(r.valorDeVenda)}
          detalhe={`pelo preço do cardápio — referência, não é custo${r.itensSemPreco ? ` · ${un(r.itensSemPreco)} sem preço` : ""}`} />
      </GradeDeCartoes>

      {r.itensSemCusto > 0 && (
        <div role="note" style={{ background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, color: PALETA.carvao, borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1.25rem", fontSize: "0.84rem", lineHeight: 1.5 }}>
          <strong style={{ color: PALETA.atencao }}>{un(r.itensSemCusto)} sem custo cadastrado.</strong>{" "}
          Itens refeitos em troca: o custo de refazer mostra só o que tem custo — nada é inventado. Cadastre a ficha técnica (ou o custo no produto) dos itens da lista
          “Sem custo cadastrado”, no fim da página, para o número ficar completo.
        </div>
      )}

      {r.reposicoes === 0 ? (
        <Bloco><Vazio texto="Nenhuma reposição no período e filtros escolhidos. Ótimo sinal!" /></Bloco>
      ) : (
        <>
          <Bloco titulo="Por motivo" subtitulo="As duas abas do Ver pedido: 📦 Faltou item e 🔄 Veio errado (troca)." semPadding>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 680 }}>
                <thead>
                  <tr>
                    <th style={th}>Motivo</th><th style={{ ...th, ...num }}>Reposições</th><th style={{ ...th, ...num }}>Unidades</th>
                    <th style={{ ...th, ...num }}>Refazer</th><th style={{ ...th, ...num }}>Entrega</th><th style={{ ...th, ...num }}>Custo total</th>
                    <th style={{ ...th, ...num }}>Valor de venda</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porMotivo.map((m) => (
                    <tr key={m.motivo}>
                      <td style={{ ...td, fontWeight: 800 }}>{m.motivo === "TROCA" ? "🔄" : "📦"} {m.rotulo}</td>
                      <td style={{ ...td, ...num, fontWeight: 800 }}>{m.reposicoes}</td>
                      <td style={{ ...td, ...num }}>{m.itens}</td>
                      <td style={{ ...td, ...num }}>{m.motivo === "FALTOU" ? <JaNaVenda /> : <Custo valor={m.itens > 0 && m.itensSemCusto === m.itens ? null : m.custoRefazer} semCusto={m.itensSemCusto < m.itens ? m.itensSemCusto : 0} />}</td>
                      <td style={{ ...td, ...num }}>{fmtReais(m.custoEntrega)}</td>
                      <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(m.custoTotal)}</td>
                      <td style={{ ...td, ...num, color: PALETA.areiaTinta }}>{fmtReais(m.valorDeVenda)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: PALETA.areia }}>
                    <td style={{ ...td, fontWeight: 900 }}>Total</td>
                    <td style={{ ...td, ...num, fontWeight: 900 }}>{r.reposicoes}</td>
                    <td style={{ ...td, ...num, fontWeight: 800 }}>{r.itens}</td>
                    <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(r.custoRefazer)}</td>
                    <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(r.custoEntrega)}</td>
                    <td style={{ ...td, ...num, fontWeight: 900 }}>{fmtReais(r.custoTotal)}</td>
                    <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(r.valorDeVenda)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Bloco>

          <Bloco titulo="Itens que mais dão problema" subtitulo="Os produtos que mais voltaram para a cozinha: em quantas reposições, quantas unidades e o custo." semPadding>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={th}>Produto</th><th style={{ ...th, ...num }}>Reposições</th><th style={{ ...th, ...num }}>Unidades</th>
                    <th style={th}>Motivo</th><th style={{ ...th, ...num }}>Custo de refazer</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((p) => (
                    <tr key={p.chave}>
                      <td style={{ ...td, fontWeight: 700, wordBreak: "break-word" }}>{p.nome}</td>
                      <td style={{ ...td, ...num, fontWeight: 800 }}>{p.vezes}</td>
                      <td style={{ ...td, ...num }}>{p.quantidade}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {p.faltou > 0 && <Etiqueta>📦 faltou {p.faltou}</Etiqueta>}{p.faltou > 0 && p.troca > 0 ? " " : null}
                        {p.troca > 0 && <Etiqueta tom="troca">🔄 troca {p.troca}</Etiqueta>}
                      </td>
                      <td style={{ ...td, ...num }}>{p.troca === 0 ? <JaNaVenda /> : <Custo valor={p.troca === p.quantidadeSemCusto ? null : p.custo} semCusto={p.troca > p.quantidadeSemCusto ? p.quantidadeSemCusto : 0} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dados.porProduto.length > LIMITE && (
              <div style={{ padding: "0.7rem 0.8rem" }} className="fh-sem-impressao">
                <button type="button" className="btn btn-outline" style={{ padding: "6px 12px", fontSize: "0.8rem" }} onClick={() => setTodosOsItens((t) => !t)}>
                  {todosOsItens ? "Mostrar só os que mais voltaram" : `Ver todos (${dados.porProduto.length})`}
                </button>
              </div>
            )}
          </Bloco>

          <Bloco titulo="As reposições" semPadding
            subtitulo={`${vezes(dados.lista.length, "reposição", "reposições")}, das mais recentes para as mais antigas`}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 960 }}>
                <thead>
                  <tr>
                    <th style={th}>Data</th><th style={th}>Nº</th><th style={th}>Pedido</th><th style={th}>Cliente</th>
                    <th style={th}>Motivo</th><th style={th}>Itens</th>
                    <th style={{ ...th, ...num }}>Refazer</th><th style={{ ...th, ...num }}>Entrega</th><th style={{ ...th, ...num }}>Total</th>
                    <th style={th}>Motoboy</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.lista.map((l) => (
                    <tr key={l.id}>
                      <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{l.dia.slice(8, 10)}/{l.dia.slice(5, 7)} <span style={{ color: PALETA.areiaTinta }}>{l.hora}</span></td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}><strong>#{l.numero}</strong></td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        #{l.original}
                        <div style={suave}>{ROTULO_DO_TIPO[l.tipo as TipoDeVenda] || l.tipo}</div>
                      </td>
                      <td style={{ ...td, wordBreak: "break-word", maxWidth: 180 }}>{l.cliente}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{l.motivo === "TROCA" ? <Etiqueta tom="troca">🔄 {l.rotulo}</Etiqueta> : <Etiqueta>📦 {l.rotulo}</Etiqueta>}</td>
                      <td style={{ ...td, wordBreak: "break-word", maxWidth: 300 }}>{l.itens}</td>
                      <td style={{ ...td, ...num }}>{l.motivo === "FALTOU" ? <JaNaVenda /> : <Custo valor={l.custoRefazer} semCusto={l.custoRefazer != null ? l.itensSemCusto : 0} />}</td>
                      <td style={{ ...td, ...num }} title={l.entregaDetalhe}>
                        {l.tipo === "DELIVERY" ? fmtReais(l.custoEntrega) : <span style={{ color: PALETA.areiaTinta }}>—</span>}
                        {l.entregaEstimada && <div style={{ ...suave, color: PALETA.atencao }}>estimada</div>}
                      </td>
                      <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(l.custoTotal)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{l.motoboy || <span style={{ color: PALETA.areiaTinta }}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Bloco>

          {dados.semCusto.length > 0 && (
            <Bloco titulo="Sem custo cadastrado" subtitulo="Estes itens ficaram fora do custo de refazer. Cadastre a ficha técnica ou o custo do produto." semPadding>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem", minWidth: 480 }}>
                  <thead>
                    <tr><th style={th}>Item</th><th style={{ ...th, ...num }}>Unidades</th><th style={th}>O que falta</th></tr>
                  </thead>
                  <tbody>
                    {dados.semCusto.map((x) => (
                      <tr key={`${x.nome}|${x.porque}`}>
                        <td style={{ ...td, fontWeight: 700 }}>{x.nome}</td>
                        <td style={{ ...td, ...num }}>{x.quantidade}</td>
                        <td style={{ ...td, color: PALETA.areiaTinta }}>{x.porque}</td>
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
        A reposição é o pedido de R$ 0,00 que nasce nas abas <strong>📦 Faltou item</strong> e <strong>🔄 Veio errado (troca)</strong> do Ver pedido. Reposição cancelada não entra.
        Ela conta no dia e na hora em que foi lançada; os filtros de tipo, canal e marca olham o pedido original.
        No <strong>faltou item</strong>, o item não tinha sido feito: ele é feito agora pela primeira vez e o custo dele já estava na venda — o prejuízo é só a nova entrega.
        Na <strong>troca</strong>, o errado já foi feito e o certo é feito de novo: o <strong>custo de refazer</strong> é o custo dos insumos do que foi refeito, pela ficha técnica no dia da reposição (sem ficha, o custo cadastrado no produto) — a mesma conta do CMV do DRE, onde ele entra na linha “Reposições (troca)”. Item sem custo cadastrado fica fora da soma e é contado à parte.
        A reposição não conta como venda em nenhum relatório.
        O <strong>custo de entrega</strong> é o que o acerto paga ao motoboy pela corrida a mais (sem motoboy marcado, a taxa da entrega do pedido original). Nas reposições anteriores a 15/10/2026 essa taxa não ficava gravada e foi <strong>estimada</strong> pela do pedido original.
        O <strong>% das vendas</strong> é quantos pedidos precisaram de reposição sobre as vendas do período (as próprias reposições não contam como venda); o <strong>% do faturamento</strong> é o custo total sobre o valor vendido, o mesmo do Vendas por período.
        O valor do que foi reposto é o preço de hoje no cardápio — serve de referência, não é custo.
      </p>
    </>
  );
}
