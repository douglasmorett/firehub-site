"use client";
/**
 * Contas a receber — a tela. O que cada venda já feita ainda vai pôr na
 * conta: o calendário do mês (quanto cai em cada dia), por forma e app (bruto,
 * taxa %, taxa, líquido) e o dia aberto, venda a venda agrupada. A conta mora
 * em lib/relatorios/recebiveis.ts.
 *
 * O período é sempre um MÊS, com ◀ ▶: é como o lojista confere o extrato da
 * maquininha e o repasse do app.
 */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { DIAS_CURTOS, fmtDia, fmtPct, fmtReais, somarDias } from "@/lib/relatorios/base";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import PrazosDeRecebimento, { type PrazoNaTela } from "@/components/relatorios/PrazosDeRecebimento";
import type { ResultadoDoAReceber } from "@/lib/relatorios/recebiveis";

type Resposta = ResultadoDoAReceber & {
  lojas: string[];
  periodo: { de: string; ate: string };
  hoje: string;
  prazos: PrazoNaTela[];
  algumPrazoPadrao: boolean;
  fora: { chave: string; rotulo: string; quantidade: number; valor: number }[];
  semComissao: string[];
  semTaxa: string[];
};

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom" };
const td: React.CSSProperties = { padding: "7px 0.6rem" };

const ultimoDoMes = (mes: string) => somarDias(`${somarDias(`${mes}-28`, 4).slice(0, 7)}-01`, -1);
const mesVizinho = (mes: string, n: number) => {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const diaCurto = (dia: string) => `${DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export default function ContasAReceberClient({ inicio }: { inicio: InicioDosFiltros }) {
  const { filtros, mudar, query } = useFiltros(inicio, "mes");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("contas-a-receber", query);
  const hoje = inicio.hoje;
  const mes = filtros.de.slice(0, 7);
  const irPara = (m: string) => mudar({ de: `${m}-01`, ate: ultimoDoMes(m) });
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [prazosAbertos, setPrazosAbertos] = useState(false);

  const doDia = useMemo(() => (dados && diaAberto ? dados.linhas.filter((l) => l.dia === diaAberto) : []), [dados, diaAberto]);
  const pctDaTaxa = dados && dados.total.bruto > 0 ? (dados.total.taxa / dados.total.bruto) * 100 : 0;

  return (
    <ModeloDoRelatorio
      titulo="Contas a receber"
      descricao="Quanto das vendas já feitas ainda vai cair na sua conta, e em que dia: cartão no prazo da maquininha, Pix e dinheiro no dia, o app pelo repasse. Com a taxa e a comissão já descontadas."
      slug="contas-a-receber" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <section className="fh-sem-impressao" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: "1.1rem" }}>
        <button type="button" className="btn btn-outline" onClick={() => irPara(mesVizinho(mes, -1))} aria-label="Mês anterior">◀</button>
        <strong style={{ fontSize: "1.15rem", minWidth: 170, textAlign: "center" }}>{MESES[Number(mes.slice(5, 7)) - 1]} de {mes.slice(0, 4)}</strong>
        <button type="button" className="btn btn-outline" onClick={() => irPara(mesVizinho(mes, 1))} aria-label="Próximo mês">▶</button>
        {mes !== hoje.slice(0, 7) && <button type="button" className="btn btn-outline" onClick={() => irPara(hoje.slice(0, 7))}>Este mês</button>}
      </section>

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Cai no mês (líquido)" valor={fmtReais(dados.total.liquido)} detalhe={`bruto ${fmtReais(dados.total.bruto)}`} />
          <Cartao rotulo="Já caiu" tom="ok" valor={fmtReais(dados.total.jaCaiu)} detalhe="até ontem" />
          <Cartao rotulo="Ainda vai cair" tom="atencao" valor={fmtReais(dados.total.aCair)} detalhe="de hoje até o fim do mês" />
          <Cartao rotulo="Taxas e comissões" valor={fmtReais(dados.total.taxa)} detalhe={dados.total.bruto > 0 ? `${fmtPct(pctDaTaxa)} do bruto` : "—"} />
        </GradeDeCartoes>
      )}

      {dados && dados.total.bruto === 0 && dados.total.liquido === 0 && (
        <Bloco><Vazio texto="Nada cai neste mês pelas vendas registradas. Venda que ainda não aconteceu entra no Fluxo de caixa, como previsão." /></Bloco>
      )}

      {dados && (dados.total.bruto !== 0 || dados.total.liquido !== 0) && (
        <>
          <Bloco titulo="Calendário" subtitulo="O líquido que cai em cada dia. Toque num dia para ver de onde vem.">
            <Calendario dados={dados} mes={mes} hoje={hoje} aberto={diaAberto} onAbrir={(d) => setDiaAberto(d === diaAberto ? null : d)} />
            {diaAberto && (
              <div style={{ marginTop: "1rem", borderTop: `1px solid ${PALETA.areiaBorda}`, paddingTop: "0.8rem" }}>
                <strong style={{ fontSize: "0.92rem" }}>{diaCurto(diaAberto)}{diaAberto < hoje ? " — já caiu" : diaAberto === hoje ? " — cai hoje" : ""}</strong>
                {doDia.length === 0 ? (
                  <p style={{ margin: "6px 0 0", fontSize: "0.84rem", color: PALETA.areiaTinta }}>Nada cai neste dia.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", marginTop: 6 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: PALETA.carvao2 }}>
                        <th style={th}>Forma / app</th><th style={th}>Venda de</th><th style={{ ...th, ...num }}>Bruto</th><th style={{ ...th, ...num }}>Taxa</th><th style={{ ...th, ...num }}>Líquido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doDia.map((l, i) => (
                        <tr key={i} style={{ borderTop: `1px solid ${PALETA.areiaBorda}` }}>
                          <td style={td}>{l.rotulo}</td>
                          <td style={td}>{fmtDia(l.diaDaVenda)} <span style={{ color: PALETA.areiaTinta }}>(D+{l.prazo})</span></td>
                          <td style={{ ...td, ...num }}>{fmtReais(l.bruto)}</td>
                          <td style={{ ...td, ...num }}>{l.taxa ? `− ${fmtReais(l.taxa)}` : "—"}</td>
                          <td style={{ ...td, ...num, fontWeight: 800 }}>{fmtReais(l.liquido)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Bloco>

          <Bloco titulo="Por forma e por app" subtitulo="Bruto − taxa = líquido. No app, a taxa é a comissão cadastrada (sobre os itens), e o bruto já é sem a entrega e a taxa de serviço que ficam com ele." semPadding>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: PALETA.areia, textAlign: "left", color: PALETA.carvao2 }}>
                    <th style={th}>Forma / app</th><th style={th}>Prazo</th><th style={{ ...th, ...num }}>Bruto</th><th style={{ ...th, ...num }}>Taxa %</th><th style={{ ...th, ...num }}>Taxa</th><th style={{ ...th, ...num }}>Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porForma.map((f) => (
                    <tr key={f.chave} style={{ borderTop: `1px solid ${PALETA.areiaBorda}` }}>
                      <td style={{ ...td, fontWeight: 700 }}>{f.rotulo}</td>
                      <td style={td}>D+{f.prazo}{f.prazoPadrao && <span style={{ color: PALETA.atencao, fontWeight: 700 }}> · padrão</span>}</td>
                      <td style={{ ...td, ...num }}>{fmtReais(f.bruto)}</td>
                      <td style={{ ...td, ...num, color: f.taxaPct == null ? PALETA.atencao : undefined }}>{f.taxaPct == null ? "não cadastrada" : fmtPct(f.taxaPct, 2)}</td>
                      <td style={{ ...td, ...num }}>{f.taxa ? `− ${fmtReais(f.taxa)}` : "—"}</td>
                      <td style={{ ...td, ...num, fontWeight: 900 }}>{fmtReais(f.liquido)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `2px solid ${PALETA.carvao2}`, background: PALETA.areia, fontWeight: 900 }}>
                    <td style={td}>Total</td><td style={td} />
                    <td style={{ ...td, ...num }}>{fmtReais(dados.total.bruto)}</td>
                    <td style={{ ...td, ...num }}>{dados.total.bruto > 0 ? fmtPct(pctDaTaxa, 2) : "—"}</td>
                    <td style={{ ...td, ...num }}>− {fmtReais(dados.total.taxa)}</td>
                    <td style={{ ...td, ...num }}>{fmtReais(dados.total.liquido)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Bloco>
        </>
      )}

      {dados && (
        <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55, display: "grid", gap: 6 }}>
          {dados.algumPrazoPadrao && (
            <p style={{ margin: 0, color: PALETA.atencao, fontWeight: 700 }}>
              Parte está prevista pelo prazo padrão (crédito D+30, débito D+1, Pix e dinheiro no dia, app D+7) —{" "}
              <button type="button" onClick={() => { setPrazosAbertos(true); document.getElementById("prazos")?.scrollIntoView({ behavior: "smooth" }); }}
                style={{ border: "none", background: "none", padding: 0, color: PALETA.marca, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}>
                ajuste em Prazos de recebimento
              </button>.
            </p>
          )}
          {dados.semComissao.length > 0 && (
            <p style={{ margin: 0, color: PALETA.atencao, fontWeight: 700 }}>
              {dados.semComissao.join(", ")} sem comissão cadastrada: o líquido está sem descontar a comissão. <Link href="/store/financeiro?tab=configuracoes" style={{ color: PALETA.marca }}>Cadastrar a comissão</Link>
            </p>
          )}
          {dados.semTaxa.length > 0 && (
            <p style={{ margin: 0 }}>
              {dados.semTaxa.join(", ")} sem taxa cadastrada: o líquido está sem a taxa da maquininha. <Link href="/store/minha-loja" style={{ color: PALETA.marca, fontWeight: 700 }}>Cadastrar em Minha loja → Formas de pagamento</Link>
            </p>
          )}
          {dados.fora.length > 0 && <p style={{ margin: 0 }}>Não vira dinheiro na conta: {dados.fora.map((f) => `${f.rotulo} ${fmtReais(f.valor)}`).join(" · ")}.</p>}
          <p style={{ margin: 0 }}>
            É uma <strong style={{ color: PALETA.carvao2 }}>estimativa</strong> pelo prazo e pela taxa cadastrados: confira com o extrato da maquininha e o do app. Cartão, vale, app e site caem em dia útil (sábado e domingo passam para a segunda; feriado não conta).
            A venda é a do <Link href="/store/relatorios/formas-de-pagamento" style={{ color: PALETA.marca, fontWeight: 700 }}>Vendas por forma de pagamento</Link> e o repasse é o do <Link href="/store/relatorios/plataformas" style={{ color: PALETA.marca, fontWeight: 700 }}>Plataformas e repasses</Link>.
            O que o motoboy da loja cobrou na porta num pedido do app já é da loja, na forma em que foi pago. A mesa entra no dia em que a conta fechou, sem o troco.
          </p>
        </div>
      )}

      {dados && <PrazosDeRecebimento prazos={dados.prazos} aberto={prazosAbertos} onSalvo={recarregar} />}
    </ModeloDoRelatorio>
  );
}

function Calendario({ dados, mes, hoje, aberto, onAbrir }: { dados: Resposta; mes: string; hoje: string; aberto: string | null; onAbrir: (d: string) => void }) {
  const doMes = dados.dias.filter((d) => d.dia.startsWith(mes));
  if (!doMes.length) return null;
  const vazios = doMes[0].diaSemana; // a semana começa no domingo
  const maior = Math.max(1, ...doMes.map((d) => d.liquido));
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
        {DIAS_CURTOS.map((d) => <div key={d} style={{ fontSize: "0.7rem", fontWeight: 800, color: PALETA.areiaTinta, textAlign: "center", textTransform: "uppercase" }}>{d}</div>)}
        {Array.from({ length: vazios }, (_, i) => <div key={`v${i}`} />)}
        {doMes.map((d) => {
          const ehHoje = d.dia === hoje;
          const tem = d.liquido !== 0;
          const intensidade = tem && d.liquido > 0 ? 0.12 + 0.5 * (d.liquido / maior) : 0;
          return (
            <button key={d.dia} type="button" onClick={() => onAbrir(d.dia)} aria-pressed={aberto === d.dia}
              title={d.porChave.map((k) => `${k.rotulo}: ${fmtReais(k.liquido)}`).join("\n") || "Nada cai neste dia"}
              style={{
                minHeight: 64, borderRadius: 10, padding: "6px 6px", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                border: `${ehHoje || aberto === d.dia ? 2 : 1}px solid ${aberto === d.dia ? PALETA.carvao : ehHoje ? PALETA.brasa : PALETA.areiaBorda}`,
                background: tem ? `rgba(15, 118, 110, ${intensidade.toFixed(2)})` : "#fff",
                opacity: d.jaCaiu ? 0.7 : 1, display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0,
              }}>
              <span style={{ fontSize: "0.74rem", fontWeight: 800, color: PALETA.carvao2 }}>{Number(d.dia.slice(8, 10))}{ehHoje ? " · hoje" : ""}</span>
              <span style={{ fontSize: "0.74rem", fontWeight: 800, color: d.liquido < 0 ? PALETA.grave : PALETA.carvao, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {tem ? fmtReais(d.liquido).replace("R$", "").trim() : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ margin: "8px 0 0", fontSize: "0.72rem", color: PALETA.areiaTinta }}>Mais escuro = cai mais dinheiro. Dias já passados ficam mais claros.</p>
    </div>
  );
}
