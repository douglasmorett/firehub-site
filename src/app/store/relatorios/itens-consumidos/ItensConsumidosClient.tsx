"use client";
/**
 * Itens consumidos — o CMV teórico: quanto de cada insumo saiu pelas vendas,
 * pela ficha técnica, e quanto isso pesa no faturamento. A conta mora em
 * lib/relatorios/itens-consumidos.ts; aqui são os filtros, os números e os
 * avisos.
 *
 * O que a tela faz questão de dizer, porque é onde o CMV engana: item vendido
 * sem baixa não gera consumo. Com metade do vendido sem ficha, "custo ÷
 * faturamento" sai pela metade do real — então a cobertura (quanto do vendido
 * BAIXOU estoque) e o CMV só dessa parte ficam ao lado, e os mais vendidos sem
 * ficha vêm listados para cadastrar. A cobertura é pela baixa, não pelo
 * cadastro de hoje: a loja que cadastra a ficha na quarta não pode ver as
 * vendas de segunda como "cobertas" (sem custo nenhum). Em 24/09/2026 NENHUMA
 * loja tinha ficha cadastrada: para a maioria, esta tela começa pela lista do
 * que cadastrar.
 */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtPct, fmtQtd, fmtReais } from "@/lib/relatorios/base";
import type { DiaDoConsumo, LinhaDeInsumo, ProdutoSemFicha, ResultadoDoConsumo } from "@/lib/relatorios/itens-consumidos";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = ResultadoDoConsumo & {
  lojas: string[];
  periodo: { de: string; ate: string };
  insumosCadastrados: number;
  temFicha: boolean;
};

type Ordem = "custo" | "quantidade" | "nome";

const th: React.CSSProperties = { padding: "8px 0.9rem", fontWeight: 800, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 0.9rem", fontVariantNumeric: "tabular-nums" };
const num: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

/** Custo por grama é R$ 0,0450: com duas casas viraria "R$ 0,05". */
function fmtCustoUnitario(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1) return fmtReais(n);
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** 12.345 g também em kg — o lojista compra queijo em quilo, não em grama. */
function emUnidadeMaior(q: number, unidade: string): string | null {
  if (Math.abs(q) < 1000) return null;
  if (unidade === "g") return `${fmtQtd(q / 1000)} kg`;
  if (unidade === "ml") return `${fmtQtd(q / 1000)} l`;
  return null;
}

const ROTULO_ORIGEM: Record<ProdutoSemFicha["origem"], string> = {
  cardapio: "Cardápio",
  integracao: "Integração",
  removido: "Produto apagado",
};

function Aviso({ children, tom = "atencao" }: { children: React.ReactNode; tom?: "atencao" | "neutro" }) {
  const cor = tom === "atencao"
    ? { fundo: PALETA.atencaoClaro, borda: PALETA.atencaoBorda, texto: PALETA.carvao2 }
    : { fundo: PALETA.areia, borda: PALETA.areiaBorda, texto: PALETA.carvao2 };
  return (
    <div className="fh-relatorio-bloco" style={{ background: cor.fundo, border: `1px solid ${cor.borda}`, color: cor.texto, borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.85rem", lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

export default function ItensConsumidosClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "7d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("itens-consumidos", query);

  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("custo");
  const [verTodosSemFicha, setVerTodosSemFicha] = useState(false);

  const nomeDoCanal = useMemo(() => new Map((opcoes?.canais || []).map((c) => [c.chave, c.rotulo])), [opcoes]);

  const insumos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const lista = (dados?.insumos || []).filter((i) => !t || i.nome.toLowerCase().includes(t));
    const copia = [...lista];
    if (ordem === "nome") copia.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    else if (ordem === "quantidade") copia.sort((a, b) => b.quantidade - a.quantidade);
    return copia;
  }, [dados, busca, ordem]);

  const semFicha = dados?.semFicha.produtos || [];
  const semFichaVisiveis = verTodosSemFicha ? semFicha : semFicha.slice(0, 15);
  // Sem venda no período não há cobertura para julgar: o cartão fica neutro.
  const cobertura = dados?.vendas.coberturaPct ?? null;
  const tomDaCobertura = cobertura === null ? "neutro" : cobertura >= 95 ? "ok" : cobertura >= 60 ? "atencao" : "grave";
  const totalDosItens = dados?.vendas.totalDosItens || 0;
  const pctSemFicha = totalDosItens > 0 ? ((dados?.semFicha.valor || 0) / totalDosItens) * 100 : 0;
  const temConsumo = (dados?.insumos.length || 0) > 0;
  const maiorCustoDoDia = Math.max(0, ...(dados?.porDia || []).map((d) => d.custo));

  const botaoOrdem = (o: Ordem, rotulo: string, alinhar: "left" | "right" = "right") => (
    <th style={{ ...th, textAlign: alinhar }} aria-sort={ordem === o ? (o === "nome" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => setOrdem(o)}
        style={{ border: "none", background: "none", padding: 0, font: "inherit", color: ordem === o ? PALETA.carvao : "inherit", textTransform: "inherit", letterSpacing: "inherit", fontWeight: 800, cursor: "pointer" }}>
        {rotulo}{ordem === o ? (o === "nome" ? " ▴" : " ▾") : ""}
      </button>
    </th>
  );

  return (
    <ModeloDoRelatorio
      titulo="Itens consumidos"
      descricao="Quanto de cada insumo saiu do estoque pelas vendas, pela ficha técnica — e quanto isso custa perto do que você faturou (o CMV teórico)."
      slug="itens-consumidos" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje}>
        <p style={{ margin: 0, fontSize: "0.78rem", color: PALETA.areiaTinta, borderTop: `1px dashed ${PALETA.areiaBorda}`, paddingTop: "0.7rem", lineHeight: 1.5 }}>
          Tudo vale pelo <strong>pedido</strong> que gerou a baixa: o período (o dia do pedido, o mesmo do faturamento), o tipo de venda, o canal, a marca e o horário.
        </p>
      </BarraDeFiltros>

      {dados && !dados.temFicha && (
        <Bloco titulo="Comece pela ficha técnica" subtitulo="Sem ficha, a venda não tira nada do estoque — e não há consumo para mostrar.">
          <p style={{ margin: "0 0 0.8rem", fontSize: "0.88rem", lineHeight: 1.6, color: PALETA.carvao2 }}>
            {dados.insumosCadastrados === 0
              ? "A loja ainda não tem insumos cadastrados no Estoque nem produtos com ficha técnica. "
              : `A loja tem ${dados.insumosCadastrados} insumo${dados.insumosCadastrados === 1 ? "" : "s"} no Estoque, mas nenhum produto tem ficha técnica. `}
            A ficha diz quanto de cada insumo vai em cada produto; a partir do cadastro, cada venda baixa os insumos do estoque e o consumo aparece aqui.
            A ficha vale da hora do cadastro em diante — não refaz as vendas que já passaram. Comece pelos mais vendidos da lista abaixo.
          </p>
          <Link href="/store/estoque" className="btn btn-outline" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            Abrir Estoque → Fichas técnicas
          </Link>
        </Bloco>
      )}

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Custo dos insumos" valor={fmtReais(dados.total.custo)}
            detalhe={temConsumo ? `${dados.total.insumos} insumo${dados.total.insumos === 1 ? "" : "s"} · ${dados.total.pedidosComBaixa} pedido${dados.total.pedidosComBaixa === 1 ? "" : "s"} com baixa` : "Nenhuma baixa no período"} />
          <Cartao rotulo="CMV sobre o faturamento" valor={dados.cmv.sobreFaturamento === null ? "—" : fmtPct(dados.cmv.sobreFaturamento)}
            detalhe={`Faturamento ${fmtReais(dados.vendas.faturamento)} · ${dados.vendas.pedidos.toLocaleString("pt-BR")} pedido${dados.vendas.pedidos === 1 ? "" : "s"}`} />
          <Cartao rotulo="CMV das vendas com baixa" valor={dados.cmv.sobreItensComBaixa === null ? "—" : fmtPct(dados.cmv.sobreItensComBaixa)}
            detalhe="O custo sobre o que baixou estoque — o número que vale enquanto nem tudo tem ficha" />
          <Cartao rotulo="Vendas que baixaram estoque" valor={cobertura === null ? "—" : fmtPct(cobertura, 0)} tom={tomDaCobertura}
            detalhe={cobertura === null ? "Nenhuma venda no período" : `${fmtReais(dados.vendas.valorComBaixa)} de ${fmtReais(dados.vendas.totalDosItens)} em itens`} />
        </GradeDeCartoes>
      )}

      {dados && (dados.temFicha || temConsumo) && (
        <div style={{ display: "grid", gap: "0.6rem", marginBottom: "1.25rem" }}>
          {dados.semFicha.valor > 0 && (
            <Aviso>
              <strong>{pctSemFicha < 1 ? "Menos de 1%" : fmtPct(pctSemFicha, 0)} do que foi vendido não tem ficha técnica</strong> ({fmtReais(dados.semFicha.valor)}):
              essas vendas não tiram insumo do estoque, e o CMV sobre o faturamento sai menor que o real. A lista está abaixo.
            </Aviso>
          )}
          {dados.vendas.pedidosComFichaSemBaixa > 0 && (
            <Aviso>
              <strong>{dados.vendas.pedidosComFichaSemBaixa} pedido{dados.vendas.pedidosComFichaSemBaixa === 1 ? "" : "s"} com item de ficha técnica sem baixa no estoque</strong>{" "}
              ({fmtReais(dados.vendas.valorComFichaSemBaixa)} em itens, fora do CMV das vendas com baixa).
              Quase sempre é ficha cadastrada depois da venda — a baixa usa a ficha da hora da venda, e a ficha nova não refaz o passado — ou pedido ainda não aceito.
              Se a ficha é antiga, é baixa que falhou: vale conferir o histórico do Estoque.
            </Aviso>
          )}
          {dados.vendas.pedidosComBaixaSemFichaHoje > 0 && (
            <Aviso>
              <strong>{dados.vendas.pedidosComBaixaSemFichaHoje} pedido{dados.vendas.pedidosComBaixaSemFichaHoje === 1 ? " baixou" : "s baixaram"} estoque sem nenhum item com ficha técnica hoje</strong>{" "}
              — ficha apagada ou trocada depois da venda. O custo deles está no total; como a baixa não diz de qual item saiu, o pedido inteiro entra na base do CMV das vendas com baixa.
            </Aviso>
          )}
          {dados.total.insumosSemCusto > 0 && (
            <Aviso>
              <strong>{dados.total.insumosSemCusto} insumo{dados.total.insumosSemCusto === 1 ? "" : "s"} sem custo cadastrado</strong> — aparece{dados.total.insumosSemCusto === 1 ? "" : "m"} na tabela
              com a quantidade, mas fica{dados.total.insumosSemCusto === 1 ? "" : "m"} fora do custo total, e o CMV sai menor que o real. O custo entra pela nota de entrada ou no cadastro do insumo, em Estoque.
            </Aviso>
          )}
        </div>
      )}

      {dados && (
        <Bloco titulo="Insumos consumidos" semPadding
          subtitulo="Custo unitário = o custo ATUAL do insumo (o do último recebimento), não o do dia da venda."
          acoes={
            <input name="busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo…" aria-label="Buscar insumo"
              className="fh-sem-impressao"
              style={{ padding: "7px 12px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.85rem", fontFamily: "inherit", width: "100%", maxWidth: 260, boxSizing: "border-box" }} />
          }>
          {/* Vazio fora da tabela: dentro dela o texto centraliza nos 640px
              mínimos da tabela e some da tela do celular. */}
          {insumos.length === 0 ? (
            <Vazio texto={busca ? `Nenhum insumo com “${busca}”.`
              : dados.temFicha ? "Nenhum insumo saiu pelas vendas neste período e filtros escolhidos."
              : "Nenhum insumo saiu pelas vendas: nenhum produto tem ficha técnica ainda."} />
          ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 640 }}>
              <thead>
                <tr style={{ color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                  {botaoOrdem("nome", "Insumo", "left")}
                  <th style={{ ...th, textAlign: "left" }}>Unidade</th>
                  {botaoOrdem("quantidade", "Qtde consumida")}
                  <th style={{ ...th, textAlign: "right" }}>Custo unit.</th>
                  {botaoOrdem("custo", "Custo total")}
                  <th style={{ ...th, textAlign: "right" }}>% do custo</th>
                  <th style={{ ...th, textAlign: "right" }}>Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {insumos.map((i: LinhaDeInsumo) => {
                  const maior = emUnidadeMaior(i.quantidade, i.unidade);
                  return (
                    <tr key={i.chave} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                      <td style={{ ...td, fontWeight: 700, minWidth: 150 }}>
                        {i.nome}
                        {!i.ativo && <span style={{ marginLeft: 6, fontSize: "0.72rem", color: PALETA.areiaTinta, fontWeight: 600 }}>(inativo)</span>}
                      </td>
                      <td style={{ ...td, color: PALETA.areiaTinta }}>{i.unidade}</td>
                      <td style={{ ...num, fontWeight: 700 }}>
                        {fmtQtd(i.quantidade)}
                        {maior && <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, fontWeight: 500 }}>{maior}</div>}
                      </td>
                      <td style={num}>{fmtCustoUnitario(i.custoUnitario)}</td>
                      <td style={{ ...num, fontWeight: 700, color: i.custo === null ? PALETA.atencao : PALETA.carvao }}
                        title={i.custo === null ? "Insumo sem custo cadastrado — fora do total" : undefined}>
                        {i.custo === null ? "sem custo" : fmtReais(i.custo)}
                      </td>
                      <td style={{ ...num, minWidth: 120 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                          <div style={{ flex: 1, maxWidth: 80 }}><BarraDePct pct={i.pct} /></div>
                          <span style={{ color: PALETA.areiaTinta, minWidth: 44 }}>{i.custo === null ? "—" : fmtPct(i.pct)}</span>
                        </div>
                      </td>
                      <td style={{ ...num, color: PALETA.areiaTinta }}>{i.pedidos.toLocaleString("pt-BR")}</td>
                    </tr>
                  );
                })}
              </tbody>
              {temConsumo && !busca && (
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${PALETA.areiaBorda}`, background: PALETA.areia }}>
                    <td style={{ ...td, fontWeight: 900 }} colSpan={4}>Total</td>
                    <td style={{ ...num, fontWeight: 900 }}>{fmtReais(dados.total.custo)}</td>
                    <td style={{ ...num, color: PALETA.areiaTinta }}>100%</td>
                    <td style={{ ...num, color: PALETA.areiaTinta }}>{dados.total.pedidosComBaixa.toLocaleString("pt-BR")}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          )}
        </Bloco>
      )}

      {dados && temConsumo && dados.porDia.length > 1 && dados.porDia.length <= 62 && (
        <Bloco titulo="Por dia" subtitulo="Custo dos insumos das vendas de cada dia e o CMV sobre o faturamento do mesmo dia (o dia do pedido; vira às 5h).">
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 96px 56px", gap: 10, fontSize: "0.68rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              <span>Dia</span><span /><span style={{ textAlign: "right" }}>Custo</span><span style={{ textAlign: "right" }}>CMV</span>
            </div>
            {dados.porDia.map((d: DiaDoConsumo) => (
              <div key={d.dia} style={{ display: "grid", gridTemplateColumns: "44px 1fr 96px 56px", gap: 10, alignItems: "center", fontSize: "0.82rem", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: PALETA.carvao2, fontWeight: 700 }}>{fmtDia(d.dia).slice(0, 5)}</span>
                <div style={{ height: 10, background: PALETA.areia, borderRadius: 999, overflow: "hidden" }} aria-hidden>
                  <div style={{ height: "100%", width: `${maiorCustoDoDia > 0 ? Math.max(0, (d.custo / maiorCustoDoDia) * 100) : 0}%`, background: PALETA.brasa, borderRadius: 999 }} />
                </div>
                <span style={{ textAlign: "right", fontWeight: 700 }}>{fmtReais(d.custo)}</span>
                <span style={{ textAlign: "right", color: PALETA.areiaTinta }}>{d.cmvPct === null ? "—" : fmtPct(d.cmvPct)}</span>
              </div>
            ))}
          </div>
        </Bloco>
      )}

      {dados && semFicha.length > 0 && (
        <Bloco semPadding
          titulo={`Vendidos sem ficha técnica (${semFicha.length})`}
          subtitulo={`${fmtQtd(dados.semFicha.quantidade)} itens · ${fmtReais(dados.semFicha.valor)} que não tiraram nada do estoque. Os mais vendidos primeiro.`}
          acoes={<Link href="/store/estoque" className="fh-sem-impressao" style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.marca, textDecoration: "none" }}>Cadastrar fichas →</Link>}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", minWidth: 640 }}>
              <thead>
                <tr style={{ color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                  <th style={{ ...th, textAlign: "left" }}>Produto</th>
                  <th style={{ ...th, textAlign: "left" }}>Origem</th>
                  <th style={{ ...th, textAlign: "right" }}>Qtde</th>
                  <th style={{ ...th, textAlign: "right" }}>Valor</th>
                  <th style={{ ...th, textAlign: "left" }}>O que fazer</th>
                </tr>
              </thead>
              <tbody>
                {semFichaVisiveis.map((p) => {
                  return (
                    <tr key={p.chave} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                      <td style={{ ...td, fontWeight: 700 }}>{p.nome}</td>
                      <td style={{ ...td, color: PALETA.carvao2, minWidth: 150 }}>
                        {ROTULO_ORIGEM[p.origem]}
                        {p.canais.length > 0 && (
                          <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>{p.canais.map((c) => nomeDoCanal.get(c) || c).join(", ")}</div>
                        )}
                      </td>
                      <td style={{ ...num, fontWeight: 700 }}>{fmtQtd(p.quantidade)}</td>
                      <td style={num}>{fmtReais(p.valor)}</td>
                      <td style={{ ...td, fontSize: "0.8rem", color: p.alerta ? PALETA.atencao : PALETA.carvao2, fontWeight: p.alerta ? 700 : 500, minWidth: 220 }}>{p.oQueFazer}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {semFicha.length > 15 && (
            <div className="fh-sem-impressao" style={{ padding: "0.7rem 1rem", borderTop: `1px solid ${PALETA.areia}` }}>
              <button type="button" className="btn btn-outline" style={{ padding: "6px 12px" }} onClick={() => setVerTodosSemFicha((v) => !v)}>
                {verTodosSemFicha ? "Mostrar só os 15 primeiros" : `Ver todos (${semFicha.length})`}
              </button>
            </div>
          )}
        </Bloco>
      )}

      {dados && (
        <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.6 }}>
          Consumo = as baixas automáticas do estoque pela ficha técnica, menos as devoluções, e conta no dia do pedido (o mesmo do faturamento).
          Pedido cancelado não entra (nem a baixa, nem a devolução). Pedido editado pela tela de pedidos conta a versão que valeu, porque a edição devolve e baixa de novo;
          na mesa não: tirar item de um lançamento pelo painel de mesas não devolve o insumo (só cancelar o lançamento inteiro devolve), e o consumo da mesa editada fica maior que o vendido.
          Perda, entrada de nota e ajuste manual não são consumo de venda e ficam no Estoque.
          O faturamento é o total dos pedidos do período; na mesa, o valor dos lançamentos, sem os 10% de serviço e a gorjeta.
          {(dados.foraDaConta.cancelados + dados.foraDaConta.foraDosFiltros + dados.foraDaConta.foraDaVenda + dados.foraDaConta.antesDoPeriodo + dados.foraDaConta.semPedido) > 0 && (
            <> Baixas feitas no período que ficaram de fora, em pedidos: {[
              dados.foraDaConta.cancelados && `${dados.foraDaConta.cancelados} cancelado(s)`,
              dados.foraDaConta.foraDosFiltros && `${dados.foraDaConta.foraDosFiltros} fora dos filtros`,
              dados.foraDaConta.foraDaVenda && `${dados.foraDaConta.foraDaVenda} ainda não pago(s)`,
              dados.foraDaConta.antesDoPeriodo && `${dados.foraDaConta.antesDoPeriodo} feito(s) antes do período (contam no dia do pedido)`,
              dados.foraDaConta.semPedido && `${dados.foraDaConta.semPedido} apagado(s)`,
            ].filter(Boolean).join(", ")}.</>
          )}
        </p>
      )}
    </ModeloDoRelatorio>
  );
}
