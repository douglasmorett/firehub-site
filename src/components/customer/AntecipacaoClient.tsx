"use client";
/**
 * A aba Antecipação: o que a cozinha deixa pronto antes do pedido chegar, pela
 * média dos dois últimos dias iguais da semana (a conta: lib/antecipacao.ts,
 * a rota: api/store/antecipacao). Toda loja vê os lanches completos; o Hakim
 * vê também as 4 bases (carne, calabresa, queijo temperado, mussarela).
 *
 * Só quantidade — nada de valor: a tela abre para o funcionário da cozinha.
 */
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronUp, Clock, Info, PartyPopper, Printer, RefreshCw } from "lucide-react";

type Linha = { chave: string; nome: string; combo: boolean; porDia: number[]; media: number; sugerido: number; porHora: number[] };
type Base = Linha & { serve: string; lanches: { nome: string; media: number }[] };
type Resposta = {
  lojas: string[];
  hoje: string;
  dia: string;
  diaSemana: number;
  horaDe: string;
  horaAte: string;
  feriado: { doDia: string | null; modo: "auto" | "sim" | "nao"; ativo: boolean; pct: number };
  referencias: { dia: string; pedidosNoDia: number; pedidosNaFaixa: number }[];
  pulados: { dia: string; motivo: string }[];
  lanches: Linha[];
  combos: Linha[];
  ehHakim: boolean;
  bases: { bases: Base[]; doces: number } | null;
  pedidos: { dia: string; lista: { id: string; hora: string; canal: string; itens: { quantidade: number; nome: string }[] }[] }[];
};

type Horario = "dia" | "proximas" | "faixa";

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
/** As horas na ordem do expediente: o dia vira às 5h. */
const HORAS_DO_DIA = [...Array.from({ length: 19 }, (_, i) => i + 5), 0, 1, 2, 3, 4];

const diaCurto = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  return `${DIAS_CURTOS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
};
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function Abas<T extends string>({ valor, opcoes, onChange, rotulo }: { valor: T; opcoes: { chave: T; nome: React.ReactNode }[]; onChange: (v: T) => void; rotulo: string }) {
  const i = Math.max(0, opcoes.findIndex((o) => o.chave === valor));
  return (
    <div role="tablist" aria-label={rotulo} className="fh-abas" style={{ ["--n" as any]: opcoes.length, ["--i" as any]: i }}>
      {opcoes.map((o) => (
        <button key={o.chave} type="button" role="tab" aria-selected={o.chave === valor} className="fh-aba" onClick={() => onChange(o.chave)}>
          {o.nome}
        </button>
      ))}
    </div>
  );
}

export default function AntecipacaoClient() {
  const [dia, setDia] = useState<"hoje" | "amanha">("hoje");
  const [horario, setHorario] = useState<Horario>("dia");
  const [proximas, setProximas] = useState(3);
  const [horaDe, setHoraDe] = useState("18:00");
  const [horaAte, setHoraAte] = useState("21:00");
  const [feriado, setFeriado] = useState<"auto" | "sim" | "nao">("auto");
  const [visao, setVisao] = useState<"bases" | "lanches">("bases");
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [diaDosPedidos, setDiaDosPedidos] = useState(0);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // "Próximas horas" é de hoje: amanhã volta para o dia inteiro.
  const horarioValido: Horario = dia === "amanha" && horario === "proximas" ? "dia" : horario;

  const query = useMemo(() => {
    const sp = new URLSearchParams({ dia, feriado });
    if (horarioValido === "proximas") sp.set("proximas", String(proximas));
    if (horarioValido === "faixa" && horaDe && horaAte) { sp.set("horaDe", horaDe); sp.set("horaAte", horaAte); }
    return sp.toString();
  }, [dia, feriado, horarioValido, proximas, horaDe, horaAte]);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/store/antecipacao?${query}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Não deu para carregar a antecipação.");
      setDados(json);
      setDiaDosPedidos(0);
    } catch (e: any) {
      setErro(e.message || "Não deu para carregar a antecipação.");
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => { carregar(); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loja que não é Hakim não tem a visão de bases.
  const visaoAtual = dados?.ehHakim ? visao : "lanches";
  const n = dados?.referencias.length || 0;
  const lanches = (dados?.lanches || []).filter((l) => l.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  const totalDeLanches = (dados?.lanches || []).reduce((s, l) => s + l.sugerido, 0);
  const totalDasBases = (dados?.bases?.bases || []).reduce((s, b) => s + b.sugerido, 0);
  const janelaTexto = !dados ? "" : dados.horaDe || dados.horaAte ? `das ${dados.horaDe} às ${dados.horaAte}` : "o dia inteiro";
  // As horas da tabela hora a hora: só as que tiveram venda na média.
  const horasComVenda = HORAS_DO_DIA.filter((h) => (dados?.bases?.bases || []).some((b) => b.porHora[h] > 0));

  return (
    <div className="ant-raiz" style={{ padding: "1.5rem 1rem 3rem", maxWidth: 1180, margin: "0 auto", color: "var(--fh-t1)", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        @media print { .fh-sem-impressao, nav, aside, [data-fh-nav] { display: none !important; } body { background: #fff !important; } }
        .ant-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
        .ant-tabela { width: 100%; border-collapse: collapse; font-size: 15px; font-variant-numeric: tabular-nums; }
        .ant-tabela th { text-align: left; font: 800 12px/1.2 Inter, system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; color: var(--fh-t3); padding: 10px 12px; background: var(--fh-n3); border-bottom: 1px solid var(--fh-linha); }
        .ant-tabela td { padding: 10px 12px; border-bottom: 1px solid var(--fh-linha-fraca); color: var(--fh-t2); }
        .ant-tabela .num { text-align: right; white-space: nowrap; }
        .ant-controles { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
        @media (max-width: 560px) { .ant-raiz .fh-abas { overflow-x: visible; } .ant-raiz .fh-aba { padding: 0 4px; font-size: 13px; height: 46px; white-space: normal; text-align: center; line-height: 1.15; } }
      `}</style>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 900, letterSpacing: "-0.01em" }}>Antecipação de produção</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.92rem", color: "var(--fh-t4)", maxWidth: 720 }}>
            O que deixar pronto antes do pedido chegar: a média do que saiu nos <strong>dois últimos {dados ? DIAS[dados.diaSemana].toLowerCase() + "s" : "dias iguais da semana"}</strong>
            {dados?.lojas.length ? <> em <strong>{dados.lojas.join(", ")}</strong></> : null}. O que vem dentro dos combos já está somado em cada lanche.
          </p>
        </div>
        <div className="fh-sem-impressao" style={{ display: "flex", gap: 8 }}>
          <button type="button" className="fh-btn fh-btn--secundario" onClick={carregar}><RefreshCw size={16} /> Atualizar</button>
          <button type="button" className="fh-btn fh-btn--secundario" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>
        </div>
      </header>

      {/* ── O QUE E QUANDO ── */}
      <section className="fh-card fh-sem-impressao" style={{ padding: 18, marginBottom: 16 }}>
        <div className="ant-controles">
          <div className="fh-campo">
            <label><CalendarDays size={13} style={{ verticalAlign: -2 }} /> Para qual dia</label>
            <Abas rotulo="Dia" valor={dia} onChange={setDia} opcoes={[
              { chave: "hoje", nome: dados ? `Hoje · ${diaCurto(dados.hoje)}` : "Hoje" },
              { chave: "amanha", nome: "Amanhã" },
            ]} />
          </div>
          <div className="fh-campo">
            <label><Clock size={13} style={{ verticalAlign: -2 }} /> Horário</label>
            <Abas rotulo="Horário" valor={horarioValido} onChange={setHorario} opcoes={[
              { chave: "dia", nome: "Dia inteiro" },
              ...(dia === "hoje" ? [{ chave: "proximas" as Horario, nome: "Próximas horas" }] : []),
              { chave: "faixa", nome: "De … até" },
            ]} />
          </div>
          <div className="fh-campo">
            <label><PartyPopper size={13} style={{ verticalAlign: -2 }} /> Modo feriado (+{dados?.feriado.pct ?? 20}%)</label>
            <Abas rotulo="Modo feriado" valor={feriado} onChange={setFeriado} opcoes={[
              { chave: "auto", nome: "Automático" },
              { chave: "sim", nome: "Ligado" },
              { chave: "nao", nome: "Desligado" },
            ]} />
          </div>
        </div>

        {horarioValido === "proximas" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
            <span style={{ fontSize: 14, color: "var(--fh-t3)", fontWeight: 700 }}>Da hora cheia de agora até daqui a</span>
            {[1, 2, 3, 4, 6, 8, 12].map((h) => (
              <button key={h} type="button" onClick={() => setProximas(h)}
                className={`fh-btn ${proximas === h ? "fh-btn--primario" : "fh-btn--secundario"}`}
                style={{ height: 40, padding: "0 14px", borderRadius: 12 }}>
                {h} h
              </button>
            ))}
          </div>
        )}
        {horarioValido === "faixa" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
            <div className="fh-campo" style={{ width: 150 }}>
              <label htmlFor="ant-de">De</label>
              <input id="ant-de" type="time" value={horaDe} onChange={(e) => setHoraDe(e.target.value)} />
            </div>
            <div className="fh-campo" style={{ width: 150 }}>
              <label htmlFor="ant-ate">Até</label>
              <input id="ant-ate" type="time" value={horaAte} onChange={(e) => setHoraAte(e.target.value)} />
            </div>
            <span style={{ fontSize: 13, color: "var(--fh-t4)", paddingBottom: 12 }}>Pode passar da meia-noite (18:00 até 02:00).</span>
          </div>
        )}
      </section>

      {dados?.feriado.ativo && (
        <div className="fh-aviso fh-aviso--atencao" style={{ marginBottom: 16 }}>
          <PartyPopper size={20} style={{ flexShrink: 0 }} />
          <div>
            <strong>Modo feriado ativado.</strong>{" "}
            {dados.feriado.doDia
              ? <>{dados.dia === dados.hoje ? "Hoje" : "Amanhã"} é feriado: <strong>{dados.feriado.doDia}</strong>. </>
              : <>Ligado na mão. </>}
            A antecipação está <strong>{dados.feriado.pct}% acima</strong> do normal.
          </div>
        </div>
      )}
      {dados && !dados.feriado.ativo && dados.feriado.doDia && dados.feriado.modo === "nao" && (
        <div className="fh-aviso fh-aviso--info" style={{ marginBottom: 16 }}>
          <Info size={20} style={{ flexShrink: 0 }} />
          <div>{dados.dia === dados.hoje ? "Hoje" : "Amanhã"} é feriado ({dados.feriado.doDia}), mas o modo feriado está desligado: a conta é a de um dia normal.</div>
        </div>
      )}

      {carregando && !dados ? (
        <div className="fh-card" style={{ padding: 40, textAlign: "center", color: "var(--fh-t4)" }}>Calculando pelo histórico de pedidos…</div>
      ) : erro ? (
        <div className="fh-aviso fh-aviso--erro">
          <AlertTriangle size={20} style={{ flexShrink: 0 }} />
          <div>{erro} <button type="button" className="fh-btn fh-btn--secundario" style={{ height: 34, marginLeft: 8 }} onClick={carregar}>Tentar de novo</button></div>
        </div>
      ) : dados && n === 0 ? (
        <div className="fh-card" style={{ padding: 32, textAlign: "center" }}>
          <Info size={28} style={{ color: "var(--fh-t4)" }} />
          <p style={{ margin: "8px 0 0", fontWeight: 800 }}>Ainda não há {DIAS[dados.diaSemana].toLowerCase()} com venda para fazer a média.</p>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--fh-t4)" }}>Olhamos as últimas 8 semanas{dados.pulados.length ? ` (pulados: ${dados.pulados.map((p) => `${diaCurto(p.dia)} — ${p.motivo}`).join("; ")})` : ""}.</p>
        </div>
      ) : dados ? (
        <div style={{ opacity: carregando ? 0.55 : 1, transition: "opacity .15s" }}>
          {/* ── DE ONDE SAI A MÉDIA ── */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16, fontSize: 14, color: "var(--fh-t3)" }}>
            <span style={{ fontWeight: 800, color: "var(--fh-t1)" }}>{diaCurto(dados.dia)}, {janelaTexto}</span>
            <span>· média de</span>
            {dados.referencias.map((r) => (
              <span key={r.dia} className="fh-chip">{diaCurto(r.dia)} · {r.pedidosNaFaixa} pedido{r.pedidosNaFaixa === 1 ? "" : "s"}</span>
            ))}
            {n === 1 && <span style={{ color: "var(--fh-atencao)", fontWeight: 700 }}>(só um dia com venda: a conta usa ele sozinho)</span>}
            {dados.pulados.map((p) => (
              <span key={p.dia} style={{ fontSize: 13, color: "var(--fh-t4)" }}>· {diaCurto(p.dia)} ficou de fora: {p.motivo}</span>
            ))}
          </div>

          {dados.ehHakim && (
            <div className="fh-sem-impressao" style={{ maxWidth: 520, marginBottom: 16 }}>
              <Abas rotulo="Visão" valor={visaoAtual} onChange={setVisao} opcoes={[
                { chave: "bases", nome: `Bases (${totalDasBases})` },
                { chave: "lanches", nome: `Lanches completos (${totalDeLanches})` },
              ]} />
            </div>
          )}

          {visaoAtual === "bases" && dados.bases ? (
            <>
              <div className="ant-grade" style={{ marginBottom: 16 }}>
                {dados.bases.bases.map((b) => {
                  const aberto = abertos[b.chave];
                  return (
                    <div key={b.chave} className="fh-card" style={{ padding: 18, borderTop: "4px solid var(--fh-marca-brasa)" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--fh-t3)" }}>Base de {b.nome.toLowerCase()}</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "6px 0 2px" }}>
                        <span style={{ fontSize: 46, fontWeight: 900, lineHeight: 1, color: "var(--fh-marca)" }}>{b.sugerido}</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--fh-t3)" }}>esfihas</span>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--fh-t4)" }}>{b.serve}</div>
                      <div style={{ fontSize: 13, color: "var(--fh-t3)", marginTop: 10 }}>
                        Média {num(b.media)} · {dados.referencias.map((r, i) => `${diaCurto(r.dia)}: ${num(b.porDia[i])}`).join(" · ")}
                      </div>
                      {b.lanches.length > 0 && (
                        <button type="button" className="fh-btn fh-btn--fantasma fh-sem-impressao" style={{ height: 32, padding: "0 8px", marginTop: 8, fontSize: 13 }}
                          onClick={() => setAbertos((a) => ({ ...a, [b.chave]: !aberto }))}>
                          {aberto ? <ChevronUp size={15} /> : <ChevronDown size={15} />} De quais lanches ({b.lanches.length})
                        </button>
                      )}
                      {aberto && (
                        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", fontSize: 13, color: "var(--fh-t2)" }}>
                          {b.lanches.map((l) => (
                            <li key={l.nome} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", borderBottom: "1px solid var(--fh-linha-fraca)" }}>
                              <span>{l.nome}</span><strong>{num(l.media)}</strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
              <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--fh-t4)" }}>
                Esfiha doce não usa base ({num(dados.bases.doces)} doces na média) — está em Lanches completos, com bebida e acompanhamento.
              </p>

              {horasComVenda.length > 0 && (
                <section className="fh-card" style={{ overflow: "hidden", marginBottom: 18 }}>
                  <div className="fh-card__head"><h2 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>Hora a hora</h2>
                    <span style={{ fontSize: 13, color: "var(--fh-t4)" }}>o que sai em cada hora, para ter pronto antes dela (arredondado para cima)</span></div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="ant-tabela">
                      <thead><tr><th>Hora</th>{dados.bases.bases.map((b) => <th key={b.chave} className="num">{b.nome}</th>)}</tr></thead>
                      <tbody>
                        {horasComVenda.map((h) => (
                          <tr key={h}>
                            <td style={{ fontWeight: 800, color: "var(--fh-t1)" }}>{String(h).padStart(2, "0")}h</td>
                            {dados.bases!.bases.map((b) => <td key={b.chave} className="num">{b.porHora[h] > 0 ? Math.ceil(b.porHora[h]) : "—"}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
              <section className="fh-card" style={{ overflow: "hidden", marginBottom: 18 }}>
                <div className="fh-card__head" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>Lanches para deixar pronto ({dados.lanches.length})</h2>
                  <div className="fh-campo fh-sem-impressao" style={{ width: 260 }}>
                    <input type="search" placeholder="Buscar lanche…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar lanche" />
                  </div>
                </div>
                {lanches.length === 0 ? (
                  <p style={{ padding: 24, margin: 0, textAlign: "center", color: "var(--fh-t4)" }}>Nenhum lanche vendido nesse horário nos dias da média.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="ant-tabela">
                      <thead><tr><th>#</th><th>Lanche</th><th className="num">Deixar pronto</th><th className="num">Média</th>{dados.referencias.map((r) => <th key={r.dia} className="num">{diaCurto(r.dia)}</th>)}</tr></thead>
                      <tbody>
                        {lanches.map((l, i) => (
                          <tr key={l.chave}>
                            <td style={{ color: "var(--fh-t4)" }}>{i + 1}</td>
                            <td style={{ fontWeight: 700, color: "var(--fh-t1)" }}>{l.nome}</td>
                            <td className="num" style={{ fontSize: 20, fontWeight: 900, color: "var(--fh-marca)" }}>{l.sugerido}</td>
                            <td className="num">{num(l.media)}</td>
                            {l.porDia.map((q, k) => <td key={k} className="num">{num(q)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {dados.combos.length > 0 && (
                <section className="fh-card" style={{ overflow: "hidden", marginBottom: 18 }}>
                  <div className="fh-card__head">
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>Combos vendidos ({dados.combos.length})</h2>
                    <span style={{ fontSize: 13, color: "var(--fh-t4)" }}>O que o cliente escolheu dentro do combo já está nos lanches acima. O que vem FIXO no combo (sem escolha) não está — confira aqui.</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table className="ant-tabela">
                      <thead><tr><th>Combo</th><th className="num">Média</th>{dados.referencias.map((r) => <th key={r.dia} className="num">{diaCurto(r.dia)}</th>)}</tr></thead>
                      <tbody>
                        {dados.combos.map((l) => (
                          <tr key={l.chave}>
                            <td style={{ fontWeight: 700, color: "var(--fh-t1)" }}>{l.nome}</td>
                            <td className="num">{num(l.media)}</td>
                            {l.porDia.map((q, k) => <td key={k} className="num">{num(q)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}

          {/* ── OS PEDIDOS DA CONTA ── */}
          <details className="fh-card fh-sem-impressao" style={{ overflow: "hidden" }}>
            <summary style={{ padding: "16px 20px", cursor: "pointer", fontWeight: 900, fontSize: 16 }}>
              Pedidos usados na conta ({dados.pedidos.reduce((s, d) => s + d.lista.length, 0)})
            </summary>
            <div style={{ padding: "0 20px 20px" }}>
              <div style={{ maxWidth: 420, marginBottom: 12 }}>
                <Abas rotulo="Dia dos pedidos" valor={String(diaDosPedidos)} onChange={(v) => setDiaDosPedidos(Number(v))}
                  opcoes={dados.pedidos.map((d, i) => ({ chave: String(i), nome: `${diaCurto(d.dia)} (${d.lista.length})` }))} />
              </div>
              <div style={{ overflowX: "auto", maxHeight: 520 }}>
                <table className="ant-tabela">
                  <thead><tr><th>Hora</th><th>Canal</th><th>Itens</th></tr></thead>
                  <tbody>
                    {(dados.pedidos[diaDosPedidos]?.lista || []).map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 800, color: "var(--fh-t1)" }}>{p.hora}</td>
                        <td>{p.canal}</td>
                        <td>{p.itens.map((it) => `${it.quantidade}x ${it.nome}`).join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--fh-t4)", lineHeight: 1.5 }}>
            Como a conta é feita: o dia vira às 5h (pedido da 1h da manhã é do dia anterior). Pedido cancelado e reposição não entram. Combo pedido em dobro conta em dobro; meia pizza conta meia de cada sabor. Feriado e dia sem venda não servem de base — a conta pula para a semana anterior. É uma média: chuva, jogo e promoção mudam o movimento.
          </p>
        </div>
      ) : null}
    </div>
  );
}
