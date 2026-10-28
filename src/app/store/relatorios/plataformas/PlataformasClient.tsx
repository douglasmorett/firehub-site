"use client";
/**
 * Plataformas e repasses — a tela. A conta mora em lib/relatorios/plataformas.ts;
 * aqui são os filtros, os cartões do topo, a tabela forma × plataforma (tudo,
 * pago online ou na entrega), um cartão por plataforma com a conta do repasse
 * linha a linha e o repasse de cada semana.
 */
import React, { useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtPct, fmtReais } from "@/lib/relatorios/base";
import type { CelulaDaForma, FormaDaPlataforma, LinhaDaPlataforma, ResultadoDasPlataformas } from "@/lib/relatorios/plataformas";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = ResultadoDasPlataformas & { lojas: string[]; periodo: { de: string; ate: string } };
type Modo = "TOTAL" | "ONLINE" | "ENTREGA";

/** A cor de cada app, a que o lojista reconhece de longe. */
const COR_DO_CANAL: Record<string, string> = {
  IFOOD: "#EA1D2C", "99FOOD": "#F5A800", KEETA: "#1F2937", BRENDI: "#6D28D9", WABIZ: "#4D7C0F", JOTAJA: "#1D4ED8",
  CARDAPIOWEB: "#BE185D", ANOTAAI: "#0369A1", AIQFOME: "#7E22CE", SITE: "#15803D", APP: PALETA.brasa, WHATSAPP_IA: "#7C3AED",
};
const corDoCanal = (c: string) => COR_DO_CANAL[c] || PALETA.areiaTinta;

const COR_DA_FORMA: Record<FormaDaPlataforma, string> = {
  CREDITO: "#2563EB", DEBITO: "#0EA5E9", PIX: "#0F766E", DINHEIRO: "#65A30D", VALE: "#D97706", OUTROS: "#A8A29E",
};

const num = (n: number) => n.toLocaleString("pt-BR");
const valorNoModo = (f: CelulaDaForma, modo: Modo) => (modo === "ONLINE" ? f.online : modo === "ENTREGA" ? f.naEntrega : f.total);
const celula: React.CSSProperties = { padding: "10px 0.85rem", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

export default function PlataformasClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "7d");
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("plataformas", query);
  const [modo, setModo] = useState<Modo>("TOTAL");

  const vazio = dados && dados.canais.length === 0;
  const t = dados?.total;
  const temProprios = dados?.canais.some((c) => !c.marketplace);
  const temApps = dados?.canais.some((c) => c.marketplace);

  return (
    <ModeloDoRelatorio
      titulo="Plataformas e repasses"
      descricao="Quanto cada app e canal vendeu, em crédito, débito, Pix e dinheiro — o que foi pago no app e o que foi pago na entrega — e quanto cada app tem que te repassar, pela comissão que você cadastrou."
      slug="plataformas" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <style>{`
        .fh-pl-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1rem; margin-bottom: 1.25rem; }
        .fh-pl-rolagem { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .fh-pl-modo button { border: 0; background: transparent; padding: 6px 12px; border-radius: 999px; font-weight: 800; font-size: 0.78rem; color: ${PALETA.carvao2}; cursor: pointer; }
        .fh-pl-modo button[aria-pressed="true"] { background: ${PALETA.carvao}; color: #fff; }
        .fh-pl-tabela tbody tr:hover { background: ${PALETA.areia}; }
        @media (max-width: 560px) { .fh-pl-grade { grid-template-columns: 1fr; } }
      `}</style>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} />

      {vazio && <Bloco><Vazio texto="Nenhuma venda de app, site ou robô no período e filtros escolhidos." /></Bloco>}

      {dados && t && !vazio && (
        <>
          <GradeDeCartoes>
            <Cartao rotulo="Vendido nas plataformas" valor={fmtReais(t.valor)}
              detalhe={`${num(t.vendas)} venda${t.vendas === 1 ? "" : "s"} · ticket ${fmtReais(t.ticketMedio)}`} />
            <Cartao rotulo="Pago no app ou no site" valor={fmtReais(t.online)} detalhe={`${fmtPct(t.valor ? (t.online / t.valor) * 100 : 0)} das vendas`} />
            <Cartao rotulo="Pago na entrega" valor={fmtReais(t.naEntrega)} detalhe="Dinheiro, maquininha e Pix na porta" />
            {temApps && (
              <Cartao rotulo="A receber dos apps" valor={fmtReais(t.repasseDosApps)} tom="ok"
                detalhe={dados.semComissao.length ? `Sem ${dados.semComissao.join(", ")} (falta a comissão)` : "Estimativa pela comissão cadastrada"} />
            )}
            {temProprios && (
              <Cartao rotulo="Cai na sua conta" valor={fmtReais(t.onlineDosProprios)} detalhe="Pago online no site e no app da loja" />
            )}
          </GradeDeCartoes>

          {dados.semComissao.length > 0 && (
            <div role="note" style={{ display: "flex", gap: 10, alignItems: "flex-start", background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, color: PALETA.atencao, borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "1.25rem", fontSize: "0.86rem" }}>
              <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <b>Falta a comissão {dados.semComissao.length === 1 ? "do" : "dos apps"} {dados.semComissao.join(", ")}.</b> Sem ela não dá para calcular o repasse.{" "}
                <Link href="/store/financeiro?tab=configuracoes" style={{ color: "inherit", fontWeight: 800 }}>Cadastrar em Financeiro → Configurações</Link>
              </span>
            </div>
          )}

          <Bloco titulo="Quanto cada plataforma vendeu" subtitulo="Participação de cada canal no que foi vendido fora do salão.">
            <BarraDosCanais canais={dados.canais} />
          </Bloco>

          <Bloco titulo="Forma de pagamento × plataforma" semPadding
            subtitulo="Pago online: o cliente pagou no app ou no site. Na entrega: pagou na porta, ao motoboy."
            acoes={
              <div className="fh-pl-modo fh-sem-impressao" role="group" aria-label="O que mostrar" style={{ display: "inline-flex", background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 999, padding: 3 }}>
                {([["TOTAL", "Tudo"], ["ONLINE", "Pago online"], ["ENTREGA", "Na entrega"]] as [Modo, string][]).map(([k, r]) => (
                  <button key={k} type="button" aria-pressed={modo === k} onClick={() => setModo(k)}>{r}</button>
                ))}
              </div>
            }>
            <TabelaCruzada dados={dados} modo={modo} />
          </Bloco>

          <h2 style={{ fontSize: "1.05rem", fontWeight: 900, margin: "0.4rem 0 0.75rem" }}>Plataforma por plataforma</h2>
          <div className="fh-pl-grade">
            {dados.canais.map((c) => <CartaoDaPlataforma key={c.canal} c={c} />)}
          </div>

          {dados.semanas.length > 0 && temApps && <RepassePorSemana dados={dados} />}

          <p style={{ fontSize: "0.76rem", color: PALETA.areiaTinta, lineHeight: 1.55, margin: "0 0 1rem", maxWidth: 860 }}>
            O repasse é uma estimativa: o que o app recebeu do cliente + o cupom que o app bancou − a comissão cadastrada (sobre os itens)
            − a taxa de entrega das corridas feitas pelo entregador do app − a taxa de serviço que o app cobra do cliente. Confira com o extrato de cada app.
            Cancelados não entram.
            {dados.doSalao.vendas > 0 && <> Mesa, balcão e totem ({num(dados.doSalao.vendas)} vendas, {fmtReais(dados.doSalao.valor)}) ficam no <Link href={`/store/relatorios/formas-de-pagamento?${query}`} style={{ color: PALETA.marca, fontWeight: 700 }}>Vendas por forma de pagamento</Link>.</>}
          </p>
        </>
      )}
    </ModeloDoRelatorio>
  );
}

function Selo({ canal, nome }: { canal: string; nome: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 800 }}>
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: corDoCanal(canal), flexShrink: 0 }} />
      {nome}
    </span>
  );
}

function BarraDosCanais({ canais }: { canais: LinhaDaPlataforma[] }) {
  return (
    <div>
      <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", background: PALETA.areia }}>
        {canais.filter((c) => c.pct > 0).map((c) => (
          <div key={c.canal} title={`${c.nome}: ${fmtReais(c.valor)} (${fmtPct(c.pct)})`} style={{ width: `${c.pct}%`, background: corDoCanal(c.canal) }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1.4rem", marginTop: "0.8rem", fontSize: "0.84rem" }}>
        {canais.map((c) => (
          <span key={c.canal} style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
            <Selo canal={c.canal} nome={c.nome} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtReais(c.valor)}</span>
            <span style={{ color: PALETA.areiaTinta, fontSize: "0.76rem" }}>{fmtPct(c.pct)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TabelaCruzada({ dados, modo }: { dados: Resposta; modo: Modo }) {
  const totalDoCanal = (c: LinhaDaPlataforma) => (modo === "ONLINE" ? c.online : modo === "ENTREGA" ? c.naEntrega : c.valor);
  const linhas = dados.total.formas.filter((f) => valorNoModo(f, modo) > 0);
  const totalGeral = linhas.reduce((s, f) => s + valorNoModo(f, modo), 0);
  if (linhas.length === 0) return <Vazio texto={modo === "ONLINE" ? "Nada pago online no período." : "Nada pago na entrega no período."} />;
  return (
    <div className="fh-pl-rolagem">
      <table className="fh-pl-tabela" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem", minWidth: 120 + dados.canais.length * 120 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${PALETA.areiaBorda}`, color: PALETA.areiaTinta, fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
            <th style={{ ...celula, textAlign: "left", position: "sticky", left: 0, background: "#fff" }}>Forma</th>
            {dados.canais.map((c) => (
              <th key={c.canal} style={{ ...celula, textTransform: "none", letterSpacing: 0, fontSize: "0.82rem", color: PALETA.carvao }}><Selo canal={c.canal} nome={c.nome} /></th>
            ))}
            <th style={{ ...celula, color: PALETA.carvao }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((f) => {
            const totalDaForma = valorNoModo(f, modo);
            return (
              <tr key={f.forma} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                <td style={{ ...celula, textAlign: "left", fontWeight: 800, position: "sticky", left: 0, background: "inherit" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: COR_DA_FORMA[f.forma] }} />{f.rotulo}
                  </span>
                </td>
                {dados.canais.map((c) => {
                  const v = valorNoModo(c.formas.find((x) => x.forma === f.forma)!, modo);
                  const base = totalDoCanal(c);
                  return (
                    <td key={c.canal} style={{ ...celula, color: v ? PALETA.carvao : PALETA.areiaBorda }}>
                      {v ? fmtReais(v) : "—"}
                      {v > 0 && base > 0 && <div style={{ fontSize: "0.7rem", color: PALETA.areiaTinta }}>{fmtPct((v / base) * 100)}</div>}
                    </td>
                  );
                })}
                <td style={{ ...celula, fontWeight: 800 }}>
                  {fmtReais(totalDaForma)}
                  <div style={{ fontSize: "0.7rem", color: PALETA.areiaTinta, fontWeight: 500 }}>{fmtPct(totalGeral ? (totalDaForma / totalGeral) * 100 : 0)}</div>
                </td>
              </tr>
            );
          })}
          <tr style={{ background: PALETA.areia, fontWeight: 900 }}>
            <td style={{ ...celula, textAlign: "left", position: "sticky", left: 0, background: PALETA.areia }}>Total</td>
            {dados.canais.map((c) => <td key={c.canal} style={celula}>{fmtReais(totalDoCanal(c))}</td>)}
            <td style={celula}>{fmtReais(totalGeral)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function LinhaDaConta({ rotulo, valor, sinal, forte, dica }: { rotulo: React.ReactNode; valor: number; sinal?: "+" | "−"; forte?: boolean; dica?: string }) {
  return (
    <div title={dica} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", fontSize: forte ? "0.95rem" : "0.84rem", fontWeight: forte ? 900 : 500, borderTop: forte ? `1px solid ${PALETA.areiaBorda}` : undefined, marginTop: forte ? 4 : 0, paddingTop: forte ? 9 : 5 }}>
      <span style={{ color: forte ? PALETA.carvao : PALETA.carvao2 }}>{rotulo}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: sinal === "−" && valor > 0 ? PALETA.grave : forte ? (valor < 0 ? PALETA.grave : PALETA.ok) : PALETA.carvao }}>
        {sinal && valor > 0 ? `${sinal} ` : ""}{fmtReais(valor)}
      </span>
    </div>
  );
}

function CartaoDaPlataforma({ c }: { c: LinhaDaPlataforma }) {
  const cor = corDoCanal(c.canal);
  const formas = c.formas.filter((f) => f.total > 0);
  const totalPago = formas.reduce((s, f) => s + f.total, 0);
  return (
    <section className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 5, background: cor }} />
      <div style={{ padding: "0.95rem 1.1rem 0.6rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "1.02rem" }}><Selo canal={c.canal} nome={c.nome} /></div>
          <div style={{ fontSize: "0.76rem", color: PALETA.areiaTinta, marginTop: 3 }}>
            {num(c.vendas)} venda{c.vendas === 1 ? "" : "s"} · ticket {fmtReais(c.ticketMedio)} · {fmtPct(c.pct)} do total
          </div>
        </div>
        <div style={{ fontSize: "1.35rem", fontWeight: 900, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmtReais(c.valor)}</div>
      </div>

      <div style={{ padding: "0 1.1rem" }}>
        <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: PALETA.areia }}>
          {formas.map((f) => (
            <div key={f.forma} title={`${f.rotulo}: ${fmtReais(f.total)}`} style={{ width: `${totalPago ? (f.total / totalPago) * 100 : 0}%`, background: COR_DA_FORMA[f.forma] }} />
          ))}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginTop: 8 }}>
          <thead>
            <tr style={{ color: PALETA.areiaTinta, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              <th style={{ textAlign: "left", padding: "4px 0", fontWeight: 800 }}>Forma</th>
              <th style={{ textAlign: "right", padding: "4px 0 4px 12px", fontWeight: 800, whiteSpace: "nowrap" }}>Online</th>
              <th style={{ textAlign: "right", padding: "4px 0 4px 12px", fontWeight: 800, whiteSpace: "nowrap" }}>Na entrega</th>
              <th style={{ textAlign: "right", padding: "4px 0 4px 12px", fontWeight: 800, whiteSpace: "nowrap" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {formas.map((f) => (
              <tr key={f.forma} style={{ borderTop: `1px solid ${PALETA.areia}` }}>
                <td style={{ padding: "5px 0", fontWeight: 700 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: COR_DA_FORMA[f.forma] }} />{f.rotulo}
                  </span>
                </td>
                <td style={{ padding: "5px 0 5px 12px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: f.online ? PALETA.carvao : PALETA.areiaBorda }}>{f.online ? fmtReais(f.online) : "—"}</td>
                <td style={{ padding: "5px 0 5px 12px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: f.naEntrega ? PALETA.carvao : PALETA.areiaBorda }}>{f.naEntrega ? fmtReais(f.naEntrega) : "—"}</td>
                <td style={{ padding: "5px 0 5px 12px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontWeight: 800 }}>{fmtReais(f.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ margin: "0.8rem 1.1rem 1rem", padding: "0.7rem 0.85rem", background: PALETA.areia, borderRadius: 12, marginTop: "auto" }}>
        {c.marketplace ? (
          <>
            <div style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: PALETA.areiaTinta, marginBottom: 2 }}>Conta do repasse</div>
            <LinhaDaConta rotulo="Recebido pelo app" valor={c.recebidoPeloApp} dica="Pago no app, mais o que o entregador do app cobrou na porta" />
            {c.cupomDoApp > 0 && <LinhaDaConta rotulo={`Cupom que o ${c.nome} bancou`} valor={c.cupomDoApp} sinal="+" />}
            <LinhaDaConta rotulo={c.comissaoPct == null ? "Comissão (não cadastrada)" : `Comissão ${num(c.comissaoPct)}% sobre ${fmtReais(c.baseDaComissao)}`} valor={c.comissao} sinal="−" />
            {c.freteDoApp > 0 && <LinhaDaConta rotulo={`Entrega do app (${num(c.corridasDoApp)} corrida${c.corridasDoApp === 1 ? "" : "s"})`} valor={c.freteDoApp} sinal="−" />}
            {c.taxaDoApp > 0 && <LinhaDaConta rotulo="Taxa de serviço do app" valor={c.taxaDoApp} sinal="−" />}
            {c.repasse == null ? (
              <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${PALETA.areiaBorda}`, fontSize: "0.82rem", fontWeight: 800, color: PALETA.atencao }}>
                <Link href="/store/financeiro?tab=configuracoes" style={{ color: "inherit" }}>Cadastre a comissão do {c.nome}</Link> para ver o repasse
              </div>
            ) : (
              <LinhaDaConta rotulo="Repasse estimado" valor={c.repasse} forte />
            )}
            {c.recebidoPelaLoja > 0 && <LinhaDaConta rotulo="Já recebido na loja (na entrega)" valor={c.recebidoPelaLoja} />}
            {c.cupomDaLoja > 0 && <LinhaDaConta rotulo="Cupom que a loja bancou" valor={c.cupomDaLoja} dica="Já descontado do valor vendido" />}
          </>
        ) : (
          <>
            <div style={{ fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: PALETA.areiaTinta, marginBottom: 2 }}>Para onde foi o dinheiro</div>
            <LinhaDaConta rotulo="Pago online" valor={c.online} />
            {c.taxaOnline > 0 && <LinhaDaConta rotulo="Taxa do pagamento online" valor={c.taxaOnline} sinal="−" />}
            <LinhaDaConta rotulo="Cai na sua conta" valor={c.repasse ?? 0} forte />
            {c.naEntrega > 0 && <LinhaDaConta rotulo="Recebido na entrega" valor={c.naEntrega} />}
            {c.cupomDaLoja > 0 && <LinhaDaConta rotulo="Cupom que a loja deu" valor={c.cupomDaLoja} dica="Já descontado do valor vendido" />}
            <div style={{ fontSize: "0.72rem", color: PALETA.ok, fontWeight: 700, marginTop: 6 }}>Sem comissão de app</div>
          </>
        )}
      </div>
    </section>
  );
}

function RepassePorSemana({ dados }: { dados: Resposta }) {
  const apps = dados.canais.filter((c) => c.marketplace);
  return (
    <Bloco titulo="Repasse dos apps por semana" subtitulo="Segunda a domingo, dentro do período escolhido. Confira com o extrato de cada app." semPadding>
      <div className="fh-pl-rolagem">
        <table className="fh-pl-tabela" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem", minWidth: 160 + apps.length * 130 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${PALETA.areiaBorda}`, color: PALETA.areiaTinta, fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              <th style={{ ...celula, textAlign: "left" }}>Semana</th>
              {apps.map((c) => <th key={c.canal} style={{ ...celula, textTransform: "none", letterSpacing: 0, fontSize: "0.82rem", color: PALETA.carvao }}><Selo canal={c.canal} nome={c.nome} /></th>)}
              <th style={{ ...celula, color: PALETA.carvao }}>Total a receber</th>
            </tr>
          </thead>
          <tbody>
            {dados.semanas.map((s) => (
              <tr key={s.de} style={{ borderBottom: `1px solid ${PALETA.areia}` }}>
                <td style={{ ...celula, textAlign: "left", fontWeight: 800 }}>{s.de === s.ate ? fmtDia(s.de) : `${fmtDia(s.de)} a ${fmtDia(s.ate)}`}</td>
                {apps.map((c) => {
                  const l = s.porCanal.find((x) => x.canal === c.canal);
                  return (
                    <td key={c.canal} style={{ ...celula, color: l ? PALETA.carvao : PALETA.areiaBorda }}>
                      {!l ? "—" : l.repasse == null ? <span style={{ color: PALETA.atencao, fontSize: "0.78rem" }}>sem comissão</span> : fmtReais(l.repasse)}
                      {l && <div style={{ fontSize: "0.7rem", color: PALETA.areiaTinta }}>{num(l.vendas)} vendas · {fmtReais(l.valor)}</div>}
                    </td>
                  );
                })}
                <td style={{ ...celula, fontWeight: 900, color: PALETA.ok }}>{fmtReais(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Bloco>
  );
}
