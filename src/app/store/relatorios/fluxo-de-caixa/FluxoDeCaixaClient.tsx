"use client";
/**
 * Fluxo de caixa — a tela. A conta mora em lib/relatorios/fluxo-de-caixa.ts e
 * o a receber em lib/relatorios/recebiveis.ts; aqui são o período (que olha
 * para a FRENTE), o saldo de hoje, o aviso do dia negativo, a linha do saldo
 * e a tabela dia a dia (ou por semana/mês), com cada dia abrindo o que entra
 * e o que sai.
 *
 * O gráfico é SVG, sem biblioteca: uma linha só (o saldo no fim de cada dia),
 * cheia no que já passou e tracejada no previsto, a linha do zero e a faixa
 * vermelha abaixo dela. Tocar num dia mostra o saldo dele — no celular não
 * existe "passar o mouse".
 */
import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { DIAS_CURTOS, fmtDia, fmtReais, somarDias } from "@/lib/relatorios/base";
import ModeloDoRelatorio, { Bloco, Cartao, GradeDeCartoes } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import PrazosDeRecebimento, { AvisoNoTopo, type Aviso, type PrazoNaTela } from "@/components/relatorios/PrazosDeRecebimento";
import { agruparFluxo, type DiaDoFluxo, type ResultadoDoFluxo, type SaldoInformado } from "@/lib/relatorios/fluxo-de-caixa";

type Resposta = ResultadoDoFluxo & {
  lojas: string[];
  periodo: { de: string; ate: string };
  hoje: string;
  comPrevisao: boolean;
  saldoAntigo: SaldoInformado | null;
  prazos: PrazoNaTela[];
  algumPrazoPadrao: boolean;
  fora: { chave: string; rotulo: string; quantidade: number; valor: number }[];
  semComissao: string[];
  semTaxa: string[];
};

const rotulo: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const campo: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.85rem", fontFamily: "inherit", background: "#fff", color: PALETA.carvao };
const num: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const th: React.CSSProperties = { padding: "8px 0.6rem", fontWeight: 800, verticalAlign: "bottom", lineHeight: 1.25 };
const td: React.CSSProperties = { padding: "7px 0.6rem" };

const diaCurto = (dia: string) => `${DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const ultimoDoMes = (dia: string) => somarDias(`${somarDias(`${dia.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);

/**
 * O valor em reais do jeito que o lojista escreve ("1.200,00", "R$ 850",
 * "-300"). Cópia de components/FinanceForm.tsx, com o sinal: banco no
 * cheque especial é saldo negativo.
 */
function lerReais(texto: string): number | null {
  let t = texto.replace(/r\$/gi, "").replace(/\s+/g, "");
  const negativo = t.startsWith("-");
  t = t.replace(/^-/, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return negativo ? -Number(t) : Number(t);
}

export default function FluxoDeCaixaClient({ inicio }: { inicio: InicioDosFiltros }) {
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "30d", { previsao: "1", agrupar: "dia" });
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("fluxo-de-caixa", query);
  const hoje = inicio.hoje;
  const [aberto, setAberto] = useState<string | null>(null);
  const [prazosAbertos, setPrazosAbertos] = useState(false);

  const atalhos = useMemo(() => {
    const proxMes = somarDias(ultimoDoMes(hoje), 1);
    return [
      { rotulo: "Próximos 7 dias", de: hoje, ate: somarDias(hoje, 6) },
      { rotulo: "15 dias", de: hoje, ate: somarDias(hoje, 14) },
      { rotulo: "30 dias", de: hoje, ate: somarDias(hoje, 29) },
      { rotulo: "60 dias", de: hoje, ate: somarDias(hoje, 59) },
      { rotulo: "90 dias", de: hoje, ate: somarDias(hoje, 89) },
      { rotulo: "Este mês", de: `${hoje.slice(0, 7)}-01`, ate: ultimoDoMes(hoje) },
      { rotulo: "Próximo mês", de: proxMes, ate: ultimoDoMes(proxMes) },
      { rotulo: "Últimos 30 dias", de: somarDias(hoje, -29), ate: hoje },
    ];
  }, [hoje]);
  const agrupar = extras.agrupar === "semana" || extras.agrupar === "mes" ? extras.agrupar : "dia";
  const comPrevisao = extras.previsao !== "0";
  const temFuturo = filtros.ate >= hoje;

  return (
    <ModeloDoRelatorio
      titulo="Fluxo de caixa"
      descricao="Quanto você vai ter na conta em cada dia: o que já entrou e saiu, o que as vendas ainda vão pôr na conta (cartão, Pix, repasse do app) e as contas a pagar. Avisa o dia em que o saldo fica negativo."
      slug="fluxo-de-caixa" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      {/* ── O período (para a frente) e as opções ── */}
      <section className="fh-sem-impressao" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, padding: "1rem 1.1rem", marginBottom: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        <div>
          <div style={rotulo}>Período</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {atalhos.map((a) => {
              const ativo = a.de === filtros.de && a.ate === filtros.ate;
              return (
                <button key={a.rotulo} type="button" onClick={() => mudar({ de: a.de, ate: a.ate })} aria-pressed={ativo}
                  style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                    border: `1.5px solid ${ativo ? PALETA.carvao : PALETA.areiaBorda}`, background: ativo ? PALETA.carvao : "#fff", color: ativo ? "#fff" : PALETA.carvao2,
                  }}>
                  {a.rotulo}
                </button>
              );
            })}
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: 4 }}>
              <input type="date" aria-label="Data inicial" value={filtros.de} max={filtros.ate} onChange={(e) => e.target.value && mudar({ de: e.target.value })} style={campo} />
              <span style={{ color: PALETA.areiaTinta, fontSize: "0.8rem" }}>até</span>
              <input type="date" aria-label="Data final" value={filtros.ate} min={filtros.de} onChange={(e) => e.target.value && mudar({ ate: e.target.value })} style={campo} />
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem 1.6rem", alignItems: "center" }}>
          <div>
            <div style={rotulo}>Ver por</div>
            <div style={{ display: "inline-flex", border: `1.5px solid ${PALETA.areiaBorda}`, borderRadius: 10, overflow: "hidden" }}>
              {(["dia", "semana", "mes"] as const).map((k) => (
                <button key={k} type="button" onClick={() => mudarExtra("agrupar", k)} aria-pressed={agrupar === k}
                  style={{ padding: "6px 14px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700, background: agrupar === k ? PALETA.areia : "#fff", color: agrupar === k ? PALETA.carvao : PALETA.areiaTinta }}>
                  {k === "dia" ? "Dia" : k === "semana" ? "Semana" : "Mês"}
                </button>
              ))}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, maxWidth: 520 }}>
            <input type="checkbox" checked={comPrevisao} onChange={(e) => mudarExtra("previsao", e.target.checked ? "1" : "0")} style={{ width: 18, height: 18 }} />
            <span>
              Contar as vendas que ainda vão acontecer
              <span style={{ display: "block", fontWeight: 500, fontSize: "0.75rem", color: PALETA.areiaTinta }}>pelo ritmo das últimas 4 semanas (cada dia repete o mesmo dia da semana)</span>
            </span>
          </label>
        </div>
      </section>

      {dados && <SaldoDeHoje dados={dados} hoje={hoje} onSalvo={recarregar} />}

      {dados && <AvisoDoSaldo dados={dados} temFuturo={temFuturo} />}

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo={dados.saldoInformado ? "Saldo no início" : "Variação desde o início"} valor={fmtReais(dados.saldoInicial)}
            detalhe={dados.saldoInformado ? `começo de ${diaCurto(dados.periodo.de)}` : "sem saldo informado, começa em R$ 0"} />
          <Cartao rotulo="Entradas" tom="ok" valor={fmtReais(dados.total.entradasRealizadas + dados.total.aReceber + dados.total.vendasPrevistas)}
            detalhe={`${fmtReais(dados.total.entradasRealizadas)} já entraram · ${fmtReais(dados.total.aReceber)} a receber${dados.comPrevisao ? ` · ${fmtReais(dados.total.vendasPrevistas)} de vendas previstas` : ""}`} />
          <Cartao rotulo="Saídas" tom="atencao" valor={fmtReais(dados.total.saidasRealizadas + dados.total.aPagar)}
            detalhe={`${fmtReais(dados.total.saidasRealizadas)} já saíram · ${fmtReais(dados.total.aPagar)} a pagar`} />
          <Cartao rotulo="Saldo previsto no fim" tom={dados.saldoInformado ? (dados.saldoFinal < 0 ? "grave" : "ok") : "neutro"} valor={fmtReais(dados.saldoFinal)}
            detalhe={`fim de ${diaCurto(dados.periodo.ate)}`} />
          {dados.menorSaldo && dados.saldoInformado && (
            <Cartao rotulo="Menor saldo" tom={dados.menorSaldo.valor < 0 ? "grave" : "neutro"} valor={fmtReais(dados.menorSaldo.valor)} detalhe={diaCurto(dados.menorSaldo.dia)} />
          )}
        </GradeDeCartoes>
      )}

      {dados && dados.dias.length > 1 && (
        <Bloco titulo="A linha do saldo" subtitulo="O saldo no fim de cada dia. Linha cheia: o que já aconteceu; tracejada: o previsto. Abaixo do zero, em vermelho.">
          <GraficoDoSaldo dias={dados.dias} hoje={hoje} />
        </Bloco>
      )}

      {dados && (
        <Bloco titulo={agrupar === "dia" ? "Dia a dia" : agrupar === "semana" ? "Semana a semana" : "Mês a mês"}
          subtitulo={agrupar === "dia" ? "Toque num dia para ver o que entra e o que sai. Saldo anterior + entradas − saídas = saldo." : "Saldo anterior + entradas − saídas = saldo. Para abrir cada dia, veja por Dia."}
          semPadding>
          <TabelaDoFluxo dados={dados} agrupar={agrupar} aberto={aberto} setAberto={setAberto} />
        </Bloco>
      )}

      {dados && (
        <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "0.5rem", lineHeight: 1.55, display: "grid", gap: 6 }}>
          {dados.algumPrazoPadrao && (
            <p style={{ margin: 0, color: PALETA.atencao, fontWeight: 700 }}>
              Parte do a receber está prevista pelo prazo padrão (crédito D+30, débito D+1, Pix e dinheiro no dia, app D+7) —{" "}
              <button type="button" onClick={() => { setPrazosAbertos(true); document.getElementById("prazos")?.scrollIntoView({ behavior: "smooth" }); }}
                style={{ border: "none", background: "none", padding: 0, color: PALETA.marca, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", textDecoration: "underline" }}>
                ajuste em Prazos de recebimento
              </button>.
            </p>
          )}
          {dados.semComissao.length > 0 && (
            <p style={{ margin: 0, color: PALETA.atencao, fontWeight: 700 }}>
              {dados.semComissao.join(", ")} sem comissão cadastrada: o repasse entrou sem descontar a comissão (a mais do que vai cair).{" "}
              <Link href="/store/financeiro?tab=configuracoes" style={{ color: PALETA.marca }}>Cadastrar a comissão</Link>
            </p>
          )}
          {dados.semTaxa.length > 0 && (
            <p style={{ margin: 0 }}>
              {dados.semTaxa.join(", ")} sem taxa cadastrada: entrou sem descontar a taxa da maquininha. <Link href="/store/minha-loja" style={{ color: PALETA.marca, fontWeight: 700 }}>Cadastrar em Minha loja → Formas de pagamento</Link>
            </p>
          )}
          {dados.vencidas.quantidade > 0 && (
            <p style={{ margin: 0 }}>
              <strong style={{ color: PALETA.grave }}>{dados.vencidas.quantidade} conta{dados.vencidas.quantidade === 1 ? "" : "s"} vencida{dados.vencidas.quantidade === 1 ? "" : "s"}</strong> e ainda não paga{dados.vencidas.quantidade === 1 ? "" : "s"} ({fmtReais(dados.vencidas.valor)}): entram no a pagar de hoje.{" "}
              <Link href="/store/financeiro?tab=contasapagar" style={{ color: PALETA.marca, fontWeight: 700 }}>Ver contas a pagar</Link>
            </p>
          )}
          {dados.fora.length > 0 && (
            <p style={{ margin: 0 }}>
              Fora do fluxo (não cai na conta): {dados.fora.map((f) => `${f.rotulo} ${fmtReais(f.valor)}`).join(" · ")}.
            </p>
          )}
          <p style={{ margin: 0 }}>
            <strong style={{ color: PALETA.carvao2 }}>A receber</strong> é estimado: cada venda cai no prazo da forma, menos a taxa da maquininha; o app, pelo repasse (o que ele recebeu + o cupom dele − a comissão cadastrada − entrega e taxa de serviço do app).
            O que o motoboy da loja cobrou na porta já é da loja. <strong style={{ color: PALETA.carvao2 }}>A pagar</strong>: as contas a pagar pelo vencimento (as recorrentes do mês que ainda não foram geradas também), as despesas lançadas para o futuro.
            Não entram os custos fixos do DRE (não têm dia: cadastre como conta recorrente em <Link href="/store/financeiro?tab=contasapagar" style={{ color: PALETA.marca, fontWeight: 700 }}>Contas a pagar</Link>) nem as sangrias, que só mudam o dinheiro de gaveta.
            Veja o detalhe do que vai cair em <Link href="/store/relatorios/contas-a-receber" style={{ color: PALETA.marca, fontWeight: 700 }}>Contas a receber</Link>.
          </p>
        </div>
      )}

      {dados && <PrazosDeRecebimento prazos={dados.prazos} aberto={prazosAbertos} onSalvo={recarregar} />}
    </ModeloDoRelatorio>
  );
}

// ── O SALDO DE HOJE ─────────────────────────────────────────────────────────

function SaldoDeHoje({ dados, hoje, onSalvo }: { dados: Resposta; hoje: string; onSalvo: () => void }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const informado = dados.saldoInformado;

  const salvar = async () => {
    const valor = lerReais(texto);
    if (valor === null) { setAviso({ tipo: "erro", titulo: "Valor não entendido", detalhe: "Escreva como no extrato: 12.500,00" }); return; }
    setSalvando(true);
    try {
      const res = await fetch("/api/store/financeiro/fluxo-de-caixa", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saldo: { valor, dia: hoje } }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "Não foi possível salvar.");
      setAviso({ tipo: "ok", titulo: "Saldo salvo", detalhe: "A linha do saldo agora parte dele." });
      setEditando(false);
      setTexto("");
      onSalvo();
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não salvou", detalhe: e?.message });
    } finally {
      setSalvando(false);
    }
  };

  const formulario = (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <span style={{ fontWeight: 800 }}>R$</span>
      <input type="text" inputMode="decimal" placeholder="12.500,00" value={texto} onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") salvar(); }} aria-label="Saldo de hoje em reais" style={{ ...campo, width: 160, fontSize: "1rem" }} />
      <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando || !texto.trim()}>{salvando ? "Salvando…" : "Salvar saldo de hoje"}</button>
      {informado && <button type="button" className="btn btn-outline" onClick={() => setEditando(false)}>Cancelar</button>}
    </div>
  );

  if (!informado || editando) {
    return (
      <section className="fh-sem-impressao" style={{ background: PALETA.brasaClaro, border: `1px solid ${PALETA.brasaBorda}`, borderRadius: 16, padding: "1rem 1.1rem", marginBottom: "1.25rem" }}>
        <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
        <strong style={{ fontSize: "0.98rem" }}>Quanto você tem hoje, somando o caixa e o banco?</strong>
        <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: PALETA.areiaTinta }}>
          {dados.saldoAntigo
            ? `O último saldo informado é de ${fmtDia(dados.saldoAntigo.dia)} — antigo demais para prever. Informe o de hoje.`
            : "Com o saldo de hoje, a linha mostra quanto você vai ter em cada dia e avisa antes de ficar negativo. Sem ele, mostra só quanto entra e sai."}
        </p>
        {formulario}
      </section>
    );
  }
  return (
    <p className="fh-sem-impressao" style={{ margin: "-0.4rem 0 1rem", fontSize: "0.8rem", color: PALETA.areiaTinta }}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      Saldo informado no começo de {diaCurto(informado.dia)}: <strong style={{ color: PALETA.carvao }}>{fmtReais(informado.valor)}</strong>
      {informado.dia < hoje ? " — de lá para cá, a linha soma o que entrou e saiu." : ""}{" "}
      <button type="button" onClick={() => setEditando(true)}
        style={{ border: "none", background: "none", padding: 0, color: PALETA.marca, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>
        atualizar o saldo de hoje
      </button>
    </p>
  );
}

// ── O AVISO ─────────────────────────────────────────────────────────────────

function AvisoDoSaldo({ dados, temFuturo }: { dados: Resposta; temFuturo: boolean }) {
  if (!dados.saldoInformado || !temFuturo) return null;
  const n = dados.negativo;
  if (!n) {
    return (
      <div role="status" style={{ background: PALETA.okClaro, border: `1px solid ${PALETA.okBorda}`, color: PALETA.ok, borderRadius: 14, padding: "0.8rem 1rem", marginBottom: "1.1rem", fontWeight: 700, fontSize: "0.88rem" }}>
        ✓ O saldo previsto fica positivo em todo o período.
        {dados.menorSaldo && <span style={{ fontWeight: 500, color: PALETA.carvao2 }}> O menor é {fmtReais(dados.menorSaldo.valor)}, em {diaCurto(dados.menorSaldo.dia)}.</span>}
      </div>
    );
  }
  return (
    <div role="alert" style={{ background: PALETA.graveClaro, border: `1.5px solid ${PALETA.graveBorda}`, borderRadius: 14, padding: "0.9rem 1.1rem", marginBottom: "1.1rem" }}>
      <div style={{ color: PALETA.grave, fontWeight: 900, fontSize: "1.02rem" }}>
        ⚠ Em {diaCurto(n.dia)} o saldo previsto fica negativo: {fmtReais(n.saldo)}
      </div>
      {n.maioresContas.length > 0 && (
        <div style={{ fontSize: "0.84rem", color: PALETA.carvao2, marginTop: 6 }}>
          O que mais pesa até lá: {n.maioresContas.map((c) => `${c.descricao} ${fmtReais(c.valor)} (${diaCurto(c.dia)})`).join(" · ")}.
        </div>
      )}
      <div style={{ fontSize: "0.8rem", color: PALETA.areiaTinta, marginTop: 6 }}>
        Dá tempo de agir: negociar o vencimento de uma dessas contas, antecipar o recebível do cartão na maquininha, ou segurar uma compra.
        {!dados.comPrevisao && " (As vendas que ainda vão acontecer estão desligadas: ligue \"Contar as vendas que ainda vão acontecer\" para ver com elas.)"}
      </div>
    </div>
  );
}

// ── O GRÁFICO ───────────────────────────────────────────────────────────────

function GraficoDoSaldo({ dias, hoje }: { dias: DiaDoFluxo[]; hoje: string }) {
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const L = 1000, A = 220, M = 8;
  const valores = dias.map((d) => d.saldo);
  const max = Math.max(0, ...valores), min = Math.min(0, ...valores);
  const faixa = max - min || 1;
  const x = (i: number) => M + (i / Math.max(1, dias.length - 1)) * (L - 2 * M);
  const y = (v: number) => M + ((max - v) / faixa) * (A - 2 * M);
  const iHoje = dias.findIndex((d) => d.dia >= hoje);
  const pontos = (de: number, ate: number) => dias.slice(de, ate + 1).map((d, k) => `${x(de + k).toFixed(1)},${y(d.saldo).toFixed(1)}`).join(" ");
  // Passado (até ontem) cheio; de ontem em diante tracejado — os dois se tocam para a linha não quebrar.
  const fimDoPassado = iHoje === -1 ? dias.length - 1 : Math.max(0, iHoje - 1);
  const temPassado = iHoje !== 0;
  const temFuturo = iHoje !== -1;
  const largura = (L - 2 * M) / Math.max(1, dias.length - 1);
  const d = escolhido != null ? dias[escolhido] : null;

  return (
    <div>
      <svg viewBox={`0 0 ${L} ${A}`} width="100%" height={A} preserveAspectRatio="none" role="img" aria-label="Linha do saldo previsto por dia" style={{ display: "block" }}>
        {min < 0 && <rect x={0} y={y(0)} width={L} height={A - y(0)} fill={PALETA.graveClaro} />}
        <line x1={0} x2={L} y1={y(0)} y2={y(0)} stroke={PALETA.areiaTinta} strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {iHoje > 0 && <line x1={x(iHoje)} x2={x(iHoje)} y1={0} y2={A} stroke={PALETA.brasaBorda} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        {temPassado && <polyline points={pontos(0, fimDoPassado)} fill="none" stroke={PALETA.carvao} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
        {temFuturo && <polyline points={pontos(Math.max(0, iHoje - 1), dias.length - 1)} fill="none" stroke={PALETA.brasa} strokeWidth={2.5} strokeDasharray="7 5" vectorEffect="non-scaling-stroke" />}
        {/* O SVG estica na largura (preserveAspectRatio="none"): marcação é linha, não círculo, para não virar elipse. */}
        {d && escolhido != null && <line x1={x(escolhido)} x2={x(escolhido)} y1={0} y2={A} stroke={PALETA.carvao2} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        {dias.map((dd, i) => (
          <rect key={dd.dia} x={x(i) - largura / 2} y={0} width={largura} height={A} fill="transparent" style={{ cursor: "pointer" }} onClick={() => setEscolhido(i)}>
            <title>{`${diaCurto(dd.dia)}: ${fmtReais(dd.saldo)}`}</title>
          </rect>
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 4 }}>
        <span>{diaCurto(dias[0].dia)}</span>
        {iHoje > 0 && <span style={{ color: PALETA.brasaTinta, fontWeight: 700 }}>hoje</span>}
        <span>{diaCurto(dias[dias.length - 1].dia)}</span>
      </div>
      <div style={{ marginTop: 6, fontSize: "0.85rem", minHeight: 22 }}>
        {d ? (
          <span><strong>{diaCurto(d.dia)}</strong>: saldo {d.quando === "passado" ? "" : "previsto "}<strong style={{ color: d.saldo < 0 ? PALETA.grave : PALETA.carvao }}>{fmtReais(d.saldo)}</strong></span>
        ) : (
          <span style={{ color: PALETA.areiaTinta }}>Toque num dia do gráfico para ver o saldo.</span>
        )}
      </div>
    </div>
  );
}

// ── A TABELA ────────────────────────────────────────────────────────────────

function TabelaDoFluxo({ dados, agrupar, aberto, setAberto }: { dados: Resposta; agrupar: "dia" | "semana" | "mes"; aberto: string | null; setAberto: (d: string | null) => void }) {
  const comPrev = dados.comPrevisao;
  const linhas = agrupar === "dia"
    ? dados.dias.map((d) => ({ chave: d.dia, rotulo: diaCurto(d.dia), quando: d.quando, d }))
    : agruparFluxo(dados.dias, agrupar).map((g) => ({ chave: g.de, rotulo: g.rotulo, quando: g.ate < dados.hoje ? "passado" : g.de > dados.hoje ? "futuro" : "hoje", d: g }));
  const colunas = 7 + (comPrev ? 1 : 0);
  const cor = (v: number) => (v < -0.005 ? PALETA.grave : PALETA.carvao);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
        <thead>
          <tr style={{ background: PALETA.areia, textAlign: "left", color: PALETA.carvao2 }}>
            <th style={th}>{agrupar === "dia" ? "Dia" : agrupar === "semana" ? "Semana" : "Mês"}</th>
            <th style={{ ...th, ...num }}>Saldo<br />anterior</th>
            <th style={{ ...th, ...num }}>Entradas<br />realizadas</th>
            <th style={{ ...th, ...num }}>Saídas<br />realizadas</th>
            <th style={{ ...th, ...num }}>A<br />receber</th>
            {comPrev && <th style={{ ...th, ...num }}>Vendas<br />previstas</th>}
            <th style={{ ...th, ...num }}>A<br />pagar</th>
            <th style={{ ...th, ...num }}>Saldo<br />{dados.saldoInformado ? "previsto" : "(variação)"}</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(({ chave, rotulo: r, quando, d }) => {
            const dia = agrupar === "dia" ? (d as DiaDoFluxo) : null;
            const abre = Boolean(dia && dia.movimentos.length);
            const estaAberto = aberto === chave;
            const z = (v: number) => (v ? fmtReais(v) : "—");
            return (
              <React.Fragment key={chave}>
                <tr onClick={abre ? () => setAberto(estaAberto ? null : chave) : undefined}
                  style={{
                    borderTop: `1px solid ${PALETA.areiaBorda}`, cursor: abre ? "pointer" : "default",
                    background: quando === "hoje" ? PALETA.brasaClaro : d.saldo < -0.005 && dados.saldoInformado ? PALETA.graveClaro : undefined,
                    color: quando === "passado" ? PALETA.carvao2 : PALETA.carvao,
                  }}>
                  <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {abre ? (estaAberto ? "▾ " : "▸ ") : ""}{r}{quando === "hoje" && agrupar === "dia" ? " · hoje" : ""}
                  </td>
                  <td style={{ ...td, ...num, color: cor(d.saldoAnterior) }}>{fmtReais(d.saldoAnterior)}</td>
                  <td style={{ ...td, ...num, color: PALETA.ok }}>{z(d.entradasRealizadas)}</td>
                  <td style={{ ...td, ...num, color: PALETA.grave }}>{d.saidasRealizadas ? `− ${fmtReais(d.saidasRealizadas)}` : "—"}</td>
                  <td style={{ ...td, ...num, color: PALETA.ok }}>{z(d.aReceber)}</td>
                  {comPrev && <td style={{ ...td, ...num, color: PALETA.ok, fontStyle: "italic" }}>{z(d.vendasPrevistas)}</td>}
                  <td style={{ ...td, ...num, color: PALETA.grave }}>{d.aPagar ? `− ${fmtReais(d.aPagar)}` : "—"}</td>
                  <td style={{ ...td, ...num, fontWeight: 900, color: cor(d.saldo) }}>{fmtReais(d.saldo)}</td>
                </tr>
                {estaAberto && dia && (
                  <tr style={{ background: PALETA.areia }}>
                    <td colSpan={colunas} style={{ padding: "0.6rem 1rem 0.8rem 1.6rem" }}>
                      <div style={{ display: "grid", gap: 4 }}>
                        {dia.movimentos.map((m, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.82rem" }}>
                            <span>
                              {m.tipo === "ENTRADA" ? "＋" : "−"} {m.descricao}
                              <span style={{ color: PALETA.areiaTinta }}>
                                {" · "}{m.vencidaEm ? `venceu em ${fmtDia(m.vencidaEm)}` : m.origem === "VENDA_PREVISTA" ? "previsão" : m.previsto ? (m.tipo === "ENTRADA" ? "a receber" : "a pagar") : m.tipo === "ENTRADA" ? "entrou" : "pago"}
                              </span>
                            </span>
                            <strong style={{ ...num, color: m.tipo === "ENTRADA" ? PALETA.ok : PALETA.grave }}>{m.tipo === "ENTRADA" ? "" : "− "}{fmtReais(m.valor)}</strong>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          <tr style={{ borderTop: `2px solid ${PALETA.carvao2}`, background: PALETA.areia, fontWeight: 900 }}>
            <td style={td}>Total</td>
            <td style={{ ...td, ...num }}>{fmtReais(dados.saldoInicial)}</td>
            <td style={{ ...td, ...num }}>{fmtReais(dados.total.entradasRealizadas)}</td>
            <td style={{ ...td, ...num }}>− {fmtReais(dados.total.saidasRealizadas)}</td>
            <td style={{ ...td, ...num }}>{fmtReais(dados.total.aReceber)}</td>
            {comPrev && <td style={{ ...td, ...num }}>{fmtReais(dados.total.vendasPrevistas)}</td>}
            <td style={{ ...td, ...num }}>− {fmtReais(dados.total.aPagar)}</td>
            <td style={{ ...td, ...num, color: cor(dados.saldoFinal) }}>{fmtReais(dados.saldoFinal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
