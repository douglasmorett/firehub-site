"use client";
/**
 * Vendas por forma de pagamento — a tela. A conta mora em
 * lib/relatorios/formas-de-pagamento.ts (a régua do fechamento de caixa); aqui
 * são os filtros, as três faixas (recebido na loja, pago online, sem dinheiro
 * no dia) e o gráfico dia a dia que cada forma abre.
 *
 * O que a Saipos não mostra e o lojista pergunta quando os números não batem:
 * por que o total dos pagamentos não é o total das vendas (taxa de serviço,
 * gorjeta, desconto da mesa, mesa que fechou noutro dia…), de qual canal veio
 * cada forma e como ela estava escrita — "Cartão Deb Master" da Wabiz somado
 * no débito, à vista.
 *
 * A contagem da tabela é de CONTAS pagas (o pedido, ou a conta da mesa no dia
 * em que fechou) e a média é valor ÷ contas; os pagamentos (partes do
 * dividido, baixas da mesa) aparecem no toque quando diferem. "Vendas" e
 * "ticket médio" ficam só no cartão Total das vendas, com os números da régua
 * única — os mesmos dos outros relatórios. Com a mesma palavra nos dois
 * lugares, a Pastel da Paulista em 11/09/2026 via "97 pagamentos em 92 vendas"
 * e ticket de R$ 68,70 na tabela contra 93 vendas e R$ 66,17 no resto.
 */
import React, { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { DIAS_CURTOS, fmtDia, fmtPct, fmtReais } from "@/lib/relatorios/base";
import type { GrupoDaForma, LinhaDaForma, LinhaDeDetalhe, ResultadoDasFormas } from "@/lib/relatorios/formas-de-pagamento";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = ResultadoDasFormas & { lojas: string[]; periodo: { de: string; ate: string } };

/**
 * Uma cor por faixa, sem arco-íris: carvão para o que a loja recebeu, brasa
 * para o que vem do app (quase tudo entrega), areia para o que ninguém pagou
 * na hora. O âmbar fica só para o "não identificado" com valor — é estado.
 */
const COR_DO_GRUPO: Record<GrupoDaForma, string> = { LOJA: PALETA.carvao2, ONLINE: PALETA.brasa, SEM_DINHEIRO: PALETA.areiaTinta };

const num = (n: number) => n.toLocaleString("pt-BR");
/** No toque/hover da contagem: as partes do dividido e as baixas da mesa, quando não são uma por conta. */
const dicaDosPagamentos = (pagamentos: number, contas: number) =>
  pagamentos !== contas ? `${num(pagamentos)} pagamentos em ${num(contas)} contas (pagamento dividido ou mesa paga em partes)` : undefined;
const semana = (dia: string) => DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()];

/**
 * "494 vendas · 635 lançamentos": as vendas da régua única
 * (lib/relatorios/regua-da-venda.ts — a mesa conta uma vez, o mesmo número do
 * Vendas por período) e, quando a mesa junta rodadas, os pedidos lançados.
 */
function textoDasVendas(v: { atendimentos: number; pedidos: number; ticketMedio: number }): string {
  const vendas = `${num(v.atendimentos)} venda${v.atendimentos === 1 ? "" : "s"}`;
  const ticket = v.atendimentos ? ` · ticket ${fmtReais(v.ticketMedio)}` : "";
  return v.pedidos !== v.atendimentos ? `${vendas} · ${num(v.pedidos)} lançamentos (a mesa conta uma vez)${ticket}` : `${vendas}${ticket}`;
}
const celula: React.CSSProperties = { padding: "9px 0.9rem", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

export default function FormasDePagamentoClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "7d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("formas-de-pagamento", query);
  const [aberta, setAberta] = useState<string | null>(null);
  const alternar = (k: string) => setAberta((a) => (a === k ? null : k));

  const grupo = (k: GrupoDaForma) => dados?.grupos.find((g) => g.chave === k);
  const outros = dados?.formas.find((f) => f.chave === "OUTROS");
  const semNada = dados && dados.total.pagamentos === 0 && dados.vendas.pedidos === 0;
  const plural = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`;
  const foraDaConta = dados ? [
    dados.foraDaVenda.cancelados.pedidos > 0 ? `${plural(dados.foraDaVenda.cancelados.pedidos, "pedido cancelado", "pedidos cancelados")} (${fmtReais(dados.foraDaVenda.cancelados.valor)})` : "",
    dados.foraDaVenda.aguardandoPagamento.pedidos > 0 ? `${plural(dados.foraDaVenda.aguardandoPagamento.pedidos, "pedido aguardando pagamento", "pedidos aguardando pagamento")} (${fmtReais(dados.foraDaVenda.aguardandoPagamento.valor)})` : "",
  ].filter(Boolean).join(" e ") : "";

  return (
    <ModeloDoRelatorio
      titulo="Vendas por forma de pagamento"
      descricao="Quanto entrou em dinheiro, Pix, crédito, débito e vale — separado do que foi pago no app e vem pelo repasse. A leitura das formas é a mesma do fechamento de caixa."
      slug="formas-de-pagamento" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      {/* Na tela estreita some o ticket médio, a barrinha e a explicação da faixa, e o respiro das células encolhe:
          forma, quantidade, valor e % cabem num celular de 360 px sem rolar de lado. */}
      <style>{`
        @media (max-width: 560px) {
          .fh-fp-largo { display: none !important; }
          .fh-fp-curto { display: inline !important; }
          .fh-fp-tabela th, .fh-fp-tabela td { padding-left: 0.45rem !important; padding-right: 0.45rem !important; }
        }
        .fh-fp-linha:hover { background: ${PALETA.areia} !important; }
        .fh-fp-linha:focus-visible { outline: 2px solid ${PALETA.carvao}; outline-offset: -2px; }
      `}</style>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 1rem", alignItems: "center", borderTop: `1px dashed ${PALETA.areiaBorda}`, paddingTop: "0.8rem", fontSize: "0.82rem", color: PALETA.carvao2 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
            <span aria-hidden style={{ color: PALETA.ok, fontWeight: 900 }}>✓</span> Ignorar vendas canceladas
          </span>
          <span style={{ color: PALETA.areiaTinta }}>
            Sempre ligado: cancelado não é dinheiro.{foraDaConta ? ` Ficaram de fora ${foraDaConta}.` : ""}
          </span>
        </div>
      </BarraDeFiltros>

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Total dos pagamentos" valor={fmtReais(dados.total.valor)}
            detalhe={`${plural(dados.total.pagamentos, "pagamento", "pagamentos")}${dados.total.contas !== dados.total.pagamentos ? ` em ${plural(dados.total.contas, "conta", "contas")}` : ""}`} />
          <Cartao rotulo="Recebido na loja" valor={fmtReais(grupo("LOJA")?.valor ?? 0)} detalhe={`${fmtPct(grupo("LOJA")?.pct ?? 0)} · gaveta, maquininha e Pix`} />
          <Cartao rotulo="Pago online" valor={fmtReais(grupo("ONLINE")?.valor ?? 0)} detalhe={`${fmtPct(grupo("ONLINE")?.pct ?? 0)} · vem pelo repasse`} />
          <Cartao rotulo="Sem dinheiro no dia" valor={fmtReais(grupo("SEM_DINHEIRO")?.valor ?? 0)}
            tom={(outros?.valor ?? 0) > 0 ? "atencao" : "neutro"}
            detalhe={(outros?.valor ?? 0) > 0 ? `${fmtReais(outros!.valor)} em forma não identificada` : "Fiado e forma não identificada"} />
          <Cartao rotulo="Total das vendas" valor={fmtReais(dados.vendas.valor)} detalhe={textoDasVendas(dados.vendas)} />
        </GradeDeCartoes>
      )}

      {dados && dados.diferenca.linhas.length > 0 && <AvisoDaDiferenca dados={dados} />}

      {dados && (
        <Bloco titulo="Por forma de pagamento" subtitulo="Toque numa forma para ver o dia a dia, de qual canal veio e como estava escrita." semPadding>
          {semNada ? <Vazio /> : (
            <div style={{ overflowX: "auto" }}>
              <table className="fh-fp-tabela" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                <thead>
                  <tr style={{ background: PALETA.areia, color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <th style={{ ...celula, textAlign: "left", fontWeight: 800 }}>Forma</th>
                    <th style={{ ...celula, fontWeight: 800 }} title="Pedidos ou contas de mesa pagos nesta forma (a mesa no dia em que fechou). Não é o número de vendas: esse está no cartão Total das vendas.">
                      <span className="fh-fp-largo">Contas</span><span className="fh-fp-curto" style={{ display: "none" }}>Qtd.</span>
                    </th>
                    <th style={{ ...celula, fontWeight: 800 }}>Valor</th>
                    <th className="fh-fp-largo" style={{ ...celula, fontWeight: 800 }} title="Valor ÷ contas: quanto cada conta pagou nesta forma, em média">Média por conta</th>
                    <th style={{ ...celula, fontWeight: 800, width: "22%" }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.grupos.map((g) => (
                    <React.Fragment key={g.chave}>
                      <tr style={{ background: "#FDFBF9", borderTop: `1px solid ${PALETA.areiaBorda}` }}>
                        <td style={{ padding: "10px 0.9rem 8px", fontWeight: 900 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: COR_DO_GRUPO[g.chave], flexShrink: 0 }} />
                            {g.rotulo}
                          </span>
                          <div className="fh-fp-largo" style={{ fontSize: "0.74rem", fontWeight: 500, color: PALETA.areiaTinta, marginTop: 2, whiteSpace: "normal" }}>{g.explicacao}</div>
                        </td>
                        <td style={{ ...celula, fontWeight: 800 }} title={dicaDosPagamentos(g.pagamentos, g.contas)}>{num(g.contas)}</td>
                        <td style={{ ...celula, fontWeight: 900 }}>{fmtReais(g.valor)}</td>
                        <td className="fh-fp-largo" style={{ ...celula, color: PALETA.carvao2 }}>{g.contas ? fmtReais(g.mediaPorConta) : ""}</td>
                        <td style={{ ...celula, fontWeight: 800 }}>{fmtPct(g.pct)}</td>
                      </tr>
                      {dados.formas.filter((f) => f.grupo === g.chave).map((f) => (
                        <LinhaDaFormaNaTabela key={f.chave} forma={f} dias={dados.dias} aberta={aberta === f.chave} alternar={() => alternar(f.chave)}
                          nota={f.chave === "DINHEIRO" && dados.mesas.troco.valor > 0
                            ? `Já sem o troco devolvido nas mesas: ${fmtReais(dados.mesas.troco.valor)} em ${plural(dados.mesas.troco.contas, "conta", "contas")}. A baixa da mesa grava a nota que o cliente entregou; o que passou da conta voltou como troco, da gaveta.`
                            : undefined} />
                      ))}
                      {g.chave === "ONLINE" && dados.cupomDaPlataforma.valor > 0 && (
                        <tr>
                          <td colSpan={5} style={{ padding: "4px 0.9rem 10px 2.6rem", fontSize: "0.76rem", color: PALETA.areiaTinta, whiteSpace: "normal" }}>
                            Fora desta soma: <strong style={{ color: PALETA.carvao2 }}>{fmtReais(dados.cupomDaPlataforma.valor)}</strong> de cupom pago pelas plataformas
                            em {num(dados.cupomDaPlataforma.pedidos)} pedidos ({dados.cupomDaPlataforma.porCanal.map((c) => `${c.rotulo} ${fmtReais(c.valor)}`).join(" · ")}).
                            Não é pagamento do cliente, mas a plataforma paga à loja junto com o repasse.
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <LinhaDoTotal dados={dados} aberta={aberta === "TOTAL"} alternar={() => alternar("TOTAL")} />
                  <tr style={{ background: PALETA.areia }}>
                    <td colSpan={5} style={{ padding: "10px 0.9rem", fontSize: "0.84rem", color: PALETA.carvao2, whiteSpace: "normal" }}>
                      Total das vendas: <strong>{fmtReais(dados.vendas.valor)}</strong> ({textoDasVendas(dados.vendas)})
                      {dados.diferenca.linhas.length === 0
                        ? <span style={{ color: PALETA.ok, fontWeight: 700 }}> · igual ao total dos pagamentos</span>
                        : <span style={{ color: PALETA.areiaTinta }}> · a diferença está explicada acima</span>}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Bloco>
      )}

      <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.55 }}>
        <strong>Mesa:</strong> o pedido lançado numa conta de mesa não guarda a forma — ela é registrada no fechamento da conta, junto com a taxa
        de serviço e a gorjeta. Por isso a mesa entra aqui pelas baixas das contas <strong>fechadas</strong> no período, no dia em que fecharam
        {dados && dados.mesas.fechadas > 0 ? ` (${num(dados.mesas.fechadas)} conta${dados.mesas.fechadas === 1 ? "" : "s"}, ${fmtReais(dados.mesas.valor)} pagos)` : ""};
        o pedido de mesa conta no total das vendas, nunca como pagamento. A baixa grava o que o cliente entregou: o troco devolvido
        {dados && dados.mesas.troco.valor > 0 ? ` (${fmtReais(dados.mesas.troco.valor)} em ${plural(dados.mesas.troco.contas, "conta", "contas")})` : ""} sai
        do Dinheiro. <strong>Pagamento dividido</strong> conta em cada forma pelo valor dela, e a conta uma vez; a média por conta é valor ÷
        contas. As <strong>contas</strong> da tabela não são as vendas: a mesa entra no dia em que fechou e a cortesia de R$ 0 não tem
        pagamento — vendas e ticket médio estão no cartão Total das vendas, iguais aos dos outros relatórios. O dia vira às 5h: a venda da 1h da manhã é do dia anterior.
      </p>
    </ModeloDoRelatorio>
  );
}

/** Por que o total dos pagamentos não é o total das vendas — linha a linha. */
function AvisoDaDiferenca({ dados }: { dados: Resposta }) {
  const d = dados.diferenca;
  const semExplicacao = d.linhas.find((l) => l.chave === "OUTROS");
  return (
    <div role="note" className="fh-relatorio-bloco" style={{
      background: semExplicacao ? PALETA.atencaoClaro : "#fff", border: `1px solid ${semExplicacao ? PALETA.atencaoBorda : PALETA.areiaBorda}`,
      borderRadius: 14, padding: "0.9rem 1.1rem", marginBottom: "1.25rem", fontSize: "0.85rem", color: PALETA.carvao2,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 700, color: PALETA.carvao }}>
        <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
        <span>
          O total dos pagamentos ({fmtReais(dados.total.valor)}) é {fmtReais(Math.abs(d.valor))} {d.valor > 0 ? "maior" : "menor"} que o total
          das vendas ({fmtReais(dados.vendas.valor)}). Por quê:
        </span>
      </div>
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
        {d.linhas.map((l) => (
          <li key={l.chave} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "2px 12px", paddingLeft: 24 }}>
            <span style={{ fontWeight: 700, color: l.chave === "OUTROS" ? PALETA.atencao : PALETA.carvao }}>
              {l.rotulo}{l.quantidade > 0 ? <span style={{ fontWeight: 500, color: PALETA.areiaTinta }}> · {num(l.quantidade)}</span> : null}
            </span>
            <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{l.valor > 0 ? "+" : "−"} {fmtReais(Math.abs(l.valor))}</span>
            <span style={{ gridColumn: "1 / -1", fontSize: "0.76rem", color: PALETA.areiaTinta }}>{l.explicacao}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LinhaDaFormaNaTabela({ forma: f, dias, aberta, alternar, nota }: { forma: LinhaDaForma; dias: string[]; aberta: boolean; alternar: () => void; nota?: string }) {
  const vazia = f.pagamentos === 0;
  const alerta = f.chave === "OUTROS" && f.valor > 0;
  const cor = COR_DO_GRUPO[f.grupo];
  return (
    <>
      <tr className={vazia ? undefined : "fh-fp-linha"}
        onClick={vazia ? undefined : alternar}
        onKeyDown={vazia ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(); } }}
        tabIndex={vazia ? undefined : 0}
        aria-expanded={vazia ? undefined : aberta}
        style={{ borderTop: `1px solid ${PALETA.areia}`, cursor: vazia ? "default" : "pointer", color: vazia ? PALETA.areiaTinta : PALETA.carvao, background: aberta ? PALETA.areia : "#fff" }}>
        <td style={{ padding: "9px 0.9rem 9px 1.1rem", fontWeight: 700 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {vazia
              ? <span style={{ width: 14, flexShrink: 0 }} />
              : <ChevronRight size={14} aria-hidden style={{ flexShrink: 0, transition: "transform 0.15s", transform: aberta ? "rotate(90deg)" : "none" }} />}
            {f.rotulo}
            {alerta && (
              <span style={{ fontSize: "0.68rem", fontWeight: 800, color: PALETA.atencao, background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, borderRadius: 999, padding: "1px 7px" }}>
                confira
              </span>
            )}
          </span>
        </td>
        <td style={{ ...celula, fontWeight: 600 }} title={dicaDosPagamentos(f.pagamentos, f.contas)}>
          {num(f.contas)}
        </td>
        <td style={{ ...celula, fontWeight: 800 }}>{fmtReais(f.valor)}</td>
        <td className="fh-fp-largo" style={{ ...celula, color: PALETA.carvao2 }}>{f.contas ? fmtReais(f.mediaPorConta) : "—"}</td>
        <td style={celula}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end", width: "100%" }}>
            <span className="fh-fp-largo" style={{ flex: 1, maxWidth: 120 }}><BarraDePct pct={f.pct} cor={alerta ? PALETA.atencao : cor} /></span>
            <span style={{ minWidth: 48, fontWeight: 700 }}>{fmtPct(f.pct)}</span>
          </span>
        </td>
      </tr>
      {aberta && (
        <tr>
          <td colSpan={5} style={{ padding: "0.4rem 0.9rem 1.1rem 1.1rem", background: PALETA.areia }}>
            <BarrasPorDia dias={dias} valores={f.porDia} cor={alerta ? PALETA.atencao : cor} rotulo={f.rotulo} />
            {nota && <p style={{ margin: "0.7rem 0 0", fontSize: "0.76rem", color: PALETA.carvao2, lineHeight: 1.5 }}>{nota}</p>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.8rem", marginTop: "0.9rem", alignItems: "start" }}>
              <ListaDeDetalhe titulo={f.chave === "ONLINE" ? "De qual repasse" : "De qual canal"} linhas={f.porCanal} />
              <ListaDeDetalhe titulo="Como estava escrito" linhas={f.textos}
                rodape={f.chave === "OUTROS" ? "Texto que nenhuma forma reconhece. Se o cliente pagou de um jeito conhecido, troque a forma de pagamento no pedido, pelo painel." : undefined} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function LinhaDoTotal({ dados, aberta, alternar }: { dados: Resposta; aberta: boolean; alternar: () => void }) {
  const vazio = dados.total.pagamentos === 0;
  return (
    <>
      <tr className={vazio ? undefined : "fh-fp-linha"} onClick={vazio ? undefined : alternar} tabIndex={vazio ? undefined : 0} aria-expanded={vazio ? undefined : aberta}
        onKeyDown={vazio ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(); } }}
        style={{ borderTop: `2px solid ${PALETA.carvao}`, cursor: vazio ? "default" : "pointer", background: aberta ? PALETA.areia : "#fff" }}>
        <td style={{ padding: "11px 0.9rem", fontWeight: 900, textTransform: "uppercase", fontSize: "0.8rem", letterSpacing: "0.03em" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ChevronRight size={14} aria-hidden style={{ flexShrink: 0, transition: "transform 0.15s", transform: aberta ? "rotate(90deg)" : "none", opacity: vazio ? 0 : 1 }} />
            Total dos pagamentos
          </span>
        </td>
        <td style={{ ...celula, fontWeight: 900 }} title={dicaDosPagamentos(dados.total.pagamentos, dados.total.contas)}>{num(dados.total.contas)}</td>
        <td style={{ ...celula, fontWeight: 900 }}>{fmtReais(dados.total.valor)}</td>
        <td className="fh-fp-largo" style={{ ...celula, color: PALETA.carvao2 }}>{dados.total.contas ? fmtReais(dados.total.mediaPorConta) : ""}</td>
        <td style={{ ...celula, fontWeight: 800 }}>{dados.total.valor > 0 ? fmtPct(100) : "—"}</td>
      </tr>
      {aberta && (
        <tr>
          <td colSpan={5} style={{ padding: "0.4rem 0.9rem 1.1rem 1.1rem", background: PALETA.areia }}>
            <BarrasPorDia dias={dados.dias} valores={dados.total.porDia} cor={PALETA.carvao} rotulo="Total dos pagamentos" />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Barras dia a dia, em CSS puro. Até 14 dias, cada barra leva o valor e o
 * dia embaixo; período maior vira uma faixa que rola de lado, com o dia no
 * toque/hover — 400 barras com rótulo seriam ilegíveis.
 */
function BarrasPorDia({ dias, valores, cor, rotulo }: { dias: string[]; valores: number[]; cor: string; rotulo: string }) {
  const max = Math.max(0, ...valores);
  const total = valores.reduce((s, v) => s + v, 0);
  const n = dias.length;
  const comRotulo = n <= 14;
  const passo = n <= 14 ? 1 : n <= 31 ? 3 : n <= 62 ? 7 : 30;
  const iMax = valores.indexOf(max);
  const media = n ? total / n : 0;
  // Em pixels, não em %: com o valor escrito em cima, a barra do maior dia
  // precisa de espaço para o rótulo, e % da coluna achataria todas iguais.
  const alturaDaBarra = comRotulo ? 118 : 116;
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "4px 12px", fontSize: "0.76rem", color: PALETA.areiaTinta, margin: "0.4rem 0 0.5rem" }}>
        <span><strong style={{ color: PALETA.carvao }}>{rotulo}</strong> por dia</span>
        {max > 0 && <span>Maior dia: <strong style={{ color: PALETA.carvao2 }}>{fmtDia(dias[iMax]).slice(0, 5)} · {fmtReais(max)}</strong> · média {fmtReais(media)}/dia</span>}
      </figcaption>
      <div style={{ overflowX: "auto" }}>
        <div role="img" aria-label={`${rotulo} por dia: total ${fmtReais(total)} em ${n} dias${max > 0 ? `, maior dia ${fmtDia(dias[iMax])} com ${fmtReais(max)}` : ""}.`}
          style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(${comRotulo ? 30 : 5}px, 1fr))`, gap: comRotulo ? 6 : 2, alignItems: "end", minWidth: n * (comRotulo ? 36 : 7) }}>
          {valores.map((v, i) => (
            <div key={dias[i]} title={`${fmtDia(dias[i])} (${semana(dias[i])}): ${fmtReais(v)}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: comRotulo ? 150 : 120, minWidth: 0 }}>
              {comRotulo && v > 0 && (
                <span style={{ fontSize: "0.62rem", fontWeight: 700, color: PALETA.carvao2, marginBottom: 3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : Math.round(v).toLocaleString("pt-BR")}
                </span>
              )}
              <div style={{ width: "100%", height: max > 0 && v > 0 ? Math.max(2, Math.round((v / max) * alturaDaBarra)) : 0, background: cor, borderRadius: "4px 4px 0 0" }} />
            </div>
          ))}
        </div>
        <div aria-hidden style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(${comRotulo ? 30 : 5}px, 1fr))`, gap: comRotulo ? 6 : 2, minWidth: n * (comRotulo ? 36 : 7), borderTop: `1px solid ${PALETA.areiaBorda}`, marginTop: 2, paddingTop: 4 }}>
          {dias.map((d, i) => (
            <span key={d} style={{ fontSize: "0.62rem", color: PALETA.areiaTinta, textAlign: comRotulo ? "center" : "left", whiteSpace: "nowrap", overflow: "visible", lineHeight: 1.25 }}>
              {i % passo === 0 ? (comRotulo ? <>{d.slice(8, 10)}/{d.slice(5, 7)}<br />{semana(d)}</> : `${d.slice(8, 10)}/${d.slice(5, 7)}`) : ""}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}

function ListaDeDetalhe({ titulo, linhas, rodape }: { titulo: string; linhas: LinhaDeDetalhe[]; rodape?: string }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 12, padding: "0.7rem 0.85rem", minWidth: 0 }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{titulo}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 5 }}>
        {linhas.map((l) => (
          <li key={l.chave} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 10, alignItems: "baseline", fontSize: "0.8rem" }}>
            <span style={{ overflowWrap: "anywhere", color: PALETA.carvao }}>{l.rotulo}</span>
            <span style={{ color: PALETA.areiaTinta, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{num(l.pagamentos)}×</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtReais(l.valor)}</span>
          </li>
        ))}
      </ul>
      {rodape && <p style={{ margin: "8px 0 0", fontSize: "0.74rem", color: PALETA.atencao }}>{rodape}</p>}
    </div>
  );
}
