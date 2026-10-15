"use client";
/**
 * Acerto de entregadores — a tela. A soma da equipe mora em
 * lib/relatorios/acerto-de-entregadores.ts, por cima da MESMA conta da tela
 * Motoboys e do app do entregador (lib/relatorio-do-entregador.ts).
 *
 * A tela Motoboys é a ferramenta de um motoboy por vez (entregas, troca de
 * pagamento, "Ver pedido"). Esta é a visão da equipe:
 * - O fechamento: quanto a loja paga, quanto dinheiro está com os motoboys e o
 *   saldo de cada um ("a loja paga R$ X" / "ele devolve R$ Y").
 * - Custo por entrega e o peso da equipe no valor dos pedidos, com o período
 *   anterior ao lado.
 * - O pódio, o dia a dia e os horários (quantos motoboys estavam na rua em cada
 *   hora, e quantas entregas cada um fez nela).
 * - O recibo do acerto de cada motoboy, para imprimir e ele assinar.
 */
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Printer, Bike, AlertTriangle } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtDia, fmtQtd, fmtReais, DIAS_CURTOS } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { BarraDePct, Bloco, Cartao, GradeDeCartoes, Vazio, Variacao } from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import type { LinhaDoMotoboy, ResultadoDoAcerto, TotaisDoAcerto } from "@/lib/relatorios/acerto-de-entregadores";

type Resposta = ResultadoDoAcerto & {
  lojas: string[];
  periodo: { de: string; ate: string };
  periodoAnterior: { de: string; ate: string } | null;
  anterior: { total: TotaisDoAcerto; porMotoboy: Record<string, { entregas: number; aPagar: number }> } | null;
};

const caixa: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.86rem", fontWeight: 600, cursor: "pointer", color: PALETA.carvao };
const th: React.CSSProperties = { padding: "9px 0.8rem", fontSize: "0.7rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", textAlign: "right", borderBottom: `1px solid ${PALETA.areiaBorda}`, background: "#fff" };
const td: React.CSSProperties = { padding: "10px 0.8rem", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", verticalAlign: "top" };

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
const MEDALHAS = ["🥇", "🥈", "🥉"];
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const diaDaSemana = (dia: string) => DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()];

/** "A loja paga R$ X" / "Ele devolve R$ Y" / "Zerado". */
function Saldo({ valor, quem = "ele", grande }: { valor: number; quem?: string; grande?: boolean }) {
  const zerado = Math.abs(valor) < 0.005;
  const cor = zerado ? PALETA.areiaTinta : valor > 0 ? PALETA.ok : PALETA.atencao;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: grande ? "flex-start" : "flex-end", lineHeight: 1.15 }}>
      <span style={{ fontSize: grande ? "0.72rem" : "0.66rem", fontWeight: 800, color: cor, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {zerado ? "zerado" : valor > 0 ? "loja paga" : `${quem} devolve`}
      </span>
      <span style={{ fontWeight: 900, color: cor, fontSize: grande ? "1.6rem" : undefined }}>{fmtReais(Math.abs(valor))}</span>
    </span>
  );
}

/** O fechamento da equipe: a pagar, dinheiro com eles e o saldo, com a conta à mostra. */
function Fechamento({ total, anterior }: { total: TotaisDoAcerto; anterior: TotaisDoAcerto | null }) {
  const linha = (rotulo: string, valor: string, sinal?: string, forte?: boolean) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: forte ? "0.92rem" : "0.84rem", fontWeight: forte ? 900 : 600, color: forte ? PALETA.carvao : PALETA.carvao2, padding: "3px 0", fontVariantNumeric: "tabular-nums" }}>
      <span>{rotulo}</span><span>{sinal}{valor}</span>
    </div>
  );
  return (
    <section className="fh-relatorio-bloco" style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 0,
      background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, overflow: "hidden", marginBottom: "1.25rem",
    }}>
      <div style={{ padding: "1.1rem 1.2rem", background: `linear-gradient(135deg, ${PALETA.brasaClaro}, #fff)`, borderRight: `1px solid ${PALETA.areia}` }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 800, color: PALETA.brasaTinta, textTransform: "uppercase", letterSpacing: "0.05em" }}>A loja paga à equipe</div>
        <div style={{ fontSize: "2.1rem", fontWeight: 900, color: PALETA.carvao, fontVariantNumeric: "tabular-nums", margin: "2px 0 4px" }}>{fmtReais(total.aPagar)}</div>
        <div style={{ fontSize: "0.78rem" }}>
          {anterior ? <Variacao atual={total.aPagar} anterior={anterior.aPagar} menorEhMelhor /> : <span style={{ color: PALETA.areiaTinta }}>{plural(total.motoboysComEntrega, "motoboy", "motoboys")} com entrega</span>}
        </div>
      </div>
      <div style={{ padding: "1rem 1.2rem", borderRight: `1px solid ${PALETA.areia}` }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Como chega nesse valor</div>
        {linha("Diárias", fmtReais(total.diaria))}
        {linha("Entregas", fmtReais(total.porEntrega), "+ ")}
        {total.lanche > 0.005 && linha("Lanche acima do combinado", fmtReais(total.lanche), "− ")}
        {(total.pendencias || 0) > 0.005 && linha("Pendências lançadas", fmtReais(total.pendencias), "− ")}
        <div style={{ borderTop: `1px dashed ${PALETA.areiaBorda}`, marginTop: 4, paddingTop: 4 }}>{linha("A pagar", fmtReais(total.aPagar), "", true)}</div>
      </div>
      <div style={{ padding: "1rem 1.2rem" }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Acerto com o dinheiro da rua</div>
        {linha("A pagar", fmtReais(total.aPagar))}
        {linha("Dinheiro com os motoboys", fmtReais(total.dinheiroComEles), "− ")}
        <div style={{ borderTop: `1px dashed ${PALETA.areiaBorda}`, marginTop: 4, paddingTop: 6 }}>
          <Saldo valor={total.saldo} quem="a equipe" grande />
        </div>
      </div>
    </section>
  );
}

/** Os três que mais entregaram. */
function Podio({ linhas }: { linhas: LinhaDoMotoboy[] }) {
  const top = linhas.filter((l) => l.entregas > 0).slice(0, 3);
  if (top.length < 2) return null;
  const maior = top[0].entregas || 1;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
      {top.map((l, i) => (
        <div key={l.id} className="fh-relatorio-bloco" style={{
          background: i === 0 ? `linear-gradient(160deg, #FFF8E1, #fff 70%)` : "#fff",
          border: `1px solid ${i === 0 ? "#FCD34D" : PALETA.areiaBorda}`, borderRadius: 14, padding: "0.9rem 1rem", minWidth: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "1.5rem", lineHeight: 1 }} aria-hidden>{MEDALHAS[i]}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: "0.98rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.nome}</div>
              <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta }}>{l.tipo}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 10 }}>
            <span style={{ fontSize: "1.6rem", fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{l.entregas}</span>
            <span style={{ fontSize: "0.8rem", color: PALETA.areiaTinta, fontWeight: 700 }}>entregas</span>
          </div>
          <div style={{ margin: "6px 0 8px" }}><BarraDePct pct={(l.entregas / maior) * 100} cor={i === 0 ? "#F59E0B" : PALETA.brasa} /></div>
          <div style={{ fontSize: "0.76rem", color: PALETA.carvao2, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            <span>{plural(l.dias, "dia", "dias")}</span>
            {l.entregasPorDia !== null && <span>{fmtQtd(l.entregasPorDia)}/dia</span>}
            {l.km > 0 && <span>{fmtQtd(l.km)} km</span>}
            <span style={{ fontWeight: 800 }}>{fmtReais(l.aPagar)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Barras verticais de uma série só, com a dica ao passar o mouse. */
function Barras<T>({ itens, valor, rotulo, subRotulo, dica, destaque, altura = 150 }: {
  itens: T[]; valor: (t: T) => number; rotulo: (t: T) => React.ReactNode; subRotulo?: (t: T) => React.ReactNode;
  dica: (t: T) => React.ReactNode; destaque?: (t: T) => boolean; altura?: number;
}) {
  const [sobre, setSobre] = useState<number | null>(null);
  const max = Math.max(1, ...itens.map(valor));
  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, minWidth: itens.length * 30, height: altura + 48, position: "relative" }}>
        {itens.map((t, i) => {
          const v = valor(t);
          const h = Math.max(v ? 4 : 0, (v / max) * altura);
          const forte = destaque?.(t);
          return (
            <div key={i} onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)} onFocus={() => setSobre(i)} onBlur={() => setSobre(null)} tabIndex={0}
              style={{ flex: "1 1 0", minWidth: 26, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", position: "relative", cursor: "default", outline: "none" }}>
              {sobre === i && (
                <div role="tooltip" style={{
                  position: "absolute", bottom: h + 54, left: "50%", transform: "translateX(-50%)", zIndex: 5,
                  background: PALETA.carvao, color: "#fff", borderRadius: 8, padding: "7px 10px", fontSize: "0.74rem", lineHeight: 1.45,
                  whiteSpace: "nowrap", boxShadow: "0 6px 18px rgba(0,0,0,0.18)", pointerEvents: "none",
                }}>{dica(t)}</div>
              )}
              <span style={{ fontSize: "0.68rem", fontWeight: 800, color: PALETA.carvao2, marginBottom: 3, fontVariantNumeric: "tabular-nums", visibility: v ? "visible" : "hidden" }}>
                {fmtQtd(v)}
              </span>
              <div style={{
                width: "70%", maxWidth: 34, height: h, borderRadius: "4px 4px 0 0",
                background: forte ? PALETA.marca : sobre === i ? PALETA.brasa : "#F3A47A", transition: "background 0.12s",
              }} />
              <div style={{ height: 1, width: "100%", background: PALETA.areiaBorda }} />
              <span style={{ fontSize: "0.66rem", fontWeight: 700, color: PALETA.areiaTinta, marginTop: 4, whiteSpace: "nowrap" }}>{rotulo(t)}</span>
              {subRotulo && <span style={{ fontSize: "0.6rem", color: PALETA.areiaTinta, whiteSpace: "nowrap" }}>{subRotulo(t)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** O detalhe de um motoboy, aberto na linha da tabela. */
function Detalhe({ l, onRecibo }: { l: LinhaDoMotoboy; onRecibo: () => void }) {
  const formas = [
    { rotulo: "💵 Dinheiro (com ele)", valor: l.dinheiroComEle, extra: l.trocoLevado > 0.005 ? `inclui ${fmtReais(l.trocoLevado)} de troco levado` : "" },
    { rotulo: "💳 Maquininha", valor: l.maquininha },
    { rotulo: "📲 Pix na entrega", valor: l.pix },
    { rotulo: "⚡ Pago online", valor: l.online },
    { rotulo: "📒 Fiado", valor: l.fiadoDosPedidos },
    { rotulo: "❓ Forma não identificada", valor: l.naoIdentificado },
  ].filter((f) => f.valor > 0.005);
  const sub: React.CSSProperties = { fontSize: "0.7rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
  const linha = (a: React.ReactNode, b: React.ReactNode, k?: string) => (
    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.82rem", padding: "2px 0", fontVariantNumeric: "tabular-nums" }}><span>{a}</span><span style={{ fontWeight: 700 }}>{b}</span></div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem 1.6rem", padding: "0.9rem 1rem 1rem 2.6rem", background: PALETA.areia, textAlign: "left", whiteSpace: "normal" }}>
      <div>
        <div style={sub}>De onde vem o pagamento</div>
        {(l.diaria > 0.005 || (l.diariasAjustadas || []).length > 0) && linha(
          `Diária × ${plural(l.dias, "dia", "dias")}${(l.diariasAjustadas || []).length ? ` (${plural(l.diariasAjustadas.length, "dia ajustado", "dias ajustados")})` : ""}`,
          fmtReais(l.diaria),
        )}
        {(l.diariasAjustadas || []).map((d) => (
          <div key={d.dia} style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: -2 }}>
            {fmtDia(d.dia)}: diária ajustada para {fmtReais(d.valor)} <span style={{ textDecoration: "line-through" }}>{fmtReais(d.padrao)}</span>
          </div>
        ))}
        {l.composicao.map((c) => linha(`${c.rotulo} (${c.qtd})`, fmtReais(c.valor), c.rotulo))}
        {l.lanche > 0.005 && linha("Lanche acima do combinado", `− ${fmtReais(l.lanche)}`)}
        {/* A pendência que a loja lançou no relatório do motoboy, com o motivo. */}
        {(l.listaDePendencias || []).map((p, i) => (
          <div key={`p${i}`}>
            {linha(`Pendência ${fmtDia(p.dia)}`, `− ${fmtReais(p.valor)}`)}
            <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: -2 }}>{p.motivo}{p.criadoPor ? ` · lançada por ${p.criadoPor}` : ""}</div>
          </div>
        ))}
        <div style={{ borderTop: `1px dashed ${PALETA.areiaBorda}`, marginTop: 4, paddingTop: 4 }}>{linha(<strong>A pagar</strong>, <strong>{fmtReais(l.aPagar)}</strong>)}</div>
      </div>
      <div>
        <div style={sub}>Como os clientes pagaram ({fmtReais(l.valorLevado)})</div>
        {formas.length ? formas.map((f) => (
          <div key={f.rotulo}>
            {linha(f.rotulo, fmtReais(f.valor))}
            {f.extra && <div style={{ fontSize: "0.7rem", color: PALETA.areiaTinta, marginTop: -2 }}>{f.extra}</div>}
          </div>
        )) : <div style={{ fontSize: "0.82rem", color: PALETA.areiaTinta }}>Sem valor de pedido no período.</div>}
      </div>
      <div>
        <div style={sub}>Entregas</div>
        {linha("Entregues", l.entregues)}
        {l.naRua > 0 && linha("Na rua ou em preparo", l.naRua)}
        {l.canceladasComCorrida > 0 && linha("Canceladas depois de sair (contam)", l.canceladasComCorrida)}
        {l.canceladasSemCorrida > 0 && linha("Canceladas antes de sair (não contam)", l.canceladasSemCorrida)}
        {l.kmPorEntrega !== null && linha("Km por entrega", `${fmtQtd(l.kmPorEntrega)} km`)}
        {l.fiadoEmAberto > 0.005 && linha("Fiado dele em aberto", fmtReais(l.fiadoEmAberto))}
        <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button type="button" onClick={onRecibo} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", padding: "6px 12px" }}>
            <Printer size={14} /> Recibo para assinar
          </button>
          <Link href="/store/motoboys" className="btn btn-outline" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", padding: "6px 12px", textDecoration: "none" }}>
            Ver as entregas
          </Link>
        </div>
      </div>
    </div>
  );
}

/** O recibo do acerto, em meia folha, com a linha para ele assinar. */
function Recibo({ l, periodo, nomeDaLoja, onFechar }: { l: LinhaDoMotoboy; periodo: { de: string; ate: string }; nomeDaLoja: string; onFechar: () => void }) {
  const linha = (a: React.ReactNode, b: React.ReactNode, forte?: boolean) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", fontWeight: forte ? 900 : 500, fontSize: forte ? "1rem" : "0.9rem", fontVariantNumeric: "tabular-nums" }}><span>{a}</span><span>{b}</span></div>
  );
  return (
    <div className="fh-recibo-fundo" onClick={onFechar} style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "2rem 1rem", overflowY: "auto" }}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .fh-recibo, .fh-recibo * { visibility: visible !important; }
          .fh-recibo { position: absolute !important; left: 0; top: 0; width: 100% !important; box-shadow: none !important; border: none !important; }
          .fh-recibo-acoes { display: none !important; }
        }
      `}</style>
      <div className="fh-recibo" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Recibo do acerto de ${l.nome}`}
        style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 480, padding: "1.4rem 1.5rem", color: PALETA.carvao, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ textAlign: "center", borderBottom: `2px dashed ${PALETA.areiaBorda}`, paddingBottom: 10, marginBottom: 10 }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.06em" }}>{nomeDaLoja}</div>
          <div style={{ fontSize: "1.2rem", fontWeight: 900, marginTop: 2 }}>Recibo de acerto do entregador</div>
          <div style={{ fontSize: "0.82rem", color: PALETA.carvao2, marginTop: 2 }}>{periodo.de === periodo.ate ? fmtDia(periodo.de) : `${fmtDia(periodo.de)} a ${fmtDia(periodo.ate)}`}</div>
        </div>
        {linha("Entregador", <strong>{l.nome}</strong>)}
        {linha("Forma de pagamento", l.tipo)}
        {linha("Dias trabalhados", l.dias)}
        {linha("Entregas", l.entregas)}
        {l.km > 0 && linha("Km rodados", `${fmtQtd(l.km)} km`)}
        <div style={{ borderTop: `1px solid ${PALETA.areiaBorda}`, margin: "8px 0" }} />
        {l.diaria > 0.005 && linha("Diárias", fmtReais(l.diaria))}
        {(l.diariasAjustadas || []).map((d) => (
          <div key={d.dia} style={{ fontSize: "0.78rem", color: PALETA.carvao2, marginTop: -2 }}>
            {fmtDia(d.dia)}: diária de {fmtReais(d.valor)} (padrão {fmtReais(d.padrao)})
          </div>
        ))}
        {linha("Entregas", fmtReais(l.porEntrega))}
        {l.lanche > 0.005 && linha("Lanche acima do combinado", `− ${fmtReais(l.lanche)}`)}
        {(l.listaDePendencias || []).map((p, i) => (
          <div key={`p${i}`}>
            {linha(`Pendência ${fmtDia(p.dia)}`, `− ${fmtReais(p.valor)}`)}
            <div style={{ fontSize: "0.78rem", color: PALETA.carvao2, marginTop: -4, paddingBottom: 2 }}>Motivo: {p.motivo}</div>
          </div>
        ))}
        {linha("Total do acerto", fmtReais(l.aPagar), true)}
        {l.dinheiroComEle > 0.005 && linha(l.trocoLevado > 0.005 ? "Dinheiro com ele (pedidos + troco levado)" : "Dinheiro dos pedidos com ele", `− ${fmtReais(l.dinheiroComEle)}`)}
        <div style={{ background: PALETA.areia, borderRadius: 10, padding: "8px 12px", marginTop: 8 }}>
          {linha(l.saldo >= 0 ? "A loja paga ao entregador" : "O entregador devolve à loja", fmtReais(Math.abs(l.saldo)), true)}
        </div>
        <div style={{ marginTop: 44, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, fontSize: "0.78rem", color: PALETA.carvao2, textAlign: "center" }}>
          <div style={{ borderTop: `1px solid ${PALETA.carvao}`, paddingTop: 4 }}>{l.nome}</div>
          <div style={{ borderTop: `1px solid ${PALETA.carvao}`, paddingTop: 4 }}>{nomeDaLoja}</div>
        </div>
        <div style={{ fontSize: "0.7rem", color: PALETA.areiaTinta, textAlign: "center", marginTop: 14 }}>
          Data: ____/____/______ · Gerado pelo FireHub
        </div>
        <div className="fh-recibo-acoes" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={onFechar} className="btn btn-outline">Fechar</button>
          <button type="button" onClick={() => window.print()} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Printer size={15} /> Imprimir</button>
        </div>
      </div>
    </div>
  );
}

export default function AcertoDeEntregadoresClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "7d", { comparar: "" });
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("acerto-de-entregadores", query);
  const comparar = extras.comparar !== "0";
  const [aberto, setAberto] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<LinhaDoMotoboy | null>(null);

  const variasLojas = (dados?.lojas?.length || 0) > 1;
  const ant = comparar ? dados?.anterior ?? null : null;
  const t = dados?.total;

  const pico = useMemo(() => {
    const horas = dados?.horas || [];
    return horas.reduce<(typeof horas)[number] | null>((m, h) => (!m || h.entregas > m.entregas ? h : m), null);
  }, [dados]);
  const melhorDia = useMemo(() => (dados?.dias || []).reduce<Resposta["dias"][number] | null>((m, d) => (!m || d.entregas > m.entregas ? d : m), null), [dados]);

  return (
    <ModeloDoRelatorio
      titulo="Acerto de entregadores"
      descricao="Quanto a loja paga a cada motoboy, quanto dinheiro está com ele e o saldo do acerto — mais o custo por entrega, o dia a dia e os horários da equipe. Mesma conta da tela Motoboys e do app do entregador."
      slug="acerto-de-entregadores" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ horario: false, tipos: false, canais: false, marcas: false }}>
        <div style={{ borderTop: `1px dashed ${PALETA.areiaBorda}`, paddingTop: "0.8rem" }}>
          <label style={caixa}>
            <input type="checkbox" checked={comparar} onChange={(e) => mudarExtra("comparar", e.target.checked ? "" : "0")} style={{ accentColor: PALETA.carvao }} />
            Comparar com o período anterior
            {comparar && dados?.periodoAnterior && (
              <span style={{ fontWeight: 500, color: PALETA.areiaTinta }}>({fmtDia(dados.periodoAnterior.de)} a {fmtDia(dados.periodoAnterior.ate)})</span>
            )}
          </label>
        </div>
      </BarraDeFiltros>

      {dados && t && t.entregas === 0 && dados.linhas.length === 0 && (
        <Bloco><Vazio texto="Nenhuma entrega de motoboy da loja no período escolhido." /></Bloco>
      )}

      {dados && t && dados.linhas.length > 0 && (
        <>
          <Fechamento total={t} anterior={ant?.total ?? null} />

          <GradeDeCartoes>
            <Cartao rotulo="Entregas" valor={t.entregas.toLocaleString("pt-BR")}
              detalhe={ant ? <Variacao atual={t.entregas} anterior={ant.total.entregas} /> : `${plural(t.motoboysComEntrega, "motoboy", "motoboys")} · ${plural(t.diasComEntrega, "dia", "dias")}`} />
            <Cartao rotulo="Custo por entrega" valor={fmtReais(t.custoPorEntrega)}
              detalhe={ant && ant.total.custoPorEntrega !== null && t.custoPorEntrega !== null
                ? <Variacao atual={t.custoPorEntrega} anterior={ant.total.custoPorEntrega} menorEhMelhor />
                : "Tudo o que a loja paga ÷ entregas"} />
            <Cartao rotulo="Peso no valor dos pedidos" valor={t.pesoNoValor === null ? "—" : `${t.pesoNoValor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
              tom={t.pesoNoValor !== null && t.pesoNoValor > 15 ? "atencao" : "neutro"}
              detalhe={`Equipe ÷ ${fmtReais(t.valorLevado)} levados`} />
            <Cartao rotulo="Km rodados" valor={t.km > 0 ? `${fmtQtd(t.km)} km` : "—"}
              detalhe={t.km > 0 && t.entregas ? `${fmtQtd(t.km / t.entregas)} km por entrega` : "Os pedidos não trazem distância"} />
            {pico && (
              <Cartao rotulo="Horário de pico" valor={`${String(pico.hora).padStart(2, "0")}h`}
                detalhe={`${fmtQtd(pico.mediaPorDia)} entregas/dia com ${fmtQtd(pico.motoboysNaHora)} motoboy${pico.motoboysNaHora >= 1.5 ? "s" : ""} na rua`} />
            )}
          </GradeDeCartoes>

          <Podio linhas={dados.linhas} />

          {dados.avisos.length > 0 && (
            <section className="fh-relatorio-bloco" style={{ background: PALETA.atencaoClaro, border: `1px solid ${PALETA.atencaoBorda}`, borderRadius: 14, padding: "0.8rem 1rem", marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 900, fontSize: "0.88rem", color: PALETA.atencao, marginBottom: 6 }}>
                <AlertTriangle size={16} /> Antes de pagar, confira
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.82rem", color: PALETA.carvao2, lineHeight: 1.6 }}>
                {dados.avisos.map((a, i) => <li key={i} style={{ color: a.tom === "grave" ? PALETA.grave : undefined }}>{a.texto}</li>)}
              </ul>
            </section>
          )}

          <Bloco titulo="Acerto por motoboy" subtitulo="Clique no motoboy para ver de onde vem o valor, como os clientes pagaram e o recibo para assinar." semPadding>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 940, borderCollapse: "collapse", fontSize: "0.86rem" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left", minWidth: 200 }}>Motoboy</th>
                    <th style={th}>Dias</th>
                    <th style={th}>Entregas</th>
                    <th style={{ ...th, minWidth: 110 }} title="Participação nas entregas da equipe">% equipe</th>
                    <th style={th}>Km</th>
                    <th style={th} title="Tudo o que ele recebe ÷ entregas">Custo/entrega</th>
                    <th style={th} title="Diária + entregas − lanche acima do combinado − pendências">A pagar</th>
                    <th style={th} title="Pedidos em dinheiro + o troco que ele levou da loja">Dinheiro c/ ele</th>
                    <th style={th} title="A pagar − dinheiro com ele">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.linhas.map((l, i) => {
                    const abre = aberto === l.id;
                    const antes = ant?.porMotoboy[l.id];
                    return (
                      <React.Fragment key={l.id}>
                        <tr onClick={() => setAberto(abre ? null : l.id)} style={{ borderBottom: abre ? "none" : `1px solid ${PALETA.areia}`, cursor: "pointer", background: abre ? PALETA.areia : undefined }}>
                          <td style={{ ...td, textAlign: "left", whiteSpace: "normal", lineHeight: 1.25 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 18 }}>
                              <button type="button" aria-expanded={abre} aria-label={abre ? `Fechar ${l.nome}` : `Abrir ${l.nome}`}
                                onClick={(e) => { e.stopPropagation(); setAberto(abre ? null : l.id); }}
                                style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: PALETA.areiaTinta, display: "inline-flex" }}>
                                {abre ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                              <span style={{ fontWeight: 800, color: PALETA.carvao }}>{i < 3 && l.entregas > 0 ? `${MEDALHAS[i]} ` : ""}{l.nome}</span>
                              {!l.ativo && <span style={{ fontSize: "0.64rem", fontWeight: 800, padding: "1px 6px", borderRadius: 999, background: PALETA.areia, color: PALETA.areiaTinta, border: `1px solid ${PALETA.areiaBorda}` }}>INATIVO</span>}
                            </div>
                            <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 2, marginLeft: 22 }}>
                              {l.tipo}{variasLojas ? ` · ${l.loja}` : ""}
                              {antes && <> · antes: {plural(antes.entregas, "entrega", "entregas")}</>}
                            </div>
                          </td>
                          <td style={td}>{l.dias}</td>
                          <td style={{ ...td, fontWeight: 800 }}>
                            {l.entregas}
                            {l.entregasPorDia !== null && <div style={{ fontSize: "0.68rem", color: PALETA.areiaTinta, fontWeight: 600 }}>{fmtQtd(l.entregasPorDia)}/dia</div>}
                          </td>
                          <td style={td}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                              <div style={{ flex: 1, maxWidth: 70 }}><BarraDePct pct={l.pctDasEntregas} /></div>
                              <span style={{ minWidth: 38 }}>{l.pctDasEntregas.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</span>
                            </div>
                          </td>
                          <td style={td}>{l.km > 0 ? fmtQtd(l.km) : "—"}</td>
                          <td style={td}>{fmtReais(l.custoPorEntrega)}</td>
                          <td style={{ ...td, fontWeight: 900 }}>{fmtReais(l.aPagar)}</td>
                          <td style={td}>{l.dinheiroComEle > 0.005 ? fmtReais(l.dinheiroComEle) : "—"}</td>
                          <td style={td}><Saldo valor={l.saldo} /></td>
                        </tr>
                        {abre && (
                          <tr style={{ borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                            <td colSpan={9} style={{ padding: 0 }}><Detalhe l={l} onRecibo={() => setRecibo(l)} /></td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: PALETA.areia, borderTop: `1.5px solid ${PALETA.areiaBorda}` }}>
                    <td style={{ ...td, textAlign: "left", fontWeight: 900 }}>Equipe</td>
                    <td style={td} />
                    <td style={{ ...td, fontWeight: 900 }}>{t.entregas}</td>
                    <td style={td}>100%</td>
                    <td style={{ ...td, fontWeight: 800 }}>{t.km > 0 ? fmtQtd(t.km) : "—"}</td>
                    <td style={{ ...td, fontWeight: 800 }}>{fmtReais(t.custoPorEntrega)}</td>
                    <td style={{ ...td, fontWeight: 900 }}>{fmtReais(t.aPagar)}</td>
                    <td style={{ ...td, fontWeight: 800 }}>{fmtReais(t.dinheiroComEles)}</td>
                    <td style={td}><Saldo valor={t.saldo} quem="equipe" /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {dados.semEntrega.length > 0 && (
              <div style={{ padding: "0.7rem 1rem", fontSize: "0.8rem", color: PALETA.areiaTinta, borderTop: `1px solid ${PALETA.areia}` }}>
                <strong style={{ color: PALETA.carvao2 }}>Sem entrega no período:</strong> {dados.semEntrega.map((m) => m.nome + (m.ativo ? "" : " (inativo)")).join(", ")}
              </div>
            )}
          </Bloco>

          {dados.dias.length > 1 && (
            <Bloco titulo="Dia a dia da equipe"
              subtitulo={melhorDia ? `Entregas por dia. O mais forte: ${diaDaSemana(melhorDia.dia)} ${diaCurto(melhorDia.dia)}, com ${plural(melhorDia.entregas, "entrega", "entregas")} e ${plural(melhorDia.motoboys, "motoboy", "motoboys")}.` : undefined}>
              <Barras itens={dados.dias} valor={(d) => d.entregas}
                rotulo={(d) => diaCurto(d.dia)} subRotulo={(d) => diaDaSemana(d.dia)}
                destaque={(d) => d === melhorDia}
                dica={(d) => (
                  <>
                    <strong>{diaDaSemana(d.dia)} {diaCurto(d.dia)}</strong> · {plural(d.entregas, "entrega", "entregas")}<br />
                    Custo do dia: {fmtReais(d.custo)} ({fmtReais(d.entregas ? d.custo / d.entregas : 0)}/entrega)<br />
                    {d.porMotoboy.slice(0, 6).map((m) => `${m.nome} ${m.entregas}`).join(" · ")}{d.porMotoboy.length > 6 ? " · …" : ""}
                  </>
                )} />
            </Bloco>
          )}

          {dados.horas.length > 0 && (
            <Bloco titulo="Horários da equipe"
              subtitulo="Média de entregas por dia em cada hora, e quantos motoboys estavam com entrega nela. Serve para montar a escala.">
              <Barras itens={dados.horas} valor={(h) => Math.round(h.mediaPorDia * 10) / 10}
                rotulo={(h) => `${String(h.hora).padStart(2, "0")}h`}
                subRotulo={(h) => !h.entregas ? "" : <span title="Motoboys com entrega nessa hora, em média"><Bike size={9} style={{ verticalAlign: "-1px" }} /> {fmtQtd(Math.round(h.motoboysNaHora * 10) / 10)}</span>}
                destaque={(h) => h === pico}
                dica={(h) => (
                  <>
                    <strong>{String(h.hora).padStart(2, "0")}h às {String((h.hora + 1) % 24).padStart(2, "0")}h</strong><br />
                    {plural(h.entregas, "entrega", "entregas")} no período · {fmtQtd(h.mediaPorDia)} por dia<br />
                    {fmtQtd(h.motoboysNaHora)} motoboy(s) na rua · {fmtQtd(h.motoboysNaHora ? h.mediaPorDia / h.motoboysNaHora : 0)} entregas por motoboy
                  </>
                )} />
            </Bloco>
          )}
        </>
      )}

      <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.55 }}>
        <strong>A pagar</strong> é a diária de cada dia trabalhado (a do cadastro, ou a que a loja ajustou naquele dia) mais o valor de cada entrega
        (pela forma de pagamento do cadastro do motoboy), menos o lanche acima do combinado e as pendências lançadas no relatório do motoboy — o mesmo total da tela <Link href="/store/motoboys" style={{ color: PALETA.marca, fontWeight: 800 }}>Motoboys</Link> e
        do app do entregador. <strong>Dinheiro com ele</strong> são os pedidos pagos em dinheiro mais o troco que ele levou da loja.{" "}
        <strong>Saldo</strong> é um menos o outro: positivo, a loja paga; negativo, ele devolve. Entrega cancelada depois que o motoboy saiu conta como
        corrida; antes de sair, não. Pedido levado pelo entregador do iFood ou da 99 fica fora. O dia vira às 5h.
      </p>

      {recibo && dados && <Recibo l={recibo} periodo={dados.periodo} nomeDaLoja={recibo.loja} onFechar={() => setRecibo(null)} />}
    </ModeloDoRelatorio>
  );
}
