"use client";

/**
 * PERFORMANCE DAS CARTEIRAS — admin › Vendedores (pedido do Douglas,
 * 18/10/2026): "eu vejo tudo e vejo a carteira de cada vendedor separado;
 * também análise de performance por carteira do vendedor, detalhada".
 *
 * Comparativo de todas as carteiras num período contra o anterior, a atividade
 * comercial do CRM (a mesma conta do antigo "Desempenho da equipe", que esta
 * tela substitui) e o detalhe de uma carteira com a evolução mês a mês, as
 * lojas e o relatório da carteira. As contas: lib/performance-das-carteiras.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, ChevronRight, Download, Info, Medal, Minus, RefreshCw, TriangleAlert, Users, X,
} from "lucide-react";
import { useDinheiro } from "@/components/parceiro/ValoresOcultos";
import {
  ATALHOS_DO_PERIODO, NOME_DO_SERVICO, csvDoComparativo, mesCurto, ordenarCarteiras,
  type ChaveDoPeriodo, type OrdemDoComparativo, type PeriodoDaAnalise, type ResumoDaCarteira, type MesDaEvolucao,
} from "@/lib/performance-das-carteiras/regras";
import type { DetalheDaCarteira, LinhaDaLojaNaCarteira } from "@/lib/performance-das-carteiras/no-banco";
import { ESTILO_DO_PERFIL } from "./estilo";
import { AvisoNoTopo, PilulaDoStatus, type Aviso } from "./PerfilDaLoja";
import RelatorioDaCarteira from "./RelatorioDaCarteira";
import ComoVoceGanha, { ESTILO_DO_COMISSIONAMENTO } from "./ComoVoceGanha";

type Analise = { periodo: PeriodoDaAnalise; carteiras: ResumoDaCarteira[]; total: ResumoDaCarteira; disparoEstimado: boolean; custoMetaAtual: number; geradoEm: string };
/** O período pedido: atalho, mês escolhido ou intervalo livre. */
type Filtro = { chave: ChaveDoPeriodo; mes?: string; de?: string; ate?: string };
const consultaDo = (f: Filtro) => {
  const q = new URLSearchParams({ periodo: f.chave });
  if (f.chave === "mesEspecifico" && f.mes) q.set("mes", f.mes);
  if (f.chave === "intervalo") { if (f.de) q.set("de", f.de); if (f.ate) q.set("ate", f.ate); }
  return q.toString();
};
const ROTULO_DA_ORIGEM = { LINK: "Link de vendedor", ATRIBUIDA: "Atribuída", INDICACAO: "Indicação (embaixador)", SEM: "—" } as const;

/** Período escolhido × anterior (validado: scripts/validate_palette.js, CVD ΔE 22,8). */
const COR_DO_PERIODO = "#E8360C";
const COR_DO_ANTERIOR = "#4F6FB8";
const COR_DO_HISTORICO = "#D6D3D1";
const COR_DA_SITUACAO = { ATIVA: "#22A55A", ESFRIANDO: "#E8A317", PARADA: "#E5484D", NOVA: "#3B82F6" } as const;
const PAPEL: Record<ResumoDaCarteira["papel"], string> = {
  VENDEDOR: "Vendedor", EMBAIXADOR: "Embaixador (indicações)", SEM_VENDEDOR: "Do Douglas",
};
const ORDENS: { chave: OrdemDoComparativo; rotulo: string }[] = [
  { chave: "receita", rotulo: "Receita FireHub" }, { chave: "gmv", rotulo: "Faturamento (GMV)" }, { chave: "crescimento", rotulo: "Crescimento" },
  { chave: "lojas", rotulo: "Nº de lojas" }, { chave: "conversao", rotulo: "Conversão do teste" }, { chave: "risco", rotulo: "Faturamento em risco" },
];

const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR");
const compacto = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : n0(v));

function Delta({ pct, inverso, texto }: { pct: number | null; inverso?: boolean; texto?: string }) {
  if (pct === null) return <span className="pc-delta neutro" title="Sem base no período anterior"><Minus size={12} aria-hidden />{texto ?? "sem base"}</span>;
  const bom = inverso ? pct < 0 : pct > 0;
  const cls = Math.abs(pct) < 1 ? "neutro" : bom ? "sobe" : "cai";
  const Icone = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  return <span className={`pc-delta ${cls}`}><Icone size={12} aria-hidden />{pct > 0 ? "+" : ""}{pct}%</span>;
}

/** Diferença em número absoluto, para contagens pequenas (lojas, perdidas). */
function DeltaAbs({ atual, anterior, inverso }: { atual: number; anterior: number; inverso?: boolean }) {
  const d = atual - anterior;
  if (d === 0) return <span className="pc-delta neutro"><Minus size={12} aria-hidden />igual</span>;
  const bom = inverso ? d < 0 : d > 0;
  return <span className={`pc-delta ${bom ? "sobe" : "cai"}`}>{d > 0 ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}{d > 0 ? "+" : ""}{d}</span>;
}

function BarraDaSituacao({ s }: { s: ResumoDaCarteira["atual"]["porSituacao"] }) {
  const total = s.ATIVA + s.ESFRIANDO + s.PARADA + s.NOVA;
  if (!total) return <span className="pc-fraco">—</span>;
  return (
    <div className="pc-sit" title={`Ativas ${s.ATIVA} · Esfriando ${s.ESFRIANDO} · Paradas ${s.PARADA} · Novas ${s.NOVA}`}>
      <div className="pf-barra" style={{ height: 8 }}>
        {(["ATIVA", "ESFRIANDO", "PARADA", "NOVA"] as const).filter((k) => s[k] > 0).map((k) => <span key={k} style={{ width: `${(s[k] / total) * 100}%`, background: COR_DA_SITUACAO[k] }} />)}
      </div>
      <small>{[s.ATIVA && `${s.ATIVA} ativa${s.ATIVA > 1 ? "s" : ""}`, s.ESFRIANDO && `${s.ESFRIANDO} esfriando`, s.PARADA && `${s.PARADA} parada${s.PARADA > 1 ? "s" : ""}`, s.NOVA && `${s.NOVA} nova${s.NOVA > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</small>
    </div>
  );
}

// ── Gráfico de barras por mês (uma medida, um eixo) ────────────────────────

type Medida = "gmv" | "previsto" | "recebido" | "comissao" | "ativas";
const MEDIDAS: { chave: Medida; rotulo: string; dinheiro: boolean }[] = [
  { chave: "previsto", rotulo: "Receita FireHub", dinheiro: true },
  { chave: "recebido", rotulo: "Recebido", dinheiro: true },
  { chave: "gmv", rotulo: "Faturamento das lojas", dinheiro: true },
  { chave: "comissao", rotulo: "Comissão", dinheiro: true },
  { chave: "ativas", rotulo: "Lojas ativas", dinheiro: false },
];

function GraficoMensal({ dados, medida, doPeriodo, doAnterior, formato, moeda }: {
  dados: MesDaEvolucao[]; medida: Medida; doPeriodo: string[]; doAnterior: string[]; formato: (v: number) => string; moeda: (v: number) => string;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  // Mede a largura de verdade: o SVG não encolhe a letra no celular.
  const caixa = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setW(Math.max(280, Math.round(el.clientWidth)));
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const valores = dados.map((d) => Number(d[medida]) || 0);
  const max = Math.max(1, ...valores);
  const H = 220, top = 20, base = 186, esq = 6, dir = 18;
  const passo = (W - esq - dir) / Math.max(1, dados.length);
  const larg = Math.max(8, Math.min(42, passo - 10));
  const grade = [0.5, 1].map((f) => ({ y: base - (base - top) * f, v: max * f }));
  const cor = (ym: string) => (doPeriodo.includes(ym) ? COR_DO_PERIODO : doAnterior.includes(ym) ? COR_DO_ANTERIOR : COR_DO_HISTORICO);
  const d = foco !== null ? dados[foco] : null;
  return (
    <div className="pc-grafico" ref={caixa}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Evolução mensal: ${dados.map((x, i) => `${mesCurto(x.mes)} ${formato(valores[i])}`).join(", ")}`} onMouseLeave={() => setFoco(null)}>
        {grade.map((g) => (
          <g key={g.y}>
            <line x1={esq} x2={W} y1={g.y} y2={g.y} stroke="#E5E7EB" strokeDasharray="3 4" />
            <text x={esq + 2} y={g.y - 4} textAnchor="start" fontSize="10" fill="#78716C" stroke="#FFFFFF" strokeWidth="3" paintOrder="stroke">{formato(g.v)}</text>
          </g>
        ))}
        <line x1={esq} x2={W} y1={base} y2={base} stroke="#CBD5E1" />
        {dados.map((x, i) => {
          const v = valores[i];
          const h = Math.max(v > 0 ? 3 : 0, ((base - top) * v) / max);
          const cx = esq + passo * i + passo / 2;
          const destaque = doPeriodo.includes(x.mes);
          // Sem espaço para todos os meses: um sim, um não (o último sempre).
          const mostraMes = passo >= 40 || (dados.length - 1 - i) % 2 === 0;
          return (
            <g key={x.mes} onMouseEnter={() => setFoco(i)} onFocus={() => setFoco(i)} tabIndex={0} style={{ outline: "none" }}>
              <rect x={cx - passo / 2} y={top} width={passo} height={base - top + 24} fill="transparent" />
              <path d={`M${cx - larg / 2},${base} V${base - h + Math.min(4, h)} Q${cx - larg / 2},${base - h} ${cx - larg / 2 + Math.min(4, larg / 2)},${base - h} H${cx + larg / 2 - Math.min(4, larg / 2)} Q${cx + larg / 2},${base - h} ${cx + larg / 2},${base - h + Math.min(4, h)} V${base} Z`}
                fill={cor(x.mes)} opacity={foco === null || foco === i ? 1 : 0.55} />
              {destaque && v > 0 && passo >= 46 && <text x={cx} y={base - h - 5} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#1C1917">{formato(v)}</text>}
              {mostraMes && <text x={cx} y={base + 15} textAnchor="middle" fontSize="10.5" fill={destaque ? "#1C1917" : "#78716C"} fontWeight={destaque ? 700 : 500}>{mesCurto(x.mes)}</text>}
            </g>
          );
        })}
      </svg>
      {d && (
        <div className="pc-tooltip" style={{ left: `${Math.min(82, Math.max(4, ((foco! + 0.5) / dados.length) * 100 - 9))}%` }}>
          <strong>{mesCurto(d.mes)}</strong>
          <span>Receita FireHub <b>{moeda(d.previsto)}</b></span>
          <span>Recebido <b>{moeda(d.recebido)}</b></span>
          <span>Faturamento <b>{moeda(d.gmv)}</b></span>
          <span>Comissão <b>{moeda(d.comissao)}</b></span>
          <span>Lojas <b>{d.lojas}</b> · ativas <b>{d.ativas}</b> · vendas <b>{n0(d.vendas)}</b></span>
        </div>
      )}
      <div className="pc-legenda">
        <span><i style={{ background: COR_DO_PERIODO }} /> Período escolhido</span>
        <span><i style={{ background: COR_DO_ANTERIOR }} /> Período anterior</span>
        <span><i style={{ background: COR_DO_HISTORICO }} /> Histórico</span>
      </div>
    </div>
  );
}

// ── O detalhe de uma carteira ────────────────────────────────────────────────

function DetalheDaCarteiraTela({ id, consulta, aoFechar }: { id: string; consulta: string; aoFechar: () => void }) {
  const dinheiro = useDinheiro();
  const [d, setD] = useState<DetalheDaCarteira | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [medida, setMedida] = useState<Medida>("previsto");
  const [aba, setAba] = useState<"numeros" | "carteira">("numeros");

  useEffect(() => {
    let vivo = true;
    setD(null); setErro(null);
    fetch(`/api/admin/performance-das-carteiras/${encodeURIComponent(id)}?${consulta}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!vivo) return; if (!r.ok) setErro(j.error || "Não deu para abrir a carteira."); else setD(j); })
      .catch(() => vivo && setErro("Sem conexão."));
    return () => { vivo = false; };
  }, [id, consulta]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = antes; };
  }, [aoFechar]);

  const r = d?.resumo;
  const m = MEDIDAS.find((x) => x.chave === medida)!;
  const formatoDoGrafico = m.dinheiro ? (v: number) => `R$ ${compacto(v)}` : n0;
  const receita = r?.atual.receita;
  const linhasDaReceita = receita ? [
    { nome: "Mensalidades", atual: receita.mensalidade, anterior: r!.anterior.receita.mensalidade },
    ...(Object.keys(receita.servicos) as (keyof typeof receita.servicos)[]).map((k) => ({ nome: NOME_DO_SERVICO[k], atual: receita.servicos[k], anterior: r!.anterior.receita.servicos[k] })),
  ].filter((x) => x.atual > 0 || x.anterior > 0) : [];
  const lojasDoLink = d ? d.lojas.filter((l) => l.origem === "LINK").length : 0;
  const lojasAtribuidas = d ? d.lojas.filter((l) => l.origem === "ATRIBUIDA").length : 0;
  const maxReceita = Math.max(1, ...linhasDaReceita.flatMap((x) => [x.atual, x.anterior]));

  return (
    <div className="pf-gaveta-fundo" onClick={aoFechar}>
      <aside className="pf-gaveta pc-gaveta" role="dialog" aria-modal="true" aria-label="Carteira" onClick={(e) => e.stopPropagation()}>
        <div className="pf-gaveta-topo">
          <strong>{r ? `${r.nome} · ${PAPEL[r.papel]}` : "Carteira"}</strong>
          <button type="button" className="pf-fechar" onClick={aoFechar} aria-label="Fechar"><X size={17} aria-hidden /></button>
        </div>
        {erro ? <div className="pf-perfil"><div className="pf-erro-caixa">{erro}</div></div> : !d || !r ? (
          <div className="pf-esqueleto"><div style={{ height: 90 }} /><div style={{ height: 260 }} /><div style={{ height: 300 }} /></div>
        ) : (
          <div className="pf-perfil">
            <div>
              <div className="pf-nome">{r.nome}</div>
              <div className="pf-cab-info"><span>{PAPEL[r.papel]}{!r.ativo ? " (pausado)" : ""}</span><span>{d.periodo.rotulo} contra {d.periodo.rotuloDoAnterior}</span></div>
            </div>
            <div className="pc-abas" role="tablist">
              <button type="button" role="tab" aria-selected={aba === "numeros"} className={aba === "numeros" ? "on" : ""} onClick={() => setAba("numeros")}>Performance</button>
              <button type="button" role="tab" aria-selected={aba === "carteira"} className={aba === "carteira" ? "on" : ""} onClick={() => setAba("carteira")}>Carteira e oportunidades</button>
            </div>

            {aba === "carteira" ? (
              <RelatorioDaCarteira fonte="/api/admin/perfil-das-lojas" tema="admin" vendedorFixo={id} titulo={`Carteira de ${r.nome}`} />
            ) : (
              <>
                <div className="pc-kpis">
                  <Kpi rotulo="Lojas na carteira" valor={String(r.atual.lojas)} extra={<DeltaAbs atual={r.atual.lojas} anterior={r.anterior.lojas} />} sub={`${r.atual.novas} novas · ${r.atual.perdidas} perdidas`} />
                  <Kpi rotulo="Faturamento das lojas" valor={dinheiro(r.atual.gmv)} extra={<Delta pct={r.variacao.gmv} />} sub={`antes ${dinheiro(r.anterior.gmv)}`} />
                  <Kpi rotulo="Receita FireHub (prevista)" valor={dinheiro(r.atual.receita.previsto)} extra={<Delta pct={r.variacao.receita} />} sub={`recebido ${dinheiro(r.atual.receita.recebido)} · aberto ${dinheiro(r.atual.receita.emAberto)}`} />
                  <Kpi rotulo="Comissão" valor={dinheiro(r.atual.comissaoPrevista)} extra={<Delta pct={r.variacao.comissao} />} sub={`recebida ${dinheiro(r.atual.comissaoRecebida)}`} />
                  <Kpi rotulo="Conversão do teste" valor={r.atual.conversaoPct === null ? "—" : `${r.atual.conversaoPct}%`} sub={`${r.atual.novasPagantes} de ${r.atual.novasForaDoTeste} que saíram do teste pagaram`} />
                  <Kpi rotulo="Em risco agora" valor={dinheiro(r.agora.gmvEmRisco)} sub={`${r.agora.emRisco} lojas esfriando/paradas · ${r.agora.bloqueadas} bloqueadas`} alerta={r.agora.emRisco > 0} />
                </div>

                <section className="pf-painel">
                  <div className="pf-painel-cab">
                    <div>
                      <h3 className="pf-h">Evolução mês a mês</h3>
                      <p className="pf-sub">Laranja = período escolhido; azul = o anterior. Só conta a loja depois que ela entrou na carteira.</p>
                    </div>
                    <div className="pf-chips" role="group" aria-label="Medida do gráfico">
                      {MEDIDAS.map((x) => <button key={x.chave} type="button" className={`pf-chip${medida === x.chave ? " on" : ""}`} onClick={() => setMedida(x.chave)} aria-pressed={medida === x.chave}>{x.rotulo}</button>)}
                    </div>
                  </div>
                  <div style={{ padding: "0 14px 14px" }}>
                    <GraficoMensal dados={d.evolucao} medida={medida} doPeriodo={d.mesesDoPeriodo} doAnterior={d.mesesDoAnterior} formato={formatoDoGrafico} moeda={dinheiro} />
                  </div>
                </section>

                {r.regra && (r.papel === "VENDEDOR" || r.regra.embaixador !== null) && (
                  <ComoVoceGanha embutido modo="ADMIN" d={{
                    embaixador: r.regra.embaixador, lojasIndicadas: d.lojas.filter((l) => l.origem === "INDICACAO").length,
                    link: r.regra.link, atribuida: r.regra.atribuida, lojasDoLink, lojasAtribuidas,
                    previstoNoMes: r.atual.comissaoPrevista, recebidoNoMes: r.atual.comissaoRecebida, recebidoNoMesAnterior: null,
                    ganhoComDisparo: r.atual.comissaoDoDisparo, divergencias: r.regra.divergencias, custoMeta: d.custoMetaAtual,
                    disparoDoAdmin: { bruto: r.atual.receita.disparoBruto, margem: r.atual.receita.servicos.disparo, estimado: d.disparoEstimado },
                    rotulos: { previsto: "Comissão prevista no período", previstoSub: d.periodo.rotulo, recebido: "Já recebida no período" },
                  }} />
                )}

                <div className="pf-duas">
                  <section className="pf-painel">
                    <div className="pf-painel-cab"><div><h3 className="pf-h">De onde vem a receita</h3><p className="pf-sub">Barra = período; traço azul = anterior. Disparo entra pelo lucro do FireHub (recarga − custo da Meta).</p></div></div>
                    {linhasDaReceita.length === 0 ? <div className="pf-vazio">Nenhuma receita no período (lojas em teste, isentas ou sem cobrança).</div> : (
                      <ul className="pc-receita">
                        {linhasDaReceita.map((x) => (
                          <li key={x.nome}>
                            <span>{x.nome}</span>
                            <div className="pc-receita-barra" title={`${x.nome}: ${dinheiro(x.atual)} (antes ${dinheiro(x.anterior)})`}>
                              <span style={{ width: `${(x.atual / maxReceita) * 100}%` }} />
                              {x.anterior > 0 && <i style={{ left: `calc(${(x.anterior / maxReceita) * 100}% - 1px)` }} />}
                            </div>
                            <b>{dinheiro(x.atual)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                    {receita && receita.disparoBruto > 0 && (
                      <p className="pc-disparo">
                        Disparo: <b>{dinheiro(receita.disparoBruto)}</b> cobrado das lojas → <b>{dinheiro(receita.servicos.disparo)}</b> de lucro do FireHub
                        {d.disparoEstimado ? ` (custo da Meta estimado em ${dinheiro(d.custoMetaAtual)} por mensagem onde a recarga não gravou o custo)` : " (custo da Meta gravado em cada recarga)"}.
                        {" "}Comissão do vendedor que atende (3% do lucro): <b>{dinheiro(r.atual.comissaoDoDisparo)}</b> — no split do Pix das recargas geradas a partir desta versão.
                      </p>
                    )}
                  </section>
                  <section className="pf-painel">
                    <div className="pf-painel-cab"><div><h3 className="pf-h">Funil comercial</h3><p className="pf-sub">{r.crm ? "Do CRM (contatos atribuídos ao vendedor) até a loja que pagou." : "Sem CRM: embaixador e “Sem vendedor” não atendem pelo CRM."}</p></div></div>
                    <Funil r={r} />
                  </section>
                </div>

                <section className="pf-painel">
                  <div className="pf-painel-cab">
                    <div>
                      <h3 className="pf-h">Lojas da carteira <small>{d.lojas.length}</small></h3>
                      <p className="pf-sub">No período escolhido. Status = agora (régua diária do perfil da loja).</p>
                    </div>
                  </div>
                  <TabelaDeLojas lojas={d.lojas} />
                </section>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Kpi({ rotulo, valor, extra, sub, alerta }: { rotulo: string; valor: string; extra?: React.ReactNode; sub?: string; alerta?: boolean }) {
  return (
    <div className={`pf-kpi pc-kpi${alerta ? " alerta" : ""}`}>
      <span className="pf-rotulo">{rotulo}</span>
      <div className="pc-kpi-linha"><div className="pf-kpi-val dinheiro">{valor}</div>{extra}</div>
      {sub && <div className="pf-kpi-sub">{sub}</div>}
    </div>
  );
}

function Funil({ r }: { r: ResumoDaCarteira }) {
  const etapas = [
    ...(r.crm ? [{ nome: "Leads recebidos (CRM)", n: r.crm.atual.leads, ant: r.crm.anterior.leads }] : []),
    ...(r.crm ? [{ nome: "Demos feitas", n: r.crm.atual.demosFeitas, ant: r.crm.anterior.demosFeitas }] : []),
    { nome: "Lojas novas (teste)", n: r.atual.novas, ant: r.anterior.novas },
    { nome: "Saíram do teste", n: r.atual.novasForaDoTeste, ant: r.anterior.novasForaDoTeste },
    { nome: "Pagaram um boleto", n: r.atual.novasPagantes, ant: r.anterior.novasPagantes },
  ];
  const max = Math.max(1, ...etapas.map((e) => e.n));
  return (
    <div className="pc-funil">
      {etapas.map((e, i) => (
        <div key={e.nome} className="pc-funil-linha">
          <span>{e.nome}</span>
          <div className="pc-funil-barra"><span style={{ width: `${Math.max(e.n > 0 ? 4 : 0, (e.n / max) * 100)}%` }} /></div>
          <b>{e.n}</b>
          <small>{i > 0 && etapas[i - 1].n > 0 ? `${Math.round((e.n / etapas[i - 1].n) * 100)}%` : ""}</small>
        </div>
      ))}
      {r.crm && (
        <p className="pc-funil-nota">
          {r.crm.atual.conversas} conversas · {r.crm.atual.mensagens} mensagens · 1º contato em {r.crm.atual.tempoAtePrimeiroContatoMin === null ? "—" : `${r.crm.atual.tempoAtePrimeiroContatoMin} min`} · {r.crm.atual.esperando} esperando contato · {r.crm.atual.proximasDemos} demos marcadas à frente
        </p>
      )}
    </div>
  );
}

function TabelaDeLojas({ lojas }: { lojas: LinhaDaLojaNaCarteira[] }) {
  const dinheiro = useDinheiro();
  if (!lojas.length) return <div className="pf-vazio">Nenhuma loja nesta carteira.</div>;
  return (
    <div className="pf-tabela-rolagem">
      <table className="pf-tabela pc-tabela-lojas">
        <thead>
          <tr><th>Loja</th><th className="dir">Faturamento</th><th className="so-largo">Origem</th><th className="dir so-largo">Receita FireHub</th><th className="dir so-largo">Comissão</th><th className="so-largo">Upsell no período</th><th className="so-largo">Oferecer</th></tr>
        </thead>
        <tbody>
          {lojas.map((l) => (
            <tr key={l.id} style={{ cursor: "default" }}>
              <td>
                <div className="pf-loja-cel">
                  <strong>{l.nome}</strong>
                  <small style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {l.statusAgora && <PilulaDoStatus status={l.statusAgora as any} curta />}
                    {l.bloqueada && <span className="pf-tag" style={{ background: "#FCE8E6", color: "#B91C1C" }}>bloqueada</span>}
                    {l.isenta && <span className="pf-tag" style={{ background: "#F1F5F9", color: "#475569" }}>isenta</span>}
                    {l.cidade}
                  </small>
                </div>
              </td>
              <td className="dir"><b>{dinheiro(l.gmv)}</b><div><Delta pct={l.variacaoGmv} /></div></td>
              <td className="so-largo">
                <span className={`pf-tag ${l.origem === "LINK" ? "venda" : "adocao"}`}>{ROTULO_DA_ORIGEM[l.origem]}{l.percentual !== null ? ` · ${l.percentual}%` : ""}</span>
              </td>
              <td className="dir so-largo"><b>{dinheiro(l.previsto)}</b><div className="pc-fraco">receb. {dinheiro(l.recebido)}{l.emAberto > 0 ? ` · aberto ${dinheiro(l.emAberto)}` : ""}</div></td>
              <td className="dir so-largo"><b>{dinheiro(l.comissao)}</b><div className="pc-fraco">receb. {dinheiro(l.comissaoRecebida)}{l.comissaoDoDisparo > 0 ? ` · disparo ${dinheiro(l.comissaoDoDisparo)}` : ""}</div></td>
              <td className="so-largo">{l.upsell.length ? <div className="pf-ops-mini">{l.upsell.map((u) => <span key={u} className="pf-tag venda">{NOME_DO_SERVICO[u as keyof typeof NOME_DO_SERVICO] || u}</span>)}</div> : <span className="pc-fraco">—</span>}</td>
              <td className="so-largo">{l.produtos.length ? <div className="pf-ops-mini">{l.produtos.slice(0, 2).map((p) => <span key={p} className="pf-tag adocao">{p}</span>)}{l.produtos.length > 2 && <span className="pc-fraco">+{l.produtos.length - 2}</span>}</div> : <span className="pc-fraco">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── A tela ───────────────────────────────────────────────────────────────────

export default function PerformanceDasCarteiras() {
  const dinheiro = useDinheiro();
  const [filtro, setFiltro] = useState<Filtro>({ chave: "mes" });
  const [rascunho, setRascunho] = useState<{ mes: string; de: string; ate: string }>({ mes: "", de: "", ate: "" });
  const consulta = consultaDo(filtro);
  const [ordem, setOrdem] = useState<OrdemDoComparativo>("receita");
  const [dados, setDados] = useState<Analise | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const fechar = useCallback(() => setAberta(null), []);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(`/api/admin/performance-das-carteiras?${consulta}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErro(j.error || "Não deu para carregar a análise.");
      else setDados(j);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, [consulta]);
  useEffect(() => { void carregar(); }, [carregar]);

  const carteiras = useMemo(() => (dados ? ordenarCarteiras(dados.carteiras, ordem) : []), [dados, ordem]);
  const vendedores = carteiras.filter((c) => c.crm);
  const t = dados?.total;
  const maxReceita = Math.max(1, ...carteiras.flatMap((c) => [c.atual.receita.previsto, c.anterior.receita.previsto]));

  const exportar = () => {
    if (!dados) return;
    const blob = new Blob([csvDoComparativo(carteiras, dados.periodo)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `carteiras-${dados.periodo.chave}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setAviso({ tipo: "ok", titulo: "Comparativo baixado", detalhe: `${carteiras.length} carteiras no arquivo (abre no Excel).` });
  };

  return (
    <div className="pf pf-admin pc">
      <style>{ESTILO_DO_PERFIL + ESTILO_DA_PERFORMANCE + ESTILO_DO_COMISSIONAMENTO}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      {aberta && <DetalheDaCarteiraTela id={aberta} consulta={consulta} aoFechar={fechar} />}

      <div className="pf-relatorio">
        <div className="pf-rel-cab">
          <div>
            <h2>Performance das carteiras</h2>
            <p className="pf-sub">
              {dados ? `${dados.periodo.rotulo} contra ${dados.periodo.rotuloDoAnterior} · ${dados.carteiras.length} carteiras · atualizado às ${new Date(dados.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Carregando…"}
            </p>
          </div>
          <div className="pf-rel-acoes">
            <div className="pc-segmento" role="group" aria-label="Período">
              {ATALHOS_DO_PERIODO.map((p) => <button key={p.chave} type="button" className={filtro.chave === p.chave ? "on" : ""} onClick={() => setFiltro({ chave: p.chave })} aria-pressed={filtro.chave === p.chave}>{p.rotulo}</button>)}
            </div>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemDoComparativo)} aria-label="Ordenar por">
              {ORDENS.map((o) => <option key={o.chave} value={o.chave}>Ordenar: {o.rotulo}</option>)}
            </select>
            <button type="button" className="pf-botao" onClick={carregar} disabled={carregando}><RefreshCw size={14} className={carregando ? "pf-gira" : ""} aria-hidden /> Atualizar</button>
            <button type="button" className="pf-botao escuro" onClick={exportar} disabled={!dados}><Download size={14} aria-hidden /> CSV</button>
          </div>
        </div>

        <div className="pc-filtros" role="group" aria-label="Período livre">
          <label className={filtro.chave === "mesEspecifico" ? "on" : ""}>
            <span>Mês</span>
            <input type="month" value={rascunho.mes} max={new Date().toISOString().slice(0, 7)} onChange={(e) => {
              const v = e.target.value;
              setRascunho((x) => ({ ...x, mes: v }));
              if (v) setFiltro({ chave: "mesEspecifico", mes: v });
            }} />
          </label>
          <label className={filtro.chave === "intervalo" ? "on" : ""}>
            <span>De</span>
            <input type="date" value={rascunho.de} max={rascunho.ate || undefined} onChange={(e) => { const v = e.target.value; setRascunho((x) => ({ ...x, de: v })); }} />
          </label>
          <label className={filtro.chave === "intervalo" ? "on" : ""}>
            <span>Até</span>
            <input type="date" value={rascunho.ate} min={rascunho.de || undefined} onChange={(e) => { const v = e.target.value; setRascunho((x) => ({ ...x, ate: v })); }} />
          </label>
          <button type="button" className="pf-botao pequeno" disabled={!rascunho.de || !rascunho.ate} onClick={() => setFiltro({ chave: "intervalo", de: rascunho.de, ate: rascunho.ate })}>Aplicar intervalo</button>
          <span className="pc-fraco">Comparado com o mesmo trecho logo antes. Mensalidade e serviços são rateados pelos dias do mês dentro do período.</span>
        </div>

        {erro && <div className="pf-erro-caixa">{erro}<button type="button" className="pf-botao pequeno" onClick={carregar}>Tentar de novo</button></div>}
        {!dados && !erro && <div className="pf-esqueleto" style={{ padding: 0 }}><div style={{ height: 110 }} /><div style={{ height: 260 }} /><div style={{ height: 420 }} /></div>}

        {dados && t && (
          <>
            <div className="pc-kpis">
              <Kpi rotulo="Lojas" valor={String(t.atual.lojas)} extra={<DeltaAbs atual={t.atual.lojas} anterior={t.anterior.lojas} />} sub={`${t.atual.novas} novas · ${t.atual.perdidas} perdidas no período`} />
              <Kpi rotulo="Faturamento das lojas (GMV)" valor={dinheiro(t.atual.gmv)} extra={<Delta pct={t.variacao.gmv} />} sub={`${n0(t.atual.vendas)} vendas · antes ${dinheiro(t.anterior.gmv)}`} />
              <Kpi rotulo="Receita FireHub prevista" valor={dinheiro(t.atual.receita.previsto)} extra={<Delta pct={t.variacao.receita} />} sub={`faturado ${dinheiro(t.atual.receita.faturado)} · recebido ${dinheiro(t.atual.receita.recebido)} · antes ${dinheiro(t.anterior.receita.previsto)}`} />
              <Kpi rotulo="Em aberto" valor={dinheiro(t.atual.receita.emAberto)} sub={`${t.agora.bloqueadas} lojas bloqueadas por boleto agora`} alerta={t.atual.receita.emAberto > 0} />
              <Kpi rotulo="Comissões" valor={dinheiro(t.atual.comissaoPrevista)} extra={<Delta pct={t.variacao.comissao} />} sub={`recebidas ${dinheiro(t.atual.comissaoRecebida)}${t.atual.comissaoDoDisparo > 0 ? ` · + ${dinheiro(t.atual.comissaoDoDisparo)} do disparo` : ""}`} />
              <Kpi rotulo="Disparo oficial (lucro)" valor={dinheiro(t.atual.receita.servicos.disparo)} sub={`de ${dinheiro(t.atual.receita.disparoBruto)} em recargas pagas${dados.disparoEstimado ? " · custo Meta estimado" : ""}`} />
              <Kpi rotulo="Conversão do teste" valor={t.atual.conversaoPct === null ? "—" : `${t.atual.conversaoPct}%`} sub={`${t.atual.novasPagantes} de ${t.atual.novasForaDoTeste} pagaram · antes ${t.anterior.conversaoPct === null ? "—" : `${t.anterior.conversaoPct}%`}`} />
              <Kpi rotulo="Upsell no período" valor={String(t.atual.upsell)} extra={<DeltaAbs atual={t.atual.upsell} anterior={t.anterior.upsell} />} sub={`+${dinheiro(t.atual.upsellMensal)}/mês em serviços`} />
              <Kpi rotulo="Em risco agora" valor={dinheiro(t.agora.gmvEmRisco)} sub={`${t.agora.emRisco} lojas · ${t.agora.oportunidades} oportunidades (${dinheiro(t.agora.potencial)}/mês)`} alerta={t.agora.emRisco > 0} />
            </div>

            <section className="pf-painel">
              <div className="pf-painel-cab">
                <div>
                  <h3 className="pf-h">Receita do FireHub por carteira</h3>
                  <p className="pf-sub">Barra laranja = {dados.periodo.rotulo}; traço azul = {dados.periodo.rotuloDoAnterior}. Mensalidades + serviços pagos; mês aberto entra pelo previsto.</p>
                </div>
                <div className="pc-legenda"><span><i style={{ background: COR_DO_PERIODO }} /> Período</span><span><i className="traco" style={{ background: COR_DO_ANTERIOR }} /> Anterior</span></div>
              </div>
              {carteiras.length === 0 ? <div className="pf-vazio">Nenhuma carteira ainda — atribua lojas a um vendedor em Lojistas.</div> : (
                <ul className="pc-barras">
                  {carteiras.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => setAberta(c.id)} title={`${c.nome}: ${dinheiro(c.atual.receita.previsto)} (antes ${dinheiro(c.anterior.receita.previsto)})`}>
                        <span className="pc-barras-nome">{c.nome}</span>
                        <span className="pc-barras-trilho">
                          <span style={{ width: `${(c.atual.receita.previsto / maxReceita) * 100}%` }} />
                          {c.anterior.receita.previsto > 0 && <i style={{ left: `calc(${(c.anterior.receita.previsto / maxReceita) * 100}% - 1px)` }} />}
                        </span>
                        <b>{dinheiro(c.atual.receita.previsto)}</b>
                        <Delta pct={c.variacao.receita} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="pf-painel">
              <div className="pf-painel-cab">
                <div>
                  <h3 className="pf-h">Ranking das carteiras</h3>
                  <p className="pf-sub">Toque numa carteira para ver a evolução, as lojas e as oportunidades. Uma loja indicada por um embaixador e atendida por um vendedor aparece nas duas carteiras.</p>
                </div>
              </div>
              <div className="pf-tabela-rolagem pc-so-largo">
                <table className="pf-tabela pc-ranking">
                  <thead>
                    <tr>
                      <th>#</th><th>Carteira</th><th className="dir">Lojas</th><th title="Situação das lojas no fim do período (régua mensal)">Situação</th><th className="dir">GMV</th>
                      <th className="dir">Receita FireHub</th><th className="dir">Comissão</th><th className="dir">Teste → pag.</th>
                      <th className="dir">Upsell / oport.</th><th className="dir">Em risco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carteiras.map((c, i) => (
                      <tr key={c.id} onClick={() => setAberta(c.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setAberta(c.id); }}>
                        <td><span className={`pf-pos${i < 3 && c.id !== "sem" ? " ouro" : ""}`}>{i < 3 && c.id !== "sem" ? <Medal size={13} aria-label={`${i + 1}º`} /> : i + 1}</span></td>
                        <td><div className="pf-loja-cel"><strong>{c.nome}</strong><small>{PAPEL[c.papel]}{!c.ativo ? " · pausado" : ""}</small></div></td>
                        <td className="dir"><b>{c.atual.lojas}</b><div><DeltaAbs atual={c.atual.lojas} anterior={c.anterior.lojas} /></div>{c.atual.perdidas > 0 && <div className="pc-fraco" title="Perdidas no período (pararam de vender)" style={{ color: "#B91C1C" }}>{c.atual.perdidas} perdida{c.atual.perdidas === 1 ? "" : "s"}</div>}{c.papel === "VENDEDOR" && <div className="pc-fraco" title="Pelo link de convite / atribuídas" style={{ whiteSpace: "nowrap" }}>{c.atual.porOrigem.LINK} link · {c.atual.porOrigem.ATRIBUIDA} atr.</div>}</td>
                        <td><BarraDaSituacao s={c.atual.porSituacao} /></td>
                        <td className="dir"><b>{dinheiro(c.atual.gmv)}</b><div><Delta pct={c.variacao.gmv} /></div></td>
                        <td className="dir pc-receita-cel"><b>{dinheiro(c.atual.receita.previsto)}</b><div className="pc-fraco">receb. {dinheiro(c.atual.receita.recebido)}{c.atual.receita.emAberto > 0 ? ` · aberto ${dinheiro(c.atual.receita.emAberto)}` : ""}</div></td>
                        <td className="dir">{c.papel === "SEM_VENDEDOR" ? <span className="pc-fraco">—</span> : <><b>{dinheiro(c.atual.comissaoPrevista)}</b><div className="pc-fraco">receb. {dinheiro(c.atual.comissaoRecebida)}</div>{c.regra && c.regra.divergencias.length > 0 && <div className="pc-fraco" style={{ color: "#B45309" }} title={c.regra.divergencias.join(" ")}>⚠ cadastro {c.regra.link}% / {c.regra.atribuida}%</div>}</>}</td>
                        <td className="dir"><b>{c.atual.novasPagantes}/{c.atual.novasForaDoTeste}</b><div className="pc-fraco">{c.atual.conversaoPct === null ? `${c.atual.novas} novas` : `${c.atual.conversaoPct}% · ${c.atual.novas} novas`}</div></td>
                        <td className="dir"><b title="Serviços pagos que começaram no período">{c.atual.upsell}</b> <span className="pc-fraco">/</span> <b title="Oportunidades de venda abertas agora">{c.agora.oportunidades}</b><div className="pc-fraco">{c.atual.upsellMensal > 0 ? `+${dinheiro(c.atual.upsellMensal)}` : "—"} / {dinheiro(c.agora.potencial)}</div></td>
                        <td className="dir">{c.agora.emRisco > 0 ? <><b style={{ color: "#B91C1C" }}>{c.agora.emRisco}</b><div className="pc-fraco">{dinheiro(c.agora.gmvEmRisco)}</div></> : <span className="pc-fraco">0</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="pc-cartoes pc-so-estreito">
                {carteiras.map((c, i) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setAberta(c.id)}>
                      <div className="pc-cartao-topo">
                        <span className={`pf-pos${i < 3 && c.id !== "sem" ? " ouro" : ""}`}>{i + 1}</span>
                        <div style={{ minWidth: 0, flex: 1 }}><strong>{c.nome}</strong><small>{PAPEL[c.papel]} · {c.atual.lojas} lojas</small></div>
                        <ChevronRight size={16} color="#94A3B8" aria-hidden />
                      </div>
                      <div className="pc-cartao-grade">
                        <div><span>Receita FireHub</span><b>{dinheiro(c.atual.receita.previsto)}</b><Delta pct={c.variacao.receita} /></div>
                        <div><span>GMV</span><b>{dinheiro(c.atual.gmv)}</b><Delta pct={c.variacao.gmv} /></div>
                        <div><span>Comissão</span><b>{c.papel === "SEM_VENDEDOR" ? "—" : dinheiro(c.atual.comissaoPrevista)}</b></div>
                        <div><span>Teste → pagante</span><b>{c.atual.novasPagantes}/{c.atual.novasForaDoTeste}</b></div>
                        <div><span>Perdidas</span><b>{c.atual.perdidas}</b></div>
                        <div><span>Em risco</span><b style={{ color: c.agora.emRisco ? "#B91C1C" : undefined }}>{c.agora.emRisco}</b></div>
                      </div>
                      <BarraDaSituacao s={c.atual.porSituacao} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="pf-painel">
              <div className="pf-painel-cab">
                <div>
                  <h3 className="pf-h"><Users size={17} aria-hidden /> Atividade comercial (CRM)</h3>
                  <p className="pf-sub">A mesma conta do antigo “Desempenho da equipe” (lib/crm/desempenho.ts), no período escolhido, com o funil até a loja pagar.</p>
                </div>
              </div>
              {vendedores.length === 0 ? <div className="pf-vazio">Nenhum vendedor na equipe ainda.</div> : (
                <div className="pf-tabela-rolagem">
                  <table className="pf-tabela pc-crm">
                    <thead>
                      <tr>
                        <th>Vendedor</th><th className="dir">Leads</th><th className="dir">Conversas</th><th className="dir">1º contato</th><th className="dir">Esperando</th>
                        <th className="dir">Demos</th><th className="dir">Cadastros</th><th className="dir">Pagantes</th><th className="dir">Conversão</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendedores.map((c) => {
                        const a = c.crm!.atual, b = c.crm!.anterior;
                        const leadCad = a.leads > 0 ? Math.round((a.cadastros / a.leads) * 100) : null;
                        const cadPag = c.atual.novasForaDoTeste > 0 ? Math.round((c.atual.novasPagantes / c.atual.novasForaDoTeste) * 100) : null;
                        return (
                          <tr key={c.id} onClick={() => setAberta(c.id)}>
                            <td><div className="pf-loja-cel"><strong>{c.nome}</strong>{!c.ativo && <small>pausado</small>}</div></td>
                            <td className="dir"><b>{a.leads}</b><div><DeltaAbs atual={a.leads} anterior={b.leads} /></div></td>
                            <td className="dir"><b>{a.conversas}</b><div className="pc-fraco">{a.mensagens} msgs</div></td>
                            <td className="dir">{a.tempoAtePrimeiroContatoMin === null ? <span className="pc-fraco">—</span> : <b style={{ color: a.tempoAtePrimeiroContatoMin > 120 ? "#B91C1C" : undefined }}>{a.tempoAtePrimeiroContatoMin < 60 ? `${a.tempoAtePrimeiroContatoMin} min` : `${(a.tempoAtePrimeiroContatoMin / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`}</b>}</td>
                            <td className="dir">{a.esperando > 0 ? <b style={{ color: "#B45309" }}>{a.esperando}</b> : <span className="pc-fraco">0</span>}</td>
                            <td className="dir"><b>{a.demosFeitas}</b><div className="pc-fraco">{a.demosMarcadas} marcadas · {a.demosFaltou} faltas</div></td>
                            <td className="dir"><b>{a.cadastros}</b><div><DeltaAbs atual={a.cadastros} anterior={b.cadastros} /></div></td>
                            <td className="dir"><b>{c.atual.novasPagantes}</b></td>
                            <td className="dir"><div className="pc-conv"><span>lead → cadastro <b>{leadCad === null ? "—" : `${leadCad}%`}</b></span><span>teste → pagante <b>{cadPag === null ? "—" : `${cadPag}%`}</b></span></div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <details className="pf-painel pc-como">
              <summary><Info size={15} aria-hidden /> Como cada número é calculado</summary>
              <ul>
                <li><b>Carteira</b> = uma loja, um dono: o vendedor que ATENDE — o atribuído (desde a atribuição); sem atribuído, quem convidou pelo link (desde o cadastro). Quem convidou e não atende não vê a loja. Loja indicada por embaixador que não vende aparece nas indicações dele e na carteira do vendedor que atende. “Sem vendedor” = sem vendedor e sem embaixador. A troca de vendedor não tem histórico: vale a carteira de hoje.</li>
                <li><b>Situação</b> no fim do período, régua mensal: nova (cadastrada no mês ou em teste), parada (0 vendas no mês), esfriando (≤ 70% das vendas do mês anterior, com base ≥ 20; o mês corrente é projetado), ativa.</li>
                <li><b>GMV</b> = soma do valor dos pedidos na régua dos relatórios (sem cancelado, reposição e não concluídos; mesa uma vez). No “Mês atual” o mês anterior é cortado no mesmo ponto.</li>
                <li><b>Receita FireHub</b>: mês fechado = boleto emitido (pago: valor pago; aberto: pendente) + recargas de disparo pagas. Mês aberto = previsto (mensalidade que o ciclo já soma + tráfego + totem + Bill/App/Multimarcas ativos). Recebido = boleto pago + recargas. Em aberto = boleto emitido e não pago. Isenta não gera receita.</li>
                <li><b>Comissão</b> = a do split do boleto: entre os vendedores ganha quem ATENDE — o atribuído; sem atribuído, quem convidou pelo link. Ele leva o % de link do cadastro (10%) se foi ele quem convidou, o de atribuída (3%) se não; quem convidou e não atende, ou está com a conta pausada, não leva nada. Embaixador que não vende → o % dele (programa de indicação). Incide sobre o boleto do mês (mensalidade + serviços cobrados nele); recebida = boleto pago. Período que pega parte do mês leva a parte proporcional.</li>
                <li><b>Disparo oficial</b> = lucro do FireHub na recarga paga (valor − mensagens × custo da Meta gravado na recarga; sem o custo gravado, o custo atual, marcado como estimado). O vendedor que atende leva sempre 3% desse lucro, em split de valor fixo no Pix da recarga (recargas geradas a partir desta versão).</li>
                <li><b>Teste → pagante</b> = lojas novas do período que já saíram do teste e pagaram pelo menos um boleto ÷ as que já saíram do teste.</li>
                <li><b>Perdidas</b> = venderam num mês e ficaram o mês seguinte inteiro sem vender, sem voltar até o fim do período (no mês corrente: 30+ dias sem venda). Loja excluída do sistema não aparece — não há registro de cancelamento.</li>
                <li><b>Upsell</b> = serviço pago que começou no período (App, Bill, Multimarcas, totem, primeira recarga de disparo, primeiro mês de tráfego).</li>
                <li><b>Oportunidades e risco</b> são de agora (perfil da loja); “em risco” = esfriando ou parada que já vendeu, com o GMV dos 30 dias anteriores.</li>
              </ul>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

const ESTILO_DA_PERFORMANCE = `
.pc .pc-segmento { display: inline-flex; background: var(--pf-neutro-bg); border-radius: 10px; padding: 3px; gap: 2px; flex-wrap: wrap; }
.pc .pc-segmento button { border: none; background: none; font: inherit; font-size: 0.8rem; font-weight: 700; color: var(--pf-tinta-2); padding: 6px 11px; border-radius: 8px; cursor: pointer; }
.pc .pc-segmento button.on { background: var(--pf-papel); color: var(--pf-tinta); box-shadow: 0 1px 2px rgba(15,23,42,.14); }
.pc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(158px, 1fr)); gap: 10px; }
.pc-kpi.alerta { border-color: #F3C4BF; background: #FFFBFA; }
.pc-kpi-linha { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pc-delta { display: inline-flex; align-items: center; gap: 2px; font-size: 0.74rem; font-weight: 800; white-space: nowrap; padding: 1px 6px; border-radius: 999px; }
.pc-delta.sobe { color: #15803D; background: #E3F4E7; } .pc-delta.cai { color: #B91C1C; background: #FCE8E6; } .pc-delta.neutro { color: #64748B; background: #F1F5F9; }
.pc-fraco { color: var(--pf-cinza); font-size: 0.74rem; }
.pc-sit { display: flex; flex-direction: column; gap: 4px; min-width: 170px; }
.pc-sit small { color: var(--pf-cinza); font-size: 0.72rem; white-space: nowrap; }
.pc-legenda { display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.76rem; color: var(--pf-tinta-2); }
.pc-legenda span { display: inline-flex; align-items: center; gap: 6px; }
.pc-legenda i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.pc-legenda i.traco { width: 3px; height: 14px; border-radius: 2px; }
.pc-barras { list-style: none; margin: 0; padding: 0 14px 14px; display: flex; flex-direction: column; gap: 4px; }
.pc-barras button { all: unset; cursor: pointer; display: grid; grid-template-columns: minmax(110px, 180px) minmax(0, 1fr) auto auto; gap: 12px; align-items: center; width: 100%; padding: 6px 6px; border-radius: 8px; box-sizing: border-box; }
.pc-barras button:hover { background: var(--pf-papel-2); }
.pc-barras button:focus-visible { outline: 2px solid var(--pf-laranja); }
.pc-barras-nome { font-weight: 700; font-size: 0.84rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-barras-trilho { position: relative; height: 14px; background: var(--pf-neutro-bg); border-radius: 999px; }
.pc-barras-trilho span { position: absolute; left: 0; top: 0; bottom: 0; background: ${COR_DO_PERIODO}; border-radius: 999px; min-width: 3px; }
.pc-barras-trilho i { position: absolute; top: -3px; bottom: -3px; width: 3px; border-radius: 2px; background: ${COR_DO_ANTERIOR}; box-shadow: 0 0 0 2px var(--pf-papel); }
.pc-barras b { font-variant-numeric: tabular-nums; font-size: 0.86rem; text-align: right; min-width: 96px; }
.pc-ranking td, .pc-crm td { vertical-align: top; }
.pc-ranking th, .pc-ranking td, .pc-crm th, .pc-crm td { padding-left: 8px; padding-right: 8px; }
.pc-ranking .pc-sit { min-width: 0; width: 132px; }
.pc-ranking td.dir .pc-fraco { white-space: normal; }
.pc-ranking td.pc-receita-cel { max-width: 150px; }
.pc-ranking tbody tr:hover td:nth-child(2) strong { color: var(--pf-laranja-escuro); }
.pc-ranking .pc-sit small { white-space: normal; }
.pc-conv { display: flex; flex-direction: column; gap: 1px; font-size: 0.74rem; color: var(--pf-cinza); white-space: nowrap; }
.pc-conv b { color: var(--pf-tinta); }
.pc-crm tbody tr { cursor: pointer; }
.pc-cartoes { list-style: none; margin: 0; padding: 0 12px 12px; display: none; flex-direction: column; gap: 8px; }
.pc-cartoes button { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 10px; width: 100%; box-sizing: border-box; border: 1px solid var(--pf-linha); border-radius: 14px; padding: 12px; background: var(--pf-papel); }
.pc-cartao-topo { display: flex; align-items: center; gap: 10px; }
.pc-cartao-topo strong { display: block; font-size: 0.95rem; }
.pc-cartao-topo small { color: var(--pf-cinza); font-size: 0.74rem; }
.pc-cartao-grade { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px 12px; }
.pc-cartao-grade div { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; }
.pc-cartao-grade span { font-size: 0.7rem; color: var(--pf-cinza); font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
.pc-cartao-grade b { font-size: 0.95rem; font-variant-numeric: tabular-nums; }
.pc-grafico { position: relative; }
.pc-grafico svg { width: 100%; height: 220px; display: block; overflow: visible; }
.pc-tooltip { position: absolute; top: 4px; min-width: 180px; background: #1C1917; color: #FAFAF9; border-radius: 10px; padding: 9px 11px; font-size: 0.76rem; display: flex; flex-direction: column; gap: 2px; pointer-events: none; box-shadow: 0 10px 24px -8px rgba(0,0,0,.4); z-index: 2; }
.pc-tooltip strong { font-size: 0.84rem; margin-bottom: 2px; }
.pc-tooltip span { color: #D6D3D1; } .pc-tooltip b { color: #fff; font-variant-numeric: tabular-nums; }
.pc-grafico .pc-legenda { margin-top: 6px; }
.pc-abas { display: inline-flex; background: var(--pf-neutro-bg); border-radius: 10px; padding: 3px; gap: 2px; align-self: flex-start; }
.pc-abas button { border: none; background: none; font: inherit; font-size: 0.82rem; font-weight: 700; color: var(--pf-tinta-2); padding: 7px 12px; border-radius: 8px; cursor: pointer; }
.pc-abas button.on { background: var(--pf-papel); color: var(--pf-tinta); box-shadow: 0 1px 2px rgba(15,23,42,.14); }
.pc-gaveta { width: min(1080px, 100vw); }
.pc-receita { list-style: none; margin: 0; padding: 0 18px 16px; display: flex; flex-direction: column; gap: 8px; }
.pc-receita li { display: grid; grid-template-columns: minmax(96px, 150px) minmax(0,1fr) auto; gap: 10px; align-items: center; font-size: 0.82rem; }
.pc-receita b { font-variant-numeric: tabular-nums; text-align: right; min-width: 92px; }
.pc-receita-barra { position: relative; height: 10px; background: var(--pf-neutro-bg); border-radius: 999px; }
.pc-receita-barra span { position: absolute; left: 0; top: 0; bottom: 0; background: ${COR_DO_PERIODO}; border-radius: 999px; min-width: 2px; }
.pc-receita-barra i { position: absolute; top: -3px; bottom: -3px; width: 3px; border-radius: 2px; background: ${COR_DO_ANTERIOR}; box-shadow: 0 0 0 2px var(--pf-papel); }
.pc-funil { padding: 0 18px 16px; display: flex; flex-direction: column; gap: 8px; }
.pc-funil-linha { display: grid; grid-template-columns: minmax(110px, 170px) minmax(0,1fr) 40px 40px; gap: 10px; align-items: center; font-size: 0.82rem; }
.pc-funil-linha b { text-align: right; font-variant-numeric: tabular-nums; }
.pc-funil-linha small { color: var(--pf-cinza); text-align: right; font-size: 0.74rem; }
.pc-funil-barra { height: 12px; background: var(--pf-neutro-bg); border-radius: 999px; overflow: hidden; }
.pc-funil-barra span { display: block; height: 100%; background: #6D28D9; border-radius: 999px; }
.pc-funil-nota { margin: 4px 0 0; color: var(--pf-cinza); font-size: 0.78rem; }
.pc-filtros { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; }
.pc-filtros label { display: flex; flex-direction: column; gap: 3px; font-size: 0.72rem; font-weight: 700; color: var(--pf-cinza); text-transform: uppercase; letter-spacing: .03em; }
.pc-filtros label.on input { border-color: var(--pf-tinta); box-shadow: inset 0 0 0 1px var(--pf-tinta); }
.pc-filtros input { font: inherit; font-size: 0.84rem; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--pf-tinta); background: var(--pf-papel); border: 1px solid var(--pf-linha-forte); border-radius: 9px; padding: 6px 9px; }
.pc-filtros .pc-fraco { flex: 1 1 260px; }
.pc-disparo { margin: 0 18px 16px; padding: 10px 12px; border-radius: 10px; background: var(--pf-papel-2); border: 1px dashed var(--pf-linha-forte); font-size: 0.8rem; color: var(--pf-tinta-2); }
.pc-como { padding: 0; }
.pc-como summary { cursor: pointer; padding: 14px 18px; font-weight: 800; display: flex; gap: 8px; align-items: center; list-style: none; }
.pc-como summary::-webkit-details-marker { display: none; }
.pc-como ul { margin: 0; padding: 0 18px 16px 36px; display: flex; flex-direction: column; gap: 6px; font-size: 0.83rem; color: var(--pf-tinta-2); max-width: 110ch; }
@media (max-width: 760px) {
  .pc-so-largo { display: none; }
  .pc-cartoes.pc-so-estreito { display: flex; }
  .pc-barras button { grid-template-columns: minmax(0, 1fr) auto; }
  .pc-barras-trilho { grid-column: 1 / -1; grid-row: 2; }
  .pc-barras .pc-delta { justify-self: end; }
  .pc-barras b { min-width: 0; }
  .pc .pc-segmento { width: 100%; }
  .pc .pc-segmento button { flex: 1 1 40%; }
  .pc-kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .pc-receita li, .pc-funil-linha { grid-template-columns: minmax(0,1fr) auto; }
  .pc-receita-barra, .pc-funil-barra { grid-column: 1 / -1; grid-row: 2; }
  .pc-funil-linha small { display: none; }
}
`;
