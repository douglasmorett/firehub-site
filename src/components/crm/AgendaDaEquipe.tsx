"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  NOMES_DOS_DIAS, dataCurta, diaDaSemana, horarioDosMinutos, minutosDoHorario, somarDias, type Disponibilidade, type Faixa,
} from "@/lib/crm/agenda";
import { ROTULO_DO_STATUS_DE_REUNIAO, ROTULO_DO_TIPO_DE_REUNIAO, type StatusDeReuniao, type TipoDeReuniao } from "@/lib/crm/etapas";
import type { ReuniaoDaTela } from "@/lib/crm/serializar";
import { EstiloDoCrm, Modal, api, horaDe } from "./comum";
import ModalDeReuniao from "./ModalDeReuniao";

type Membro = { id: string; nome: string; disponibilidade: Disponibilidade };
type Agenda = {
  hoje: string; de: string; dias: number;
  equipe: Membro[];
  reunioes: ReuniaoDaTela[];
  vagas: { vendedorId: string; data: string; vagas: string[] }[];
  quem: { tipo: "ADMIN" | "VENDEDOR"; id: string; nome: string };
};

const PX_POR_MIN = 1.1;
const FUSO = "America/Sao_Paulo";

const minutosNoFuso = (iso: string) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).split(":").map(Number);
  return (h % 24) * 60 + m;
};

const COR_DA_REUNIAO = (r: ReuniaoDaTela) => {
  if (r.status === "CANCELADA") return { fundo: "#F8FAFC", borda: "#CBD5E1", texto: "#94A3B8" };
  if (r.status === "FALTOU") return { fundo: "#FEF2F2", borda: "#F87171", texto: "#991B1B" };
  if (r.status === "REALIZADA") return { fundo: "#F0FDF4", borda: "#22C55E", texto: "#14532D" };
  if (r.tipo === "BLOQUEIO") return { fundo: "#F1F5F9", borda: "#64748B", texto: "#334155" };
  if (r.tipo === "OCUPADO") return { fundo: "#F1F5F9", borda: "#94A3B8", texto: "#475569" };
  if (r.tipo === "DEMONSTRACAO") return { fundo: "#FFF4F0", borda: "#E8360C", texto: "#7C2D12" };
  return { fundo: "#EEF2FF", borda: "#6366F1", texto: "#312E81" };
};

/**
 * A AGENDA COMPARTILHADA DA EQUIPE.
 *
 * Dia: uma coluna por vendedor, as faixas de trabalho de cada um, as reuniões
 * e os horários LIVRES em verde — clicar num livre já abre "marcar" com o
 * vendedor, o dia e a hora. Semana: quantas vagas cada vendedor tem em cada
 * dia (é a pergunta "tem vaga para mais alguém na quinta com o Victor?").
 *
 * O vendedor vê a equipe inteira; nas colunas dos colegas, só "Ocupado".
 */
export default function AgendaDaEquipe({ modo, aoAbrirConversa }: { modo: "ADMIN" | "VENDEDOR"; aoAbrirConversa?: (contatoId: string) => void }) {
  const [vista, setVista] = useState<"dia" | "semana">("dia");
  const [dia, setDia] = useState<string>(() => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date()));
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcar, setMarcar] = useState<{ vendedorId: string; data: string; hora: string; tipo?: string } | null>(null);
  const [aberta, setAberta] = useState<ReuniaoDaTela | null>(null);
  const [horariosDe, setHorariosDe] = useState<string | null>(null);

  const inicio = dia;
  const dias = vista === "semana" ? 7 : 1;
  // O que está na tela é do período pedido? Trocar de dia ou de vista mostra o
  // dado anterior até a resposta chegar — e dia sem dado carregado apareceria
  // como "lotado", que é mentira.
  const pronta = !!agenda && agenda.de === inicio && agenda.dias === dias;

  const carregar = useCallback(async () => {
    const r = await api(`/api/crm/agenda?de=${inicio}&dias=${dias}`);
    if (!r.ok) { setErro(r.erro); return; }
    setErro(null);
    setAgenda(r.dados);
  }, [inicio, dias]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 30_000);
    return () => clearInterval(i);
  }, [carregar]);

  const equipe = useMemo(() => {
    if (!agenda) return [];
    // O vendedor vê a própria coluna primeiro.
    const lista = [...agenda.equipe];
    if (modo === "VENDEDOR") lista.sort((a, b) => (a.id === agenda.quem.id ? -1 : b.id === agenda.quem.id ? 1 : 0));
    return lista;
  }, [agenda, modo]);

  const vendedoresParaSelecao = equipe.map((m) => ({ id: m.id, nome: m.nome }));
  const podeMarcarEm = (vendedorId: string) => modo === "ADMIN" || agenda?.quem.id === vendedorId;

  const vagasDe = (vendedorId: string, data: string) => agenda?.vagas.find((v) => v.vendedorId === vendedorId && v.data === data)?.vagas || [];
  const reunioesDe = (vendedorId: string, data: string) =>
    (agenda?.reunioes || []).filter((r) => r.vendedorId === vendedorId && new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(r.inicio)) === data);

  // ── Faixa de horas da grade do dia: do começo mais cedo ao fim mais tarde ──
  const [iniGrade, fimGrade] = useMemo(() => {
    if (!agenda || vista !== "dia") return [8 * 60, 19 * 60];
    const d = String(diaDaSemana(dia));
    let a = 24 * 60;
    let b = 0;
    for (const m of equipe) {
      for (const [x, y] of m.disponibilidade.dias[d] || []) {
        a = Math.min(a, minutosDoHorario(x) ?? a);
        b = Math.max(b, minutosDoHorario(y) ?? b);
      }
    }
    for (const r of agenda.reunioes) {
      a = Math.min(a, minutosNoFuso(r.inicio));
      b = Math.max(b, minutosNoFuso(r.fim) || 24 * 60);
    }
    if (a >= b) { a = 8 * 60; b = 19 * 60; }
    return [Math.max(0, Math.floor(a / 60) * 60 - 60), Math.min(24 * 60, Math.ceil(b / 60) * 60 + 60)];
  }, [agenda, equipe, dia, vista]);

  const andar = (n: number) => setDia((d) => somarDias(d, n * (vista === "semana" ? 7 : 1)));
  const hoje = agenda?.hoje || dia;

  const totalDeVagasNoDia = (data: string) => equipe.reduce((s, m) => s + vagasDe(m.id, data).length, 0);

  return (
    <div className="crm">
      <EstiloDoCrm />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button className="crm-btn" onClick={() => andar(-1)} aria-label="Anterior">◀</button>
        <button className="crm-btn" onClick={() => setDia(hoje)}>Hoje</button>
        <button className="crm-btn" onClick={() => andar(1)} aria-label="Próximo">▶</button>
        <input className="crm-input" type="date" style={{ width: 160 }} value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} />
        <b style={{ fontSize: "0.95rem", marginLeft: 4 }}>
          {vista === "dia" ? `${NOMES_DOS_DIAS[diaDaSemana(dia)]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}` : `${dataCurta(dia)} a ${dataCurta(somarDias(dia, 6))}`}
        </b>
        {vista === "dia" && pronta && <span className="crm-selo" style={{ background: "#DCFCE7", color: "#166534" }}>{totalDeVagasNoDia(dia)} vaga(s) no dia</span>}
        <span style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", gap: 4 }}>
          <button className={`crm-chip${vista === "dia" ? " on" : ""}`} onClick={() => setVista("dia")}>Dia</button>
          <button className={`crm-chip${vista === "semana" ? " on" : ""}`} onClick={() => setVista("semana")}>Semana</button>
        </div>
        {modo === "VENDEDOR" && agenda && <button className="crm-btn" onClick={() => setHorariosDe(agenda.quem.id)}>🕘 Meus horários</button>}
        {agenda && (podeMarcarEm(agenda.quem.id) || modo === "ADMIN") && (
          <button className="crm-btn crm-btn-primary" onClick={() => setMarcar({ vendedorId: modo === "VENDEDOR" ? agenda.quem.id : equipe[0]?.id || "", data: dia, hora: "10:00" })}>+ Marcar</button>
        )}
      </div>

      {erro && <div className="crm-erro" style={{ marginBottom: 12 }}>{erro}</div>}
      {agenda && equipe.length === 0 && (
        <div className="crm-card crm-vazio" style={{ height: "auto" }}>
          <div style={{ fontSize: "1.6rem" }}>📅</div>
          Nenhum vendedor ativo na equipe. Cadastre vendedores na aba Vendedores e a agenda de cada um aparece aqui.
        </div>
      )}

      {agenda && !pronta && equipe.length > 0 && <div className="crm-card crm-vazio" style={{ height: 160 }}>Carregando a agenda…</div>}

      {pronta && equipe.length > 0 && vista === "semana" && (
        <div className="crm-card" style={{ overflowX: "auto" }}>
          <table className="crm-tabela crm-semana">
            <thead>
              <tr>
                <th>Vendedor</th>
                {Array.from({ length: 7 }, (_, i) => somarDias(dia, i)).map((d) => (
                  <th key={d} style={{ textAlign: "center", color: d === hoje ? "#E8360C" : undefined }}>{dataCurta(d)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {equipe.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                    {m.nome}
                    {modo === "ADMIN" && <button className="crm-btn crm-btn-sm" style={{ marginLeft: 6 }} onClick={() => setHorariosDe(m.id)} title="Horários de trabalho">🕘</button>}
                  </td>
                  {Array.from({ length: 7 }, (_, i) => somarDias(dia, i)).map((d) => {
                    const vagas = vagasDe(m.id, d).length;
                    const reunioes = reunioesDe(m.id, d).filter((r) => r.status !== "CANCELADA" && r.tipo !== "BLOQUEIO").length;
                    const trabalha = (m.disponibilidade.dias[String(diaDaSemana(d))] || []).length > 0;
                    return (
                      <td key={d} className="dia" onClick={() => { setDia(d); setVista("dia"); }} title="Abrir o dia">
                        {!trabalha && reunioes === 0 ? (
                          <span className="crm-muted" style={{ fontSize: "0.72rem" }}>folga</span>
                        ) : (
                          <>
                            <div style={{ fontWeight: 800, color: vagas > 0 ? "#15803D" : "#B91C1C", fontSize: "0.86rem" }}>{vagas > 0 ? `${vagas} vaga${vagas > 1 ? "s" : ""}` : "lotado"}</div>
                            <div className="crm-sub" style={{ fontSize: "0.68rem" }}>{reunioes} reuniã{reunioes === 1 ? "o" : "es"}</div>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pronta && equipe.length > 0 && vista === "dia" && (
        <div className="crm-agenda-grade" style={{ gridTemplateColumns: `52px repeat(${equipe.length}, minmax(170px, 1fr))` }}>
          <div className="crm-agenda-cab" style={{ borderLeft: "none" }} />
          {equipe.map((m) => {
            const vagas = vagasDe(m.id, dia).length;
            return (
              <div key={m.id} className="crm-agenda-cab" style={{ borderLeft: "1px solid #EEF0F3" }}>
                <div style={{ fontWeight: 800, fontSize: "0.84rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m.nome}{modo === "VENDEDOR" && m.id === agenda.quem.id ? " (você)" : ""}
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center", marginTop: 3 }}>
                  <span style={{ fontSize: "0.72rem", fontWeight: 800, color: vagas > 0 ? "#15803D" : "#94A3B8" }}>{vagas > 0 ? `${vagas} vaga${vagas > 1 ? "s" : ""}` : "sem vaga"}</span>
                  {(modo === "ADMIN" || m.id === agenda.quem.id) && <button className="crm-btn crm-btn-sm" style={{ padding: "1px 6px" }} onClick={() => setHorariosDe(m.id)} title="Horários de trabalho">🕘</button>}
                </div>
              </div>
            );
          })}

          {/* horas */}
          <div style={{ position: "relative", height: (fimGrade - iniGrade) * PX_POR_MIN }}>
            {Array.from({ length: Math.floor((fimGrade - iniGrade) / 60) + 1 }, (_, i) => iniGrade + i * 60).map((t) => (
              <div key={t} className="crm-agenda-hora" style={{ position: "absolute", top: (t - iniGrade) * PX_POR_MIN, right: 0, left: 0, transform: t === iniGrade ? "none" : undefined }}>{horarioDosMinutos(t)}</div>
            ))}
          </div>

          {equipe.map((m) => {
            const faixas = m.disponibilidade.dias[String(diaDaSemana(dia))] || [];
            const minhas = reunioesDe(m.id, dia);
            const vagas = vagasDe(m.id, dia);
            const podeMarcar = podeMarcarEm(m.id);
            return (
              <div
                key={m.id}
                className="crm-agenda-col"
                style={{
                  height: (fimGrade - iniGrade) * PX_POR_MIN,
                  background: "repeating-linear-gradient(135deg, #F8FAFC, #F8FAFC 6px, #F1F5F9 6px, #F1F5F9 12px)",
                  cursor: podeMarcar ? "copy" : "default",
                }}
                onClick={(e) => {
                  if (!podeMarcar || e.target !== e.currentTarget) return;
                  const y = e.nativeEvent.offsetY;
                  const t = Math.floor((iniGrade + y / PX_POR_MIN) / 15) * 15;
                  setMarcar({ vendedorId: m.id, data: dia, hora: horarioDosMinutos(Math.max(0, Math.min(t, 23 * 60 + 45))) });
                }}
              >
                {/* linhas das horas */}
                {Array.from({ length: Math.floor((fimGrade - iniGrade) / 60) + 1 }, (_, i) => (
                  <div key={i} style={{ position: "absolute", left: 0, right: 0, top: i * 60 * PX_POR_MIN, borderTop: "1px solid #EEF0F3", pointerEvents: "none" }} />
                ))}
                {/* faixas de trabalho (fundo branco) */}
                {faixas.map(([a, b]: Faixa) => {
                  const ia = minutosDoHorario(a) ?? 0;
                  const ib = minutosDoHorario(b) ?? 0;
                  return <div key={a + b} style={{ position: "absolute", left: 0, right: 0, top: (ia - iniGrade) * PX_POR_MIN, height: (ib - ia) * PX_POR_MIN, background: "#FFFFFF", pointerEvents: "none" }} />;
                })}
                {vagas.map((iso) => {
                  const t = minutosNoFuso(iso);
                  return (
                    <div
                      key={iso}
                      className="crm-vaga"
                      style={{ top: (t - iniGrade) * PX_POR_MIN + 2, height: m.disponibilidade.duracaoMin * PX_POR_MIN - 4, cursor: podeMarcar ? "pointer" : "default", opacity: podeMarcar ? 1 : 0.75 }}
                      onClick={(e) => { e.stopPropagation(); if (podeMarcar) setMarcar({ vendedorId: m.id, data: dia, hora: horaDe(iso) }); }}
                      title={podeMarcar ? "Marcar neste horário" : "Horário livre"}
                    >
                      {horaDe(iso)} livre{podeMarcar ? " · marcar" : ""}
                    </div>
                  );
                })}
                {minhas.map((r) => {
                  const a = minutosNoFuso(r.inicio);
                  const b = Math.max(a + 15, minutosNoFuso(r.fim) || a + 45);
                  const cor = COR_DA_REUNIAO(r);
                  return (
                    <div
                      key={r.id}
                      className="crm-reuniao"
                      style={{ top: (a - iniGrade) * PX_POR_MIN + 1, height: Math.max((b - a) * PX_POR_MIN - 2, 20), background: cor.fundo, borderColor: cor.borda, color: cor.texto, cursor: r.mascarada ? "default" : "pointer", textDecoration: r.status === "CANCELADA" ? "line-through" : undefined }}
                      onClick={(e) => { e.stopPropagation(); if (!r.mascarada) setAberta(r); }}
                      title={r.titulo}
                    >
                      <b>{horaDe(r.inicio)}</b> {r.titulo}
                      {r.contato?.telefone && <div style={{ opacity: 0.8 }}>{r.contato.telefone}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {agenda && vista === "dia" && equipe.length > 0 && (
        <div className="crm-sub" style={{ marginTop: 8 }}>
          Verde = horário livre para demonstração. Área listrada = fora do horário de trabalho. {modo === "ADMIN" ? "Clique em qualquer ponto de uma coluna para marcar naquela hora." : "Na sua coluna, clique para marcar."}
        </div>
      )}

      {marcar && agenda && (
        <ModalDeReuniao
          modo={modo}
          vendedores={vendedoresParaSelecao}
          inicial={marcar}
          aoFechar={() => setMarcar(null)}
          aoSalvar={() => { setMarcar(null); void carregar(); }}
        />
      )}
      {aberta && agenda && (
        <DetalheDaReuniao
          reuniao={aberta}
          modo={modo}
          vendedores={vendedoresParaSelecao}
          aoFechar={() => setAberta(null)}
          aoMudar={() => { setAberta(null); void carregar(); }}
          aoAbrirConversa={aoAbrirConversa}
        />
      )}
      {horariosDe && agenda && (
        <EditorDeHorarios
          vendedorId={horariosDe}
          nome={equipe.find((m) => m.id === horariosDe)?.nome || ""}
          aoFechar={() => setHorariosDe(null)}
          aoSalvar={() => { setHorariosDe(null); void carregar(); }}
        />
      )}
    </div>
  );
}

function DetalheDaReuniao({ reuniao, modo, vendedores, aoFechar, aoMudar, aoAbrirConversa }: {
  reuniao: ReuniaoDaTela; modo: "ADMIN" | "VENDEDOR"; vendedores: { id: string; nome: string }[];
  aoFechar: () => void; aoMudar: () => void; aoAbrirConversa?: (id: string) => void;
}) {
  const dataAtual = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(reuniao.inicio));
  const [data, setData] = useState(dataAtual);
  const [hora, setHora] = useState(horaDe(reuniao.inicio));
  const [vendedorId, setVendedorId] = useState(reuniao.vendedorId);
  const [local, setLocal] = useState(reuniao.local || "");
  const [observacao, setObservacao] = useState(reuniao.observacao || "");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [lembreteEm, setLembreteEm] = useState<string | null>(reuniao.lembreteEm);

  // Uma pessoa clica e o lembrete sai pelo WhatsApp do FireHub — nunca sozinho.
  const lembrar = async () => {
    if (!confirm(`Mandar agora o lembrete da reunião para ${reuniao.contato?.nomeDaLoja || reuniao.contato?.nome || "o contato"} pelo WhatsApp do FireHub?`)) return;
    setErro(null); setOcupado(true);
    const r = await api(`/api/crm/agenda/${reuniao.id}/lembrete`, { method: "POST" });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    setLembreteEm(r.dados.lembreteEm);
  };

  const patch = async (corpo: Record<string, unknown>) => {
    setErro(null); setOcupado(true);
    const r = await api(`/api/crm/agenda/${reuniao.id}`, { method: "PATCH", json: corpo });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    aoMudar();
  };
  const cancelar = async () => {
    if (!confirm(reuniao.tipo === "BLOQUEIO" ? "Liberar este horário?" : "Cancelar esta reunião?")) return;
    setOcupado(true);
    const r = await api(`/api/crm/agenda/${reuniao.id}`, { method: "DELETE" });
    setOcupado(false);
    if (!r.ok) { setErro(r.erro); return; }
    aoMudar();
  };
  const mudouHorario = data !== dataAtual || hora !== horaDe(reuniao.inicio) || vendedorId !== reuniao.vendedorId;

  return (
    <Modal titulo={reuniao.titulo} aoFechar={aoFechar} largura={500}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="crm-linha"><span>Tipo</span><span>{ROTULO_DO_TIPO_DE_REUNIAO[reuniao.tipo as TipoDeReuniao] || reuniao.tipo}</span></div>
        <div className="crm-linha"><span>Situação</span><span>{ROTULO_DO_STATUS_DE_REUNIAO[reuniao.status as StatusDeReuniao] || reuniao.status}</span></div>
        <div className="crm-linha"><span>Vendedor</span><span>{reuniao.vendedorNome}</span></div>
        {reuniao.contato && (
          <div className="crm-linha">
            <span>Com</span>
            <span>
              {reuniao.contato.nomeDaLoja || reuniao.contato.nome || "Contato"}{reuniao.contato.telefone ? ` · ${reuniao.contato.telefone}` : ""}
              {aoAbrirConversa && <button className="crm-btn crm-btn-sm" style={{ marginLeft: 6 }} onClick={() => { aoFechar(); aoAbrirConversa(reuniao.contato!.id); }}>💬 Conversa</button>}
            </span>
          </div>
        )}
        {reuniao.criadoPorNome && <div className="crm-linha"><span>Marcada por</span><span>{reuniao.criadoPorNome}</span></div>}

        {reuniao.status === "MARCADA" && reuniao.tipo !== "BLOQUEIO" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="crm-btn crm-btn-sm" disabled={ocupado} onClick={() => patch({ status: "REALIZADA" })}>✓ Foi feita</button>
            <button className="crm-btn crm-btn-sm" disabled={ocupado} onClick={() => patch({ status: "FALTOU" })}>Não compareceu</button>
            {reuniao.contato && new Date(reuniao.inicio).getTime() > Date.now() && (
              <button className="crm-btn crm-btn-sm" disabled={ocupado} onClick={lembrar} title="Manda o lembrete agora, pelo WhatsApp do FireHub">
                📲 {lembreteEm ? "Lembrar de novo" : "Mandar lembrete"}
              </button>
            )}
          </div>
        )}
        {lembreteEm && <div className="crm-sub">Lembrete enviado em {new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(lembreteEm))}.</div>}

        <div style={{ borderTop: "1px solid #EEF0F3", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="crm-rotulo">Remarcar</span>
          <div style={{ display: "grid", gridTemplateColumns: modo === "ADMIN" ? "1.2fr 1fr 1.4fr" : "1.2fr 1fr", gap: 8 }}>
            <input className="crm-input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            <input className="crm-input" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            {modo === "ADMIN" && (
              <select className="crm-select" value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            )}
          </div>
          <input className="crm-input" placeholder="Link da chamada ou local" value={local} onChange={(e) => setLocal(e.target.value)} />
          {local && /^https?:\/\//.test(local) && <a href={local} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem", color: "#0F766E", fontWeight: 700 }}>Abrir o link ↗</a>}
          <textarea className="crm-textarea" rows={2} placeholder="Observação" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
        </div>
        {erro && <div className="crm-erro">{erro}</div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <button className="crm-btn crm-btn-perigo" disabled={ocupado || reuniao.status === "CANCELADA"} onClick={cancelar}>{reuniao.tipo === "BLOQUEIO" ? "Liberar horário" : "Cancelar reunião"}</button>
          <button className="crm-btn crm-btn-dark" disabled={ocupado} onClick={() => patch({
            ...(mudouHorario ? { data, hora, ...(modo === "ADMIN" && vendedorId !== reuniao.vendedorId ? { vendedorId } : {}) } : {}),
            local, observacao,
          })}>{ocupado ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Os horários de trabalho da semana de um vendedor — de onde saem as vagas. */
function EditorDeHorarios({ vendedorId, nome, aoFechar, aoSalvar }: { vendedorId: string; nome: string; aoFechar: () => void; aoSalvar: () => void }) {
  const [config, setConfig] = useState<Disponibilidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void api(`/api/crm/agenda/disponibilidade?vendedorId=${encodeURIComponent(vendedorId)}`).then((r) => {
      if (r.ok) setConfig(r.dados.config); else setErro(r.erro);
    });
  }, [vendedorId]);

  const mudarFaixa = (dia: number, i: number, lado: 0 | 1, valor: string) => {
    if (!config) return;
    const faixas = [...(config.dias[String(dia)] || [])].map((f) => [...f] as Faixa);
    faixas[i][lado] = valor;
    setConfig({ ...config, dias: { ...config.dias, [String(dia)]: faixas } });
  };
  const addFaixa = (dia: number) => {
    if (!config) return;
    const faixas = [...(config.dias[String(dia)] || [])];
    const ultima = faixas[faixas.length - 1];
    const ini = ultima ? (minutosDoHorario(ultima[1]) ?? 12 * 60) + 60 : 9 * 60;
    faixas.push([horarioDosMinutos(Math.min(ini, 22 * 60)), horarioDosMinutos(Math.min(ini + 3 * 60, 23 * 60 + 59))]);
    setConfig({ ...config, dias: { ...config.dias, [String(dia)]: faixas } });
  };
  const tirarFaixa = (dia: number, i: number) => {
    if (!config) return;
    const faixas = (config.dias[String(dia)] || []).filter((_, j) => j !== i);
    setConfig({ ...config, dias: { ...config.dias, [String(dia)]: faixas } });
  };

  const salvar = async () => {
    if (!config) return;
    setSalvando(true);
    setErro(null);
    const r = await api("/api/crm/agenda/disponibilidade", { method: "PUT", json: { vendedorId, config } });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    aoSalvar();
  };

  return (
    <Modal titulo={`Horários de ${nome || "vendedor"}`} aoFechar={aoFechar} largura={560}>
      {!config ? <div className="crm-sub">{erro || "Carregando…"}</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="crm-sub">As vagas da agenda saem destes horários: cada demonstração ocupa a duração abaixo, com o intervalo entre uma e outra.</div>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const faixas = config.dias[String(d)] || [];
            return (
              <div key={d} style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 8, alignItems: "start", borderBottom: "1px solid #F1F3F5", paddingBottom: 8 }}>
                <b style={{ fontSize: "0.84rem", paddingTop: 7 }}>{NOMES_DOS_DIAS[d]}</b>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {faixas.length === 0 && <span className="crm-muted" style={{ fontSize: "0.8rem", paddingTop: 7 }}>folga</span>}
                  {faixas.map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input className="crm-input" type="time" style={{ width: 120 }} value={f[0]} onChange={(e) => mudarFaixa(d, i, 0, e.target.value)} />
                      <span className="crm-sub">até</span>
                      <input className="crm-input" type="time" style={{ width: 120 }} value={f[1]} onChange={(e) => mudarFaixa(d, i, 1, e.target.value)} />
                      <button className="crm-btn crm-btn-sm" onClick={() => tirarFaixa(d, i)} aria-label="Tirar faixa">×</button>
                    </div>
                  ))}
                  <button className="crm-btn crm-btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => addFaixa(d)}>+ faixa</button>
                </div>
              </div>
            );
          })}
          <div className="crm-grade2">
            <label><span className="crm-rotulo">Duração da demonstração</span>
              <select className="crm-select" style={{ width: "100%" }} value={config.duracaoMin} onChange={(e) => setConfig({ ...config, duracaoMin: Number(e.target.value) })}>
                {[20, 30, 40, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
            <label><span className="crm-rotulo">Intervalo entre uma e outra</span>
              <select className="crm-select" style={{ width: "100%" }} value={config.intervaloMin} onChange={(e) => setConfig({ ...config, intervaloMin: Number(e.target.value) })}>
                {[0, 5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
          </div>
          {erro && <div className="crm-erro">{erro}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="crm-btn" onClick={aoFechar}>Cancelar</button>
            <button className="crm-btn crm-btn-primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar horários"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
