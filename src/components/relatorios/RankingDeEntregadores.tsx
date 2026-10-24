"use client";
/**
 * O ranking de entregadores desenhado — o MESMO na aba Ranking da tela
 * Motoboys e no relatório /store/relatorios/ranking-de-entregadores. Os
 * números vêm prontos da rota (lib/relatorios/ranking-de-entregadores.ts): a
 * tela não soma nada.
 *
 * Pódio com os três primeiros, os destaques de cada medida, a equipe, a tabela
 * inteira (clicar na linha abre de onde veio o score) e como o score é feito.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import type { LinhaDoRanking, ResultadoDoRanking } from "@/lib/relatorios/ranking-de-entregadores";

export type RespostaDoRanking = ResultadoDoRanking & {
  periodo: { de: string; ate: string };
  antes?: Record<string, { posicao: number | null; score: number | null }>;
  pesos: { conclusao: number; prazo: number; entrega: number; volta: number; coleta: number };
  rankingNoApp?: boolean;
};

const MEDALHAS = ["🥇", "🥈", "🥉"];
const COR_DO_PODIO = ["#D4A017", "#94A3B8", "#B87333"];

export const fmtMin = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`);
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const fmtNum = (n: number | null | undefined, casas = 1) => (n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: casas }));

export function corDoScore(score: number | null): string {
  if (score == null) return PALETA.areiaTinta;
  return score >= 85 ? PALETA.ok : score >= 70 ? PALETA.atencao : PALETA.grave;
}

/** "▲ 2" subiu, "▼ 1" caiu, "novo" — contra o período anterior. */
function Movimento({ agora, antes }: { agora: number | null; antes?: { posicao: number | null } }) {
  if (agora == null) return null;
  if (!antes || antes.posicao == null) return <span style={{ fontSize: "0.68rem", fontWeight: 800, color: PALETA.areiaTinta }}>novo</span>;
  const d = antes.posicao - agora;
  if (d === 0) return <span style={{ fontSize: "0.68rem", fontWeight: 800, color: PALETA.areiaTinta }}>=</span>;
  return <span style={{ fontSize: "0.7rem", fontWeight: 900, color: d > 0 ? PALETA.ok : PALETA.grave }}>{d > 0 ? `▲ ${d}` : `▼ ${-d}`}</span>;
}

function Pilula({ score }: { score: number | null }) {
  const cor = corDoScore(score);
  return (
    <span style={{ display: "inline-block", minWidth: 40, textAlign: "center", padding: "3px 8px", borderRadius: 999, fontWeight: 900, fontSize: "0.85rem", color: "#fff", background: score == null ? PALETA.areiaBorda : cor }}>
      {score ?? "—"}
    </span>
  );
}

function Podio({ linhas, antes }: { linhas: LinhaDoRanking[]; antes?: RespostaDoRanking["antes"] }) {
  const tres = linhas.filter((l) => l.posicao != null).slice(0, 3);
  if (tres.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
      {tres.map((l, i) => (
        <div key={l.motoboyId} className="fh-relatorio-bloco" style={{
          background: i === 0 ? "linear-gradient(135deg, #FFF8E1 0%, #FFFFFF 70%)" : "#fff",
          border: `2px solid ${COR_DO_PODIO[i]}`, borderRadius: 16, padding: "1rem 1.1rem", position: "relative",
          boxShadow: i === 0 ? "0 8px 24px rgba(212,160,23,0.18)" : undefined,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 900, color: COR_DO_PODIO[i], textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {i === 0 ? "Melhor do período" : `${i + 1}º lugar`}
              </div>
              <div style={{ fontSize: "1.15rem", fontWeight: 900, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {MEDALHAS[i]} {l.nome}
              </div>
              <div style={{ marginTop: 2 }}><Movimento agora={l.posicao} antes={antes?.[l.motoboyId]} /></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "2rem", fontWeight: 900, lineHeight: 1, color: corDoScore(l.score) }}>{l.score}</div>
              <div style={{ fontSize: "0.66rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase" }}>score</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 12, fontSize: "0.74rem", color: PALETA.areiaTinta }}>
            <div><strong style={{ display: "block", fontSize: "0.95rem", color: PALETA.carvao }}>{l.entregas}</strong>entregas</div>
            <div><strong style={{ display: "block", fontSize: "0.95rem", color: PALETA.carvao }}>{fmtPct(l.noPrazoPct)}</strong>no prazo</div>
            <div><strong style={{ display: "block", fontSize: "0.95rem", color: PALETA.carvao }}>{fmtMin(l.entregaMedianaMin)}</strong>entrega</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CartaoDaEquipe({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 14, padding: "0.8rem 0.9rem", minWidth: 0 }}>
      <div style={{ fontSize: "0.68rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em" }}>{rotulo}</div>
      <div style={{ fontSize: "1.3rem", fontWeight: 900, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
      {detalhe && <div style={{ fontSize: "0.72rem", color: PALETA.areiaTinta, marginTop: 2 }}>{detalhe}</div>}
    </div>
  );
}

/** De onde veio o score: a nota de cada medida e o peso dela. */
function Porque({ l, pesos }: { l: LinhaDoRanking; pesos: RespostaDoRanking["pesos"] }) {
  const itens: { rotulo: string; nota: number | null; peso: number; texto: string }[] = [
    { rotulo: "Conclusão", nota: l.notas.conclusao, peso: pesos.conclusao, texto: `${l.entregas} entregues, ${l.canceladas} cancelado(s) depois de sair com ele` },
    { rotulo: "No prazo", nota: l.notas.prazo, peso: pesos.prazo, texto: l.comPrazo ? `${l.noPrazo} de ${l.comPrazo} no prazo prometido${l.atrasadas ? ` · atraso médio ${fmtMin(l.atrasoMedioMin)}` : ""}` : "nenhum pedido com prazo prometido" },
    { rotulo: "Entrega", nota: l.notas.entrega, peso: pesos.entrega, texto: `mediana ${fmtMin(l.entregaMedianaMin)} · média ${fmtMin(l.entregaMediaMin)} (da saída à entrega)` },
    { rotulo: "Volta", nota: l.notas.volta, peso: pesos.volta, texto: l.voltas ? `mediana ${fmtMin(l.voltaMedianaMin)} em ${l.voltas} volta(s) (da última entrega até pegar o próximo)` : "sem volta medida no período" },
    { rotulo: "Coleta", nota: l.notas.coleta, peso: pesos.coleta, texto: l.coletas ? `mediana ${fmtMin(l.coletaMedianaMin)} em ${l.coletas} pedido(s) (do pronto até sair)` : "a cozinha não marcou pronto" },
  ];
  return (
    <div style={{ display: "grid", gap: 8, padding: "0.4rem 0 0.6rem" }}>
      {itens.map((it) => (
        <div key={it.rotulo} style={{ display: "grid", gridTemplateColumns: "92px 1fr 46px", alignItems: "center", gap: 10, fontSize: "0.78rem" }}>
          <span style={{ fontWeight: 800 }}>{it.rotulo} <span style={{ color: PALETA.areiaTinta, fontWeight: 600 }}>({it.peso})</span></span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", height: 7, background: PALETA.areia, borderRadius: 999, overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${it.nota ?? 0}%`, background: it.nota == null ? PALETA.areiaBorda : corDoScore(it.nota), borderRadius: 999 }} />
            </span>
            <span style={{ display: "block", color: PALETA.areiaTinta, marginTop: 2 }}>{it.texto}</span>
          </span>
          <span style={{ textAlign: "right", fontWeight: 900, color: it.nota == null ? PALETA.areiaTinta : corDoScore(it.nota) }}>{it.nota == null ? "fora" : Math.round(it.nota)}</span>
        </div>
      ))}
      <div style={{ fontSize: "0.74rem", color: PALETA.areiaTinta }}>
        {l.dias} dia(s) trabalhado(s) · {fmtNum(l.entregasPorDia)} entregas por dia · {l.viagens} viagem(ns), {fmtNum(l.pedidosPorViagem)} pedido(s) por viagem
        {l.km != null ? ` · ${fmtNum(l.km)} km` : ""}{l.avaliacao != null ? ` · avaliação ${fmtNum(l.avaliacao)} (${l.avaliacoes})` : ""}
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: "9px 0.6rem", fontSize: "0.66rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", textAlign: "right", borderBottom: `1px solid ${PALETA.areiaBorda}`, background: "#fff" };
const td: React.CSSProperties = { padding: "10px 0.6rem", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", borderBottom: `1px solid ${PALETA.areia}` };

export default function RankingDeEntregadores({ dados }: { dados: RespostaDoRanking }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const { linhas, equipe, destaques, pesos, antes } = dados;

  if (linhas.length === 0) {
    return <div style={{ padding: "2.5rem 1rem", textAlign: "center", color: PALETA.areiaTinta }}>Nenhuma entrega de motoboy da loja no período escolhido.</div>;
  }

  return (
    <div>
      <Podio linhas={linhas} antes={antes} />

      {destaques.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "1.1rem" }}>
          {destaques.map((d) => (
            <span key={d.chave} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, background: PALETA.brasaClaro, border: `1px solid ${PALETA.brasaBorda}`, fontSize: "0.78rem", color: PALETA.brasaTinta }}>
              <strong>{d.titulo}:</strong> {d.nome} · {d.valor}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem", marginBottom: "1.25rem" }}>
        <CartaoDaEquipe rotulo="Entregas" valor={equipe.entregas.toLocaleString("pt-BR")} detalhe={`${equipe.motoboys} entregador(es)`} />
        <CartaoDaEquipe rotulo="Cancelados com motoboy" valor={equipe.canceladas.toLocaleString("pt-BR")} detalhe="cancelados depois de sair" />
        <CartaoDaEquipe rotulo="Conclusão" valor={fmtPct(equipe.conclusaoPct)} />
        <CartaoDaEquipe rotulo="Entrega (mediana)" valor={fmtMin(equipe.entregaMedianaMin)} detalhe="da saída à entrega" />
        <CartaoDaEquipe rotulo="No prazo" valor={fmtPct(equipe.noPrazoPct)} detalhe="até a hora prometida" />
        <CartaoDaEquipe rotulo="Coleta (mediana)" valor={fmtMin(equipe.coletaMedianaMin)} detalhe="do pronto até sair" />
        <CartaoDaEquipe rotulo="Volta (mediana)" valor={fmtMin(equipe.voltaMedianaMin)} detalhe="fim da rota → próximo pedido" />
        <CartaoDaEquipe rotulo="Pedidos por viagem" valor={fmtNum(equipe.pedidosPorViagem)} detalhe={`${equipe.viagens} viagens`} />
      </div>

      <div className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, overflow: "hidden", marginBottom: "1.25rem" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left", width: 44 }}>#</th>
                <th style={{ ...th, textAlign: "left" }}>Entregador</th>
                <th style={th}>Score</th>
                <th style={th}>Entregas</th>
                <th style={th} title="Cancelados depois de sair com ele">Canc.</th>
                <th style={th}>Concl.</th>
                <th style={th} title="Mediana, da saída à entrega">Entrega</th>
                <th style={th} title="Entregues até a hora prometida ao cliente">No prazo</th>
                <th style={th} title="Mediana, do pedido pronto até ele sair">Coleta</th>
                <th style={th} title="Mediana, da última entrega da rota até pegar o próximo pedido">Volta</th>
                <th style={th} title="Pedidos por viagem">Ped./viagem</th>
                <th style={th}>Km</th>
                <th style={th}>Por dia</th>
                <th style={th}>Avaliação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const top = l.posicao != null && l.posicao <= 3;
                const abre = aberto === l.motoboyId;
                return (
                  <React.Fragment key={l.motoboyId}>
                    <tr onClick={() => setAberto(abre ? null : l.motoboyId)} style={{ cursor: "pointer", background: top ? "#FFFBF0" : undefined }}>
                      <td style={{ ...td, textAlign: "left" }}>
                        {l.posicao == null
                          ? <span style={{ color: PALETA.areiaTinta }}>—</span>
                          : l.posicao <= 3
                            ? <span style={{ fontSize: "1.05rem" }}>{MEDALHAS[l.posicao - 1]}</span>
                            : <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 999, background: PALETA.areia, fontWeight: 800, fontSize: "0.76rem" }}>{l.posicao}</span>}
                      </td>
                      <td style={{ ...td, textAlign: "left", fontWeight: 800 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {abre ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {l.nome}
                          <Movimento agora={l.posicao} antes={antes?.[l.motoboyId]} />
                        </span>
                        {l.posicao == null && <span style={{ display: "block", fontSize: "0.68rem", fontWeight: 600, color: PALETA.areiaTinta }}>poucas entregas para pontuar</span>}
                      </td>
                      <td style={td}><Pilula score={l.score} /></td>
                      <td style={{ ...td, fontWeight: 800 }}>{l.entregas}</td>
                      <td style={{ ...td, color: l.canceladas > 0 ? PALETA.grave : undefined, fontWeight: l.canceladas > 0 ? 800 : undefined }}>{l.canceladas}</td>
                      <td style={td}>{fmtPct(l.conclusaoPct)}</td>
                      <td style={td}>{fmtMin(l.entregaMedianaMin)}</td>
                      <td style={{ ...td, color: l.noPrazoPct != null && l.noPrazoPct < 80 ? PALETA.grave : undefined }}>{fmtPct(l.noPrazoPct)}</td>
                      <td style={td}>{fmtMin(l.coletaMedianaMin)}</td>
                      <td style={td}>{fmtMin(l.voltaMedianaMin)}</td>
                      <td style={td}>{fmtNum(l.pedidosPorViagem)}</td>
                      <td style={td}>{l.km == null ? "—" : fmtNum(l.km)}</td>
                      <td style={td}>{fmtNum(l.entregasPorDia)}</td>
                      <td style={td}>{l.avaliacao == null ? "—" : `${fmtNum(l.avaliacao)} ★`}</td>
                    </tr>
                    {abre && (
                      <tr>
                        <td colSpan={14} style={{ padding: "0.3rem 1rem 0.6rem 3.2rem", background: PALETA.areia, borderBottom: `1px solid ${PALETA.areiaBorda}` }}>
                          <Porque l={l} pesos={pesos} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <details className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 14, padding: "0.8rem 1rem", fontSize: "0.8rem", color: PALETA.carvao2, lineHeight: 1.55 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>Como o score é calculado</summary>
        <p style={{ margin: "0.6rem 0 0" }}>
          Cada medida vira uma nota de 0 a 100, e o score é a média com estes pesos: <strong>conclusão {pesos.conclusao}</strong>,
          {" "}<strong>no prazo {pesos.prazo}</strong>, <strong>entrega {pesos.entrega}</strong>, <strong>volta {pesos.volta}</strong> e <strong>coleta {pesos.coleta}</strong>.
        </p>
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: 18 }}>
          <li><strong>Conclusão:</strong> entregues ÷ (entregues + cancelados depois de sair com ele). Cancelado antes de sair não conta contra ele.</li>
          <li><strong>No prazo:</strong> entregue até a hora prometida ao cliente (o prazo do app ou o tempo da área de entrega).</li>
          <li><strong>Entrega, volta e coleta</strong> são comparadas com a equipe: igual ou melhor que a mediana da equipe vale 100; o dobro vale 0.</li>
          <li><strong>Volta:</strong> da última entrega de uma rota até ele pegar o próximo pedido. Intervalo acima de 60 min é pausa e não entra.</li>
          <li><strong>Coleta:</strong> do pedido marcado pronto até ele sair. Só conta onde a cozinha marca pronto.</li>
          <li>Medida sem dado sai da conta e o peso dela vai para as outras. Quem fez menos de 3 entregas aparece sem posição.</li>
        </ul>
      </details>
    </div>
  );
}
